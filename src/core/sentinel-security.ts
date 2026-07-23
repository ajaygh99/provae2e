/** Sentinel security detection engine: rate, pattern, and behavioral intrusion detection. */
import { log } from './logger.js';

/** Category of security-relevant production event. */
export type SecurityEventType = 'login' | 'api-request' | 'data-access' | 'query' | 'generic';

/** How a rate rule groups events before counting them. */
export type RateGroupBy = 'ip' | 'user' | 'global';

/** Detection rule family that produced an alert. */
export type SecurityRuleType = 'rate' | 'sqli' | 'impossible-travel';

/**
 * Alert severity, mapped to a response posture:
 * - `suspicious`: investigate only, no automated action.
 * - `confirmed`: block the offending source.
 * - `critical`: full incident response.
 */
export type SecurityAlertLevel = 'suspicious' | 'confirmed' | 'critical';

/** Automated response action taken in reply to a detection. */
export type SecurityActionType =
  | 'block-ip'
  | 'revoke-session'
  | 'rotate-credentials'
  | 'page-security';

/** Outcome recorded for a single detection or automated action. */
export type SecurityOutcome = 'detected' | 'planned' | 'succeeded' | 'failed';

/** Supported SIEM export dialects. */
export type SiemFormat = 'splunk' | 'elk';

/** A single security-relevant production log event. */
export interface SecurityEvent {
  /** Unique event identifier. */
  id: string;
  /** ISO-8601 event timestamp. */
  timestamp: string;
  /** Event category used by detection rules. */
  type: SecurityEventType;
  /** Originating source IP address. */
  sourceIp: string;
  /** Authenticated user identifier, when known. */
  userId?: string;
  /** ISO country code of the request origin, when known. */
  country?: string;
  /** Raw log message, inspected by pattern rules. */
  message?: string;
}

/** Configurable rate-based detection rule. */
export interface RateRule {
  /** Stable rule identifier. */
  id: string;
  /** Event type this rule counts. */
  eventType: SecurityEventType;
  /** Dimension used to bucket events before counting. */
  groupBy: RateGroupBy;
  /** Sliding window size in milliseconds. */
  windowMs: number;
  /** Threshold; a count strictly greater than this triggers the rule. */
  threshold: number;
  /** Alert level raised when the rule triggers. */
  level: SecurityAlertLevel;
}

/** Immutable audit-trail record capturing who, what, when, where, and why. */
export interface SecurityAuditRecord {
  /** Monotonic append-only sequence number. */
  sequence: number;
  /** ISO timestamp of the triggering event (when). */
  timestamp: string;
  /** Acting principal — user id or `anonymous` (who). */
  actor: string;
  /** Source IP address of the event (where). */
  sourceIp: string;
  /** Detection rule family (what was detected). */
  rule: SecurityRuleType;
  /** Specific rule identifier. */
  ruleId: string;
  /** Alert severity. */
  alertLevel: SecurityAlertLevel;
  /** Detection marker or automated action taken (what was done). */
  action: 'detect' | SecurityActionType;
  /** Human-readable justification (why). */
  reason: string;
  /** Recorded outcome. */
  outcome: SecurityOutcome;
  /** Supplementary detail. */
  detail: string;
}

/** A single triggered detection with its resulting audit records. */
export interface SecurityDetection {
  /** Detection rule family. */
  rule: SecurityRuleType;
  /** Specific rule identifier. */
  ruleId: string;
  /** Alert severity. */
  alertLevel: SecurityAlertLevel;
  /** Grouping subject that breached the rule. */
  subject: string;
  /** Acting principal. */
  actor: string;
  /** Source IP address. */
  sourceIp: string;
  /** ISO timestamp of the triggering event. */
  timestamp: string;
  /** Human-readable justification. */
  reason: string;
  /** Sequence number of the detection audit record. */
  auditSequence: number;
  /** Audit records for automated actions taken in response. */
  actions: SecurityAuditRecord[];
}

/** Result returned by an automated response action. */
export interface SecurityActionResult {
  /** Whether the action completed successfully. */
  success: boolean;
  /** Human-readable detail for the audit trail. */
  detail: string;
}

/**
 * Injected boundary for automated response side effects. Implementations
 * perform real infrastructure changes; tested paths use a fake.
 */
export interface SecurityResponder {
  /** Blocks an offending source IP. */
  blockIp(ip: string, reason: string): Promise<SecurityActionResult>;
  /** Revokes an active session for a user. */
  revokeSession(userId: string, reason: string): Promise<SecurityActionResult>;
  /** Rotates credentials for a compromised user. */
  rotateCredentials(userId: string, reason: string): Promise<SecurityActionResult>;
  /** Pages the on-call security team. */
  pageSecurity(summary: string, reason: string): Promise<SecurityActionResult>;
}

/** Injected boundary for forwarding audit records to a SIEM. */
export interface SiemForwarder {
  /** Forwards one immutable audit record to the SIEM. */
  forward(record: SecurityAuditRecord): Promise<void>;
}

/** Evidence mapping for a single compliance-framework control. */
export interface ComplianceControl {
  /** Control identifier (e.g. `CC7.2`). */
  id: string;
  /** Control name. */
  name: string;
  /** What the control asserts. */
  description: string;
  /** Audit record sequences that evidence the control. */
  evidence: number[];
  /** Whether at least one evidence record exists. */
  satisfied: boolean;
}

/** Compliance evidence report for a security framework. */
export interface ComplianceEvidence {
  /** Framework the report attests to. */
  framework: 'SOC2' | 'ISO27001';
  /** ISO timestamp the report was generated. */
  generatedAt: string;
  /** Total immutable audit records available as evidence. */
  totalAuditRecords: number;
  /** Per-control evidence mapping. */
  controls: ComplianceControl[];
}

/** Configuration for {@link SentinelSecurityMonitor}. */
export interface SentinelSecurityOptions {
  /** Rate rules to evaluate. Defaults to {@link DEFAULT_RATE_RULES}. */
  rateRules?: RateRule[];
  /** Behavioral impossible-travel window in ms. Defaults to one hour. */
  travelWindowMs?: number;
  /** Injected responder; when omitted, actions are recorded as `planned` only. */
  responder?: SecurityResponder;
  /** Injected SIEM forwarder; when omitted, records are retained locally only. */
  siem?: SiemForwarder;
  /** Clock used for report generation timestamps. */
  now?: () => Date;
}

/** Default rate-based detection rules covering login, API, and bulk data access. */
export const DEFAULT_RATE_RULES: readonly RateRule[] = Object.freeze([
  { id: 'login-burst', eventType: 'login', groupBy: 'global', windowMs: 60_000, threshold: 100, level: 'confirmed' },
  { id: 'api-flood', eventType: 'api-request', groupBy: 'ip', windowMs: 60_000, threshold: 1000, level: 'confirmed' },
  { id: 'bulk-data-access', eventType: 'data-access', groupBy: 'user', windowMs: 60_000, threshold: 50, level: 'suspicious' }
]);

/** Default behavioral impossible-travel window: one hour. */
export const DEFAULT_TRAVEL_WINDOW_MS = 3_600_000;

/** Regular expressions matching common SQL-injection signatures. */
const SQLI_SIGNATURES: readonly RegExp[] = Object.freeze([
  /\bor\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i,
  /\bunion\b\s+(all\s+)?\bselect\b/i,
  /\bdrop\s+table\b/i,
  /\binsert\s+into\b.*\bvalues\b/i,
  /;\s*--/,
  /'\s*--/,
  /\bexec(\s|\()+/i,
  /\bxp_cmdshell\b/i
]);

/**
 * Stateful security intrusion-detection engine. Ingests security events,
 * evaluates rate, pattern, and behavioral rules, classifies alert levels,
 * drives automated responses through an injected boundary, and maintains an
 * append-only audit trail suitable for SIEM export and compliance evidence.
 */
export class SentinelSecurityMonitor {
  private readonly rateRules: RateRule[];
  private readonly travelWindowMs: number;
  private readonly responder: SecurityResponder | undefined;
  private readonly siem: SiemForwarder | undefined;
  private readonly now: () => Date;
  private readonly events: SecurityEvent[] = [];
  private readonly trail: SecurityAuditRecord[] = [];
  private readonly activeAlerts = new Set<string>();
  private sequence = 0;
  private readonly maxWindowMs: number;

  /**
   * Creates a security monitor.
   * @param options Rule configuration and injected side-effect boundaries.
   */
  constructor(options: SentinelSecurityOptions = {}) {
    this.rateRules = (options.rateRules ?? [...DEFAULT_RATE_RULES]).map(validateRateRule);
    this.travelWindowMs = validatePositive(options.travelWindowMs ?? DEFAULT_TRAVEL_WINDOW_MS, 'travelWindowMs');
    this.responder = options.responder;
    this.siem = options.siem;
    this.now = options.now ?? ((): Date => new Date());
    this.maxWindowMs = Math.max(
      this.travelWindowMs,
      ...this.rateRules.map(rule => rule.windowMs),
      0
    );
  }

  /**
   * Ingests one security event, evaluates all detection rules, records audit
   * evidence, and triggers automated responses for confirmed/critical alerts.
   * @param event Security-relevant production event.
   * @returns Detections raised by this event, if any.
   * @throws Error if the event is malformed.
   */
  async ingest(event: SecurityEvent): Promise<SecurityDetection[]> {
    const validated = validateEvent(event);
    const eventTime = Date.parse(validated.timestamp);
    this.events.push(validated);
    this.prune(eventTime);

    const detections: SecurityDetection[] = [];
    const patternDetection = this.evaluatePattern(validated, eventTime);
    if (patternDetection) detections.push(patternDetection);
    for (const rule of this.rateRules) {
      const rateDetection = this.evaluateRate(rule, validated, eventTime);
      if (rateDetection) detections.push(rateDetection);
    }
    const travelDetection = this.evaluateTravel(validated, eventTime);
    if (travelDetection) detections.push(travelDetection);

    for (const detection of detections) {
      await this.respond(detection, validated);
    }
    return detections;
  }

  /**
   * Returns the immutable audit trail in append order.
   * @returns A defensive copy of every audit record.
   */
  auditTrail(): SecurityAuditRecord[] {
    return this.trail.map(record => ({ ...record }));
  }

  /**
   * Formats the audit trail for a SIEM platform.
   * @param format Target SIEM dialect.
   * @returns Newline-delimited SIEM payload.
   */
  exportSiem(format: SiemFormat): string {
    return formatSiem(this.trail, format);
  }

  /**
   * Builds SOC2 or ISO27001 security-control evidence from the audit trail.
   * @param framework Compliance framework to attest to.
   * @returns Control-by-control evidence report.
   */
  complianceEvidence(framework: 'SOC2' | 'ISO27001'): ComplianceEvidence {
    const detectSequences = this.trail.filter(r => r.action === 'detect').map(r => r.sequence);
    const responseSequences = this.trail.filter(r => r.action !== 'detect').map(r => r.sequence);
    const allSequences = this.trail.map(r => r.sequence);
    const controls = (framework === 'SOC2'
      ? SOC2_CONTROLS
      : ISO27001_CONTROLS
    ).map(definition => {
      const evidence = definition.kind === 'detection'
        ? detectSequences
        : definition.kind === 'response'
          ? responseSequences
          : allSequences;
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        evidence,
        satisfied: evidence.length > 0
      };
    });
    return {
      framework,
      generatedAt: this.currentTime().toISOString(),
      totalAuditRecords: this.trail.length,
      controls
    };
  }

  private evaluatePattern(event: SecurityEvent, eventTime: number): SecurityDetection | undefined {
    const message = event.message ?? '';
    if (!SQLI_SIGNATURES.some(signature => signature.test(message))) return undefined;
    const reason = `SQL injection signature detected in ${event.type} request`;
    return this.record('sqli', 'sqli-signature', 'confirmed', actorOf(event), event, eventTime, reason);
  }

  private evaluateRate(rule: RateRule, event: SecurityEvent, eventTime: number): SecurityDetection | undefined {
    if (event.type !== rule.eventType) return undefined;
    const subject = subjectOf(rule.groupBy, event);
    const key = `rate:${rule.id}:${subject}`;
    const windowStart = eventTime - rule.windowMs;
    const count = this.events.filter(candidate =>
      candidate.type === rule.eventType &&
      subjectOf(rule.groupBy, candidate) === subject &&
      Date.parse(candidate.timestamp) > windowStart &&
      Date.parse(candidate.timestamp) <= eventTime
    ).length;
    if (count <= rule.threshold) {
      this.activeAlerts.delete(key);
      return undefined;
    }
    if (this.activeAlerts.has(key)) return undefined;
    this.activeAlerts.add(key);
    const reason = `${count} ${rule.eventType} events for ${rule.groupBy}=${subject} exceeded ${rule.threshold} within ${rule.windowMs}ms`;
    return this.record('rate', rule.id, rule.level, actorOf(event), event, eventTime, reason, subject);
  }

  private evaluateTravel(event: SecurityEvent, eventTime: number): SecurityDetection | undefined {
    if (!event.userId || !event.country) return undefined;
    const key = `travel:${event.userId}`;
    const match = this.events.find(candidate =>
      candidate.userId === event.userId &&
      candidate.country !== undefined &&
      candidate.country !== event.country &&
      Math.abs(eventTime - Date.parse(candidate.timestamp)) < this.travelWindowMs
    );
    if (!match) {
      this.activeAlerts.delete(key);
      return undefined;
    }
    if (this.activeAlerts.has(key)) return undefined;
    this.activeAlerts.add(key);
    const reason = `User ${event.userId} seen in ${match.country} and ${event.country} within ${this.travelWindowMs}ms`;
    return this.record('impossible-travel', 'impossible-travel', 'critical', event.userId, event, eventTime, reason);
  }

  private async respond(detection: SecurityDetection, event: SecurityEvent): Promise<void> {
    for (const action of actionsForLevel(detection.alertLevel)) {
      if ((action === 'revoke-session' || action === 'rotate-credentials') && !event.userId) continue;
      const auditAction = await this.performAction(action, detection, event);
      detection.actions.push(auditAction);
    }
  }

  private async performAction(
    action: SecurityActionType,
    detection: SecurityDetection,
    event: SecurityEvent
  ): Promise<SecurityAuditRecord> {
    if (!this.responder) {
      return this.append(detection, action, 'planned', 'No responder configured; action recorded only', event);
    }
    try {
      const result = await this.invoke(action, detection, event);
      return this.append(
        detection,
        action,
        result.success ? 'succeeded' : 'failed',
        result.detail,
        event
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.error(`Security auto-action ${action} failed`, error);
      return this.append(detection, action, 'failed', detail, event);
    }
  }

  private invoke(
    action: SecurityActionType,
    detection: SecurityDetection,
    event: SecurityEvent
  ): Promise<SecurityActionResult> {
    const responder = this.responder as SecurityResponder;
    const reason = detection.reason;
    if (action === 'block-ip') return responder.blockIp(event.sourceIp, reason);
    if (action === 'revoke-session') return responder.revokeSession(event.userId as string, reason);
    if (action === 'rotate-credentials') return responder.rotateCredentials(event.userId as string, reason);
    return responder.pageSecurity(`${detection.rule} (${detection.alertLevel})`, reason);
  }

  private record(
    rule: SecurityRuleType,
    ruleId: string,
    alertLevel: SecurityAlertLevel,
    actor: string,
    event: SecurityEvent,
    eventTime: number,
    reason: string,
    subject = actor
  ): SecurityDetection {
    const detection: SecurityDetection = {
      rule,
      ruleId,
      alertLevel,
      subject,
      actor,
      sourceIp: event.sourceIp,
      timestamp: new Date(eventTime).toISOString(),
      reason,
      auditSequence: 0,
      actions: []
    };
    const auditRecord = this.append(detection, 'detect', 'detected', reason, event);
    detection.auditSequence = auditRecord.sequence;
    return detection;
  }

  private append(
    detection: SecurityDetection,
    action: 'detect' | SecurityActionType,
    outcome: SecurityOutcome,
    detail: string,
    event: SecurityEvent
  ): SecurityAuditRecord {
    this.sequence += 1;
    const record: SecurityAuditRecord = {
      sequence: this.sequence,
      timestamp: detection.timestamp,
      actor: detection.actor,
      sourceIp: event.sourceIp,
      rule: detection.rule,
      ruleId: detection.ruleId,
      alertLevel: detection.alertLevel,
      action,
      reason: detection.reason,
      outcome,
      detail
    };
    this.trail.push(record);
    this.forward(record);
    return record;
  }

  private forward(record: SecurityAuditRecord): void {
    if (!this.siem) return;
    void this.siem.forward({ ...record }).catch((error: unknown) => {
      log.warn('SIEM forwarding failed', { sequence: record.sequence });
      log.debug('SIEM forwarding error detail', { error: String(error) });
    });
  }

  private prune(eventTime: number): void {
    const cutoff = eventTime - this.maxWindowMs;
    while (this.events.length > 0 && Date.parse(this.events[0].timestamp) < cutoff) {
      this.events.shift();
    }
  }

  private currentTime(): Date {
    const value = this.now();
    if (!Number.isFinite(value.getTime())) throw new Error('now() must return a valid Date');
    return value;
  }
}

/**
 * Formats immutable audit records for a SIEM platform.
 * @param records Audit records to serialize.
 * @param format Target SIEM dialect (`splunk` key=value, `elk` ECS NDJSON).
 * @returns Newline-delimited SIEM payload.
 */
export function formatSiem(records: readonly SecurityAuditRecord[], format: SiemFormat): string {
  if (format === 'splunk') {
    return records.map(splunkLine).join('\n');
  }
  if (format === 'elk') {
    return records.map(elkLine).join('\n');
  }
  throw new Error(`Unsupported SIEM format: ${String(format)}`);
}

/**
 * Returns the automated actions mandated for an alert level.
 * @param level Alert severity.
 * @returns Ordered list of response actions.
 */
export function actionsForLevel(level: SecurityAlertLevel): SecurityActionType[] {
  if (level === 'suspicious') return [];
  if (level === 'confirmed') return ['block-ip', 'revoke-session'];
  return ['block-ip', 'revoke-session', 'rotate-credentials', 'page-security'];
}

function splunkLine(record: SecurityAuditRecord): string {
  return [
    `time=${record.timestamp}`,
    `seq=${record.sequence}`,
    `rule=${record.rule}`,
    `rule_id=${record.ruleId}`,
    `level=${record.alertLevel}`,
    `action=${record.action}`,
    `actor=${record.actor}`,
    `src_ip=${record.sourceIp}`,
    `outcome=${record.outcome}`,
    `reason=${quote(record.reason)}`,
    `detail=${quote(record.detail)}`
  ].join(' ');
}

function elkLine(record: SecurityAuditRecord): string {
  return JSON.stringify({
    '@timestamp': record.timestamp,
    'event.kind': record.action === 'detect' ? 'alert' : 'action',
    'event.action': record.action,
    'event.outcome': record.outcome,
    'event.sequence': record.sequence,
    'rule.name': record.rule,
    'rule.id': record.ruleId,
    'security.alert_level': record.alertLevel,
    'user.name': record.actor,
    'source.ip': record.sourceIp,
    message: record.reason,
    detail: record.detail
  });
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function actorOf(event: SecurityEvent): string {
  return event.userId ?? 'anonymous';
}

function subjectOf(groupBy: RateGroupBy, event: SecurityEvent): string {
  if (groupBy === 'ip') return event.sourceIp;
  if (groupBy === 'user') return event.userId ?? 'anonymous';
  return 'all';
}

function validateEvent(event: SecurityEvent): SecurityEvent {
  requiredString(event.id, 'event.id');
  requiredString(event.sourceIp, 'event.sourceIp');
  if (!Number.isFinite(Date.parse(event.timestamp))) throw new Error('event.timestamp must be a valid ISO date');
  if (!['login', 'api-request', 'data-access', 'query', 'generic'].includes(event.type)) {
    throw new Error(`Unsupported event type: ${String(event.type)}`);
  }
  if (event.userId !== undefined && !event.userId.trim()) throw new Error('event.userId must not be blank');
  if (event.country !== undefined && !event.country.trim()) throw new Error('event.country must not be blank');
  return event;
}

function validateRateRule(rule: RateRule): RateRule {
  requiredString(rule.id, 'rateRule.id');
  if (!['login', 'api-request', 'data-access', 'query', 'generic'].includes(rule.eventType)) {
    throw new Error(`Unsupported rate rule event type: ${String(rule.eventType)}`);
  }
  if (!['ip', 'user', 'global'].includes(rule.groupBy)) throw new Error(`Unsupported rate rule groupBy: ${String(rule.groupBy)}`);
  validatePositive(rule.windowMs, 'rateRule.windowMs');
  if (!Number.isFinite(rule.threshold) || rule.threshold < 0) throw new Error('rateRule.threshold must be non-negative');
  if (!['suspicious', 'confirmed', 'critical'].includes(rule.level)) throw new Error(`Unsupported alert level: ${String(rule.level)}`);
  return rule;
}

function validatePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function requiredString(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
}

interface ControlDefinition {
  id: string;
  name: string;
  description: string;
  kind: 'detection' | 'response' | 'all';
}

const SOC2_CONTROLS: readonly ControlDefinition[] = Object.freeze([
  { id: 'CC7.2', name: 'Security monitoring', description: 'Monitors systems to detect anomalies indicative of malicious acts.', kind: 'detection' },
  { id: 'CC7.3', name: 'Security event evaluation', description: 'Evaluates security events to determine whether they represent incidents.', kind: 'all' },
  { id: 'CC7.4', name: 'Incident response', description: 'Responds to identified security incidents with defined actions.', kind: 'response' }
]);

const ISO27001_CONTROLS: readonly ControlDefinition[] = Object.freeze([
  { id: 'A.12.4.1', name: 'Event logging', description: 'Produces and retains logs recording security-relevant activity.', kind: 'all' },
  { id: 'A.12.4.3', name: 'Administrator and operator logs', description: 'Logs privileged and automated response activity.', kind: 'response' },
  { id: 'A.16.1.4', name: 'Assessment of security events', description: 'Assesses and classifies information security events.', kind: 'detection' }
]);
