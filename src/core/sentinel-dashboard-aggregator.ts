/**
 * Assembles the PROVA Sentinel Studio dashboard model from raw production
 * monitoring inputs (live status, incidents, test-coverage gaps, alerts and
 * latency/error trends).
 *
 * Every function here is pure and fully unit-testable: no network, browser or
 * filesystem access. The resulting {@link SentinelDashboardModel} is consumed by
 * the HTML generator in `src/reporters/sentinel-dashboard.ts`, mirroring the
 * aggregator + generator split used by the Golden Thread dashboard.
 */

/** Incident severity, highest to lowest operational urgency. */
export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';

/** Active-alert severity levels. */
export type AlertSeverity = 'critical' | 'warning' | 'info';

/** Overall live-service health classification. */
export type ServiceHealth = 'healthy' | 'degraded' | 'critical';

/** Recommendation priority, highest first. */
export type RecommendationPriority = 'high' | 'medium' | 'low';

/** Selectable trend window. */
export type TrendRange = '24h' | '7d' | '30d';

/** The ordered set of selectable trend windows. */
export const TREND_RANGES: readonly TrendRange[] = Object.freeze(['24h', '7d', '30d']);

/**
 * Thresholds that classify {@link ServiceHealth} from live status metrics.
 * A metric crossing a "Critical" bound yields `critical`; crossing a "Degraded"
 * bound yields `degraded`; otherwise `healthy`.
 */
export const SENTINEL_STATUS_THRESHOLDS = Object.freeze({
  errorRateDegradedPercent: 1,
  errorRateCriticalPercent: 5,
  latencyDegradedMs: 500,
  latencyCriticalMs: 1000,
  uptimeDegradedPercent: 99.9,
  uptimeCriticalPercent: 99
});

/** Raw live-status metrics for the monitored service. */
export interface LiveStatusInput {
  /** Requests per minute currently served. */
  trafficRpm: number;
  /** Percentage of requests returning errors (0-100). */
  errorRatePercent: number;
  /** P95 latency in milliseconds. */
  latencyMsP95: number;
  /** Uptime percentage over the reporting window (0-100). */
  uptimePercent: number;
}

/** Raw incident record used to build the incident table. */
export interface DashboardIncidentInput {
  id: string;
  title: string;
  /** ISO timestamp the incident started. */
  startedAt: string;
  /** ISO timestamp the incident was resolved; omit for an ongoing incident. */
  endedAt?: string;
  severity: IncidentSeverity;
  usersAffected: number;
  revenueAtRisk: number;
}

/** Raw uncovered error pattern used to build the test-gap table. */
export interface TestGapInput {
  /** Error signature / pattern that lacks automated coverage. */
  pattern: string;
  /** How many times the pattern has occurred (drives sort order). */
  occurrences: number;
  /** Automated test coverage for the pattern (0-100). */
  coveragePercent: number;
}

/** Raw alert record. Alerts with `resolvedAt` set are auto-dismissed. */
export interface AlertInput {
  id: string;
  title: string;
  severity: AlertSeverity;
  /** ISO timestamp the alert was raised. */
  raisedAt: string;
  /** ISO timestamp the alert was resolved; when set, the alert is dismissed. */
  resolvedAt?: string;
}

/** A single point on a latency/error trend line. */
export interface TrendPointInput {
  /** ISO timestamp of the aggregated point. */
  timestamp: string;
  latencyMs: number;
  errorRatePercent: number;
}

/** Full raw input for building a dashboard model. */
export interface SentinelDashboardInput {
  /** Service name shown in the dashboard header. */
  service: string;
  status: LiveStatusInput;
  incidents: DashboardIncidentInput[];
  gaps: TestGapInput[];
  alerts: AlertInput[];
  /** Trend points per window; missing windows render as empty series. */
  trends: Partial<Record<TrendRange, TrendPointInput[]>>;
}

/** Options controlling aggregation. */
export interface SentinelDashboardOptions {
  /** Injectable clock for age/duration math and `generatedAt`. */
  now?: () => Date;
}

/** Computed live status with a derived health classification. */
export interface LiveStatus {
  trafficRpm: number;
  errorRatePercent: number;
  latencyMsP95: number;
  uptimePercent: number;
  health: ServiceHealth;
}

/** Computed incident row with impact and duration. */
export interface DashboardIncident {
  id: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  ongoing: boolean;
  durationMinutes: number;
  severity: IncidentSeverity;
  usersAffected: number;
  revenueAtRisk: number;
  impactLabel: string;
}

/** Computed test-coverage gap. */
export interface TestGap {
  pattern: string;
  occurrences: number;
  coveragePercent: number;
  recommendation: string;
}

/** Computed active alert with an age. */
export interface ActiveAlert {
  id: string;
  title: string;
  severity: AlertSeverity;
  raisedAt: string;
  ageMinutes: number;
  ageLabel: string;
}

/** One selectable trend series. */
export interface TrendSeries {
  range: TrendRange;
  points: TrendPointInput[];
  maxLatencyMs: number;
  maxErrorRatePercent: number;
}

/** A derived, actionable recommendation. */
export interface Recommendation {
  title: string;
  detail: string;
  priority: RecommendationPriority;
}

/** The complete dashboard view model. */
export interface SentinelDashboardModel {
  service: string;
  generatedAt: string;
  status: LiveStatus;
  incidents: DashboardIncident[];
  gaps: TestGap[];
  alerts: ActiveAlert[];
  trends: Record<TrendRange, TrendSeries>;
  recommendations: Recommendation[];
}

const MILLIS_PER_MINUTE = 60_000;
const COVERAGE_TARGET_PERCENT = 80;
const SEVERITY_ORDER: Record<IncidentSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_ORDER: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 };
const MAX_RECOMMENDATIONS = 10;

/**
 * Classifies overall service health from live status metrics.
 * @param status Raw live status metrics.
 * @returns `critical` when any critical bound is crossed, `degraded` when any
 * degraded bound is crossed, otherwise `healthy`.
 */
export function classifyHealth(status: LiveStatusInput): ServiceHealth {
  const t = SENTINEL_STATUS_THRESHOLDS;
  if (
    status.errorRatePercent >= t.errorRateCriticalPercent ||
    status.latencyMsP95 >= t.latencyCriticalMs ||
    status.uptimePercent < t.uptimeCriticalPercent
  ) {
    return 'critical';
  }
  if (
    status.errorRatePercent >= t.errorRateDegradedPercent ||
    status.latencyMsP95 >= t.latencyDegradedMs ||
    status.uptimePercent < t.uptimeDegradedPercent
  ) {
    return 'degraded';
  }
  return 'healthy';
}

/**
 * Builds the computed live-status block.
 * @param input Raw live status metrics.
 * @returns Live status with derived health.
 * @throws Error when a metric is out of range.
 */
export function buildLiveStatus(input: LiveStatusInput): LiveStatus {
  nonNegative(input.trafficRpm, 'trafficRpm');
  percent(input.errorRatePercent, 'errorRatePercent');
  nonNegative(input.latencyMsP95, 'latencyMsP95');
  percent(input.uptimePercent, 'uptimePercent');
  return {
    trafficRpm: round(input.trafficRpm),
    errorRatePercent: round(input.errorRatePercent),
    latencyMsP95: round(input.latencyMsP95),
    uptimePercent: round(input.uptimePercent, 4),
    health: classifyHealth(input)
  };
}

/**
 * Converts one raw incident into a computed row, sizing an ongoing incident's
 * duration against the supplied clock.
 * @param input Raw incident record.
 * @param nowMs Current epoch milliseconds.
 * @returns Computed incident row.
 * @throws Error when timestamps or numbers are invalid.
 */
export function toDashboardIncident(input: DashboardIncidentInput, nowMs: number): DashboardIncident {
  required(input.id, 'incident id');
  required(input.title, 'incident title');
  const start = validDate(input.startedAt, 'incident startedAt');
  const end = input.endedAt === undefined ? undefined : validDate(input.endedAt, 'incident endedAt');
  if (end !== undefined && end < start) throw new Error('incident endedAt must not precede startedAt');
  nonNegativeInteger(input.usersAffected, 'usersAffected');
  nonNegative(input.revenueAtRisk, 'revenueAtRisk');
  const ongoing = end === undefined;
  const effectiveEnd = end ?? nowMs;
  const durationMinutes = round(Math.max(0, effectiveEnd - start) / MILLIS_PER_MINUTE);
  return {
    id: input.id,
    title: input.title,
    startedAt: new Date(start).toISOString(),
    ...(input.endedAt !== undefined ? { endedAt: new Date(end as number).toISOString() } : {}),
    ongoing,
    durationMinutes,
    severity: input.severity,
    usersAffected: input.usersAffected,
    revenueAtRisk: round(input.revenueAtRisk),
    impactLabel: incidentImpactLabel(input.usersAffected, input.revenueAtRisk)
  };
}

/**
 * Sorts incidents by severity (critical first), then most recent start.
 * @param incidents Computed incidents.
 * @returns A new, sorted array.
 */
export function sortIncidents(incidents: DashboardIncident[]): DashboardIncident[] {
  return [...incidents].sort((left, right) => {
    const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (bySeverity !== 0) return bySeverity;
    return Date.parse(right.startedAt) - Date.parse(left.startedAt);
  });
}

/**
 * Builds test gaps sorted by occurrence frequency (most frequent first).
 * @param inputs Raw uncovered patterns.
 * @returns Sorted, computed test gaps.
 * @throws Error when a gap value is invalid.
 */
export function buildTestGaps(inputs: TestGapInput[]): TestGap[] {
  const gaps = inputs.map(input => {
    required(input.pattern, 'gap pattern');
    nonNegativeInteger(input.occurrences, 'gap occurrences');
    percent(input.coveragePercent, 'gap coveragePercent');
    return {
      pattern: input.pattern,
      occurrences: input.occurrences,
      coveragePercent: round(input.coveragePercent),
      recommendation: gapRecommendation(input.coveragePercent)
    };
  });
  return gaps.sort((left, right) => {
    const byFrequency = right.occurrences - left.occurrences;
    if (byFrequency !== 0) return byFrequency;
    return left.coveragePercent - right.coveragePercent;
  });
}

/**
 * Builds active alerts, auto-dismissing any alert that has been resolved, and
 * sorts the survivors by severity then age (oldest first).
 * @param inputs Raw alerts.
 * @param nowMs Current epoch milliseconds.
 * @returns Active (unresolved) alerts with computed ages.
 * @throws Error when an alert value is invalid.
 */
export function buildActiveAlerts(inputs: AlertInput[], nowMs: number): ActiveAlert[] {
  const active: ActiveAlert[] = [];
  for (const input of inputs) {
    required(input.id, 'alert id');
    required(input.title, 'alert title');
    const raised = validDate(input.raisedAt, 'alert raisedAt');
    if (input.resolvedAt !== undefined) {
      validDate(input.resolvedAt, 'alert resolvedAt');
      continue; // auto-dismiss resolved alerts
    }
    const ageMinutes = round(Math.max(0, nowMs - raised) / MILLIS_PER_MINUTE);
    active.push({
      id: input.id,
      title: input.title,
      severity: input.severity,
      raisedAt: new Date(raised).toISOString(),
      ageMinutes,
      ageLabel: ageLabel(ageMinutes)
    });
  }
  return active.sort((left, right) => {
    const bySeverity = alertSeverityRank(left.severity) - alertSeverityRank(right.severity);
    if (bySeverity !== 0) return bySeverity;
    return right.ageMinutes - left.ageMinutes;
  });
}

/**
 * Builds one trend series for a given window, computing axis maxima for scaling.
 * @param range The trend window.
 * @param points Raw trend points (empty when the window has no data).
 * @returns The computed trend series.
 * @throws Error when a point value is invalid.
 */
export function buildTrendSeries(range: TrendRange, points: TrendPointInput[]): TrendSeries {
  const validated = [...points]
    .map(point => {
      validDate(point.timestamp, 'trend timestamp');
      nonNegative(point.latencyMs, 'trend latencyMs');
      percent(point.errorRatePercent, 'trend errorRatePercent');
      return point;
    })
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  return {
    range,
    points: validated,
    maxLatencyMs: validated.reduce((max, point) => Math.max(max, point.latencyMs), 0),
    maxErrorRatePercent: validated.reduce((max, point) => Math.max(max, point.errorRatePercent), 0)
  };
}

/**
 * Derives prioritized recommendations from coverage gaps and severe incidents.
 * @param gaps Computed, frequency-sorted test gaps.
 * @param incidents Computed incidents.
 * @returns Up to ten recommendations, highest priority first.
 */
export function buildRecommendations(gaps: TestGap[], incidents: DashboardIncident[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  for (const gap of gaps) {
    if (gap.coveragePercent >= COVERAGE_TARGET_PERCENT) continue;
    recommendations.push({
      title: `Add test coverage for "${gap.pattern}"`,
      detail: `Seen ${gap.occurrences} time(s) with ${gap.coveragePercent}% coverage`,
      priority: gap.coveragePercent === 0 ? 'high' : 'medium'
    });
  }
  for (const incident of incidents) {
    if (incident.severity !== 'critical' && incident.severity !== 'high') continue;
    recommendations.push({
      title: `Review ${incident.severity} incident ${incident.id}`,
      detail: incident.ongoing
        ? `Ongoing — ${incident.impactLabel}`
        : `Resolved after ${incident.durationMinutes} min — ${incident.impactLabel}`,
      priority: incident.severity === 'critical' ? 'high' : 'medium'
    });
  }
  return recommendations
    .sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority])
    .slice(0, MAX_RECOMMENDATIONS);
}

/**
 * Assembles the complete Sentinel dashboard model from raw inputs.
 * @param input Raw live status, incidents, gaps, alerts and trends.
 * @param options Optional injectable clock.
 * @returns The dashboard view model consumed by the HTML generator.
 * @throws Error when the service name or any nested input is invalid.
 */
export function aggregateSentinelDashboard(
  input: SentinelDashboardInput,
  options: SentinelDashboardOptions = {}
): SentinelDashboardModel {
  required(input.service, 'service');
  const now = options.now ?? ((): Date => new Date());
  const nowMs = now().getTime();
  if (!Number.isFinite(nowMs)) throw new Error('current time must be valid');

  const status = buildLiveStatus(input.status);
  const incidents = sortIncidents(input.incidents.map(incident => toDashboardIncident(incident, nowMs)));
  const gaps = buildTestGaps(input.gaps);
  const alerts = buildActiveAlerts(input.alerts, nowMs);
  // Cast is safe: every TrendRange key is populated by the loop immediately below.
  const trends = {} as Record<TrendRange, TrendSeries>;
  for (const range of TREND_RANGES) {
    trends[range] = buildTrendSeries(range, input.trends[range] ?? []);
  }
  const recommendations = buildRecommendations(gaps, incidents);

  return {
    service: input.service,
    generatedAt: new Date(nowMs).toISOString(),
    status,
    incidents,
    gaps,
    alerts,
    trends,
    recommendations
  };
}

/** Formats an incident's customer impact for display. */
export function incidentImpactLabel(usersAffected: number, revenueAtRisk: number): string {
  const users = usersAffected.toLocaleString('en-US');
  const revenue = round(revenueAtRisk).toLocaleString('en-US');
  return `${users} user(s) affected · $${revenue} at risk`;
}

/** Builds a coverage recommendation string for a gap. */
export function gapRecommendation(coveragePercent: number): string {
  percent(coveragePercent, 'coveragePercent');
  if (coveragePercent === 0) return 'No coverage — create a regression test';
  if (coveragePercent < COVERAGE_TARGET_PERCENT) return `Below target — raise coverage above ${COVERAGE_TARGET_PERCENT}%`;
  return 'Coverage meets target';
}

/** Renders an alert age (minutes) as a compact human-readable label. */
export function ageLabel(ageMinutes: number): string {
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) throw new Error('ageMinutes must be a non-negative finite number');
  if (ageMinutes < 1) return 'just now';
  if (ageMinutes < 60) return `${Math.floor(ageMinutes)}m`;
  if (ageMinutes < 1440) return `${Math.floor(ageMinutes / 60)}h`;
  return `${Math.floor(ageMinutes / 1440)}d`;
}

function alertSeverityRank(severity: AlertSeverity): number {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

function required(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
}

function validDate(value: string, name: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid timestamp`);
  return timestamp;
}

function percent(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${name} must be between 0 and 100`);
}

function nonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number`);
}

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}
