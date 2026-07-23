/**
 * Sentinel 7-day rolling performance baselines.
 *
 * Establishes a mean + population standard deviation baseline per metric per
 * service over a rolling time window (7 days by default), with an option to
 * exclude weekend samples. Pure, side-effect-free statistics used by the
 * anomaly detector in `sentinel-anomaly.ts`. This module deliberately does NOT
 * replace the fixed-threshold K6 baseline in `performance-baseline.ts`.
 */

/** Performance metrics tracked by Sentinel. */
export type SentinelMetricName =
  | 'p50LatencyMs'
  | 'p95LatencyMs'
  | 'p99LatencyMs'
  | 'throughputRps'
  | 'errorRate'
  | 'cpuPercent'
  | 'memoryMb';

/** All Sentinel metric names, in a stable order. */
export const SENTINEL_METRICS: readonly SentinelMetricName[] = Object.freeze([
  'p50LatencyMs',
  'p95LatencyMs',
  'p99LatencyMs',
  'throughputRps',
  'errorRate',
  'cpuPercent',
  'memoryMb'
]);

/**
 * Whether a metric is "bad" when it goes high (latency, errors, CPU, memory)
 * or "bad" when it goes low (throughput drop).
 */
export const SENTINEL_METRIC_DIRECTION: Readonly<Record<SentinelMetricName, 'high' | 'low'>> = Object.freeze({
  p50LatencyMs: 'high',
  p95LatencyMs: 'high',
  p99LatencyMs: 'high',
  throughputRps: 'low',
  errorRate: 'high',
  cpuPercent: 'high',
  memoryMb: 'high'
});

/** One observed metric value for a service at a point in time. */
export interface MetricSample {
  service: string;
  metric: SentinelMetricName;
  value: number;
  timestamp: string;
}

/** Options controlling how a rolling baseline is computed. */
export interface RollingBaselineOptions {
  /** Reference "now"; defaults to the newest sample timestamp. */
  now?: Date;
  /** Rolling window length in days (default 7). */
  windowDays?: number;
  /** Exclude Saturday/Sunday (UTC) samples when true (default false). */
  ignoreWeekends?: boolean;
  /** Minimum eligible samples required to form a baseline (default 1). */
  minimumSamples?: number;
}

/** A computed rolling baseline for a single service + metric. */
export interface RollingBaseline {
  service: string;
  metric: SentinelMetricName;
  mean: number;
  stddev: number;
  sampleSize: number;
  windowDays: number;
  ignoreWeekends: boolean;
  from: string;
  to: string;
}

const MILLIS_PER_DAY = 86_400_000;

/**
 * Computes the arithmetic mean of a non-empty list of numbers.
 * @param values Finite numbers.
 * @returns The arithmetic mean.
 */
export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('mean requires at least one value');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Computes the population standard deviation of a non-empty list of numbers.
 * @param values Finite numbers.
 * @returns The population standard deviation (sqrt of mean squared deviation).
 */
export function populationStddev(values: readonly number[]): number {
  if (values.length === 0) throw new Error('populationStddev requires at least one value');
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

/**
 * Computes the z-score of a value against a baseline mean and standard deviation.
 * When the standard deviation is zero, returns +/-Infinity for any deviation
 * from the mean and 0 when the value equals the mean.
 * @param value Observed value.
 * @param baselineMean Baseline mean.
 * @param baselineStddev Baseline population standard deviation (must be >= 0).
 * @returns The signed z-score.
 */
export function zScore(value: number, baselineMean: number, baselineStddev: number): number {
  if (!Number.isFinite(value)) throw new Error('zScore value must be finite');
  if (!Number.isFinite(baselineStddev) || baselineStddev < 0) throw new Error('baseline stddev must be a non-negative finite number');
  if (baselineStddev === 0) {
    if (value > baselineMean) return Number.POSITIVE_INFINITY;
    if (value < baselineMean) return Number.NEGATIVE_INFINITY;
    return 0;
  }
  return (value - baselineMean) / baselineStddev;
}

/**
 * Validates a single metric sample and throws a typed Error on bad input.
 * @param sample Candidate metric sample.
 * @returns Nothing; throws when the sample is invalid.
 */
export function validateMetricSample(sample: MetricSample): void {
  if (!sample.service.trim()) throw new Error('MetricSample.service is required');
  if (!SENTINEL_METRICS.includes(sample.metric)) throw new Error(`Unsupported Sentinel metric: ${String(sample.metric)}`);
  if (!Number.isFinite(Date.parse(sample.timestamp))) throw new Error(`Invalid MetricSample.timestamp: ${sample.timestamp}`);
  if (!Number.isFinite(sample.value) || sample.value < 0) throw new Error(`${sample.metric} value must be a non-negative finite number`);
  if (sample.metric === 'errorRate' && sample.value > 1) throw new Error('errorRate must be between 0 and 1');
  if (sample.metric === 'cpuPercent' && sample.value > 100) throw new Error('cpuPercent must be between 0 and 100');
}

/**
 * Computes a rolling mean + population-stddev baseline for one service + metric.
 *
 * All samples must belong to the same service and metric. Samples are filtered
 * to the rolling window `[now - windowDays, now]` (inclusive), optionally
 * dropping weekend samples, before the statistics are computed.
 *
 * @param samples Homogeneous samples for a single service + metric.
 * @param options Window length, reference time, weekend handling, and minimum samples.
 * @returns The rolling baseline for the service + metric.
 * @throws Error when samples are empty, heterogeneous, invalid, or too few in-window.
 */
export function computeRollingBaseline(
  samples: readonly MetricSample[],
  options: RollingBaselineOptions = {}
): RollingBaseline {
  if (samples.length === 0) throw new Error('computeRollingBaseline requires at least one sample');
  samples.forEach(validateMetricSample);

  const { service, metric } = samples[0];
  for (const sample of samples) {
    if (sample.service !== service || sample.metric !== metric) {
      throw new Error('computeRollingBaseline requires samples for a single service and metric');
    }
  }

  const windowDays = options.windowDays ?? 7;
  if (!Number.isFinite(windowDays) || windowDays <= 0) throw new Error('windowDays must be a positive number');
  const minimumSamples = options.minimumSamples ?? 1;
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1) throw new Error('minimumSamples must be a positive integer');
  const ignoreWeekends = options.ignoreWeekends ?? false;

  const now = options.now ?? new Date(Math.max(...samples.map((sample) => Date.parse(sample.timestamp))));
  if (!Number.isFinite(now.getTime())) throw new Error('baseline reference time must be a valid date');
  const windowStart = now.getTime() - windowDays * MILLIS_PER_DAY;

  const eligible = samples.filter((sample) => {
    const time = Date.parse(sample.timestamp);
    if (time < windowStart || time > now.getTime()) return false;
    if (ignoreWeekends && isWeekend(time)) return false;
    return true;
  });

  if (eligible.length < minimumSamples) {
    throw new Error(`At least ${minimumSamples} sample(s) are required within the ${windowDays}-day window (found ${eligible.length})`);
  }

  const values = eligible.map((sample) => sample.value);
  return {
    service,
    metric,
    mean: mean(values),
    stddev: populationStddev(values),
    sampleSize: values.length,
    windowDays,
    ignoreWeekends,
    from: new Date(windowStart).toISOString(),
    to: now.toISOString()
  };
}

/** Returns true when the UTC day of the given epoch time is Saturday or Sunday. */
function isWeekend(epochMillis: number): boolean {
  const day = new Date(epochMillis).getUTCDay();
  return day === 0 || day === 6;
}
