/**
 * PROVA Sentinel ↔ Datadog APM integration.
 *
 * Provides real-time tracing/observability by pushing Sentinel signals into
 * Datadog and correlating Sentinel's own trace ids with Datadog trace ids.
 *
 * Design constraints (Issue #109):
 *  - Authentication uses a Datadog API key sourced from options or the
 *    `DATADOG_API_KEY` environment variable — never hardcoded.
 *  - ALL network access lives behind the injected {@link DatadogApmClient}
 *    boundary, so every tested code path is exercised against a mock and no
 *    live HTTP request is issued during tests.
 *  - Ingest is batched (default 1000 events per batch, synced every 60s by the
 *    caller's scheduler) via {@link chunkEvents}.
 *  - Pure helpers (trace correlation, service-map construction, custom-metric
 *    formatting, rule→monitor mapping, dashboard definition) contain the logic
 *    and are independently unit-testable.
 *
 * Reuses the Sentinel foundation on `main` (sentinel-agent.ts) via the
 * {@link SentinelEvidence} type rather than duplicating it.
 */
import { log } from './logger.js';
import type { SentinelEvidence } from './sentinel-agent.js';
import { SENTINEL_METRIC_DIRECTION, type SentinelMetricName } from './sentinel-baseline.js';

/** Default number of events submitted per ingest batch (Datadog intake limit). */
export const DATADOG_BATCH_SIZE = 1000;

/** Default sync cadence in seconds; callers schedule ingest at this interval. */
export const SENTINEL_SYNC_INTERVAL_SECONDS = 60;

/** Default Datadog US site intake host used only for building resource URLs. */
export const DEFAULT_DATADOG_SITE = 'datadoghq.com';

/** Stable Datadog custom-metric names exposed by Sentinel. */
export const SENTINEL_CUSTOM_METRICS = Object.freeze({
  coverage: 'sentinel.coverage',
  uncoveredIncidents: 'sentinel.uncovered_incidents',
  impact: 'sentinel.impact'
});

/** A single Datadog metric time series. */
export interface DatadogMetricSeries {
  metric: string;
  type: 'gauge' | 'count' | 'rate';
  points: Array<[number, number]>;
  tags: string[];
}

/** A single Datadog log intake event. */
export interface DatadogLogEvent {
  message: string;
  ddsource: string;
  service: string;
  ddtags: string;
  status: string;
  timestampMs: number;
}

/** A single Datadog APM span. */
export interface DatadogSpan {
  traceId: string;
  spanId: string;
  parentId?: string;
  service: string;
  name: string;
  resource?: string;
  startMs: number;
  durationMs: number;
  error: 0 | 1;
  meta?: Record<string, string>;
}

/** Response returned by an ingest submission. */
export interface DatadogIngestResponse {
  accepted: number;
  status: 'ok' | 'error';
  detail?: string;
}

/** Response returned when a Datadog resource (monitor/dashboard) is created. */
export interface DatadogResourceResponse {
  id: string;
  url?: string;
}

/**
 * Transport boundary for every Datadog network call.
 *
 * A production implementation wraps an authenticated HTTP client (see
 * `production-logs-datadog.ts` for the `DD-API-KEY` header convention). Tests
 * provide a mock so no live request is made.
 */
export interface DatadogApmClient {
  /** Submits a batch of metric series to Datadog. */
  submitMetrics(series: DatadogMetricSeries[]): Promise<DatadogIngestResponse>;
  /** Submits a batch of log events to Datadog. */
  submitLogs(logs: DatadogLogEvent[]): Promise<DatadogIngestResponse>;
  /** Submits a batch of spans to Datadog's trace intake. */
  submitTraces(spans: DatadogSpan[]): Promise<DatadogIngestResponse>;
  /** Creates a Datadog monitor and returns its id. */
  createMonitor(monitor: DatadogMonitor): Promise<DatadogResourceResponse>;
  /** Creates a Datadog dashboard and returns its id. */
  createDashboard(dashboard: DatadogDashboard): Promise<DatadogResourceResponse>;
}

/** Options for constructing a {@link SentinelDatadogApm} instance. */
export interface SentinelDatadogApmOptions {
  /** Injected Datadog transport; all network I/O goes through it. */
  client: DatadogApmClient;
  /** API key; falls back to the `DATADOG_API_KEY` environment variable. */
  apiKey?: string;
  /** Datadog site host (e.g. `datadoghq.eu`); defaults to the US site. */
  site?: string;
  /** Events per ingest batch (default {@link DATADOG_BATCH_SIZE}). */
  batchSize?: number;
  /** Only ingest traces/spans for these services when provided. */
  trackedServices?: readonly string[];
}

/** A Sentinel-side trace record used for cross-system correlation. */
export interface SentinelTrace {
  traceId: string;
  sentinelIncidentId: string;
  service: string;
  timestamp: string;
}

/** Result of correlating one Sentinel trace with Datadog spans. */
export interface TraceCorrelation {
  traceId: string;
  sentinelIncidentId: string;
  matched: boolean;
  datadogSpanCount: number;
  services: string[];
  hasError: boolean;
}

/** A directed edge in the service dependency map. */
export interface ServiceMapEdge {
  from: string;
  to: string;
  callCount: number;
  errorCount: number;
}

/** A service dependency map with error-propagation counts. */
export interface ServiceMap {
  services: string[];
  edges: ServiceMapEdge[];
}

/** Aggregated Sentinel findings exposed as Datadog custom metrics. */
export interface SentinelFindings {
  service: string;
  timestamp: string;
  coveragePercent: number;
  uncoveredIncidents: number;
  impactScore: number;
}

/** A Sentinel alerting rule to be materialised as a Datadog monitor. */
export interface SentinelRule {
  name: string;
  metric: SentinelMetricName | string;
  threshold: number;
  comparator?: '>' | '>=' | '<' | '<=';
  windowMinutes?: number;
  service?: string;
  message?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
}

/** A Datadog monitor definition (no network side effect). */
export interface DatadogMonitor {
  name: string;
  type: 'metric alert';
  query: string;
  message: string;
  tags: string[];
  priority: number;
  options: {
    thresholds: { critical: number };
    notify_no_data: boolean;
  };
}

/** A Datadog dashboard widget request. */
export interface DatadogWidgetRequest {
  q: string;
  display_type: 'line' | 'bars' | 'area';
}

/** A Datadog dashboard widget definition. */
export interface DatadogWidgetDefinition {
  title: string;
  type: 'timeseries' | 'query_value' | 'toplist';
  requests: DatadogWidgetRequest[];
}

/** A Datadog dashboard widget wrapper. */
export interface DatadogWidget {
  definition: DatadogWidgetDefinition;
}

/** A Datadog dashboard definition (no network side effect). */
export interface DatadogDashboard {
  title: string;
  description: string;
  layout_type: 'ordered';
  widgets: DatadogWidget[];
}

/** Options for building the pre-built Sentinel dashboard. */
export interface DashboardOptions {
  /** Optional service scope applied to every widget query. */
  service?: string;
  /** Optional title override. */
  title?: string;
}

const DEFAULT_MONITOR_WINDOW_MINUTES = 5;
const DEFAULT_MONITOR_PRIORITY = 3;
const DEFAULT_IMPACT_WEIGHT = 10;

/**
 * Splits a list of events into batches no larger than `batchSize`.
 * @param events Events to split (metrics, logs, or spans).
 * @param batchSize Maximum events per batch (default {@link DATADOG_BATCH_SIZE}).
 * @returns An array of batches; empty input yields an empty array.
 * @throws Error when `batchSize` is not a positive integer.
 * @typeParam T Element type of the events being chunked.
 */
export function chunkEvents<T>(events: readonly T[], batchSize: number = DATADOG_BATCH_SIZE): T[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('batchSize must be a positive integer');
  }
  const batches: T[][] = [];
  for (let index = 0; index < events.length; index += batchSize) {
    batches.push(events.slice(index, index + batchSize));
  }
  return batches;
}

/**
 * Converts an ISO timestamp to whole epoch seconds (Datadog metric format).
 * @param isoTimestamp ISO-8601 timestamp string.
 * @returns Epoch seconds as an integer.
 * @throws Error when the timestamp cannot be parsed.
 */
export function toEpochSeconds(isoTimestamp: string): number {
  const millis = Date.parse(isoTimestamp);
  if (!Number.isFinite(millis)) throw new Error(`invalid timestamp: ${isoTimestamp}`);
  return Math.floor(millis / 1000);
}

/**
 * Correlates Sentinel traces with Datadog spans sharing the same trace id.
 *
 * Datadog spans are grouped by `traceId`; each Sentinel trace is matched to its
 * group, reporting the participating services and whether any span errored
 * (used for error-propagation views).
 *
 * @param sentinelTraces Sentinel-side trace records.
 * @param datadogSpans Datadog spans to match against.
 * @returns One {@link TraceCorrelation} per Sentinel trace, input order preserved.
 * @throws Error when a Sentinel trace is missing its `traceId`.
 */
export function correlateTraces(
  sentinelTraces: readonly SentinelTrace[],
  datadogSpans: readonly DatadogSpan[]
): TraceCorrelation[] {
  const spansByTrace = new Map<string, DatadogSpan[]>();
  for (const span of datadogSpans) {
    const bucket = spansByTrace.get(span.traceId);
    if (bucket) bucket.push(span);
    else spansByTrace.set(span.traceId, [span]);
  }

  return sentinelTraces.map((trace) => {
    if (!trace.traceId.trim()) throw new Error('SentinelTrace.traceId is required');
    const spans = spansByTrace.get(trace.traceId) ?? [];
    const services = [...new Set(spans.map((span) => span.service))].sort();
    return {
      traceId: trace.traceId,
      sentinelIncidentId: trace.sentinelIncidentId,
      matched: spans.length > 0,
      datadogSpanCount: spans.length,
      services,
      hasError: spans.some((span) => span.error === 1)
    };
  });
}

/**
 * Builds a service dependency map from Datadog spans, tracking error propagation.
 *
 * A directed edge `parent.service → child.service` is created for every span
 * whose `parentId` resolves to another span in the set. Repeated calls increment
 * `callCount`; a child span with `error === 1` increments `errorCount`.
 *
 * @param spans Datadog spans belonging to one or more traces.
 * @returns A {@link ServiceMap} with sorted services and edges.
 */
export function buildServiceMap(spans: readonly DatadogSpan[]): ServiceMap {
  const spanById = new Map<string, DatadogSpan>();
  for (const span of spans) spanById.set(span.spanId, span);

  const edgeMap = new Map<string, ServiceMapEdge>();
  const services = new Set<string>();
  for (const span of spans) {
    services.add(span.service);
    if (span.parentId === undefined) continue;
    const parent = spanById.get(span.parentId);
    if (!parent || parent.service === span.service) continue;
    const key = `${parent.service} ${span.service}`;
    const edge = edgeMap.get(key) ?? { from: parent.service, to: span.service, callCount: 0, errorCount: 0 };
    edge.callCount += 1;
    if (span.error === 1) edge.errorCount += 1;
    edgeMap.set(key, edge);
  }

  return {
    services: [...services].sort(),
    edges: [...edgeMap.values()].sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)))
  };
}

/**
 * Aggregates raw Sentinel evidence into the findings exposed as custom metrics.
 *
 * `coveragePercent` is the mean of each incident's test coverage, rounded to two
 * decimals; `uncoveredIncidents` counts gaps; `impactScore` weights each
 * uncovered incident (ERROR counts double).
 *
 * @param evidence Sentinel incident evidence (from the Sentinel agent store).
 * @param service Service name tagged on the resulting metrics.
 * @param timestamp ISO timestamp for the metric points.
 * @param impactWeight Per-uncovered-incident weight (default 10).
 * @returns Aggregated {@link SentinelFindings}.
 * @throws Error when `service` is blank or `impactWeight` is not positive.
 */
export function summarizeEvidence(
  evidence: readonly SentinelEvidence[],
  service: string,
  timestamp: string,
  impactWeight: number = DEFAULT_IMPACT_WEIGHT
): SentinelFindings {
  if (!service.trim()) throw new Error('service is required');
  if (!Number.isFinite(impactWeight) || impactWeight <= 0) throw new Error('impactWeight must be a positive number');
  toEpochSeconds(timestamp);

  const total = evidence.length;
  const coveragePercent = total === 0
    ? 100
    : Math.round((evidence.reduce((sum, item) => sum + item.testCoveragePercent, 0) / total) * 100) / 100;
  const uncovered = evidence.filter((item) => !item.covered);
  const impactScore = uncovered.reduce((sum, item) => sum + impactWeight * (item.level === 'ERROR' ? 2 : 1), 0);

  return {
    service,
    timestamp,
    coveragePercent,
    uncoveredIncidents: uncovered.length,
    impactScore
  };
}

/**
 * Formats Sentinel findings as Datadog custom-metric series
 * (`sentinel.coverage`, `sentinel.uncovered_incidents`, `sentinel.impact`).
 * @param findings Aggregated Sentinel findings.
 * @returns Three gauge series tagged with the service.
 * @throws Error when a finding value is out of range.
 */
export function findingsToMetricSeries(findings: SentinelFindings): DatadogMetricSeries[] {
  if (!Number.isFinite(findings.coveragePercent) || findings.coveragePercent < 0 || findings.coveragePercent > 100) {
    throw new Error('coveragePercent must be between 0 and 100');
  }
  if (!Number.isInteger(findings.uncoveredIncidents) || findings.uncoveredIncidents < 0) {
    throw new Error('uncoveredIncidents must be a non-negative integer');
  }
  if (!Number.isFinite(findings.impactScore) || findings.impactScore < 0) {
    throw new Error('impactScore must be a non-negative number');
  }
  const epoch = toEpochSeconds(findings.timestamp);
  const tags = [`service:${findings.service}`];
  return [
    { metric: SENTINEL_CUSTOM_METRICS.coverage, type: 'gauge', points: [[epoch, findings.coveragePercent]], tags },
    { metric: SENTINEL_CUSTOM_METRICS.uncoveredIncidents, type: 'gauge', points: [[epoch, findings.uncoveredIncidents]], tags },
    { metric: SENTINEL_CUSTOM_METRICS.impact, type: 'gauge', points: [[epoch, findings.impactScore]], tags }
  ];
}

/**
 * Converts one Sentinel evidence record into a Datadog log event.
 * @param evidence Sentinel incident evidence.
 * @param service Service name tagged on the log.
 * @returns A Datadog log intake event.
 */
export function evidenceToLogEvent(evidence: SentinelEvidence, service: string): DatadogLogEvent {
  return {
    message: evidence.error,
    ddsource: 'prova-sentinel',
    service,
    ddtags: `incident_id:${evidence.id},deployment_sha:${evidence.deploymentSha},covered:${evidence.covered}`,
    status: evidence.level.toLowerCase(),
    timestampMs: Date.parse(evidence.timestamp)
  };
}

/**
 * Resolves the comparator for a rule, defaulting from the metric's bad direction.
 * @param rule The Sentinel rule.
 * @returns The comparator to use in the monitor query.
 */
function resolveComparator(rule: SentinelRule): '>' | '>=' | '<' | '<=' {
  if (rule.comparator) return rule.comparator;
  if (rule.metric in SENTINEL_METRIC_DIRECTION) {
    return SENTINEL_METRIC_DIRECTION[rule.metric as SentinelMetricName] === 'low' ? '<' : '>';
  }
  return '>';
}

/**
 * Maps a single Sentinel rule to a Datadog metric-alert monitor definition.
 *
 * Builds a query of the form
 * `avg(last_<window>m):avg:sentinel.<metric>{<scope>} <comparator> <threshold>`
 * and derives the comparator from the metric direction when not specified.
 *
 * @param rule The Sentinel rule to convert.
 * @returns A Datadog monitor definition (not yet created remotely).
 * @throws Error when the rule name is blank or the threshold is not finite.
 */
export function ruleToMonitor(rule: SentinelRule): DatadogMonitor {
  if (!rule.name.trim()) throw new Error('rule name is required');
  if (!String(rule.metric).trim()) throw new Error('rule metric is required');
  if (!Number.isFinite(rule.threshold)) throw new Error('rule threshold must be a finite number');
  const windowMinutes = rule.windowMinutes ?? DEFAULT_MONITOR_WINDOW_MINUTES;
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1) throw new Error('windowMinutes must be a positive integer');

  const comparator = resolveComparator(rule);
  const metricName = String(rule.metric).includes('.') ? String(rule.metric) : `sentinel.${String(rule.metric)}`;
  const scope = rule.service ? `service:${rule.service}` : '*';
  const query = `avg(last_${windowMinutes}m):avg:${metricName}{${scope}} ${comparator} ${rule.threshold}`;
  const tags = ['source:prova-sentinel', ...(rule.service ? [`service:${rule.service}`] : [])];

  return {
    name: rule.name,
    type: 'metric alert',
    query,
    message: rule.message ?? `Sentinel rule "${rule.name}" breached: ${metricName} ${comparator} ${rule.threshold}.`,
    tags,
    priority: rule.priority ?? DEFAULT_MONITOR_PRIORITY,
    options: { thresholds: { critical: rule.threshold }, notify_no_data: false }
  };
}

/**
 * Maps a batch of Sentinel rules to Datadog monitor definitions.
 * @param rules The Sentinel rules to convert.
 * @returns One monitor definition per rule, input order preserved.
 */
export function rulesToMonitors(rules: readonly SentinelRule[]): DatadogMonitor[] {
  return rules.map(ruleToMonitor);
}

/**
 * Builds the pre-built Sentinel dashboard definition (uptime, error patterns,
 * coverage gaps, and impact) ready to be created via {@link DatadogApmClient}.
 * @param options Optional service scope and title override.
 * @returns A Datadog dashboard definition.
 */
export function buildSentinelDashboard(options: DashboardOptions = {}): DatadogDashboard {
  const scope = options.service ? `service:${options.service}` : '*';
  const line: DatadogWidgetRequest['display_type'] = 'line';
  return {
    title: options.title ?? 'PROVA Sentinel — Production Observability',
    description: 'Auto-generated Sentinel dashboard: uptime, error patterns, coverage gaps, and impact.',
    layout_type: 'ordered',
    widgets: [
      {
        definition: {
          title: 'Uptime / availability',
          type: 'timeseries',
          requests: [{ q: `avg:sentinel.uptime{${scope}}`, display_type: line }]
        }
      },
      {
        definition: {
          title: 'Error patterns',
          type: 'timeseries',
          requests: [{ q: `sum:sentinel.errors{${scope}}.as_count()`, display_type: 'bars' }]
        }
      },
      {
        definition: {
          title: 'Coverage gaps (uncovered incidents)',
          type: 'query_value',
          requests: [{ q: `sum:${SENTINEL_CUSTOM_METRICS.uncoveredIncidents}{${scope}}`, display_type: line }]
        }
      },
      {
        definition: {
          title: 'Test coverage %',
          type: 'timeseries',
          requests: [{ q: `avg:${SENTINEL_CUSTOM_METRICS.coverage}{${scope}}`, display_type: line }]
        }
      },
      {
        definition: {
          title: 'Sentinel impact score',
          type: 'timeseries',
          requests: [{ q: `avg:${SENTINEL_CUSTOM_METRICS.impact}{${scope}}`, display_type: 'area' }]
        }
      }
    ]
  };
}

/**
 * High-level Sentinel↔Datadog APM connector.
 *
 * Authenticates with a Datadog API key, filters spans to tracked services,
 * batches ingest, and creates monitors/dashboards. Every network operation is
 * delegated to the injected {@link DatadogApmClient}.
 */
export class SentinelDatadogApm {
  private readonly client: DatadogApmClient;
  private readonly batchSize: number;
  private readonly site: string;
  private readonly trackedServices?: Set<string>;

  /**
   * @param options Connector options; `apiKey` falls back to `DATADOG_API_KEY`.
   * @throws Error when no API key is available or `batchSize` is invalid.
   */
  constructor(options: SentinelDatadogApmOptions) {
    const apiKey = options.apiKey ?? process.env['DATADOG_API_KEY'];
    if (!apiKey || !apiKey.trim()) {
      throw new Error('Datadog API key is required (pass apiKey or set DATADOG_API_KEY)');
    }
    const batchSize = options.batchSize ?? DATADOG_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
    this.client = options.client;
    this.batchSize = batchSize;
    this.site = options.site ?? DEFAULT_DATADOG_SITE;
    if (options.trackedServices && options.trackedServices.length > 0) {
      this.trackedServices = new Set(options.trackedServices);
    }
  }

  /**
   * Filters spans to the configured tracked services (no-op when unset).
   * @param spans Spans to filter.
   * @returns Spans belonging to tracked services, or all spans when no filter is set.
   */
  filterTrackedSpans(spans: readonly DatadogSpan[]): DatadogSpan[] {
    if (!this.trackedServices) return [...spans];
    return spans.filter((span) => this.trackedServices?.has(span.service));
  }

  /**
   * Batches and submits metric series to Datadog.
   * @param series Metric series to ingest.
   * @returns Aggregated ingest response across all batches.
   */
  async ingestMetrics(series: readonly DatadogMetricSeries[]): Promise<DatadogIngestResponse> {
    return this.ingest(series, (batch) => this.client.submitMetrics(batch), 'metrics');
  }

  /**
   * Batches and submits log events to Datadog.
   * @param logs Log events to ingest.
   * @returns Aggregated ingest response across all batches.
   */
  async ingestLogs(logs: readonly DatadogLogEvent[]): Promise<DatadogIngestResponse> {
    return this.ingest(logs, (batch) => this.client.submitLogs(batch), 'logs');
  }

  /**
   * Filters to tracked services, then batches and submits spans to Datadog.
   * @param spans Spans to ingest.
   * @returns Aggregated ingest response across all batches.
   */
  async ingestTraces(spans: readonly DatadogSpan[]): Promise<DatadogIngestResponse> {
    return this.ingest(this.filterTrackedSpans(spans), (batch) => this.client.submitTraces(batch), 'traces');
  }

  /**
   * Formats Sentinel findings as custom metrics and ingests them.
   * @param findings Aggregated Sentinel findings.
   * @returns Aggregated ingest response.
   */
  async ingestFindings(findings: SentinelFindings): Promise<DatadogIngestResponse> {
    return this.ingestMetrics(findingsToMetricSeries(findings));
  }

  /**
   * Creates Datadog monitors from Sentinel rules.
   * @param rules Sentinel rules to materialise.
   * @returns The created monitor resource responses, in rule order.
   * @throws Error when the underlying client rejects a creation.
   */
  async createMonitorsFromRules(rules: readonly SentinelRule[]): Promise<DatadogResourceResponse[]> {
    const monitors = rulesToMonitors(rules);
    const results: DatadogResourceResponse[] = [];
    for (const monitor of monitors) {
      try {
        results.push(await this.client.createMonitor(monitor));
      } catch (error) {
        log.error('Failed to create Datadog monitor', error);
        throw new Error(`Failed to create Datadog monitor "${monitor.name}": ${errorMessage(error)}`);
      }
    }
    log.success('Created Datadog monitors from Sentinel rules', { count: results.length });
    return results;
  }

  /**
   * Creates the pre-built Sentinel dashboard in Datadog.
   * @param options Optional service scope and title override.
   * @returns The created dashboard resource response.
   * @throws Error when the underlying client rejects the creation.
   */
  async createDashboard(options: DashboardOptions = {}): Promise<DatadogResourceResponse> {
    const dashboard = buildSentinelDashboard(options);
    try {
      const result = await this.client.createDashboard(dashboard);
      log.success('Created Sentinel dashboard in Datadog', { id: result.id, site: this.site });
      return result;
    } catch (error) {
      log.error('Failed to create Sentinel dashboard', error);
      throw new Error(`Failed to create Sentinel dashboard: ${errorMessage(error)}`);
    }
  }

  /**
   * Chunks a payload and submits each batch, aggregating the responses.
   * @param events Events to ingest.
   * @param submit Submission function bound to the transport.
   * @param label Human-readable payload label for error messages.
   * @returns Aggregated ingest response.
   */
  private async ingest<T>(
    events: readonly T[],
    submit: (batch: T[]) => Promise<DatadogIngestResponse>,
    label: string
  ): Promise<DatadogIngestResponse> {
    const batches = chunkEvents(events, this.batchSize);
    if (batches.length === 0) return { accepted: 0, status: 'ok' };
    let accepted = 0;
    try {
      for (const batch of batches) {
        const response = await submit(batch);
        if (response.status !== 'ok') {
          return { accepted, status: 'error', detail: response.detail ?? `Datadog rejected ${label} batch` };
        }
        accepted += response.accepted;
      }
    } catch (error) {
      log.error(`Failed to ingest Sentinel ${label} to Datadog`, error);
      return { accepted, status: 'error', detail: errorMessage(error) };
    }
    log.debug(`Ingested Sentinel ${label} to Datadog`, { accepted, batches: batches.length });
    return { accepted, status: 'ok' };
  }
}

/** Extracts a message string from an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
