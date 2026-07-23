/**
 * Sentinel on-call integration for PagerDuty (Events API v2) and Opsgenie
 * (Alerts API v2).
 *
 * This module is deliberately pure and side-effect free apart from a single
 * injected {@link OncallSender} boundary, mirroring the injected-sender pattern
 * used by `golden-thread-slack.ts` and the injected executor in
 * `sentinel-remediation.ts`. No live HTTP is performed in code paths that tests
 * exercise: request payloads are built as plain objects and delivery is handled
 * by a caller-supplied sender (or an optional fetch-based default).
 *
 * Responsibilities:
 *  - map an observed error rate to an incident severity (critical/high/medium);
 *  - route an incident to the right team/escalation policy (e.g. a database
 *    error pages the DBA team);
 *  - build provider-specific alert payloads that carry incident context links
 *    (logs, traces, Sentinel findings, test-gap analysis) and the remediation
 *    actions an on-call engineer can execute;
 *  - decide when an unacknowledged incident must escalate to a manager (default
 *    5 minutes); and
 *  - assemble a post-mortem summary and attach it to a follow-up ticket via an
 *    injected ticket creator.
 */
import { log } from './logger.js';

/** Sentinel incident severity exposed to on-call engineers. */
export type OncallSeverity = 'critical' | 'high' | 'medium';

/** Result of mapping an error rate: a severity, or `none` when below threshold. */
export type SeverityDecision = OncallSeverity | 'none';

/** Supported on-call providers. */
export type OncallProvider = 'pagerduty' | 'opsgenie';

/** PagerDuty Events API v2 severity values. */
export type PagerDutySeverity = 'critical' | 'error' | 'warning' | 'info';

/** Opsgenie alert priority values (P1 highest). */
export type OpsgeniePriority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

/** Deep-links attached to an incident so on-call has full context. */
export interface IncidentLinks {
  /** Link to the incident's aggregated logs. */
  logs?: string;
  /** Link to distributed traces for the failing request path. */
  traces?: string;
  /** Link to the Sentinel findings that raised the incident. */
  sentinelFindings?: string;
  /** Link to the automated test-gap analysis for this failure. */
  testGapAnalysis?: string;
}

/** A remediation action an on-call engineer can execute from the alert. */
export interface RemediationOption {
  /** Human-readable action label, e.g. "Scale checkout to 50 replicas". */
  label: string;
  /** Action category, e.g. `scale`, `rollback`, `failover`. */
  type: string;
  /** Optional runbook link or command reference. */
  command?: string;
}

/** Everything Sentinel knows about an incident when it pages on-call. */
export interface IncidentContext {
  /** Short incident title used as the alert summary/message. */
  title: string;
  /** Full incident description. */
  description: string;
  /** Owning service, used for routing and as the alert source. */
  service: string;
  /** Observed error rate as a percentage (0-100). Drives severity. */
  errorRatePercent: number;
  /** Stable de-duplication key (PagerDuty dedup_key / Opsgenie alias). */
  dedupKey: string;
  /** Optional error category (e.g. `database`) used by routing rules. */
  errorType?: string;
  /** Context deep-links surfaced to on-call. */
  links?: IncidentLinks;
  /** Remediation actions on-call can execute. */
  remediationActions?: readonly RemediationOption[];
  /** Sentinel findings (anomaly/causation summaries). */
  findings?: readonly string[];
}

/** Predicate describing when a routing rule applies to an incident. */
export interface RoutingMatch {
  /** Exact match on {@link IncidentContext.errorType}. */
  errorType?: string;
  /** Exact match on {@link IncidentContext.service}. */
  service?: string;
  /** Case-insensitive substring match against the title and description. */
  keyword?: string;
}

/** Maps a matching incident to a team and escalation policy. */
export interface RoutingRule {
  /** Match predicate. An empty match (`{}`) is a catch-all. */
  match: RoutingMatch;
  /** Team paged for this rule, e.g. `dba-team`. */
  team: string;
  /** Escalation policy / responder id for the provider. */
  escalationPolicy: string;
  /** Manager escalation target used when an incident is not acknowledged. */
  manager?: string;
}

/** A ready-to-send HTTP request for an on-call provider (no I/O performed). */
export interface OncallRequest {
  /** Target provider. */
  provider: OncallProvider;
  /** Absolute HTTPS endpoint. */
  url: string;
  /** HTTP method (always POST for both providers). */
  method: 'POST';
  /** Request headers, including any provider authorization header. */
  headers: Record<string, string>;
  /** JSON-serialized request body. */
  body: string;
}

/** Outcome of attempting to deliver an on-call request. */
export interface OncallDispatchResult {
  /** True when the provider accepted the request. */
  ok: boolean;
  /** HTTP status code (0 when the request never completed). */
  status: number;
  /** Provider incident/alert identifier when available. */
  incidentId?: string;
  /** Error description when delivery failed. */
  error?: string;
}

/**
 * Delivers an on-call request. Injected so tests can supply a mock instead of
 * performing network calls.
 */
export type OncallSender = (request: OncallRequest) => Promise<OncallDispatchResult>;

/** Minimal fetch signature used by the default on-call sender. */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** PagerDuty Events API v2 `links[]` entry. */
export interface PagerDutyLink {
  href: string;
  text: string;
}

/** PagerDuty Events API v2 payload body. */
export interface PagerDutyEvent {
  routing_key: string;
  event_action: 'trigger';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: PagerDutySeverity;
    custom_details: Record<string, unknown>;
  };
  links: PagerDutyLink[];
}

/** Opsgenie Alerts API v2 payload body. */
export interface OpsgenieAlert {
  message: string;
  alias: string;
  description: string;
  priority: OpsgeniePriority;
  responders: Array<{ name: string; type: 'team' }>;
  tags: string[];
  details: Record<string, string>;
}

const CRITICAL_THRESHOLD_PERCENT = 50;
const HIGH_THRESHOLD_PERCENT = 25;
const MEDIUM_THRESHOLD_PERCENT = 10;
const DEFAULT_ESCALATION_MINUTES = 5;
const MILLIS_PER_MINUTE = 60_000;

/** PagerDuty Events API v2 enqueue endpoint. */
export const PAGERDUTY_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';
/** Opsgenie Alerts API v2 endpoint. */
export const OPSGENIE_ALERTS_URL = 'https://api.opsgenie.com/v2/alerts';

/** PagerDuty severity for each Sentinel severity. */
const PAGERDUTY_SEVERITY: Readonly<Record<OncallSeverity, PagerDutySeverity>> = Object.freeze({
  critical: 'critical',
  high: 'error',
  medium: 'warning'
});

/** Opsgenie priority for each Sentinel severity. */
const OPSGENIE_PRIORITY: Readonly<Record<OncallSeverity, OpsgeniePriority>> = Object.freeze({
  critical: 'P1',
  high: 'P2',
  medium: 'P3'
});

/**
 * Default routing rules: database failures page the DBA team, everything else
 * falls through to a catch-all platform on-call rule.
 */
export const DEFAULT_ROUTING_RULES: readonly RoutingRule[] = Object.freeze([
  { match: { errorType: 'database' }, team: 'dba-team', escalationPolicy: 'dba-escalation', manager: 'dba-manager' },
  { match: { keyword: 'database' }, team: 'dba-team', escalationPolicy: 'dba-escalation', manager: 'dba-manager' },
  { match: {}, team: 'platform-oncall', escalationPolicy: 'platform-escalation', manager: 'platform-manager' }
]);

/**
 * Maps an observed error rate to an incident severity.
 *
 * Thresholds (from Issue #110): `> 50%` critical, `> 25%` high, `> 10%` medium,
 * otherwise `none`. Boundaries are exclusive, so exactly 50/25/10 fall to the
 * next lower band.
 *
 * @param errorRatePercent Observed error rate as a percentage (0-100).
 * @returns The severity band, or `none` when paging is not warranted.
 * @throws Error when the error rate is not a finite number in [0, 100].
 */
export function mapSeverity(errorRatePercent: number): SeverityDecision {
  if (!Number.isFinite(errorRatePercent) || errorRatePercent < 0 || errorRatePercent > 100) {
    throw new Error('errorRatePercent must be a finite number between 0 and 100');
  }
  if (errorRatePercent > CRITICAL_THRESHOLD_PERCENT) return 'critical';
  if (errorRatePercent > HIGH_THRESHOLD_PERCENT) return 'high';
  if (errorRatePercent > MEDIUM_THRESHOLD_PERCENT) return 'medium';
  return 'none';
}

/**
 * Selects the first routing rule that matches an incident.
 *
 * A rule matches when every field present in its {@link RoutingMatch} matches
 * the incident (exact `errorType`/`service`, case-insensitive `keyword`
 * substring of the title+description). An empty match is a catch-all.
 *
 * @param context Incident context.
 * @param rules Ordered routing rules (defaults to {@link DEFAULT_ROUTING_RULES}).
 * @returns The first matching rule.
 * @throws Error when no rule matches (supply a catch-all `{ match: {} }` rule).
 */
export function routeAlert(
  context: IncidentContext,
  rules: readonly RoutingRule[] = DEFAULT_ROUTING_RULES
): RoutingRule {
  const haystack = `${context.title} ${context.description}`.toLowerCase();
  for (const rule of rules) {
    const { errorType, service, keyword } = rule.match;
    if (errorType !== undefined && errorType !== context.errorType) continue;
    if (service !== undefined && service !== context.service) continue;
    if (keyword !== undefined && !haystack.includes(keyword.toLowerCase())) continue;
    return rule;
  }
  throw new Error(`No routing rule matched incident for service "${context.service}"`);
}

/**
 * Decides whether an unacknowledged incident must escalate to a manager.
 *
 * Escalation fires when the incident is still unacknowledged and at least
 * `escalationMinutes` have elapsed. The boundary is inclusive: at exactly the
 * window (default 5 minutes) escalation fires.
 *
 * @param createdAtMs Incident creation time (epoch milliseconds).
 * @param nowMs Current time (epoch milliseconds).
 * @param acknowledged Whether the incident has been acknowledged.
 * @param escalationMinutes Minutes before escalation (default 5).
 * @returns True when the incident should escalate now.
 * @throws Error on invalid timestamps or a non-positive escalation window.
 */
export function shouldEscalate(
  createdAtMs: number,
  nowMs: number,
  acknowledged: boolean,
  escalationMinutes: number = DEFAULT_ESCALATION_MINUTES
): boolean {
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) {
    throw new Error('createdAtMs and nowMs must be finite epoch milliseconds');
  }
  if (!Number.isFinite(escalationMinutes) || escalationMinutes <= 0) {
    throw new Error('escalationMinutes must be a positive number');
  }
  if (nowMs < createdAtMs) throw new Error('nowMs must not precede createdAtMs');
  if (acknowledged) return false;
  return nowMs - createdAtMs >= escalationMinutes * MILLIS_PER_MINUTE;
}

/** Builds the shared custom-details bag surfaced to on-call in either provider. */
function buildDetails(context: IncidentContext, severity: OncallSeverity, team: string): Record<string, string> {
  const details: Record<string, string> = {
    service: context.service,
    severity,
    team,
    error_rate_percent: String(context.errorRatePercent)
  };
  if (context.errorType) details['error_type'] = context.errorType;
  if (context.links?.logs) details['logs'] = context.links.logs;
  if (context.links?.traces) details['traces'] = context.links.traces;
  if (context.links?.sentinelFindings) details['sentinel_findings'] = context.links.sentinelFindings;
  if (context.links?.testGapAnalysis) details['test_gap_analysis'] = context.links.testGapAnalysis;
  if (context.findings && context.findings.length > 0) details['findings'] = context.findings.join('; ');
  if (context.remediationActions && context.remediationActions.length > 0) {
    details['remediation_actions'] = context.remediationActions
      .map(action => `${action.label} [${action.type}]${action.command ? ` -> ${action.command}` : ''}`)
      .join('\n');
  }
  return details;
}

/** Collects incident context links into PagerDuty `links[]` entries. */
function buildPagerDutyLinks(context: IncidentContext): PagerDutyLink[] {
  const links: PagerDutyLink[] = [];
  if (context.links?.logs) links.push({ href: context.links.logs, text: 'Incident logs' });
  if (context.links?.traces) links.push({ href: context.links.traces, text: 'Distributed traces' });
  if (context.links?.sentinelFindings) links.push({ href: context.links.sentinelFindings, text: 'Sentinel findings' });
  if (context.links?.testGapAnalysis) links.push({ href: context.links.testGapAnalysis, text: 'Test-gap analysis' });
  return links;
}

/**
 * Builds a PagerDuty Events API v2 `trigger` payload for an incident.
 *
 * The `routing_key` is a secret and must be supplied by the caller (never
 * hardcoded). Context links become PagerDuty `links[]` and all other context
 * (findings, remediation actions, test-gap analysis) is placed in
 * `custom_details`.
 *
 * @param context Incident context.
 * @param severity Sentinel severity (must not be `none`).
 * @param routingKey PagerDuty integration routing key (secret).
 * @param team Team resolved by routing, recorded in custom details.
 * @returns A PagerDuty Events API v2 event body.
 * @throws Error when the routing key is missing.
 */
export function formatPagerDutyEvent(
  context: IncidentContext,
  severity: OncallSeverity,
  routingKey: string,
  team: string
): PagerDutyEvent {
  if (!routingKey.trim()) throw new Error('PagerDuty routing key is required');
  return {
    routing_key: routingKey,
    event_action: 'trigger',
    dedup_key: context.dedupKey,
    payload: {
      summary: context.title,
      source: context.service,
      severity: PAGERDUTY_SEVERITY[severity],
      custom_details: { description: context.description, ...buildDetails(context, severity, team) }
    },
    links: buildPagerDutyLinks(context)
  };
}

/**
 * Builds an Opsgenie Alerts API v2 create-alert payload for an incident.
 *
 * The API key is a secret used in the request `Authorization` header (see
 * {@link buildOncallRequest}) and never appears in the body. Context links and
 * remediation actions are carried in the string `details` map.
 *
 * @param context Incident context.
 * @param severity Sentinel severity (must not be `none`).
 * @param team Team resolved by routing; becomes the Opsgenie responder.
 * @returns An Opsgenie Alerts API v2 alert body.
 */
export function formatOpsgenieAlert(
  context: IncidentContext,
  severity: OncallSeverity,
  team: string
): OpsgenieAlert {
  const tags = ['sentinel', `severity:${severity}`, `service:${context.service}`];
  if (context.errorType) tags.push(`error-type:${context.errorType}`);
  return {
    message: context.title,
    alias: context.dedupKey,
    description: context.description,
    priority: OPSGENIE_PRIORITY[severity],
    responders: [{ name: team, type: 'team' }],
    tags,
    details: buildDetails(context, severity, team)
  };
}

/** Options controlling how a provider request is built. */
export interface BuildRequestOptions {
  /** PagerDuty routing key (secret). Falls back to `PAGERDUTY_ROUTING_KEY`. */
  routingKey?: string;
  /** Opsgenie API key (secret). Falls back to `OPSGENIE_API_KEY`. */
  apiKey?: string;
  /** Environment source for secret fallbacks. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * Builds a ready-to-send {@link OncallRequest} for the chosen provider.
 *
 * Secrets are read from options first and then from the environment
 * (`PAGERDUTY_ROUTING_KEY` / `OPSGENIE_API_KEY`); they are never hardcoded. No
 * network call is made — the returned request is delivered by an
 * {@link OncallSender}.
 *
 * @param provider Target provider.
 * @param context Incident context.
 * @param severity Sentinel severity (must not be `none`).
 * @param team Team resolved by routing.
 * @param options Secret sources.
 * @returns A serialized HTTPS request for the provider.
 * @throws Error when the required secret is not configured.
 */
export function buildOncallRequest(
  provider: OncallProvider,
  context: IncidentContext,
  severity: OncallSeverity,
  team: string,
  options: BuildRequestOptions = {}
): OncallRequest {
  const env = options.env ?? process.env;
  if (provider === 'pagerduty') {
    const routingKey = options.routingKey ?? env['PAGERDUTY_ROUTING_KEY'];
    if (!routingKey || !routingKey.trim()) {
      throw new Error('PagerDuty routing key not configured (set PAGERDUTY_ROUTING_KEY or pass routingKey)');
    }
    return {
      provider,
      url: PAGERDUTY_EVENTS_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formatPagerDutyEvent(context, severity, routingKey, team))
    };
  }
  const apiKey = options.apiKey ?? env['OPSGENIE_API_KEY'];
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Opsgenie API key not configured (set OPSGENIE_API_KEY or pass apiKey)');
  }
  return {
    provider,
    url: OPSGENIE_ALERTS_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `GenieKey ${apiKey}` },
    body: JSON.stringify(formatOpsgenieAlert(context, severity, team))
  };
}

/** Options for {@link dispatchIncident}. */
export interface DispatchIncidentOptions extends BuildRequestOptions {
  /** Incident to page on. */
  context: IncidentContext;
  /** Target provider. */
  provider: OncallProvider;
  /** Delivery boundary (injected; supply a mock in tests). */
  sender: OncallSender;
  /** Routing rules (defaults to {@link DEFAULT_ROUTING_RULES}). */
  routingRules?: readonly RoutingRule[];
}

/** Outcome of {@link dispatchIncident}. */
export interface DispatchIncidentResult {
  /** True when on-call was successfully paged. */
  paged: boolean;
  /** True when paging was intentionally skipped (severity below threshold). */
  skipped: boolean;
  /** Explanation when skipped or failed. */
  reason?: string;
  /** Resolved severity. */
  severity: SeverityDecision;
  /** Team resolved by routing (absent when skipped). */
  team?: string;
  /** The request that was sent (absent when skipped). */
  request?: OncallRequest;
  /** Underlying delivery result when a send was attempted. */
  result?: OncallDispatchResult;
}

/**
 * Pages on-call for an incident: maps severity, routes to a team, builds the
 * provider payload, and delivers it through the injected sender.
 *
 * When the error rate maps to `none` (at or below 10%) paging is skipped. All
 * network I/O is delegated to the injected {@link OncallSender}.
 *
 * @param opts Incident, provider, sender, routing, and secret sources.
 * @returns Result describing whether on-call was paged, skipped, or failed.
 * @throws Error when the required provider secret is not configured.
 */
export async function dispatchIncident(opts: DispatchIncidentOptions): Promise<DispatchIncidentResult> {
  const { context, provider, sender, routingRules } = opts;
  const severity = mapSeverity(context.errorRatePercent);
  if (severity === 'none') {
    log.info('Skipping on-call page: severity below threshold', {
      service: context.service,
      errorRatePercent: context.errorRatePercent
    });
    return { paged: false, skipped: true, reason: 'Error rate below paging threshold', severity };
  }

  const rule = routeAlert(context, routingRules);
  const request = buildOncallRequest(provider, context, severity, rule.team, opts);

  let result: OncallDispatchResult;
  try {
    result = await sender(request);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error('On-call dispatch threw', error);
    return { paged: false, skipped: false, reason: detail, severity, team: rule.team, request };
  }

  if (!result.ok) {
    log.error('On-call dispatch failed', new Error(result.error ?? `HTTP ${result.status}`));
    return { paged: false, skipped: false, reason: result.error ?? `HTTP ${result.status}`, severity, team: rule.team, request, result };
  }

  log.warn('Paged on-call', { service: context.service, severity, team: rule.team, provider });
  return { paged: true, skipped: false, severity, team: rule.team, request, result };
}

/** Options for {@link escalateIfUnacked}. */
export interface EscalateOptions {
  /** Incident being escalated. */
  context: IncidentContext;
  /** Target provider. */
  provider: OncallProvider;
  /** Delivery boundary (injected). */
  sender: OncallSender;
  /** Incident creation time (epoch milliseconds). */
  createdAtMs: number;
  /** Current time (epoch milliseconds). */
  nowMs: number;
  /** Whether the incident was acknowledged. */
  acknowledged: boolean;
  /** Manager/escalation target paged when escalating. */
  manager: string;
  /** Escalation window in minutes (default 5). */
  escalationMinutes?: number;
  /** PagerDuty routing key (secret). Falls back to env. */
  routingKey?: string;
  /** Opsgenie API key (secret). Falls back to env. */
  apiKey?: string;
  /** Environment source for secret fallbacks. */
  env?: Record<string, string | undefined>;
}

/** Outcome of {@link escalateIfUnacked}. */
export interface EscalateResult {
  /** True when an escalation page was delivered. */
  escalated: boolean;
  /** Explanation when not escalated or on failure. */
  reason?: string;
  /** Underlying delivery result when a send was attempted. */
  result?: OncallDispatchResult;
}

/**
 * Escalates an unacknowledged incident to the manager once the escalation
 * window elapses (default 5 minutes, boundary inclusive).
 *
 * The manager is paged as the responder team/escalation policy; the alert
 * re-uses the incident's de-dup key with an `-escalation` suffix so it is a
 * distinct, correlated page.
 *
 * @param opts Incident, timing, manager, provider, sender, and secrets.
 * @returns Result describing whether escalation was performed.
 * @throws Error on invalid timing input or a missing provider secret.
 */
export async function escalateIfUnacked(opts: EscalateOptions): Promise<EscalateResult> {
  const { context, provider, sender, createdAtMs, nowMs, acknowledged, manager } = opts;
  if (!manager.trim()) throw new Error('manager is required to escalate');
  if (!shouldEscalate(createdAtMs, nowMs, acknowledged, opts.escalationMinutes)) {
    return { escalated: false, reason: acknowledged ? 'Incident acknowledged' : 'Escalation window not elapsed' };
  }

  const escalationContext: IncidentContext = {
    ...context,
    title: `ESCALATION: ${context.title}`,
    description: `Unacknowledged after ${opts.escalationMinutes ?? DEFAULT_ESCALATION_MINUTES} minutes. ${context.description}`,
    dedupKey: `${context.dedupKey}-escalation`
  };
  const severity = mapSeverity(context.errorRatePercent);
  const effectiveSeverity: OncallSeverity = severity === 'none' ? 'high' : severity;
  const request = buildOncallRequest(provider, escalationContext, effectiveSeverity, manager, opts);

  try {
    const result = await sender(request);
    if (!result.ok) {
      log.error('Escalation dispatch failed', new Error(result.error ?? `HTTP ${result.status}`));
      return { escalated: false, reason: result.error ?? `HTTP ${result.status}`, result };
    }
    log.warn('Escalated incident to manager', { service: context.service, manager });
    return { escalated: true, result };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error('Escalation dispatch threw', error);
    return { escalated: false, reason: detail };
  }
}

/** Post-mortem summary attached to a follow-up ticket. */
export interface PostMortemSummary {
  /** Provider incident/alert identifier. */
  incidentId: string;
  /** Incident title. */
  title: string;
  /** Severity the incident was paged at. */
  severity: OncallSeverity;
  /** Team that owned the incident. */
  team: string;
  /** Service affected. */
  service: string;
  /** Ordered timeline entries (detection, page, ack, escalation, resolution). */
  timeline: string[];
  /** Sentinel findings captured during the incident. */
  findings: string[];
  /** Remediation actions offered/taken. */
  remediation: string[];
  /** Context links preserved for the ticket. */
  links: IncidentLinks;
}

/** A created follow-up ticket. */
export interface FollowUpTicket {
  /** Ticket key/id in the tracker. */
  ticketKey: string;
  /** Optional browsable URL. */
  url?: string;
}

/** Creates a follow-up ticket from a post-mortem summary (injected boundary). */
export type FollowUpTicketCreator = (summary: PostMortemSummary) => Promise<FollowUpTicket>;

/**
 * Builds a post-mortem summary from an incident and its lifecycle timeline.
 *
 * @param context Incident context.
 * @param details Incident id, severity, owning team, and timeline entries.
 * @returns A structured post-mortem summary.
 * @throws Error when the incident id is empty.
 */
export function buildPostMortemSummary(
  context: IncidentContext,
  details: { incidentId: string; severity: OncallSeverity; team: string; timeline: readonly string[] }
): PostMortemSummary {
  if (!details.incidentId.trim()) throw new Error('incidentId is required for a post-mortem');
  return {
    incidentId: details.incidentId,
    title: context.title,
    severity: details.severity,
    team: details.team,
    service: context.service,
    timeline: [...details.timeline],
    findings: [...(context.findings ?? [])],
    remediation: (context.remediationActions ?? []).map(action => `${action.label} [${action.type}]`),
    links: { ...(context.links ?? {}) }
  };
}

/** Outcome of {@link attachPostMortem}. */
export interface AttachPostMortemResult {
  /** True when a follow-up ticket was created. */
  attached: boolean;
  /** The created ticket when successful. */
  ticket?: FollowUpTicket;
  /** Error description when creation failed. */
  reason?: string;
}

/**
 * Attaches a post-mortem summary to a follow-up ticket via an injected creator.
 *
 * @param summary Post-mortem summary to attach.
 * @param creator Injected ticket creator (mocked in tests).
 * @returns Result describing whether the ticket was created.
 */
export async function attachPostMortem(
  summary: PostMortemSummary,
  creator: FollowUpTicketCreator
): Promise<AttachPostMortemResult> {
  try {
    const ticket = await creator(summary);
    if (!ticket.ticketKey.trim()) throw new Error('ticket creator returned an empty ticket key');
    log.success('Attached post-mortem to follow-up ticket', { incidentId: summary.incidentId, ticketKey: ticket.ticketKey });
    return { attached: true, ticket };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error('Failed to attach post-mortem', error);
    return { attached: false, reason: detail };
  }
}

/**
 * Creates a fetch-based {@link OncallSender}.
 *
 * The default reads the incident/alert id from the provider's JSON response
 * (`dedup_key` for PagerDuty, `requestId` for Opsgenie). Injected so tests
 * never perform live HTTP.
 *
 * @param fetchImpl Fetch implementation (defaults to global `fetch`).
 * @returns An {@link OncallSender} that POSTs the request body.
 */
export function createFetchOncallSender(fetchImpl?: FetchLike): OncallSender {
  const doFetch: FetchLike =
    fetchImpl ??
    ((input, init): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> =>
      fetch(input, init) as unknown as Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>);

  return async (request) => {
    try {
      const response = await doFetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });
      if (!response.ok) {
        return { ok: false, status: response.status, error: `${request.provider} returned HTTP ${response.status}` };
      }
      let incidentId: string | undefined;
      try {
        const payload = (await response.json()) as { dedup_key?: unknown; requestId?: unknown };
        const raw = request.provider === 'pagerduty' ? payload.dedup_key : payload.requestId;
        if (typeof raw === 'string') incidentId = raw;
      } catch {
        // A 2xx with an unparseable body is still a successful page.
      }
      return { ok: true, status: response.status, ...(incidentId ? { incidentId } : {}) };
    } catch (error) {
      return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
