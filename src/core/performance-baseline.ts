/** Baseline persistence and fixed-threshold regression comparison. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { K6Metrics } from './k6-runner.js';

/** Baseline load outcome; `baseline` is absent when the file does not exist. */
export type BaselineLoadResult =
  | { ok: true; baseline?: K6Metrics }
  | { ok: false; error: string };

function isMetrics(value: unknown): value is K6Metrics {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['p95ResponseTimeMs'] === 'number'
    && Number.isFinite(candidate['p95ResponseTimeMs'])
    && candidate['p95ResponseTimeMs'] >= 0
    && typeof candidate['errorRate'] === 'number'
    && Number.isFinite(candidate['errorRate'])
    && candidate['errorRate'] >= 0
    && candidate['errorRate'] <= 1
    && typeof candidate['requestsPerSecond'] === 'number'
    && Number.isFinite(candidate['requestsPerSecond'])
    && candidate['requestsPerSecond'] >= 0;
}

/** Loads and validates a baseline; a missing file is a successful empty result. */
export async function loadPerformanceBaseline(filePath: string): Promise<BaselineLoadResult> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf-8')) as unknown;
    return isMetrics(parsed)
      ? { ok: true, baseline: parsed }
      : { ok: false, error: `Performance baseline is invalid: ${filePath}` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true };
    if (error instanceof SyntaxError) return { ok: false, error: `Performance baseline is not valid JSON: ${filePath}` };
    return { ok: false, error: `Unable to read performance baseline "${filePath}": ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Writes metrics as a formatted baseline JSON document, creating parent directories. */
export async function savePerformanceBaseline(filePath: string, metrics: K6Metrics): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf-8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Unable to write performance baseline "${filePath}": ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Compares latency and error rate against a relative regression threshold.
 * Ultra-fast baselines use a 50 ms p95 floor so timer and local dev-server
 * scheduling noise does not create misleading percentage regressions.
 * A zero error-rate baseline permits no new errors.
 */
export function comparePerformanceMetrics(current: K6Metrics, baseline: K6Metrics, threshold = 0.2): string[] {
  const regressions: string[] = [];
  const latencyLimit = Math.max(
    baseline.p95ResponseTimeMs * (1 + threshold),
    baseline.p95ResponseTimeMs < 50 ? 50 : 0
  );
  const errorLimit = baseline.errorRate * (1 + threshold);
  if (current.p95ResponseTimeMs > latencyLimit) {
    regressions.push(`p95 response time regressed from ${baseline.p95ResponseTimeMs}ms to ${current.p95ResponseTimeMs}ms (limit ${latencyLimit.toFixed(2)}ms)`);
  }
  if (current.errorRate > errorLimit) {
    regressions.push(`error rate regressed from ${(baseline.errorRate * 100).toFixed(2)}% to ${(current.errorRate * 100).toFixed(2)}% (limit ${(errorLimit * 100).toFixed(2)}%)`);
  }
  return regressions;
}
