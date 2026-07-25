import { EvidenceCapture } from '../../src/core/evidence-capture.js';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

jest.setTimeout(60000);

const testOutputDir = path.join(process.cwd(), '.test-evidence-output');

beforeEach(async () => {
  await mkdir(testOutputDir, { recursive: true });
});

afterEach(async () => {
  try {
    await rm(testOutputDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('EvidenceCapture', () => {
  describe('captureScreenshot', () => {
    it('captures screenshot with correct path structure', async () => {
      const mockPage = {
        screenshot: jest.fn().mockResolvedValue(undefined)
      } as unknown as Page;

      const result = await EvidenceCapture.captureScreenshot({
        page: mockPage,
        outputDir: testOutputDir,
        stepId: 'test-step'
      });

      expect(result.path).toContain('screenshot-test-step-');
      expect(result.path).toContain('.png');
      expect(result.metadata.step_id).toBe('test-step');
      expect(result.metadata.mime_type).toBe('image/png');
      expect(mockPage.screenshot).toHaveBeenCalledWith({ path: result.path });
    });

    it('captures screenshot with default step id', async () => {
      const mockPage = {
        screenshot: jest.fn().mockResolvedValue(undefined)
      } as unknown as Page;

      const result = await EvidenceCapture.captureScreenshot({
        page: mockPage,
        outputDir: testOutputDir
      });

      expect(result.metadata.step_id).toBe('default');
    });

    it('includes captured_at timestamp in metadata', async () => {
      const mockPage = {
        screenshot: jest.fn().mockResolvedValue(undefined)
      } as unknown as Page;

      const before = new Date();
      const result = await EvidenceCapture.captureScreenshot({
        page: mockPage,
        outputDir: testOutputDir
      });
      const after = new Date();

      const capturedAt = new Date(result.metadata.captured_at as string);
      expect(capturedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(capturedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('setupConsoleLogCapture', () => {
    it('sets up console listener on page', async () => {
      const listeners = new Map<string, Array<(value: unknown) => void>>();

      const mockPage = {
        on: jest.fn((event: string, handler: (value: unknown) => void): void => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)?.push(handler);
        })
      } as unknown as Page;

      await EvidenceCapture.setupConsoleLogCapture(
        mockPage,
        testOutputDir
      );

      expect(mockPage.on).toHaveBeenCalledWith('console', expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('captures console logs with correct structure', async () => {
      const listeners = new Map<string, Array<(value: unknown) => void>>();

      const mockPage = {
        on: jest.fn((event: string, handler: (value: unknown) => void): void => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)?.push(handler);
        })
      } as unknown as Page;

      await EvidenceCapture.setupConsoleLogCapture(
        mockPage,
        testOutputDir
      );

      // Simulate console messages
      const consoleListener = listeners.get('console')?.[0];
      const mockConsoleMsg1 = {
        type: (): string => 'log',
        text: (): string => 'Test message',
        location: (): { url: string } => ({ url: 'http://example.com' })
      };

      const mockConsoleMsg2 = {
        type: (): string => 'error',
        text: (): string => 'Error message',
        location: (): { url: string } => ({ url: 'http://example.com' })
      };

      if (consoleListener) {
        consoleListener(mockConsoleMsg1);
        consoleListener(mockConsoleMsg2);
      }

      // Simulate page close to trigger file write
      const closeListener = listeners.get('close')?.[0];
      if (closeListener) {
        await closeListener(undefined);
      }

      // Check file was written
      const files = await import('node:fs/promises').then(fs =>
        fs.readdir(testOutputDir)
      );
      expect(files.some(f => f.startsWith('console-logs-'))).toBe(true);

      // Check file contents
      const logFile = path.join(testOutputDir, files.find(f => f.startsWith('console-logs-'))!);
      const content = await readFile(logFile, 'utf-8');
      const parsed = JSON.parse(content);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].level).toBe('log');
      expect(parsed[0].message).toBe('Test message');
      expect(parsed[1].level).toBe('error');
      expect(parsed[1].message).toBe('Error message');
    });

    it('does not write file if no console logs', async () => {
      const listeners = new Map<string, Array<(value: unknown) => void>>();

      const mockPage = {
        on: jest.fn((event: string, handler: (value: unknown) => void): void => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)?.push(handler);
        })
      } as unknown as Page;

      await EvidenceCapture.setupConsoleLogCapture(
        mockPage,
        testOutputDir
      );

      // Don't simulate any console messages, just close
      const closeListener = listeners.get('close')?.[0];
      if (closeListener) {
        await closeListener(undefined);
      }

      // Check no files written
      const files = await import('node:fs/promises').then(fs =>
        fs.readdir(testOutputDir).catch(() => [])
      );
      expect(files.some(f => f.startsWith('console-logs-'))).toBe(false);
    });
  });

  describe('captureNetworkLogs', () => {
    it('sets up network listener on page', async () => {
      const listeners = new Map<string, Array<(value: unknown) => void>>();

      const mockPage = {
        on: jest.fn((event: string, handler: (value: unknown) => void): void => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)?.push(handler);
        })
      } as unknown as Page;

      const result = await EvidenceCapture.captureNetworkLogs(
        mockPage,
        testOutputDir
      );

      expect(result).toContain('network-');
      expect(result).toContain('.har');
      expect(mockPage.on).toHaveBeenCalledWith('response', expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('captures network requests in HAR format', async () => {
      const listeners = new Map<string, Array<(value: unknown) => void>>();

      const mockPage = {
        on: jest.fn((event: string, handler: (value: unknown) => void): void => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)?.push(handler);
        })
      } as unknown as Page;

      await EvidenceCapture.captureNetworkLogs(
        mockPage,
        testOutputDir
      );

      // Simulate network response
      const responseListener = listeners.get('response')?.[0];
      const mockRequest = {
        method: (): string => 'GET',
        url: (): string => 'http://example.com/api',
        headers: (): Record<string, string> => ({ 'content-type': 'application/json' })
      };

      const mockResponse = {
        request: (): typeof mockRequest => mockRequest,
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        status: (): number => 200,
        statusText: (): string => 'OK',
        headers: (): Record<string, string> => ({ 'content-type': 'application/json' }),
        body: jest.fn().mockResolvedValue(Buffer.from('{"data":"value"}'))
      };

      if (responseListener) {
        await responseListener(mockResponse);
      }

      // Simulate page close to trigger file write
      const closeListener = listeners.get('close')?.[0];
      if (closeListener) {
        await closeListener(undefined);
      }

      // Check file was written
      const files = await import('node:fs/promises').then(fs =>
        fs.readdir(testOutputDir)
      );
      const harFile = files.find(f => f.startsWith('network-') && f.endsWith('.har'));
      expect(harFile).toBeDefined();

      // Check HAR file structure
      const content = await readFile(
        path.join(testOutputDir, harFile!),
        'utf-8'
      );
      const parsed = JSON.parse(content);

      expect(parsed.log).toBeDefined();
      expect(parsed.log.version).toBe('1.2.0');
      expect(parsed.log.creator.name).toBe('PROVA');
      expect(Array.isArray(parsed.log.entries)).toBe(true);
      expect(parsed.log.metadata.total_requests).toBe(1);
    });

    it('tracks network metadata correctly', async () => {
      const listeners = new Map<string, Array<(value: unknown) => void>>();

      const mockPage = {
        on: jest.fn((event: string, handler: (value: unknown) => void): void => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)?.push(handler);
        })
      } as unknown as Page;

      await EvidenceCapture.captureNetworkLogs(
        mockPage,
        testOutputDir
      );

      const responseListener = listeners.get('response')?.[0];

      // Simulate 3 requests with different sizes
      for (let i = 0; i < 3; i++) {
        const mockRequest = {
          method: (): string => 'GET',
          url: (): string => `http://example.com/api/${i}`,
          headers: (): Record<string, string> => ({})
        };

        const mockResponse = {
          request: (): typeof mockRequest => mockRequest,
          // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
          status: (): number => 200,
          statusText: (): string => 'OK',
          headers: (): Record<string, string> => ({}),
          body: jest.fn().mockResolvedValue(Buffer.alloc(100 + i * 10))
        };

        if (responseListener) {
          await responseListener(mockResponse);
        }
      }

      const closeListener = listeners.get('close')?.[0];
      if (closeListener) {
        await closeListener(undefined);
      }

      const files = await import('node:fs/promises').then(fs =>
        fs.readdir(testOutputDir)
      );
      const harFile = files.find(f => f.startsWith('network-') && f.endsWith('.har'));
      const content = await readFile(
        path.join(testOutputDir, harFile!),
        'utf-8'
      );
      const parsed = JSON.parse(content);

      expect(parsed.log.metadata.total_requests).toBe(3);
      expect(parsed.log.metadata.total_size_bytes).toBe(330); // 100 + 110 + 120
    });
  });
});
