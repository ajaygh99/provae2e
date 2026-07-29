/** OWASP ZAP finding baselines, filtering rules, whitelist feedback, and accuracy metrics. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export type ZapRisk = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FilterAction = 'ignore' | 'flag';

export interface ZapFinding {
  alertId: string;
  name: string;
  cwe?: string;
  url: string;
  risk: ZapRisk;
  parameter?: string;
  evidence?: string;
}

export interface ZapFilterRule {
  alertId?: string;
  cwe?: string;
  urlPattern?: string;
  risk?: ZapRisk;
  action: FilterAction;
  reason?: string;
}

export interface FindingWhitelist {
  findingKey: string;
  reason: string;
  approver: string;
  reviewedAt: string;
}

export type FindingDisposition = 'visible' | 'rule-ignored' | 'whitelisted';

export interface FilteredZapFinding {
  finding: ZapFinding;
  findingKey: string;
  isNew: boolean;
  disposition: FindingDisposition;
  reason?: string;
}

export interface ZapScanResult {
  scanId: string;
  target: string;
  scannedAt: string;
  baselineEstablished: boolean;
  visible: FilteredZapFinding[];
  filtered: FilteredZapFinding[];
  newFindings: FilteredZapFinding[];
}

export interface ZapAccuracyPoint {
  recordedAt: string;
  truePositives: number;
  falsePositives: number;
  truePositiveRate: number;
  falsePositiveRate: number;
}

interface RawRule {
  alert_id?: unknown;
  alertId?: unknown;
  cwe?: unknown;
  url_pattern?: unknown;
  urlPattern?: unknown;
  risk?: unknown;
  action?: unknown;
  reason?: unknown;
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;

/**
 * Parses and validates YAML false-positive filter rules.
 * @param source YAML containing an array or a `rules` array.
 * @returns Normalized filter rules.
 */
export function parseZapFilterRules(source: string): ZapFilterRule[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new Error(`Invalid ZAP filter YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.rules)
      ? parsed.rules
      : undefined;
  if (!list) throw new Error('ZAP filter YAML must contain a rules array');
  return list.map((value, index) => normalizeRule(value, index));
}

/**
 * Builds a stable identity for a finding across scans.
 * @param finding ZAP alert.
 * @returns Stable finding key.
 */
export function zapFindingKey(finding: ZapFinding): string {
  validateFinding(finding);
  return [finding.alertId, finding.cwe ?? '', normalizeUrl(finding.url), finding.parameter ?? '']
    .map(value => encodeURIComponent(value.trim().toLowerCase()))
    .join('|');
}

/** Persistent false-positive filter and team-feedback engine. */
export class ZapFalsePositiveFilter {
  private constructor(
    private readonly filePath: string,
    private database: Database,
    private readonly SQL: SqlJsStatic,
    private readonly now: () => Date
  ) {}

  /**
   * Opens or creates a filtering database.
   * @param filePath SQLite database path.
   * @param now Optional clock for deterministic integrations.
   * @returns Initialized filter engine.
   */
  static async open(filePath: string, now: () => Date = (): Date => new Date()): Promise<ZapFalsePositiveFilter> {
    sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
    const SQL = await sqlitePromise;
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    let database: Database;
    try {
      database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    } catch (error) {
      throw new Error(`Cannot open ZAP database "${path.resolve(filePath)}": ${errorMessage(error)}`);
    }
    if (bytes) validateDatabase(database, path.resolve(filePath));
    database.run(`
      CREATE TABLE IF NOT EXISTS zap_baseline_findings (
        target TEXT NOT NULL, finding_key TEXT NOT NULL, finding_json TEXT NOT NULL,
        established_at TEXT NOT NULL, PRIMARY KEY(target, finding_key)
      );
      CREATE TABLE IF NOT EXISTS zap_whitelist (
        finding_key TEXT PRIMARY KEY, reason TEXT NOT NULL, approver TEXT NOT NULL, reviewed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS zap_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, finding_key TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('true-positive','false-positive')),
        recorded_at TEXT NOT NULL, reviewer TEXT NOT NULL, reason TEXT
      );
      CREATE TABLE IF NOT EXISTS zap_scans (
        scan_id TEXT PRIMARY KEY, target TEXT NOT NULL, scanned_at TEXT NOT NULL,
        visible_count INTEGER NOT NULL, filtered_count INTEGER NOT NULL, new_count INTEGER NOT NULL
      );
    `);
    const engine = new ZapFalsePositiveFilter(path.resolve(filePath), database, SQL, now);
    await engine.persist();
    return engine;
  }

  /**
   * Compares a scan with its first-scan baseline and applies rules and whitelist entries.
   * @param target Scan target identifier.
   * @param findings Current ZAP findings.
   * @param rules Custom ignore or force-flag rules.
   * @returns Visible, filtered, and newly introduced findings.
   */
  async processScan(target: string, findings: ZapFinding[], rules: ZapFilterRule[] = []): Promise<ZapScanResult> {
    required(target, 'target');
    findings.forEach(validateFinding);
    rules.forEach((rule, index) => validateRule(rule, index));
    return this.mutate(async () => {
      const scannedAt = validNow(this.now);
      const baselineKeys = this.baselineKeys(target);
      const hasPriorScan = (this.database.exec(
        'SELECT 1 FROM zap_scans WHERE target=? LIMIT 1',
        [target]
      )[0]?.values.length ?? 0) > 0;
      const baselineEstablished = !hasPriorScan;
      if (baselineEstablished) {
        findings.forEach(finding => this.database.run(
          'INSERT INTO zap_baseline_findings VALUES (?, ?, ?, ?)',
          [target, zapFindingKey(finding), JSON.stringify(finding), scannedAt]
        ));
      }
      const classified = findings.map(finding => this.classify(finding, baselineKeys, hasPriorScan));
      const withRules = classified.map(item => applyRules(item, rules));
      const visible = withRules.filter(item => item.disposition === 'visible');
      const filtered = withRules.filter(item => item.disposition !== 'visible');
      const result: ZapScanResult = {
        scanId: `${slug(target)}-${Date.parse(scannedAt)}`,
        target,
        scannedAt,
        baselineEstablished,
        visible,
        filtered,
        newFindings: visible.filter(item => item.isNew)
      };
      this.database.run(
        'INSERT OR REPLACE INTO zap_scans VALUES (?, ?, ?, ?, ?, ?)',
        [result.scanId, target, scannedAt, visible.length, filtered.length, result.newFindings.length]
      );
      return result;
    });
  }

  /**
   * Marks one exact finding reviewed and safe for future scans.
   * @param finding Finding to whitelist.
   * @param reason Review rationale.
   * @param approver Reviewing team member.
   * @returns Persisted whitelist record.
   */
  async whitelist(finding: ZapFinding, reason: string, approver: string): Promise<FindingWhitelist> {
    const findingKey = zapFindingKey(finding);
    required(reason, 'reason');
    required(approver, 'approver');
    const reviewedAt = validNow(this.now);
    return this.mutate(async () => {
      this.database.run(
        `INSERT INTO zap_whitelist VALUES (?, ?, ?, ?)
         ON CONFLICT(finding_key) DO UPDATE SET reason=excluded.reason, approver=excluded.approver, reviewed_at=excluded.reviewed_at`,
        [findingKey, reason.trim(), approver.trim(), reviewedAt]
      );
      await this.recordFeedback(finding, 'false-positive', approver, reason);
      return { findingKey, reason: reason.trim(), approver: approver.trim(), reviewedAt };
    });
  }

  /**
   * Records team classification feedback. "Not an issue" becomes a whitelist entry.
   * @param finding Reviewed finding.
   * @param outcome Team verdict.
   * @param reviewer Reviewer identity.
   * @param reason Optional explanation.
   */
  async feedback(
    finding: ZapFinding,
    outcome: 'true-positive' | 'false-positive' | 'not-an-issue',
    reviewer: string,
    reason?: string
  ): Promise<void> {
    required(reviewer, 'reviewer');
    if (outcome === 'not-an-issue') {
      await this.whitelist(finding, required(reason ?? '', 'reason'), reviewer);
      return;
    }
    await this.mutate(async () => {
      await this.recordFeedback(finding, outcome, reviewer, reason);
    });
  }

  /**
   * Returns cumulative true/false positive rates at each feedback event.
   * @returns Chronological accuracy history.
   */
  accuracyHistory(): ZapAccuracyPoint[] {
    const result = this.database.exec(
      'SELECT outcome, recorded_at FROM zap_feedback ORDER BY recorded_at ASC, id ASC'
    );
    let truePositives = 0;
    let falsePositives = 0;
    return (result[0]?.values ?? []).map(row => {
      if (row[0] === 'true-positive') truePositives++;
      else falsePositives++;
      const total = truePositives + falsePositives;
      return {
        recordedAt: row[1] as string,
        truePositives,
        falsePositives,
        truePositiveRate: round(truePositives / total * 100),
        falsePositiveRate: round(falsePositives / total * 100)
      };
    });
  }

  private classify(finding: ZapFinding, baselineKeys: Set<string>, hasPriorScan: boolean): FilteredZapFinding {
    const findingKey = zapFindingKey(finding);
    const whitelist = this.database.exec(
      'SELECT reason, approver FROM zap_whitelist WHERE finding_key=?',
      [findingKey]
    )[0]?.values[0];
    return {
      finding,
      findingKey,
      isNew: hasPriorScan && !baselineKeys.has(findingKey),
      disposition: whitelist ? 'whitelisted' : 'visible',
      ...(whitelist ? { reason: `${whitelist[0] as string} (approved by ${whitelist[1] as string})` } : {})
    };
  }

  private baselineKeys(target: string): Set<string> {
    const result = this.database.exec(
      'SELECT finding_key FROM zap_baseline_findings WHERE target=?',
      [target]
    );
    return new Set((result[0]?.values ?? []).map(row => row[0] as string));
  }

  private async recordFeedback(
    finding: ZapFinding,
    outcome: 'true-positive' | 'false-positive',
    reviewer: string,
    reason: string | undefined
  ): Promise<void> {
    const recordedAt = validNow(this.now);
    this.database.run(
      'INSERT INTO zap_feedback (finding_key, outcome, recorded_at, reviewer, reason) VALUES (?, ?, ?, ?, ?)',
      [zapFindingKey(finding), outcome, recordedAt, reviewer.trim(), reason?.trim() || null]
    );
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, Buffer.from(this.database.export()), { flag: 'wx' });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new Error(`Cannot atomically persist ZAP database "${this.filePath}": ${errorMessage(error)}`);
    }
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const snapshot = this.database.export();
    try {
      const result = await operation();
      await this.persist();
      return result;
    } catch (error) {
      this.database.close();
      this.database = new this.SQL.Database(snapshot);
      throw error;
    }
  }
}

const REQUIRED_SCHEMA: Record<string, string[]> = {
  zap_baseline_findings: ['target', 'finding_key', 'finding_json', 'established_at'],
  zap_whitelist: ['finding_key', 'reason', 'approver', 'reviewed_at'],
  zap_feedback: ['id', 'finding_key', 'outcome', 'recorded_at', 'reviewer', 'reason'],
  zap_scans: ['scan_id', 'target', 'scanned_at', 'visible_count', 'filtered_count', 'new_count']
};

function validateDatabase(database: Database, filePath: string): void {
  let integrity: unknown;
  try {
    integrity = database.exec('PRAGMA integrity_check')[0]?.values[0]?.[0];
  } catch (error) {
    throw new Error(`ZAP database "${filePath}" failed SQLite integrity validation: ${errorMessage(error)}`);
  }
  if (integrity !== 'ok') {
    throw new Error(`ZAP database "${filePath}" failed SQLite integrity validation: ${String(integrity ?? 'unknown')}`);
  }
  for (const [table, expectedColumns] of Object.entries(REQUIRED_SCHEMA)) {
    const rows = database.exec(`PRAGMA table_info(${table})`)[0]?.values ?? [];
    const columns = new Set(rows.map(row => row[1] as string));
    const missing = expectedColumns.filter(column => !columns.has(column));
    if (missing.length > 0) {
      throw new Error(`ZAP database "${filePath}" has an incompatible schema: ${table} is missing ${missing.join(', ')}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function applyRules(item: FilteredZapFinding, rules: ZapFilterRule[]): FilteredZapFinding {
  const matches = rules.filter(rule => ruleMatches(rule, item.finding));
  const forcedFlag = matches.find(rule => rule.action === 'flag');
  if (forcedFlag) return { ...item, disposition: 'visible', reason: forcedFlag.reason };
  if (item.disposition === 'whitelisted') return item;
  const ignored = matches.find(rule => rule.action === 'ignore');
  return ignored
    ? { ...item, disposition: 'rule-ignored', reason: ignored.reason ?? 'Matched custom ignore rule' }
    : item;
}

function ruleMatches(rule: ZapFilterRule, finding: ZapFinding): boolean {
  return (!rule.alertId || rule.alertId === finding.alertId)
    && (!rule.cwe || rule.cwe === finding.cwe)
    && (!rule.risk || rule.risk === finding.risk)
    && (!rule.urlPattern || wildcardMatch(rule.urlPattern, finding.url));
}

function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function normalizeRule(value: unknown, index: number): ZapFilterRule {
  if (!isRecord(value)) throw new Error(`Rule ${index + 1} must be an object`);
  const raw = value as RawRule;
  const rule: ZapFilterRule = {
    action: raw.action as FilterAction,
    ...(stringValue(raw.alert_id ?? raw.alertId) ? { alertId: stringValue(raw.alert_id ?? raw.alertId) } : {}),
    ...(stringValue(raw.cwe) ? { cwe: stringValue(raw.cwe) } : {}),
    ...(stringValue(raw.url_pattern ?? raw.urlPattern) ? { urlPattern: stringValue(raw.url_pattern ?? raw.urlPattern) } : {}),
    ...(stringValue(raw.risk) ? { risk: stringValue(raw.risk)?.toUpperCase() as ZapRisk } : {}),
    ...(stringValue(raw.reason) ? { reason: stringValue(raw.reason) } : {})
  };
  validateRule(rule, index);
  return rule;
}

function validateRule(rule: ZapFilterRule, index: number): void {
  if (!['ignore', 'flag'].includes(rule.action)) throw new Error(`Rule ${index + 1} action must be ignore or flag`);
  if (!rule.alertId && !rule.cwe && !rule.urlPattern && !rule.risk) {
    throw new Error(`Rule ${index + 1} must define at least one matcher`);
  }
  if (rule.risk && !isRisk(rule.risk)) throw new Error(`Rule ${index + 1} risk is invalid`);
  if (rule.urlPattern) {
    try {
      wildcardMatch(rule.urlPattern, '');
    } catch {
      throw new Error(`Rule ${index + 1} URL pattern is invalid`);
    }
  }
}

function validateFinding(finding: ZapFinding): void {
  required(finding.alertId, 'finding.alertId');
  required(finding.name, 'finding.name');
  required(finding.url, 'finding.url');
  if (!isRisk(finding.risk)) throw new Error('finding.risk is invalid');
  try {
    new URL(finding.url);
  } catch {
    throw new Error('finding.url must be an absolute URL');
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.searchParams.sort();
  return url.toString();
}

function isRisk(value: string): value is ZapRisk {
  return ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function validNow(now: () => Date): string {
  const value = now();
  if (!Number.isFinite(value.getTime())) throw new Error('Current time must be valid');
  return value.toISOString();
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scan';
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
