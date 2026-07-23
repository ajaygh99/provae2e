/** Sentinel change management: change log, incident correlation, approval gate, and metrics. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from './logger.js';
import type { GitHubDeployment } from './github-api-client.js';
import type { SentinelEvidence } from './sentinel-agent.js';

/** Category of a tracked production change. */
export type ChangeType = 'deployment' | 'config' | 'permission';

/** Origin system a change was captured from. */
export type ChangeSource = 'github' | 'datadog' | 'aws';

/** Approval-gate state of a change. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** Action recorded in the change audit log. */
export type AuditAction = 'created' | 'approved' | 'rejected' | 'rolled-back';

const CHANGE_TYPES: readonly ChangeType[] = ['deployment', 'config', 'permission'];
const CHANGE_SOURCES: readonly ChangeSource[] = ['github', 'datadog', 'aws'];

/** Raw change captured from a source, before approval/rollback state is tracked. */
export interface ChangeInput {
  /** Stable unique id (e.g. `github-deploy-42`). */
  id: string;
  /** Change category. */
  changeType: ChangeType;
  /** Origin system. */
  source: ChangeSource;
  /** Service or component affected. */
  service: string;
  /** ISO 8601 timestamp the change took effect. */
  timestamp: string;
  /** Human-readable description of what changed. */
  details: string;
  /** User or bot that made the change. */
  author: string;
  /** External reference (commit SHA, deployment id, event id). */
  reference?: string;
  /** One-click rollback/revert link. */
  rollbackUrl?: string;
  /** When true the change is stored pre-approved (e.g. automated safe change). */
  autoApproved?: boolean;
}

/** A stored change with approval-gate and rollback state. */
export interface ChangeRecord extends ChangeInput {
  /** Approval-gate state. */
  approvalStatus: ApprovalStatus;
  /** Approver login, when approved. */
  approvedBy?: string;
  /** ISO 8601 approval timestamp, when approved. */
  approvedAt?: string;
  /** True once the change has been rolled back. */
  rolledBack: boolean;
  /** ISO 8601 rollback timestamp, when rolled back. */
  rolledBackAt?: string;
}

/** One entry in the append-only change audit log. */
export interface ChangeAuditEntry {
  /** Change the entry relates to. */
  changeId: string;
  /** Action performed. */
  action: AuditAction;
  /** Actor who performed the action. */
  actor: string;
  /** ISO 8601 timestamp of the action. */
  timestamp: string;
  /** Optional free-text detail (e.g. rejection reason). */
  detail?: string;
}

/** Minimal production incident reference used for change correlation. */
export interface IncidentRef {
  /** Incident id. */
  id: string;
  /** ISO 8601 time the incident began. */
  timestamp: string;
  /** Incident message. */
  message: string;
  /** Affected service, when known. */
  service?: string;
}

/** A change correlated against an incident by timing. */
export interface CorrelatedChange {
  /** The correlated change. */
  change: ChangeRecord;
  /** Minutes the change preceded the incident (0 when simultaneous). */
  minutesBeforeIncident: number;
  /** True when the change targets the same service as the incident. */
  sameService: boolean;
  /** True when the change falls inside the suspicious-timing window. */
  suspicious: boolean;
  /** Rollback link, when available. */
  rollbackUrl?: string;
}

/** Result of correlating an incident with recent changes. */
export interface IncidentCorrelation {
  /** The incident that was correlated. */
  incident: IncidentRef;
  /** Suspicious-timing window applied, in minutes. */
  suspiciousWindowMinutes: number;
  /** Lookback window applied, in minutes. */
  lookbackMinutes: number;
  /** Recent changes before the incident, closest first. */
  correlatedChanges: CorrelatedChange[];
  /** The most likely culprit (closest suspicious change), when any. */
  likelyCulprit?: CorrelatedChange;
}

/** Options for incident correlation. */
export interface CorrelationOptions {
  /** How far back to include changes, in minutes. Defaults to 1440 (24h). */
  lookbackMinutes?: number;
  /** Window that flags a change as a suspicious cause, in minutes. Defaults to 15. */
  suspiciousWindowMinutes?: number;
}

/** Aggregated change-management metrics. */
export interface ChangeMetrics {
  /** Total number of changes recorded. */
  totalChanges: number;
  /** Count of changes per type. */
  changesByType: Record<ChangeType, number>;
  /** Mean number of changes per day across the recorded span. */
  changeFrequencyPerDay: number;
  /** Number of changes rolled back. */
  rollbackCount: number;
  /** Fraction of changes rolled back (0-1). */
  rollbackRate: number;
  /** Fraction of changes approved (0-1). */
  approvalRate: number;
  /** Mean time-to-recovery (minutes from change to rollback) per type, null when none. */
  mttrByChangeType: Record<ChangeType, number | null>;
}

/** Injected source adapter that yields normalized change records. */
export interface ChangeCollector {
  /** Source this collector reads from. */
  source: ChangeSource;
  /** Fetches normalized changes (no live HTTP in tested paths). */
  collect(): Promise<ChangeInput[]>;
}

/** Options for {@link SentinelChangeManagement.open}. */
export interface ChangeManagementOptions {
  /** Injectable clock, defaults to the system clock. */
  now?: () => Date;
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** SQLite-backed production change log with correlation, approval gate, and metrics. */
export class SentinelChangeManagement {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly now: () => Date
  ) {}

  /**
   * Opens or creates a change-management store.
   * @param filePath SQLite database location.
   * @param options Injectable clock.
   * @returns Initialized change-management store.
   */
  static async open(
    filePath: string,
    options: ChangeManagementOptions = {}
  ): Promise<SentinelChangeManagement> {
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS sentinel_changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        change_type TEXT NOT NULL, source TEXT NOT NULL, service TEXT NOT NULL,
        timestamp TEXT NOT NULL, details TEXT NOT NULL, author TEXT NOT NULL,
        reference TEXT, rollback_url TEXT, approval_status TEXT NOT NULL,
        approved_by TEXT, approved_at TEXT, rolled_back INTEGER NOT NULL, rolled_back_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_change_timestamp ON sentinel_changes(timestamp);
      CREATE INDEX IF NOT EXISTS idx_change_service ON sentinel_changes(service, timestamp);
      CREATE TABLE IF NOT EXISTS sentinel_change_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, change_id TEXT NOT NULL,
        action TEXT NOT NULL, actor TEXT NOT NULL, timestamp TEXT NOT NULL, detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_change ON sentinel_change_audit(change_id);
    `);
    const store = new SentinelChangeManagement(
      path.resolve(filePath),
      database,
      options.now ?? ((): Date => new Date())
    );
    await store.persist();
    return store;
  }

  /**
   * Records one change in the change log and writes a `created` audit entry.
   * @param input Normalized change to record.
   * @returns Stored change record.
   * @throws Error when the input is invalid.
   */
  async recordChange(input: ChangeInput): Promise<ChangeRecord> {
    validateChangeInput(input);
    const record: ChangeRecord = {
      ...input,
      approvalStatus: input.autoApproved ? 'approved' : 'pending',
      ...(input.autoApproved
        ? { approvedBy: input.author, approvedAt: normalizeTimestamp(input.timestamp) }
        : {}),
      rolledBack: false
    };
    const inserted = this.store(record);
    if (inserted) {
      this.appendAudit(record.id, 'created', record.author, record.details);
      if (input.autoApproved) this.appendAudit(record.id, 'approved', record.author, 'auto-approved');
    }
    await this.persist();
    return this.requireChange(record.id);
  }

  /**
   * Collects and records all changes from an injected source adapter.
   * @param collector Source adapter (GitHub, Datadog, AWS).
   * @returns Number of newly stored changes.
   * @throws Error when a record's source does not match the collector.
   */
  async collect(collector: ChangeCollector): Promise<number> {
    if (!CHANGE_SOURCES.includes(collector.source)) {
      throw new Error(`Unsupported change source: ${String(collector.source)}`);
    }
    let inputs: ChangeInput[];
    try {
      inputs = await collector.collect();
    } catch (error) {
      log.error('Change collector failed', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
    let inserted = 0;
    for (const input of inputs) {
      if (input.source !== collector.source) {
        throw new Error(`Collector source mismatch for change ${input.id}`);
      }
      validateChangeInput(input);
      const record: ChangeRecord = {
        ...input,
        approvalStatus: input.autoApproved ? 'approved' : 'pending',
        ...(input.autoApproved
          ? { approvedBy: input.author, approvedAt: normalizeTimestamp(input.timestamp) }
          : {}),
        rolledBack: false
      };
      if (this.store(record)) {
        this.appendAudit(record.id, 'created', record.author, record.details);
        if (input.autoApproved) this.appendAudit(record.id, 'approved', record.author, 'auto-approved');
        inserted += 1;
      }
    }
    await this.persist();
    log.info('Collected production changes', { source: collector.source, inserted });
    return inserted;
  }

  /**
   * Approves a pending change (deployment gate) and audits the decision.
   * @param changeId Change to approve.
   * @param approver Approver login.
   * @returns Updated change record.
   * @throws Error when the change is missing or not pending.
   */
  async approveChange(changeId: string, approver: string): Promise<ChangeRecord> {
    requireText(approver, 'approver');
    const change = this.requireChange(changeId);
    if (change.approvalStatus !== 'pending') {
      throw new Error(`Change ${changeId} is already ${change.approvalStatus}`);
    }
    const at = this.nowIso();
    this.database.run(
      'UPDATE sentinel_changes SET approval_status = ?, approved_by = ?, approved_at = ? WHERE id = ?',
      ['approved', approver, at, changeId]
    );
    this.appendAudit(changeId, 'approved', approver);
    await this.persist();
    return this.requireChange(changeId);
  }

  /**
   * Rejects a pending change and audits the decision.
   * @param changeId Change to reject.
   * @param approver Rejector login.
   * @param reason Optional rejection reason.
   * @returns Updated change record.
   * @throws Error when the change is missing or not pending.
   */
  async rejectChange(changeId: string, approver: string, reason?: string): Promise<ChangeRecord> {
    requireText(approver, 'approver');
    const change = this.requireChange(changeId);
    if (change.approvalStatus !== 'pending') {
      throw new Error(`Change ${changeId} is already ${change.approvalStatus}`);
    }
    this.database.run(
      'UPDATE sentinel_changes SET approval_status = ? WHERE id = ?',
      ['rejected', changeId]
    );
    this.appendAudit(changeId, 'rejected', approver, reason);
    await this.persist();
    return this.requireChange(changeId);
  }

  /**
   * Rolls back an approved change (revert requires prior approval) and audits it.
   * @param changeId Change to roll back.
   * @param actor Actor performing the rollback.
   * @returns Updated change record.
   * @throws Error when the change is missing, unapproved, or already rolled back.
   */
  async rollbackChange(changeId: string, actor: string): Promise<ChangeRecord> {
    requireText(actor, 'actor');
    const change = this.requireChange(changeId);
    if (change.approvalStatus !== 'approved') {
      throw new Error(`Change ${changeId} must be approved before rollback`);
    }
    if (change.rolledBack) throw new Error(`Change ${changeId} is already rolled back`);
    const at = this.nowIso();
    this.database.run(
      'UPDATE sentinel_changes SET rolled_back = 1, rolled_back_at = ? WHERE id = ?',
      [at, changeId]
    );
    this.appendAudit(changeId, 'rolled-back', actor);
    await this.persist();
    return this.requireChange(changeId);
  }

  /**
   * Correlates an incident with recent changes, flagging suspicious timing.
   * @param incident Incident to investigate.
   * @param options Lookback and suspicious-timing windows.
   * @returns Correlation with ranked changes and likely culprit.
   * @throws Error when the incident timestamp is invalid.
   */
  correlateIncident(incident: IncidentRef, options: CorrelationOptions = {}): IncidentCorrelation {
    return correlateChanges(this.listChanges(), incident, options);
  }

  /**
   * Aggregates change-management metrics across all recorded changes.
   * @returns Frequency, rollback, approval, and MTTR-by-type metrics.
   */
  metrics(): ChangeMetrics {
    return computeChangeMetrics(this.listChanges());
  }

  /**
   * Lists recorded changes in append order.
   * @returns All stored change records.
   */
  listChanges(): ChangeRecord[] {
    const result = this.database.exec(`
      SELECT id, change_type, source, service, timestamp, details, author,
             reference, rollback_url, approval_status, approved_by, approved_at,
             rolled_back, rolled_back_at
      FROM sentinel_changes ORDER BY sequence
    `);
    return result[0]?.values.map(rowToChange) ?? [];
  }

  /**
   * Returns the append-only audit log, optionally filtered to one change.
   * @param changeId When provided, only entries for this change.
   * @returns Audit entries in append order.
   */
  auditLog(changeId?: string): ChangeAuditEntry[] {
    const where = changeId ? ' WHERE change_id = ?' : '';
    const params = changeId ? [changeId] : [];
    const result = this.database.exec(
      `SELECT change_id, action, actor, timestamp, detail
       FROM sentinel_change_audit${where} ORDER BY sequence`,
      params
    );
    return result[0]?.values.map(row => ({
      changeId: row[0] as string,
      action: row[1] as AuditAction,
      actor: row[2] as string,
      timestamp: row[3] as string,
      ...(row[4] === null ? {} : { detail: row[4] as string })
    })) ?? [];
  }

  private requireChange(changeId: string): ChangeRecord {
    const result = this.database.exec(`
      SELECT id, change_type, source, service, timestamp, details, author,
             reference, rollback_url, approval_status, approved_by, approved_at,
             rolled_back, rolled_back_at
      FROM sentinel_changes WHERE id = ?
    `, [changeId]);
    const row = result[0]?.values[0];
    if (!row) throw new Error(`Change ${changeId} not found`);
    return rowToChange(row);
  }

  private store(record: ChangeRecord): boolean {
    this.database.run(
      `INSERT OR IGNORE INTO sentinel_changes
       (id, change_type, source, service, timestamp, details, author, reference,
        rollback_url, approval_status, approved_by, approved_at, rolled_back, rolled_back_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id, record.changeType, record.source, record.service,
        normalizeTimestamp(record.timestamp), record.details, record.author,
        record.reference ?? null, record.rollbackUrl ?? null, record.approvalStatus,
        record.approvedBy ?? null, record.approvedAt ?? null,
        record.rolledBack ? 1 : 0, record.rolledBackAt ?? null
      ]
    );
    return this.database.getRowsModified() === 1;
  }

  private appendAudit(changeId: string, action: AuditAction, actor: string, detail?: string): void {
    this.database.run(
      'INSERT INTO sentinel_change_audit (change_id, action, actor, timestamp, detail) VALUES (?, ?, ?, ?, ?)',
      [changeId, action, actor, this.nowIso(), detail ?? null]
    );
  }

  private nowIso(): string {
    const timestamp = this.now().getTime();
    if (!Number.isFinite(timestamp)) throw new Error('Current time must be valid');
    return new Date(timestamp).toISOString();
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }
}

/**
 * Computes how many minutes a change preceded an incident.
 * @param change Change to measure.
 * @param incident Incident to measure against.
 * @returns Positive minutes when the change is before the incident, negative when after.
 */
export function changeProximityMinutes(change: ChangeRecord, incident: IncidentRef): number {
  const changeTime = parseTime(change.timestamp, 'change timestamp');
  const incidentTime = parseTime(incident.timestamp, 'incident timestamp');
  return round((incidentTime - changeTime) / 60000);
}

/**
 * Determines whether a change is suspiciously timed relative to an incident.
 * A change is suspicious when it occurred at or before the incident and within
 * the window (inclusive of the window edge).
 * @param change Change under evaluation.
 * @param incident Incident to compare against.
 * @param windowMinutes Suspicious-timing window in minutes (must be >= 0).
 * @returns True when the change is a suspicious cause candidate.
 * @throws Error when the window is negative or non-finite.
 */
export function isSuspiciousTiming(
  change: ChangeRecord,
  incident: IncidentRef,
  windowMinutes: number
): boolean {
  if (!Number.isFinite(windowMinutes) || windowMinutes < 0) {
    throw new Error('windowMinutes must be non-negative');
  }
  const minutesBefore = changeProximityMinutes(change, incident);
  return minutesBefore >= 0 && minutesBefore <= windowMinutes;
}

/**
 * Correlates an incident with a set of changes, ranking by proximity.
 * @param changes Candidate changes.
 * @param incident Incident to investigate.
 * @param options Lookback and suspicious-timing windows.
 * @returns Correlation with ranked changes and likely culprit.
 * @throws Error when the incident timestamp or window options are invalid.
 */
export function correlateChanges(
  changes: ChangeRecord[],
  incident: IncidentRef,
  options: CorrelationOptions = {}
): IncidentCorrelation {
  const lookbackMinutes = options.lookbackMinutes ?? 1440;
  const suspiciousWindowMinutes = options.suspiciousWindowMinutes ?? 15;
  if (!Number.isFinite(lookbackMinutes) || lookbackMinutes <= 0) {
    throw new Error('lookbackMinutes must be positive');
  }
  if (!Number.isFinite(suspiciousWindowMinutes) || suspiciousWindowMinutes < 0) {
    throw new Error('suspiciousWindowMinutes must be non-negative');
  }
  parseTime(incident.timestamp, 'incident timestamp');

  const correlatedChanges: CorrelatedChange[] = changes
    .map(change => {
      const minutesBeforeIncident = changeProximityMinutes(change, incident);
      const sameService = incident.service !== undefined && incident.service === change.service;
      const suspicious = minutesBeforeIncident >= 0 && minutesBeforeIncident <= suspiciousWindowMinutes;
      return {
        change,
        minutesBeforeIncident,
        sameService,
        suspicious,
        ...(change.rollbackUrl ? { rollbackUrl: change.rollbackUrl } : {})
      };
    })
    .filter(entry => entry.minutesBeforeIncident >= 0 && entry.minutesBeforeIncident <= lookbackMinutes)
    .sort((left, right) => left.minutesBeforeIncident - right.minutesBeforeIncident);

  const culprit = [...correlatedChanges]
    .filter(entry => entry.suspicious)
    .sort((left, right) =>
      Number(right.sameService) - Number(left.sameService) ||
      left.minutesBeforeIncident - right.minutesBeforeIncident
    )[0];

  return {
    incident,
    suspiciousWindowMinutes,
    lookbackMinutes,
    correlatedChanges,
    ...(culprit ? { likelyCulprit: culprit } : {})
  };
}

/**
 * Aggregates change-management metrics across a set of changes.
 * @param changes Changes to aggregate.
 * @returns Frequency, rollback, approval, and MTTR-by-type metrics.
 */
export function computeChangeMetrics(changes: ChangeRecord[]): ChangeMetrics {
  const changesByType: Record<ChangeType, number> = { deployment: 0, config: 0, permission: 0 };
  const recoveryByType: Record<ChangeType, number[]> = { deployment: [], config: [], permission: [] };
  let rollbackCount = 0;
  let approvedCount = 0;
  const times: number[] = [];

  for (const change of changes) {
    changesByType[change.changeType] += 1;
    times.push(parseTime(change.timestamp, 'change timestamp'));
    if (change.approvalStatus === 'approved') approvedCount += 1;
    if (change.rolledBack && change.rolledBackAt) {
      rollbackCount += 1;
      const recovery = (parseTime(change.rolledBackAt, 'rolledBackAt') -
        parseTime(change.timestamp, 'change timestamp')) / 60000;
      if (recovery >= 0) recoveryByType[change.changeType].push(recovery);
    }
  }

  const total = changes.length;
  const spanDays = times.length > 1
    ? Math.max(1, (Math.max(...times) - Math.min(...times)) / 86400000)
    : 1;

  const mttrByChangeType: Record<ChangeType, number | null> = {
    deployment: mean(recoveryByType.deployment),
    config: mean(recoveryByType.config),
    permission: mean(recoveryByType.permission)
  };

  return {
    totalChanges: total,
    changesByType,
    changeFrequencyPerDay: total === 0 ? 0 : round(total / spanDays),
    rollbackCount,
    rollbackRate: total === 0 ? 0 : round(rollbackCount / total),
    approvalRate: total === 0 ? 0 : round(approvedCount / total),
    mttrByChangeType
  };
}

/**
 * Maps a GitHub deployment into a normalized change input.
 * @param deployment GitHub deployment payload.
 * @param repo Repository slug (`owner/name`) for the rollback link.
 * @returns Normalized deployment change input.
 */
export function deploymentToChange(deployment: GitHubDeployment, repo: string): ChangeInput {
  requireText(repo, 'repo');
  return {
    id: `github-deploy-${deployment.id}`,
    changeType: 'deployment',
    source: 'github',
    service: deployment.environment,
    timestamp: deployment.created_at,
    details: `Deployment #${deployment.id} to ${deployment.environment} (${deployment.state})`,
    author: deployment.creator?.login ?? 'unknown',
    reference: String(deployment.id),
    rollbackUrl: `https://github.com/${repo}/deployments/${deployment.environment}`
  };
}

/** A configuration/permission change event as delivered by Datadog. */
export interface DatadogConfigEvent {
  /** Datadog event id. */
  id: string;
  /** Event title. */
  title: string;
  /** Event body text. */
  text: string;
  /** Unix epoch seconds the event happened. */
  date_happened: number;
  /** Datadog tags, e.g. `service:checkout`. */
  tags: string[];
}

/**
 * Maps a Datadog config event into a normalized change input.
 * @param event Datadog config/permission event.
 * @returns Normalized config change input.
 * @throws Error when the event timestamp is invalid.
 */
export function configEventToChange(event: DatadogConfigEvent): ChangeInput {
  if (!Number.isFinite(event.date_happened) || event.date_happened < 0) {
    throw new Error('date_happened must be a non-negative epoch');
  }
  const isPermission = event.tags.some(tag => /(^|:)(iam|permission|policy|role)/i.test(tag));
  const serviceTag = event.tags.find(tag => tag.startsWith('service:'));
  return {
    id: `datadog-${event.id}`,
    changeType: isPermission ? 'permission' : 'config',
    source: 'datadog',
    service: serviceTag ? serviceTag.slice('service:'.length) : 'unknown',
    timestamp: new Date(event.date_happened * 1000).toISOString(),
    details: `${event.title}: ${event.text}`.trim(),
    author: 'datadog'
  };
}

/**
 * Builds an incident reference from a Sentinel evidence record.
 * @param evidence Sentinel incident evidence.
 * @returns Incident reference for correlation.
 */
export function incidentFromEvidence(evidence: SentinelEvidence): IncidentRef {
  return {
    id: evidence.id,
    timestamp: evidence.timestamp,
    message: evidence.error,
    service: evidence.source
  };
}

function rowToChange(row: (string | number | Uint8Array | null)[]): ChangeRecord {
  return {
    id: row[0] as string,
    changeType: row[1] as ChangeType,
    source: row[2] as ChangeSource,
    service: row[3] as string,
    timestamp: row[4] as string,
    details: row[5] as string,
    author: row[6] as string,
    ...(row[7] === null ? {} : { reference: row[7] as string }),
    ...(row[8] === null ? {} : { rollbackUrl: row[8] as string }),
    approvalStatus: row[9] as ApprovalStatus,
    ...(row[10] === null ? {} : { approvedBy: row[10] as string }),
    ...(row[11] === null ? {} : { approvedAt: row[11] as string }),
    rolledBack: row[12] === 1,
    ...(row[13] === null ? {} : { rolledBackAt: row[13] as string })
  };
}

function validateChangeInput(input: ChangeInput): void {
  requireText(input.id, 'id');
  requireText(input.service, 'service');
  requireText(input.details, 'details');
  requireText(input.author, 'author');
  if (!CHANGE_TYPES.includes(input.changeType)) {
    throw new Error(`Invalid changeType: ${String(input.changeType)}`);
  }
  if (!CHANGE_SOURCES.includes(input.source)) {
    throw new Error(`Invalid source: ${String(input.source)}`);
  }
  parseTime(input.timestamp, 'timestamp');
}

function normalizeTimestamp(timestamp: string): string {
  return new Date(parseTime(timestamp, 'timestamp')).toISOString();
}

function parseTime(value: string, name: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid ISO 8601 date`);
  return timestamp;
}

function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((total, value) => total + value, 0) / values.length);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
