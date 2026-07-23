/**
 * Sentinel anomaly detection, degradation trends, causation, and export.
 *
 * Consumes the rolling baselines from `sentinel-baseline.ts` and:
 *  - flags a metric window as anomalous when its z-score crosses a threshold
 *    (default 2.0), respecting the metric's "bad" direction;
 *  - alerts only when the anomaly persists across 2+ consecutive 5-minute windows;
 *  - detects gradual degradation trends (e.g. latency +2%/day for 5 days);
 *  - links an anomaly to the closest preceding deployment (commit) or load spike;
 *  - exports the result through an injected, mockable exporter boundary so no
 *    live network calls occur in code paths that tests exercise.
 */
import { log } from './logger.js';
import {
  SENTINEL_METRIC_DIRECTION,
  computeRollingBaseline,
  zScore,
  type MetricSample,
  type RollingBaseline,
  type RollingBaselineOptions,
  type SentinelMetricName
} from './sentinel-baseline.js';

/** One aggregated observation for a single 5-minute window. */
export interface WindowObservation {
  timestamp: string;
  value: number;
}

/** Z-score assessment of a single window against a baseline. */
export interface WindowAssessment {
  timestamp: string;
  value: number;
  zScore: number;
  anomalous: boolean;
}

/** Result of the persistence-of-anomaly check across consecutive windows. */
export interface PersistenceResult {
  windows: WindowAssessment[];
  maxConsecutiveAnomalies: number;
  trailingConsecutiveAnomalies: number;
  requiredWindows: number;
  persistent: boolean;
}

/** Options for the persistent-anomaly check. */
export interface PersistenceOptions {
  /** Z-score magnitude that marks a window anomalous (default 2.0). */
  zScoreThreshold?: number;
  /** Consecutive anomalous windows required to alert (default 2). */
  requiredWindows?: number;
}

/** One daily aggregated value used for trend analysis. */
export interface DailyValue {
  date: string;
  value: number;
}

/** Result of the gradual-degradation trend check. */
export interface TrendResult {
  metric: SentinelMetricName;
  direction: 'high' | 'low';
  dailyPercentChanges: number[];
  sustainedDays: number;
  slopePerDay: number;
  degrading: boolean;
}

/** Options for the degradation-trend check. */
export interface TrendOptions {
  /** Minimum absolute day-over-day percent change to count (default 2). */
  minDailyPercent?: number;
  /** Consecutive qualifying day-over-day moves required (default 5). */
  minSustainedDays?: number;
}

/** A code deployment that may explain an anomaly. */
export interface Deployment {
  sha: string;
  timestamp: string;
  description?: string;
}

/** A load spike that may explain an anomaly. */
export interface LoadSpike {
  timestamp: string;
  magnitude: number;
}

/** The most likely cause linked to an anomaly. */
export interface Causation {
  type: 'deployment' | 'load-spike' | 'unknown';
  reference?: string;
  timestamp?: string;
  minutesBefore?: number;
  description?: string;
}

/** Options for causation correlation. */
export interface CausationOptions {
  deployments?: readonly Deployment[];
  loadSpikes?: readonly LoadSpike[];
  /** How far before the anomaly to look for a cause, in minutes (default 60). */
  lookbackMinutes?: number;
}

/** Outcome of exporting a report to an external sink. */
export interface ExportResult {
  ok: boolean;
  target: string;
  detail?: string;
}

/** Injected export boundary; a real implementation wraps a network client. */
export type SentinelExporter = (report: AnomalyReport) => Promise<ExportResult>;

/** Input for a single service + metric anomaly analysis. */
export interface SentinelMetricInput {
  service: string;
  metric: SentinelMetricName;
  /** Historical samples used to build the rolling baseline. */
  history: readonly MetricSample[];
  /** Consecutive 5-minute windows, chronological (most recent last). */
  recentWindows: readonly WindowObservation[];
  /** Optional per-day values for trend analysis. */
  dailyValues?: readonly DailyValue[];
  /** Optional deployments considered for causation. */
  deployments?: readonly Deployment[];
  /** Optional load spikes considered for causation. */
  loadSpikes?: readonly LoadSpike[];
}

/** Options controlling a full anomaly analysis. */
export interface SentinelAnalyzeOptions {
  baseline?: RollingBaselineOptions;
  persistence?: PersistenceOptions;
  trend?: TrendOptions;
  causationLookbackMinutes?: number;
  exporter?: SentinelExporter;
}

/** Complete anomaly report for one service + metric. */
export interface AnomalyReport {
  service: string;
  metric: SentinelMetricName;
  direction: 'high' | 'low';
  baseline: RollingBaseline;
  currentValue: number;
  currentZScore: number;
  anomalous: boolean;
  persistence: PersistenceResult;
  trend?: TrendResult;
  causation?: Causation;
  alert: boolean;
  summary: string;
  exported?: ExportResult;
}

const MILLIS_PER_MINUTE = 60_000;
const DEFAULT_Z_THRESHOLD = 2;
const DEFAULT_REQUIRED_WINDOWS = 2;
const DEFAULT_MIN_DAILY_PERCENT = 2;
const DEFAULT_MIN_SUSTAINED_DAYS = 5;
const DEFAULT_CAUSATION_LOOKBACK_MINUTES = 60;

/**
 * Decides whether a signed z-score marks an anomaly in the metric's bad direction.
 * High-is-bad metrics alert at `z >= threshold`; low-is-bad (throughput) at `z <= -threshold`.
 * @param signedZScore Signed z-score of the observation.
 * @param direction Whether the metric is bad when high or low.
 * @param threshold Positive z-score magnitude (default 2.0).
 * @returns True when the observation is anomalous.
 */
export function isAnomalous(signedZScore: number, direction: 'high' | 'low', threshold = DEFAULT_Z_THRESHOLD): boolean {
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('threshold must be a positive number');
  if (Number.isNaN(signedZScore)) throw new Error('z-score must not be NaN');
  return direction === 'high' ? signedZScore >= threshold : signedZScore <= -threshold;
}

/**
 * Assesses consecutive 5-minute windows and reports whether an anomaly persists.
 * @param windows Chronological window observations (most recent last).
 * @param baseline Rolling baseline for the metric.
 * @param options Z-score threshold and required consecutive windows.
 * @returns Per-window assessments and persistence decision.
 * @throws Error when there are no windows or a window value is invalid.
 */
export function detectPersistentAnomaly(
  windows: readonly WindowObservation[],
  baseline: RollingBaseline,
  options: PersistenceOptions = {}
): PersistenceResult {
  if (windows.length === 0) throw new Error('detectPersistentAnomaly requires at least one window');
  const threshold = options.zScoreThreshold ?? DEFAULT_Z_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('zScoreThreshold must be a positive number');
  const requiredWindows = options.requiredWindows ?? DEFAULT_REQUIRED_WINDOWS;
  if (!Number.isInteger(requiredWindows) || requiredWindows < 1) throw new Error('requiredWindows must be a positive integer');
  const direction = SENTINEL_METRIC_DIRECTION[baseline.metric];

  const assessments: WindowAssessment[] = windows.map((window) => {
    if (!Number.isFinite(window.value) || window.value < 0) throw new Error('window value must be a non-negative finite number');
    if (!Number.isFinite(Date.parse(window.timestamp))) throw new Error(`invalid window timestamp: ${window.timestamp}`);
    const score = zScore(window.value, baseline.mean, baseline.stddev);
    return { timestamp: window.timestamp, value: window.value, zScore: score, anomalous: isAnomalous(score, direction, threshold) };
  });

  let maxConsecutive = 0;
  let run = 0;
  for (const assessment of assessments) {
    run = assessment.anomalous ? run + 1 : 0;
    if (run > maxConsecutive) maxConsecutive = run;
  }
  let trailing = 0;
  for (let index = assessments.length - 1; index >= 0 && assessments[index].anomalous; index -= 1) trailing += 1;

  return {
    windows: assessments,
    maxConsecutiveAnomalies: maxConsecutive,
    trailingConsecutiveAnomalies: trailing,
    requiredWindows,
    persistent: maxConsecutive >= requiredWindows
  };
}

/**
 * Computes the ordinary-least-squares slope of values against their index (0..n-1).
 * @param values At least two finite numbers in chronological order.
 * @returns The slope (change in value per one index step).
 * @throws Error when fewer than two finite values are supplied.
 */
export function linearRegressionSlope(values: readonly number[]): number {
  if (values.length < 2) throw new Error('linearRegressionSlope requires at least two values');
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = index - meanX;
    numerator += dx * (values[index] - meanY);
    denominator += dx * dx;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Detects a gradual degradation trend for a metric.
 *
 * Sorts daily values chronologically, computes day-over-day percent changes,
 * and confirms degradation when the most recent `minSustainedDays` transitions
 * each move at least `minDailyPercent` in the metric's bad direction
 * (up for latency/errors/CPU/memory, down for throughput).
 *
 * @param dailyValues One value per day; at least two are required.
 * @param metric The metric being analysed (determines direction).
 * @param options Minimum daily percent and sustained-days thresholds.
 * @returns The trend assessment.
 * @throws Error on fewer than two values or invalid input.
 */
export function detectDegradationTrend(
  dailyValues: readonly DailyValue[],
  metric: SentinelMetricName,
  options: TrendOptions = {}
): TrendResult {
  if (dailyValues.length < 2) throw new Error('detectDegradationTrend requires at least two daily values');
  const minDailyPercent = options.minDailyPercent ?? DEFAULT_MIN_DAILY_PERCENT;
  if (!Number.isFinite(minDailyPercent) || minDailyPercent <= 0) throw new Error('minDailyPercent must be a positive number');
  const minSustainedDays = options.minSustainedDays ?? DEFAULT_MIN_SUSTAINED_DAYS;
  if (!Number.isInteger(minSustainedDays) || minSustainedDays < 1) throw new Error('minSustainedDays must be a positive integer');

  const sorted = [...dailyValues].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
  for (const point of sorted) {
    if (!Number.isFinite(Date.parse(point.date))) throw new Error(`invalid trend date: ${point.date}`);
    if (!Number.isFinite(point.value) || point.value < 0) throw new Error('trend value must be a non-negative finite number');
  }

  const direction = SENTINEL_METRIC_DIRECTION[metric];
  const dailyPercentChanges: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1].value;
    const current = sorted[index].value;
    dailyPercentChanges.push(previous === 0 ? (current === 0 ? 0 : 100) : ((current - previous) / previous) * 100);
  }

  let sustained = 0;
  for (let index = dailyPercentChanges.length - 1; index >= 0; index -= 1) {
    const change = dailyPercentChanges[index];
    const qualifies = direction === 'high' ? change >= minDailyPercent : change <= -minDailyPercent;
    if (!qualifies) break;
    sustained += 1;
  }

  return {
    metric,
    direction,
    dailyPercentChanges,
    sustainedDays: sustained,
    slopePerDay: linearRegressionSlope(sorted.map((point) => point.value)),
    degrading: sustained >= minSustainedDays
  };
}

/**
 * Links an anomaly to the closest preceding deployment or load spike.
 * @param anomalyTimestamp ISO timestamp of the anomaly.
 * @param options Candidate deployments/load spikes and the lookback window.
 * @returns The best matching causation, or `{ type: 'unknown' }` when none fits.
 * @throws Error when the anomaly timestamp is invalid.
 */
export function correlateCausation(anomalyTimestamp: string, options: CausationOptions = {}): Causation {
  const anomalyTime = Date.parse(anomalyTimestamp);
  if (!Number.isFinite(anomalyTime)) throw new Error(`invalid anomaly timestamp: ${anomalyTimestamp}`);
  const lookbackMinutes = options.lookbackMinutes ?? DEFAULT_CAUSATION_LOOKBACK_MINUTES;
  if (!Number.isFinite(lookbackMinutes) || lookbackMinutes <= 0) throw new Error('lookbackMinutes must be a positive number');
  const lookbackMillis = lookbackMinutes * MILLIS_PER_MINUTE;

  const candidates: Causation[] = [];
  for (const deployment of options.deployments ?? []) {
    const time = Date.parse(deployment.timestamp);
    if (!Number.isFinite(time)) throw new Error(`invalid deployment timestamp: ${deployment.timestamp}`);
    const delta = anomalyTime - time;
    if (delta >= 0 && delta <= lookbackMillis) {
      candidates.push({
        type: 'deployment',
        reference: deployment.sha,
        timestamp: deployment.timestamp,
        minutesBefore: delta / MILLIS_PER_MINUTE,
        ...(deployment.description ? { description: deployment.description } : {})
      });
    }
  }
  for (const spike of options.loadSpikes ?? []) {
    const time = Date.parse(spike.timestamp);
    if (!Number.isFinite(time)) throw new Error(`invalid load spike timestamp: ${spike.timestamp}`);
    const delta = anomalyTime - time;
    if (delta >= 0 && delta <= lookbackMillis) {
      candidates.push({
        type: 'load-spike',
        reference: 'load-spike',
        timestamp: spike.timestamp,
        minutesBefore: delta / MILLIS_PER_MINUTE,
        description: `Load spike of magnitude ${spike.magnitude}`
      });
    }
  }

  if (candidates.length === 0) return { type: 'unknown' };
  return candidates.reduce((best, candidate) => ((candidate.minutesBefore ?? Infinity) < (best.minutesBefore ?? Infinity) ? candidate : best));
}

/**
 * Renders an anomaly report as Prometheus text exposition format.
 * @param report The anomaly report to render.
 * @returns Prometheus-formatted metric lines.
 */
export function toPrometheusMetrics(report: AnomalyReport): string {
  const labels = `service="${report.service}",metric="${report.metric}"`;
  return [
    `# HELP sentinel_metric_value Latest observed value for a Sentinel metric.`,
    `sentinel_metric_value{${labels}} ${report.currentValue}`,
    `# HELP sentinel_metric_zscore Z-score of the latest value against its 7-day baseline.`,
    `sentinel_metric_zscore{${labels}} ${finiteOrZero(report.currentZScore)}`,
    `# HELP sentinel_metric_alert 1 when a persistent anomaly or degradation trend is firing.`,
    `sentinel_metric_alert{${labels}} ${report.alert ? 1 : 0}`
  ].join('\n');
}

/** One Datadog time-series point payload. */
export interface DatadogSeries {
  metric: string;
  points: Array<[number, number]>;
  tags: string[];
}

/**
 * Renders an anomaly report as a Datadog series payload (no network call).
 * @param report The anomaly report to render.
 * @returns Datadog series ready to be POSTed by a thin injected client.
 */
export function toDatadogSeries(report: AnomalyReport): DatadogSeries[] {
  const epochSeconds = Math.floor(Date.parse(report.baseline.to) / 1000);
  const tags = [`service:${report.service}`, `metric:${report.metric}`];
  return [
    { metric: 'sentinel.metric.value', points: [[epochSeconds, report.currentValue]], tags },
    { metric: 'sentinel.metric.alert', points: [[epochSeconds, report.alert ? 1 : 0]], tags }
  ];
}

/**
 * Runs a full anomaly analysis for one service + metric: baseline, persistent
 * anomaly, optional degradation trend and causation, and optional export.
 *
 * An alert fires when the anomaly persists across the required consecutive
 * windows OR a degradation trend is confirmed. The injected exporter is only
 * invoked when an alert fires, keeping all external I/O behind a mockable boundary.
 *
 * @param input Baseline history, recent windows, and optional trend/causation data.
 * @param options Baseline, persistence, trend, causation, and export settings.
 * @returns The complete anomaly report.
 * @throws Error on invalid input or when no recent windows are supplied.
 */
export async function analyzeMetric(
  input: SentinelMetricInput,
  options: SentinelAnalyzeOptions = {}
): Promise<AnomalyReport> {
  if (input.recentWindows.length === 0) throw new Error('analyzeMetric requires at least one recent window');
  const homogeneous = input.history.every((sample) => sample.service === input.service && sample.metric === input.metric);
  if (!homogeneous) throw new Error('history samples must match the analysed service and metric');

  const baseline = computeRollingBaseline(input.history, options.baseline);
  const persistence = detectPersistentAnomaly(input.recentWindows, baseline, options.persistence);
  const latest = persistence.windows[persistence.windows.length - 1];
  const direction = baseline.metric === 'throughputRps' ? 'low' : 'high';

  let trend: TrendResult | undefined;
  if (input.dailyValues && input.dailyValues.length >= 2) {
    trend = detectDegradationTrend(input.dailyValues, input.metric, options.trend);
  }

  let causation: Causation | undefined;
  if ((input.deployments && input.deployments.length > 0) || (input.loadSpikes && input.loadSpikes.length > 0)) {
    causation = correlateCausation(latest.timestamp, {
      ...(input.deployments ? { deployments: input.deployments } : {}),
      ...(input.loadSpikes ? { loadSpikes: input.loadSpikes } : {}),
      ...(options.causationLookbackMinutes !== undefined ? { lookbackMinutes: options.causationLookbackMinutes } : {})
    });
  }

  const alert = persistence.persistent || (trend?.degrading ?? false);
  const summary = buildSummary(input.service, input.metric, latest, persistence, trend, causation);

  const report: AnomalyReport = {
    service: input.service,
    metric: input.metric,
    direction,
    baseline,
    currentValue: latest.value,
    currentZScore: latest.zScore,
    anomalous: latest.anomalous,
    persistence,
    ...(trend ? { trend } : {}),
    ...(causation ? { causation } : {}),
    alert,
    summary
  };

  if (alert && options.exporter) {
    try {
      report.exported = await options.exporter(report);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.error('Sentinel export failed', error);
      report.exported = { ok: false, target: 'exporter', detail };
    }
    if (report.exported.ok) {
      log.warn('Sentinel anomaly exported', { service: input.service, metric: input.metric, target: report.exported.target });
    }
  }

  return report;
}

/** Builds a human-readable summary line for a report. */
function buildSummary(
  service: string,
  metric: SentinelMetricName,
  latest: WindowAssessment,
  persistence: PersistenceResult,
  trend: TrendResult | undefined,
  causation: Causation | undefined
): string {
  if (!persistence.persistent && !(trend?.degrading ?? false)) {
    return `No confirmed anomaly for ${service}/${metric}`;
  }
  const parts: string[] = [];
  if (persistence.persistent) {
    parts.push(`${service}/${metric} anomaly persisted across ${persistence.maxConsecutiveAnomalies} consecutive windows (z=${finiteOrLabel(latest.zScore)})`);
  }
  if (trend?.degrading) {
    parts.push(`gradual degradation over ${trend.sustainedDays} days`);
  }
  if (causation && causation.type !== 'unknown') {
    parts.push(causation.type === 'deployment'
      ? `likely cause: deployment ${causation.reference ?? ''}`.trim()
      : `likely cause: load spike`);
  }
  return parts.join('; ');
}

/** Returns the number when finite, otherwise 0 (for numeric export sinks). */
function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Formats a z-score for display, using +Inf/-Inf labels for infinities. */
function finiteOrLabel(value: number): string {
  if (value === Number.POSITIVE_INFINITY) return '+Inf';
  if (value === Number.NEGATIVE_INFINITY) return '-Inf';
  return value.toFixed(2);
}
