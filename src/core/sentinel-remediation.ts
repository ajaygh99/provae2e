/** Guarded Sentinel automated remediation with immutable audit evidence. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export type RemediationActionType =
  | 'scale'
  | 'rollback'
  | 'circuit-breaker'
  | 'failover'
  | 'restart';
export type TriggerOperator = '>' | '>=' | '<' | '<=';

export interface RemediationAction {
  type: RemediationActionType;
  target: string;
  value?: number | string;
  endpoint?: string;
  risky?: boolean;
}

export interface RemediationRule {
  id: string;
  trigger: {
    metric: string;
    operator: TriggerOperator;
    threshold: number;
    forSeconds: number;
  };
  actions: RemediationAction[];
  timeoutSeconds: number;
  escalation: string;
}

export interface RemediationObservation {
  metric: string;
  value: number;
  sustainedSeconds: number;
  slaBudgetAvailable: boolean;
  lastKnownGoodDeployment?: string;
}

export interface ActionExecutionResult {
  success: boolean;
  message: string;
}

export interface RemediationExecutor {
  execute(action: RemediationAction): Promise<ActionExecutionResult>;
  pageOnCall(target: string, reason: string): Promise<ActionExecutionResult>;
}

export interface RemediationAuditEntry {
  sequence: number;
  runId: string;
  ruleId: string;
  timestamp: string;
  actor: 'sentinel';
  action: string;
  target: string;
  reasoning: string;
  result: 'previewed' | 'succeeded' | 'failed' | 'blocked' | 'escalated';
  detail: string;
}

export interface RemediationRun {
  runId: string;
  ruleId: string;
  triggered: boolean;
  dryRun: boolean;
  status: 'not-triggered' | 'previewed' | 'completed' | 'failed' | 'blocked';
  startedAt: string;
  escalationDueAt?: string;
  actions: RemediationAuditEntry[];
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** Executes safe remediation rules and persists immutable action evidence. */
export class SentinelRemediationEngine {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly rules: RemediationRule[],
    private readonly executor: RemediationExecutor,
    private readonly dryRun: boolean,
    private readonly now: () => Date
  ) {}

  /**
   * Opens a remediation engine.
   * @param filePath SQLite audit database.
   * @param rules Validated remediation rules.
   * @param executor Infrastructure action adapter.
   * @param options Dry-run and clock options.
   * @returns Initialized remediation engine.
   */
  static async open(
    filePath: string,
    rules: RemediationRule[],
    executor: RemediationExecutor,
    options: { dryRun?: boolean; now?: () => Date } = {}
  ): Promise<SentinelRemediationEngine> {
    validateRules(rules);
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS sentinel_remediation_runs (
        run_id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, started_at TEXT NOT NULL,
        escalation_due_at TEXT, dry_run INTEGER NOT NULL, resolved INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sentinel_remediation_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
        rule_id TEXT NOT NULL, timestamp TEXT NOT NULL, actor TEXT NOT NULL,
        action TEXT NOT NULL, target TEXT NOT NULL, reasoning TEXT NOT NULL,
        result TEXT NOT NULL, detail TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_remediation_run ON sentinel_remediation_audit(run_id);
    `);
    const engine = new SentinelRemediationEngine(
      path.resolve(filePath),
      database,
      rules,
      executor,
      options.dryRun ?? false,
      options.now ?? (() : Date => new Date())
    );
    await engine.persist();
    return engine;
  }

  /**
   * Evaluates a rule against sustained telemetry and executes matching actions.
   * @param ruleId Remediation rule identifier.
   * @param observation Current metric and safety state.
   * @returns Remediation run summary.
   */
  async evaluate(ruleId: string, observation: RemediationObservation): Promise<RemediationRun> {
    const rule = this.rule(ruleId);
    validateObservation(observation);
    const started = this.currentTime();
    const startedAt = new Date(started).toISOString();
    const runId = `${rule.id}-${started}-${this.nextSequence()}`;
    const triggered = observation.metric === rule.trigger.metric
      && compare(observation.value, rule.trigger.operator, rule.trigger.threshold)
      && observation.sustainedSeconds >= rule.trigger.forSeconds;
    if (!triggered) {
      return { runId, ruleId, triggered: false, dryRun: this.dryRun, status: 'not-triggered', startedAt, actions: [] };
    }

    const escalationDueAt = new Date(started + rule.timeoutSeconds * 1000).toISOString();
    this.database.run(
      `INSERT INTO sentinel_remediation_runs
       (run_id, rule_id, started_at, escalation_due_at, dry_run) VALUES (?, ?, ?, ?, ?)`,
      [runId, rule.id, startedAt, escalationDueAt, this.dryRun ? 1 : 0]
    );
    const actions: RemediationAuditEntry[] = [];
    for (const configuredAction of rule.actions) {
      const action = resolveAction(configuredAction, observation);
      const reasoning = triggerReason(rule, observation);
      if (action.risky && !observation.slaBudgetAvailable) {
        actions.push(this.audit(runId, rule.id, action, reasoning, 'blocked', 'SLA error budget unavailable'));
        continue;
      }
      if (this.dryRun) {
        actions.push(this.audit(runId, rule.id, action, reasoning, 'previewed', 'Dry-run: action not executed'));
        continue;
      }
      const execution = await this.executor.execute(action);
      actions.push(this.audit(
        runId,
        rule.id,
        action,
        reasoning,
        execution.success ? 'succeeded' : 'failed',
        execution.message
      ));
    }
    await this.persist();
    return {
      runId,
      ruleId,
      triggered: true,
      dryRun: this.dryRun,
      status: runStatus(actions),
      startedAt,
      escalationDueAt,
      actions
    };
  }

  /**
   * Marks a remediation run resolved and prevents escalation.
   * @param runId Remediation run identifier.
   * @returns Whether an unresolved run was updated.
   */
  async markResolved(runId: string): Promise<boolean> {
    this.database.run(
      'UPDATE sentinel_remediation_runs SET resolved = 1 WHERE run_id = ? AND resolved = 0',
      [runId]
    );
    const updated = this.database.getRowsModified() === 1;
    if (updated) await this.persist();
    return updated;
  }

  /**
   * Pages on-call for unresolved runs whose remediation timeout elapsed.
   * @returns Newly created escalation audit entries.
   */
  async escalateOverdue(): Promise<RemediationAuditEntry[]> {
    const now = this.currentTime();
    const result = this.database.exec(
      `SELECT run_id, rule_id FROM sentinel_remediation_runs
       WHERE resolved = 0 AND dry_run = 0 AND escalation_due_at <= ?`,
      [new Date(now).toISOString()]
    );
    const entries: RemediationAuditEntry[] = [];
    for (const row of result[0]?.values ?? []) {
      const runId = row[0] as string;
      const ruleId = row[1] as string;
      const rule = this.rule(ruleId);
      const execution = await this.executor.pageOnCall(
        rule.escalation,
        `Automated remediation ${runId} did not resolve within ${rule.timeoutSeconds} seconds`
      );
      entries.push(this.audit(
        runId,
        ruleId,
        { type: 'restart', target: rule.escalation },
        'Remediation timeout elapsed',
        'escalated',
        execution.message
      ));
      this.database.run('UPDATE sentinel_remediation_runs SET resolved = 1 WHERE run_id = ?', [runId]);
    }
    if (entries.length > 0) await this.persist();
    return entries;
  }

  /**
   * Returns append-only audit entries in sequence order.
   * @param runId Optional run filter.
   * @returns Immutable action history.
   */
  auditLog(runId?: string): RemediationAuditEntry[] {
    const result = this.database.exec(
      `SELECT sequence, run_id, rule_id, timestamp, actor, action, target,
              reasoning, result, detail
       FROM sentinel_remediation_audit${runId ? ' WHERE run_id = ?' : ''}
       ORDER BY sequence`,
      runId ? [runId] : []
    );
    return result[0]?.values.map(row => ({
      sequence: Number(row[0]),
      runId: row[1] as string,
      ruleId: row[2] as string,
      timestamp: row[3] as string,
      actor: 'sentinel',
      action: row[5] as string,
      target: row[6] as string,
      reasoning: row[7] as string,
      result: row[8] as RemediationAuditEntry['result'],
      detail: row[9] as string
    })) ?? [];
  }

  private audit(
    runId: string,
    ruleId: string,
    action: RemediationAction,
    reasoning: string,
    result: RemediationAuditEntry['result'],
    detail: string
  ): RemediationAuditEntry {
    const timestamp = new Date(this.currentTime()).toISOString();
    this.database.run(
      `INSERT INTO sentinel_remediation_audit
       (run_id, rule_id, timestamp, actor, action, target, reasoning, result, detail)
       VALUES (?, ?, ?, 'sentinel', ?, ?, ?, ?, ?)`,
      [runId, ruleId, timestamp, action.type, action.target, reasoning, result, detail]
    );
    return this.auditLog(runId).at(-1) as RemediationAuditEntry;
  }

  private rule(ruleId: string): RemediationRule {
    const rule = this.rules.find(candidate => candidate.id === ruleId);
    if (!rule) throw new Error(`Unknown remediation rule: ${ruleId}`);
    return rule;
  }

  private currentTime(): number {
    const timestamp = this.now().getTime();
    if (!Number.isFinite(timestamp)) throw new Error('Current time must be valid');
    return timestamp;
  }

  private nextSequence(): number {
    const result = this.database.exec('SELECT COUNT(*) FROM sentinel_remediation_runs');
    return Number(result[0]?.values[0]?.[0] ?? 0) + 1;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }
}

/** Parses remediation rules from YAML configuration. */
export function parseRemediationRules(content: string): RemediationRule[] {
  let document: unknown;
  try {
    document = parseYaml(content);
  } catch {
    throw new Error('Invalid remediation YAML');
  }
  const rules = (document as { rules?: RemediationRule[] })?.rules;
  if (!Array.isArray(rules)) throw new Error('Remediation YAML requires rules[]');
  validateRules(rules);
  return rules;
}

function resolveAction(action: RemediationAction, observation: RemediationObservation): RemediationAction {
  if (action.type === 'rollback') {
    if (!observation.lastKnownGoodDeployment) {
      throw new Error('Rollback requires lastKnownGoodDeployment');
    }
    return { ...action, value: observation.lastKnownGoodDeployment };
  }
  return { ...action };
}

function triggerReason(rule: RemediationRule, observation: RemediationObservation): string {
  return `${observation.metric} ${rule.trigger.operator} ${rule.trigger.threshold} for ${observation.sustainedSeconds}s`;
}

function compare(value: number, operator: TriggerOperator, threshold: number): boolean {
  if (operator === '>') return value > threshold;
  if (operator === '>=') return value >= threshold;
  if (operator === '<') return value < threshold;
  return value <= threshold;
}

function runStatus(actions: RemediationAuditEntry[]): RemediationRun['status'] {
  if (actions.some(action => action.result === 'failed')) return 'failed';
  if (actions.length > 0 && actions.every(action => action.result === 'blocked')) return 'blocked';
  if (actions.some(action => action.result === 'previewed')) return 'previewed';
  return 'completed';
}

function validateRules(rules: RemediationRule[]): void {
  if (rules.length === 0) throw new Error('At least one remediation rule is required');
  const ids = new Set<string>();
  for (const rule of rules) {
    required(rule.id, 'rule.id');
    if (ids.has(rule.id)) throw new Error(`Duplicate remediation rule: ${rule.id}`);
    ids.add(rule.id);
    required(rule.trigger?.metric, 'trigger.metric');
    if (!['>', '>=', '<', '<='].includes(rule.trigger.operator)) throw new Error('Invalid trigger operator');
    finite(rule.trigger.threshold, 'trigger.threshold');
    positive(rule.trigger.forSeconds, 'trigger.forSeconds');
    positive(rule.timeoutSeconds, 'timeoutSeconds');
    required(rule.escalation, 'escalation');
    if (!Array.isArray(rule.actions) || rule.actions.length === 0) throw new Error('Rule requires actions[]');
    rule.actions.forEach(validateAction);
  }
}

function validateAction(action: RemediationAction): void {
  if (!['scale', 'rollback', 'circuit-breaker', 'failover', 'restart'].includes(action.type)) {
    throw new Error(`Invalid remediation action: ${String(action.type)}`);
  }
  required(action.target, 'action.target');
  if (action.endpoint !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(action.endpoint);
    } catch {
      throw new Error('action.endpoint must be a valid HTTP/HTTPS URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('action.endpoint must be a valid HTTP/HTTPS URL');
  }
}

function validateObservation(observation: RemediationObservation): void {
  required(observation.metric, 'metric');
  finite(observation.value, 'value');
  if (!Number.isFinite(observation.sustainedSeconds) || observation.sustainedSeconds < 0) {
    throw new Error('sustainedSeconds must be non-negative');
  }
}

function required(value: string | undefined, name: string): void {
  if (!value?.trim()) throw new Error(`${name} is required`);
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}
