/** Performance regression comparison and CSV trend reporting. */
import type { PerformanceRun, StoredPerformanceMetrics } from './performance-store.js';

/** One degraded metric relative to a baseline. */
export interface PerformanceRegression {
  metric: keyof StoredPerformanceMetrics;
  baseline: number;
  current: number;
  changePercent: number;
  message: string;
}

/** Compares latency/error increases and throughput decreases against a percentage threshold. */
export function detectRegressions(
  current: StoredPerformanceMetrics,
  baseline: StoredPerformanceMetrics,
  thresholdPercent = 10,
  noiseFloorPercent = 2
): PerformanceRegression[] {
  if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0) throw new Error('Regression threshold must be non-negative');
  const regressions: PerformanceRegression[] = [];
  const compare = (metric: keyof StoredPerformanceMetrics, worseWhenHigher: boolean): void => {
    const previous = baseline[metric];
    const next = current[metric];
    const raw = previous === 0 ? (next === 0 ? 0 : 100) : ((next - previous) / previous) * 100;
    const degradation = worseWhenHigher ? raw : -raw;
    if (degradation >= Math.max(thresholdPercent, noiseFloorPercent)) {
      regressions.push({
        metric, baseline: previous, current: next, changePercent: degradation,
        message: `${metric} degraded ${degradation.toFixed(2)}% (was ${previous}, now ${next})`
      });
    }
  };
  compare('p50ResponseTimeMs', true);
  compare('p95ResponseTimeMs', true);
  compare('p99ResponseTimeMs', true);
  compare('errorRate', true);
  compare('requestsPerSecond', false);
  return regressions;
}

/** Exports stored performance runs to CSV. */
export function performanceRunsToCsv(runs: readonly PerformanceRun[]): string {
  const header = 'timestamp,url,vus,duration_seconds,p50,p95,p99,error_rate,rps,status';
  const cell = (value: string | number): string => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${header}\n${runs.map((run) => [run.timestamp, run.url, run.vus, run.durationSeconds,
    run.p50ResponseTimeMs, run.p95ResponseTimeMs, run.p99ResponseTimeMs, run.errorRate,
    run.requestsPerSecond, run.status].map(cell).join(',')).join('\n')}\n`;
}

/** Reports whether the last three runs consistently degraded in p95 latency. */
export function hasDegradingTrend(runs: readonly PerformanceRun[]): boolean {
  if (runs.length < 3) return false;
  const recent = runs.slice(-3);
  return recent[0].p95ResponseTimeMs < recent[1].p95ResponseTimeMs
    && recent[1].p95ResponseTimeMs < recent[2].p95ResponseTimeMs;
}
