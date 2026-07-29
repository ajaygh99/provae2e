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

export type PerformanceNoiseFloors = Partial<Record<keyof StoredPerformanceMetrics, number>>;

const DEFAULT_ABSOLUTE_NOISE_FLOORS: Required<PerformanceNoiseFloors> = {
  p50ResponseTimeMs: 5,
  p95ResponseTimeMs: 5,
  p99ResponseTimeMs: 5,
  errorRate: 0.001,
  requestsPerSecond: 1
};

/** Compares latency/error increases and throughput decreases against a percentage threshold. */
export function detectRegressions(
  current: StoredPerformanceMetrics,
  baseline: StoredPerformanceMetrics,
  thresholdPercent = 10,
  noiseFloorPercent = 2,
  absoluteNoiseFloors: PerformanceNoiseFloors = {}
): PerformanceRegression[] {
  if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0) throw new Error('Regression threshold must be non-negative');
  if (!Number.isFinite(noiseFloorPercent) || noiseFloorPercent < 0) throw new Error('Noise floor must be non-negative');
  const floors = { ...DEFAULT_ABSOLUTE_NOISE_FLOORS, ...absoluteNoiseFloors };
  const regressions: PerformanceRegression[] = [];
  const compare = (metric: keyof StoredPerformanceMetrics, worseWhenHigher: boolean): void => {
    const previous = baseline[metric];
    const next = current[metric];
    if (![previous, next, floors[metric]].every((value) => Number.isFinite(value) && value >= 0)) {
      throw new Error(`Performance metric ${metric} and its noise floor must be finite and non-negative`);
    }
    const raw = previous === 0 ? (next === 0 ? 0 : 100) : ((next - previous) / previous) * 100;
    const degradation = worseWhenHigher ? raw : -raw;
    const absoluteDegradation = worseWhenHigher ? next - previous : previous - next;
    if (degradation >= Math.max(thresholdPercent, noiseFloorPercent)
      && absoluteDegradation >= floors[metric]) {
      regressions.push({
        metric, baseline: previous, current: next, changePercent: degradation,
        message: `${metric} degraded ${degradation.toFixed(2)}% (was ${previous}, now ${next}; `
          + `policy: ${thresholdPercent}% and ${floors[metric]} absolute)`
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

/** Reports whether the last three runs materially degraded in p95 latency. */
export function hasDegradingTrend(
  runs: readonly PerformanceRun[],
  noiseFloorPercent = 2,
  absoluteNoiseFloorMs = 5
): boolean {
  if (![noiseFloorPercent, absoluteNoiseFloorMs].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('Trend noise floors must be finite and non-negative');
  }
  if (runs.length < 3) return false;
  const recent = runs.slice(-3);
  const materiallyWorse = (previous: number, next: number): boolean => {
    if (![previous, next].every((value) => Number.isFinite(value) && value >= 0)) return false;
    const percent = previous === 0 ? (next === 0 ? 0 : 100) : ((next - previous) / previous) * 100;
    return next - previous >= absoluteNoiseFloorMs && percent >= noiseFloorPercent;
  };
  return materiallyWorse(recent[0].p95ResponseTimeMs, recent[1].p95ResponseTimeMs)
    && materiallyWorse(recent[1].p95ResponseTimeMs, recent[2].p95ResponseTimeMs);
}
