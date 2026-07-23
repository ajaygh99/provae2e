/** Golden Thread statistical regression detection and escalation. */
import { log } from './logger.js';

/** Metrics captured for one test execution. */
export interface TrendMetrics {
  durationMs: number;
  errorRate: number;
  memoryMb: number;
  cpuPercent: number;
  networkBytes: number;
}

/** Duration attributed to one Golden Thread stage. */
export interface StageTiming {
  stage: string;
  durationMs: number;
}

/** One historical or current test execution. */
export interface TrendRun {
  testId: string;
  timestamp: string;
  metrics: TrendMetrics;
  stages?: StageTiming[];
}

export type TrendMetricName = keyof TrendMetrics;

/** Rolling statistics after outliers have been removed. */
export interface MetricBaseline {
  mean: number;
  median: number;
  stddev: number;
  sampleSize: number;
  excludedOutliers: number;
}

/** Statistical assessment for one metric. */
export interface MetricAssessment {
  metric: TrendMetricName;
  current: number;
  baseline: MetricBaseline;
  sevenDayAverage?: number;
  zScore: number;
  unusual: boolean;
  consecutiveRegressions: number;
  confirmed: boolean;
  message: string;
}

/** Payload supplied to an injected JIRA issue creator. */
export interface RegressionJiraIssue {
  summary: string;
  description: string;
  labels: string[];
  testId: string;
}

/** Result returned by an injected JIRA issue creator. */
export interface RegressionJiraResult {
  issueKey: string;
  issueUrl?: string;
}

export type RegressionJiraCreator = (issue: RegressionJiraIssue) => Promise<RegressionJiraResult>;

/** Complete regression decision for a current run. */
export interface RegressionTrendReport {
  testId: string;
  baselineWindowDays: number;
  baselineFrom: string;
  baselineTo: string;
  assessments: MetricAssessment[];
  confirmed: boolean;
  summary: string;
  rootCauseHints: string[];
  jira?: RegressionJiraResult;
}

/** Trend analysis configuration. */
export interface RegressionTrendOptions {
  now?: Date;
  baselineWindowDays?: number;
  zScoreThreshold?: number;
  consecutiveRuns?: number;
  minimumBaselineSamples?: number;
  jiraCreator?: RegressionJiraCreator;
}

const METRICS: TrendMetricName[] = ['durationMs', 'errorRate', 'memoryMb', 'cpuPercent', 'networkBytes'];

/** Calculates mean, median, population standard deviation, and IQR outlier count. */
export function calculateMetricBaseline(values: readonly number[]): MetricBaseline {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) throw new Error('At least one finite baseline value is required');
  const filtered = excludeOutliers(finiteValues);
  const mean = average(filtered);
  const variance = average(filtered.map(value => (value - mean) ** 2));
  return {
    mean,
    median: percentile(filtered, 0.5),
    stddev: Math.sqrt(variance),
    sampleSize: filtered.length,
    excludedOutliers: finiteValues.length - filtered.length
  };
}

/**
 * Detects confirmed regressions against a 30-day rolling baseline and optionally
 * creates one JIRA issue through an injected, testable integration boundary.
 */
export async function analyzeRegressionTrend(
  history: readonly TrendRun[],
  current: TrendRun,
  options: RegressionTrendOptions = {}
): Promise<RegressionTrendReport> {
  validateRun(current);
  history.forEach(validateRun);
  const now = options.now ?? new Date(current.timestamp);
  if (!Number.isFinite(now.getTime())) throw new Error('Analysis time must be a valid date');
  const windowDays = positiveInteger(options.baselineWindowDays ?? 30, 'baselineWindowDays');
  const requiredConsecutive = positiveInteger(options.consecutiveRuns ?? 2, 'consecutiveRuns');
  const minimumSamples = positiveInteger(options.minimumBaselineSamples ?? 5, 'minimumBaselineSamples');
  const threshold = options.zScoreThreshold ?? 2;
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('zScoreThreshold must be positive');

  const windowStart = new Date(now.getTime() - windowDays * 86_400_000);
  const eligible = history
    .filter(run => run.testId === current.testId)
    .filter(run => {
      const time = new Date(run.timestamp).getTime();
      return time >= windowStart.getTime() && time < now.getTime();
    })
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  if (eligible.length < minimumSamples) {
    throw new Error(`At least ${minimumSamples} historical runs are required within the ${windowDays}-day baseline window`);
  }

  const assessments = METRICS.map(metric => assessMetric(
    metric, eligible, current, threshold, requiredConsecutive, minimumSamples, windowDays
  ));
  const confirmedAssessments = assessments.filter(assessment => assessment.confirmed);
  const rootCauseHints = buildRootCauseHints(current);
  const summary = confirmedAssessments.length
    ? confirmedAssessments.map(assessment => assessment.message).join('; ')
    : 'No confirmed regression detected';
  const report: RegressionTrendReport = {
    testId: current.testId,
    baselineWindowDays: windowDays,
    baselineFrom: windowStart.toISOString(),
    baselineTo: now.toISOString(),
    assessments,
    confirmed: confirmedAssessments.length > 0,
    summary,
    rootCauseHints
  };

  if (report.confirmed && options.jiraCreator) {
    const duration = assessments.find(assessment => assessment.metric === 'durationMs');
    const primary = duration?.confirmed ? duration : confirmedAssessments[0];
    const changePercent = percentChange(primary.current, primary.baseline.mean);
    const issue: RegressionJiraIssue = {
      summary: `Performance Regression: ${current.testId} is ${formatPercent(changePercent)} slower`,
      description: [summary, ...rootCauseHints].join('\n'),
      labels: ['golden-thread', 'performance-regression'],
      testId: current.testId
    };
    report.jira = await options.jiraCreator(issue);
    log.warn('Confirmed performance regression escalated', { testId: current.testId, issueKey: report.jira.issueKey });
  }
  return report;
}

function assessMetric(
  metric: TrendMetricName,
  history: readonly TrendRun[],
  current: TrendRun,
  threshold: number,
  requiredConsecutive: number,
  minimumSamples: number,
  windowDays: number
): MetricAssessment {
  const baseline = calculateMetricBaseline(history.map(run => run.metrics[metric]));
  const currentValue = current.metrics[metric];
  const currentZ = zScore(currentValue, baseline);
  let consecutive = currentZ > threshold ? 1 : 0;
  if (consecutive) {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const candidate = history[index];
      const candidateTime = Date.parse(candidate.timestamp);
      const prior = history.slice(0, index).filter(run =>
        Date.parse(run.timestamp) >= candidateTime - windowDays * 86_400_000
      );
      if (prior.length < minimumSamples) break;
      const candidateBaseline = calculateMetricBaseline(prior.map(run => run.metrics[metric]));
      if (zScore(candidate.metrics[metric], candidateBaseline) <= threshold) break;
      consecutive += 1;
    }
  }
  const sevenDayStart = Date.parse(current.timestamp) - 7 * 86_400_000;
  const sevenDayValues = history
    .filter(run => Date.parse(run.timestamp) >= sevenDayStart)
    .map(run => run.metrics[metric]);
  const sevenDayAverage = sevenDayValues.length ? average(excludeOutliers(sevenDayValues)) : undefined;
  return {
    metric,
    current: currentValue,
    baseline,
    ...(sevenDayAverage === undefined ? {} : { sevenDayAverage }),
    zScore: currentZ,
    unusual: currentZ > threshold,
    consecutiveRegressions: consecutive,
    confirmed: consecutive >= requiredConsecutive,
    message: metricMessage(metric, currentValue, baseline.mean, sevenDayAverage)
  };
}

function metricMessage(metric: TrendMetricName, current: number, baseline: number, sevenDayAverage?: number): string {
  const difference = current - baseline;
  const relativeToSevenDays = sevenDayAverage === undefined ? undefined : percentChange(current, sevenDayAverage);
  const sevenDayText = relativeToSevenDays === undefined ? '' : ` (${formatPercent(relativeToSevenDays)} slower than 7d avg)`;
  if (metric === 'durationMs') return `${formatDuration(difference)} slower than baseline${sevenDayText}`;
  return `${metric} is ${formatMetric(metric, difference)} above baseline${sevenDayText}`;
}

function buildRootCauseHints(current: TrendRun): string[] {
  if (!current.stages?.length || current.metrics.durationMs <= 0) return [];
  return current.stages
    .filter(stage => stage.durationMs / current.metrics.durationMs >= 0.8)
    .map(stage => `Latency spike detected in ${stage.stage} stage (${Math.round(stage.durationMs / current.metrics.durationMs * 100)}% of time)`);
}

function excludeOutliers(values: readonly number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length < 4) return sorted;
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const filtered = sorted.filter(value => value >= lower && value <= upper);
  return filtered.length ? filtered : sorted;
}

function percentile(sortedInput: readonly number[], fraction: number): number {
  const sorted = [...sortedInput].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function zScore(value: number, baseline: MetricBaseline): number {
  if (baseline.stddev === 0) return value > baseline.mean ? Number.POSITIVE_INFINITY : 0;
  return (value - baseline.mean) / baseline.stddev;
}

function percentChange(value: number, baseline: number): number {
  if (baseline === 0) return value === 0 ? 0 : 100;
  return ((value - baseline) / baseline) * 100;
}

function formatDuration(milliseconds: number): string {
  return Math.abs(milliseconds) >= 1000 ? `${trim(milliseconds / 1000)}s` : `${trim(milliseconds)}ms`;
}

function formatMetric(metric: TrendMetricName, value: number): string {
  if (metric === 'errorRate' || metric === 'cpuPercent') return `${trim(value)} percentage points`;
  if (metric === 'memoryMb') return `${trim(value)}MB`;
  if (metric === 'networkBytes') return `${trim(value)} bytes`;
  return formatDuration(value);
}

function formatPercent(value: number): string { return `${trim(value)}%`; }
function trim(value: number): string { return Number(value.toFixed(2)).toString(); }

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function validateRun(run: TrendRun): void {
  if (!run.testId.trim()) throw new Error('testId is required');
  if (!Number.isFinite(Date.parse(run.timestamp))) throw new Error(`Invalid run timestamp: ${run.timestamp}`);
  for (const metric of METRICS) {
    const value = run.metrics[metric];
    if (!Number.isFinite(value) || value < 0) throw new Error(`${metric} must be a non-negative finite number`);
  }
  if (run.metrics.errorRate > 1) throw new Error('errorRate must be between 0 and 1');
  if (run.metrics.cpuPercent > 100) throw new Error('cpuPercent must be between 0 and 100');
  for (const stage of run.stages ?? []) {
    if (!stage.stage.trim()) throw new Error('Stage name is required');
    if (!Number.isFinite(stage.durationMs) || stage.durationMs < 0) throw new Error('Stage duration must be a non-negative finite number');
  }
}
