/** Temporary-script k6 execution and summary parsing. */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Performance metrics retained for baseline comparison. */
export interface K6Metrics {
  /** 95th-percentile HTTP response duration in milliseconds. */
  p95ResponseTimeMs: number;
  /** Failed-request fraction from 0 to 1. */
  errorRate: number;
  /** HTTP requests completed per second. */
  requestsPerSecond: number;
}

/** Options for a basic k6 load run. */
export interface K6RunOptions {
  url: string;
  vus: number;
  durationSeconds: number;
  executor?: K6CommandExecutor;
}

/** Safe k6 execution outcome. */
export type K6RunResult =
  | { ok: true; metrics: K6Metrics }
  | { ok: false; error: string };

/** Result produced by the system k6 command boundary. */
export type K6CommandResult =
  | { ok: true }
  | { ok: false; notFound?: boolean; error: string };

/** Injectable boundary around the external k6 executable. */
export interface K6CommandExecutor {
  /** Runs k6 with a generated script and summary destination. */
  run(scriptPath: string, summaryPath: string): Promise<K6CommandResult>;
}

interface K6SummaryMetric {
  values?: Record<string, unknown>;
}

interface K6Summary {
  metrics?: Record<string, K6SummaryMetric>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metricNumber(summary: K6Summary, metric: string, value: string): number | undefined {
  const candidate = summary.metrics?.[metric]?.values?.[value];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}

/**
 * Parses a k6 `--summary-export` JSON document into baseline metrics.
 *
 * @param input - Parsed k6 summary JSON.
 * @returns Metrics or a concise missing/invalid-metric error.
 */
export function parseK6Summary(input: unknown): K6RunResult {
  if (!isRecord(input)) return { ok: false, error: 'k6 summary is not a JSON object' };
  const summary = input as K6Summary;
  const p95ResponseTimeMs = metricNumber(summary, 'http_req_duration', 'p(95)');
  const errorRate = metricNumber(summary, 'http_req_failed', 'rate');
  const requestsPerSecond = metricNumber(summary, 'http_reqs', 'rate');
  if (p95ResponseTimeMs === undefined || errorRate === undefined || requestsPerSecond === undefined) {
    return { ok: false, error: 'k6 summary is missing http_req_duration p(95), http_req_failed rate, or http_reqs rate' };
  }
  if (p95ResponseTimeMs < 0 || errorRate < 0 || errorRate > 1 || requestsPerSecond < 0) {
    return { ok: false, error: 'k6 summary contains out-of-range performance metrics' };
  }
  return { ok: true, metrics: { p95ResponseTimeMs, errorRate, requestsPerSecond } };
}

/** Generates the minimal JavaScript load test passed to k6. */
export function createK6Script(url: string, vus: number, durationSeconds: number): string {
  return [
    "import http from 'k6/http';",
    "import { check } from 'k6';",
    '',
    `export const options = { vus: ${vus}, duration: '${durationSeconds}s' };`,
    '',
    'export default function () {',
    `  const response = http.get(${JSON.stringify(url)});`,
    "  check(response, { 'status is below 400': (result) => result.status < 400 });",
    '}',
    ''
  ].join('\n');
}

/** Default executor that invokes the user-installed `k6` executable. */
export const systemK6Executor: K6CommandExecutor = {
  run(scriptPath: string, summaryPath: string): Promise<K6CommandResult> {
    return new Promise((resolve) => {
      execFile(
        'k6',
        ['run', '--summary-export', summaryPath, scriptPath],
        { windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ ok: true });
            return;
          }
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            resolve({ ok: false, notFound: true, error: 'k6 executable was not found' });
            return;
          }
          const detail = stderr.trim() || stdout.trim() || error.message;
          resolve({ ok: false, error: `k6 execution failed: ${detail}` });
        }
      );
    });
  }
};

/**
 * Generates a temporary k6 script, executes it, and parses its summary.
 * Temporary files are removed on every outcome and failures never throw.
 *
 * @param options - Target URL, virtual users, duration, and optional executor.
 * @returns Parsed performance metrics or an actionable error.
 */
export async function runK6(options: K6RunOptions): Promise<K6RunResult> {
  let temporaryDirectory: string | undefined;
  try {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'prova-k6-'));
    const scriptPath = path.join(temporaryDirectory, 'baseline.js');
    const summaryPath = path.join(temporaryDirectory, 'summary.json');
    await writeFile(scriptPath, createK6Script(options.url, options.vus, options.durationSeconds), 'utf-8');
    const commandResult = await (options.executor ?? systemK6Executor).run(scriptPath, summaryPath);
    if (!commandResult.ok) {
      return commandResult.notFound
        ? { ok: false, error: 'k6 not found — install from https://k6.io/docs/get-started/installation/' }
        : { ok: false, error: commandResult.error };
    }
    let summary: unknown;
    try {
      summary = JSON.parse(await readFile(summaryPath, 'utf-8')) as unknown;
    } catch {
      return { ok: false, error: 'k6 did not produce a valid JSON summary' };
    }
    return parseK6Summary(summary);
  } catch (error) {
    return { ok: false, error: `Unable to run k6: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
