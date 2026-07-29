/** Temporary-script k6 execution and summary parsing. */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Performance metrics retained for baseline comparison. */
export interface K6Metrics {
  /** 50th-percentile HTTP response duration when reported by k6. */
  p50ResponseTimeMs?: number;
  /** 95th-percentile HTTP response duration in milliseconds. */
  p95ResponseTimeMs: number;
  /** 99th-percentile HTTP response duration when reported by k6. */
  p99ResponseTimeMs?: number;
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
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  executor?: K6CommandExecutor;
  /** Hard wall-clock limit for the k6 process. */
  executionTimeoutMs?: number;
  /** Optional caller cancellation signal. */
  signal?: AbortSignal;
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
  run(
    scriptPath: string,
    summaryPath: string,
    controls?: { timeoutMs: number; signal?: AbortSignal }
  ): Promise<K6CommandResult>;
}

interface K6SummaryMetric {
  values?: Record<string, unknown>;
  [key: string]: unknown;
}

interface K6Summary {
  metrics?: Record<string, K6SummaryMetric>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metricNumber(summary: K6Summary, metric: string, value: string): number | undefined {
  const metricSummary = summary.metrics?.[metric];
  const candidate = metricSummary?.values?.[value] ?? metricSummary?.[value];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}

function redactHeaderValues(message: string, headers?: Record<string, string>): string {
  let redacted = message;
  for (const value of Object.values(headers ?? {})) {
    if (value) redacted = redacted.split(value).join('[REDACTED]');
  }
  return redacted;
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
  const p50ResponseTimeMs = metricNumber(summary, 'http_req_duration', 'p(50)');
  const p99ResponseTimeMs = metricNumber(summary, 'http_req_duration', 'p(99)');
  const errorRate = metricNumber(summary, 'http_req_failed', 'rate')
    ?? metricNumber(summary, 'http_req_failed', 'value');
  const requestsPerSecond = metricNumber(summary, 'http_reqs', 'rate');
  if (p95ResponseTimeMs === undefined || errorRate === undefined || requestsPerSecond === undefined) {
    return { ok: false, error: 'k6 summary is missing http_req_duration p(95), http_req_failed rate, or http_reqs rate' };
  }
  if (p95ResponseTimeMs < 0 || errorRate < 0 || errorRate > 1 || requestsPerSecond < 0) {
    return { ok: false, error: 'k6 summary contains out-of-range performance metrics' };
  }
  return {
    ok: true,
    metrics: {
      ...(p50ResponseTimeMs === undefined ? {} : { p50ResponseTimeMs }),
      p95ResponseTimeMs,
      ...(p99ResponseTimeMs === undefined ? {} : { p99ResponseTimeMs }),
      errorRate,
      requestsPerSecond
    }
  };
}

/** Generates the minimal JavaScript load test passed to k6. */
export function createK6Script(
  url: string,
  vus: number,
  durationSeconds: number,
  request: Pick<K6RunOptions, 'method' | 'headers' | 'body'> = {}
): string {
  const method = request.method ?? 'GET';
  const params = { headers: request.headers ?? {} };
  const call = method === 'GET'
    ? request.headers
      ? `http.get(${JSON.stringify(url)}, ${JSON.stringify(params)})`
      : `http.get(${JSON.stringify(url)})`
    : `http.request(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${JSON.stringify(
      request.body === undefined ? null : JSON.stringify(request.body)
    )}, ${JSON.stringify(params)})`;
  return [
    "import http from 'k6/http';",
    "import { check } from 'k6';",
    '',
    `export const options = { vus: ${vus}, duration: '${durationSeconds}s' };`,
    '',
    'export default function () {',
    `  const response = ${call};`,
    "  check(response, { 'status is below 400': (result) => result.status < 400 });",
    '}',
    ''
  ].join('\n');
}

/** Default executor that invokes the user-installed `k6` executable. */
export const systemK6Executor: K6CommandExecutor = {
  run(
    scriptPath: string,
    summaryPath: string,
    controls = { timeoutMs: 120_000 }
  ): Promise<K6CommandResult> {
    return new Promise((resolve) => {
      execFile(
        'k6',
        ['run', '--summary-export', summaryPath, scriptPath],
        {
          windowsHide: true,
          timeout: controls.timeoutMs,
          maxBuffer: 1024 * 1024,
          ...(controls.signal ? { signal: controls.signal } : {})
        },
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
          if (code === 'ETIMEDOUT' || (error as Error).name === 'AbortError') {
            resolve({
              ok: false,
              error: (error as Error).name === 'AbortError'
                ? 'k6 execution was cancelled'
                : `k6 execution exceeded ${controls.timeoutMs}ms timeout`
            });
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
    const validationError = validateK6Options(options);
    if (validationError) return { ok: false, error: validationError };
    if (options.signal?.aborted) return { ok: false, error: 'k6 execution was cancelled' };
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'prova-k6-'));
    const scriptPath = path.join(temporaryDirectory, 'baseline.js');
    const summaryPath = path.join(temporaryDirectory, 'summary.json');
    await writeFile(scriptPath, createK6Script(options.url, options.vus, options.durationSeconds, options), 'utf-8');
    const executionTimeoutMs = options.executionTimeoutMs
      ?? Math.min((options.durationSeconds * 1000) + 30_000, 3_630_000);
    const commandResult = await (options.executor ?? systemK6Executor).run(
      scriptPath,
      summaryPath,
      { timeoutMs: executionTimeoutMs, ...(options.signal ? { signal: options.signal } : {}) }
    );
    if (!commandResult.ok) {
      return commandResult.notFound
        ? { ok: false, error: 'k6 not found — install from https://k6.io/docs/get-started/installation/' }
        : { ok: false, error: redactHeaderValues(commandResult.error, options.headers) };
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

function validateK6Options(options: K6RunOptions): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    return 'k6 URL must be an absolute http:// or https:// URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'k6 URL must be an absolute http:// or https:// URL';
  }
  if (!Number.isInteger(options.vus) || options.vus < 1 || options.vus > 1000) {
    return 'k6 vus must be an integer from 1 to 1000';
  }
  if (
    !Number.isInteger(options.durationSeconds) ||
    options.durationSeconds < 1 ||
    options.durationSeconds > 3600
  ) {
    return 'k6 durationSeconds must be an integer from 1 to 3600';
  }
  if (
    options.executionTimeoutMs !== undefined &&
    (!Number.isInteger(options.executionTimeoutMs) ||
      options.executionTimeoutMs < 1000 ||
      options.executionTimeoutMs > 3_630_000)
  ) {
    return 'k6 executionTimeoutMs must be an integer from 1000 to 3630000';
  }
  if (options.headers && Object.values(options.headers).some(value => typeof value !== 'string')) {
    return 'k6 headers must contain string values';
  }
  if (options.method && !['GET', 'POST', 'PUT', 'DELETE'].includes(options.method)) {
    return 'k6 method must be GET, POST, PUT, or DELETE';
  }
  if (options.body !== undefined) {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(options.body);
    } catch {
      return 'k6 request body must be JSON-serializable';
    }
    if (serialized === undefined) return 'k6 request body must be JSON-serializable';
    if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) {
      return 'k6 request body cannot exceed 1 MB';
    }
  }
  return undefined;
}
