/** Utilities for capturing test execution evidence (screenshots, logs, network). */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { log } from './logger.js';

/** Console log entry captured from the browser. */
export interface ConsoleLogEntry {
  level: string;
  message: string;
  stack_trace?: string;
  timestamp: string;
}

/** Network capture metadata. */
export interface NetworkMetadata {
  total_requests: number;
  total_size: number;
  total_duration_ms: number;
}

/** Options for screenshot capture. */
export interface ScreenshotCaptureOptions {
  page: Page;
  outputDir: string;
  stepId?: string;
}

/** Result of capturing a screenshot. */
export interface ScreenshotCaptureResult {
  path: string;
  metadata: Record<string, unknown>;
}

/**
 * Utilities for capturing test execution evidence.
 * Supports screenshots, video, console logs, and network traces.
 */
export class EvidenceCapture {
  /**
   * Captures a screenshot from the current page state.
   * @param options Screenshot capture options.
   * @returns Path to the saved screenshot and metadata.
   */
  static async captureScreenshot(options: ScreenshotCaptureOptions): Promise<ScreenshotCaptureResult> {
    const { page, outputDir, stepId } = options;
    const timestamp = Date.now();
    const fileName = `screenshot-${stepId || 'default'}-${timestamp}.png`;
    const fullPath = path.join(outputDir, fileName);

    await mkdir(outputDir, { recursive: true });
    await page.screenshot({ path: fullPath });

    const metadata = {
      step_id: stepId || 'default',
      captured_at: new Date().toISOString(),
      mime_type: 'image/png'
    };

    log.info('Screenshot captured', { path: fullPath, stepId });
    return { path: fullPath, metadata };
  }

  /**
   * Sets up console log capture on a page.
   * Writes captured logs to a JSON file.
   * @param page The Playwright page to capture console logs from.
   * @param outputDir Directory to write console logs.
   */
  static async setupConsoleLogCapture(page: Page, outputDir: string): Promise<void> {
    const logs: ConsoleLogEntry[] = [];

    page.on('console', (msg) => {
      logs.push({
        level: msg.type(),
        message: msg.text(),
        stack_trace: msg.location()?.url,
        timestamp: new Date().toISOString()
      });
    });

    page.on('close', async () => {
      if (logs.length === 0) return;

      const timestamp = Date.now();
      const fileName = `console-logs-${timestamp}.json`;
      const fullPath = path.join(outputDir, fileName);

      await mkdir(outputDir, { recursive: true });
      await writeFile(fullPath, JSON.stringify(logs, null, 2));
      log.info('Console logs saved', { path: fullPath, count: logs.length });
    });

    log.info('Console log capture enabled', { outputDir });
  }

  /**
   * Captures network activity as HAR (HTTP Archive) format.
   * Records request/response headers, timing, and payload sizes.
   * @param page The Playwright page to capture network from.
   * @param outputDir Directory to write the HAR file.
   * @returns Path to the saved HAR file.
   */
  static async captureNetworkLogs(page: Page, outputDir: string): Promise<string> {
    const har = {
      log: {
        version: '1.2.0',
        creator: { name: 'PROVA', version: '1.0.0' },
        entries: [] as Array<Record<string, unknown>>
      }
    };

    const startTime = Date.now();
    let totalSize = 0;
    let requestCount = 0;

    page.on('response', async (response) => {
      requestCount++;
      try {
        const request = response.request();
        const size = (await response.body()).length;
        totalSize += size;

        har.log.entries.push({
          startedDateTime: new Date(startTime).toISOString(),
          time: Date.now() - startTime,
          request: {
            method: request.method(),
            url: request.url(),
            headers: request.headers()
          },
          response: {
            status: response.status(),
            statusText: response.statusText(),
            headers: response.headers()
          },
          cache: {},
          timings: {
            wait: 0,
            receive: Date.now() - startTime
          }
        });
      } catch (err) {
        log.warn('Failed to capture network entry', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    });

    const timestamp = Date.now();
    const fileName = `network-${timestamp}.har`;
    const fullPath = path.join(outputDir, fileName);

    page.on('close', async () => {
      await mkdir(outputDir, { recursive: true });
      const harContent = {
        ...har,
        log: {
          ...har.log,
          metadata: {
            total_requests: requestCount,
            total_size_bytes: totalSize,
            total_duration_ms: Date.now() - startTime
          }
        }
      };
      await writeFile(fullPath, JSON.stringify(harContent, null, 2));
      log.info('Network logs saved', {
        path: fullPath,
        requestCount,
        totalSize
      });
    });

    log.info('Network log capture enabled', { outputDir });
    return fullPath;
  }
}
