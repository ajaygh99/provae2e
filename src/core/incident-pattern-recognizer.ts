/** Historical incident pattern recognition for Golden Thread failures. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type IncidentRootCause = 'TEST_GAP' | 'CODE_BUG' | 'SPEC_GAP' | 'DEPLOYMENT';

/** Historical incident used for pattern discovery. */
export interface HistoricalIncident {
  id: string;
  goldenThreadId: string;
  errorMessage: string;
  stackTrace?: string;
  rootCause: IncidentRootCause;
  occurredAt: string;
  resolvedAt?: string;
  fixCommit?: string;
}

/** Similar historical incident and actionable recommendation. */
export interface IncidentMatch extends HistoricalIncident {
  similarity: number;
  recommendation: string;
}

/** Aggregated failure pattern ranked by impact. */
export interface IncidentPattern {
  signature: string;
  frequency: number;
  rootCauses: Array<{ rootCause: IncidentRootCause; count: number }>;
  fixes: string[];
  recommendation: string;
  suggestedTests: string[];
  averageResolutionMs?: number;
  lastSeen: string;
  recommendationImplemented: boolean;
}

/** Incident frequency and time-to-resolution metrics. */
export interface IncidentPatternMetrics {
  totalIncidents: number;
  frequencyByRootCause: Record<IncidentRootCause, number>;
  averageResolutionMs?: number;
  resolutionTrend: Array<{ month: string; averageResolutionMs: number; resolved: number }>;
}

/** Quarterly-style dashboard report. */
export interface IncidentPatternReport {
  from: string;
  to: string;
  headline: string;
  topPatterns: IncidentPattern[];
  metrics: IncidentPatternMetrics;
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** SQLite-backed incident history, similarity matching, and prevention engine. */
export class IncidentPatternRecognizer {
  private constructor(private readonly filePath: string, private readonly database: Database) {}

  /**
   * Opens or creates an incident history store.
   * @param filePath SQLite database file.
   * @returns Initialized pattern recognizer.
   */
  static async open(filePath: string): Promise<IncidentPatternRecognizer> {
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS incident_history (
        id TEXT PRIMARY KEY,
        golden_thread_id TEXT NOT NULL,
        signature TEXT NOT NULL,
        error_message TEXT NOT NULL,
        stack_trace TEXT,
        root_cause TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        resolved_at TEXT,
        fix_commit TEXT,
        recommendation_implemented INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_incident_signature ON incident_history(signature);
      CREATE INDEX IF NOT EXISTS idx_incident_occurred ON incident_history(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_incident_root_cause ON incident_history(root_cause);
    `);
    const recognizer = new IncidentPatternRecognizer(path.resolve(filePath), database);
    await recognizer.persist();
    return recognizer;
  }

  /**
   * Stores an incident under its deterministic normalized signature.
   * @param incident Historical incident details.
   * @returns Stored incident signature.
   */
  async recordIncident(incident: HistoricalIncident): Promise<string> {
    validateIncident(incident);
    const signature = incidentSignature(incident.errorMessage, incident.stackTrace);
    this.database.run(
      `INSERT INTO incident_history
       (id, golden_thread_id, signature, error_message, stack_trace, root_cause,
        occurred_at, resolved_at, fix_commit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        incident.id, incident.goldenThreadId, signature, incident.errorMessage,
        incident.stackTrace ?? null, incident.rootCause, incident.occurredAt,
        incident.resolvedAt ?? null, incident.fixCommit ?? null
      ]
    );
    await this.persist();
    return signature;
  }

  /**
   * Finds semantically similar errors using deterministic token similarity.
   * @param errorMessage Current error message.
   * @param stackTrace Optional current stack trace.
   * @param threshold Minimum similarity from 0 through 1.
   * @returns Matches ranked by similarity and recency.
   */
  findSimilar(errorMessage: string, stackTrace?: string, threshold = 0.45): IncidentMatch[] {
    required(errorMessage, 'errorMessage');
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('threshold must be between 0 and 1');
    const query = `${errorMessage} ${stackTrace ?? ''}`;
    return this.allIncidents()
      .map(incident => ({ ...incident, similarity: textSimilarity(query, `${incident.errorMessage} ${incident.stackTrace ?? ''}`) }))
      .filter(incident => incident.similarity >= threshold)
      .sort((left, right) => right.similarity - left.similarity || Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .map(incident => ({
        ...incident,
        recommendation: historicalRecommendation(incident)
      }));
  }

  /**
   * Generates the top failure-pattern dashboard for a time range.
   * @param from Inclusive ISO start.
   * @param to Inclusive ISO end.
   * @param limit Maximum patterns to return.
   * @returns Ranked patterns and incident metrics.
   */
  report(from: string, to: string, limit = 5): IncidentPatternReport {
    const start = validDate(from, 'from');
    const end = validDate(to, 'to');
    if (start > end) throw new Error('from must be before or equal to to');
    if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit must be a positive integer');
    const incidents = this.allIncidents().filter(incident => {
      const timestamp = Date.parse(incident.occurredAt);
      return timestamp >= start && timestamp <= end;
    });
    const patterns = aggregatePatterns(incidents, this.implementedSignatures()).slice(0, limit);
    return {
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
      headline: `Top ${Math.min(limit, patterns.length)} failure patterns for selected period`,
      topPatterns: patterns,
      metrics: calculateMetrics(incidents)
    };
  }

  /**
   * Marks prevention guidance for a signature as implemented.
   * @param signature Pattern signature returned by record/report.
   * @returns Number of historical incidents updated.
   */
  async markRecommendationImplemented(signature: string): Promise<number> {
    required(signature, 'signature');
    this.database.run(
      'UPDATE incident_history SET recommendation_implemented = 1 WHERE signature = ?',
      [signature]
    );
    const changed = this.database.getRowsModified();
    await this.persist();
    return changed;
  }

  private allIncidents(): HistoricalIncident[] {
    const result = this.database.exec(`
      SELECT id, golden_thread_id, error_message, stack_trace, root_cause,
             occurred_at, resolved_at, fix_commit
      FROM incident_history
    `);
    return result[0]?.values.map(row => ({
      id: row[0] as string,
      goldenThreadId: row[1] as string,
      errorMessage: row[2] as string,
      ...(row[3] ? { stackTrace: row[3] as string } : {}),
      rootCause: row[4] as IncidentRootCause,
      occurredAt: row[5] as string,
      ...(row[6] ? { resolvedAt: row[6] as string } : {}),
      ...(row[7] ? { fixCommit: row[7] as string } : {})
    })) ?? [];
  }

  private implementedSignatures(): Set<string> {
    const result = this.database.exec(
      'SELECT DISTINCT signature FROM incident_history WHERE recommendation_implemented = 1'
    );
    return new Set(result[0]?.values.map(row => row[0] as string) ?? []);
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }
}

/** Produces a stable signature while removing volatile IDs and numbers. */
export function incidentSignature(errorMessage: string, stackTrace?: string): string {
  required(errorMessage, 'errorMessage');
  const combined = `${errorMessage} ${stackTrace?.split('\n')[0] ?? ''}`;
  return normalize(combined);
}

/** Deterministic Jaccard similarity for error messages and stack traces. */
export function textSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalize(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalize(right).split(' ').filter(Boolean));
  if (!leftTokens.size && !rightTokens.size) return 1;
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function aggregatePatterns(incidents: HistoricalIncident[], implemented: Set<string>): IncidentPattern[] {
  const groups = new Map<string, HistoricalIncident[]>();
  for (const incident of incidents) {
    const signature = incidentSignature(incident.errorMessage, incident.stackTrace);
    groups.set(signature, [...(groups.get(signature) ?? []), incident]);
  }
  return [...groups.entries()].map(([signature, matches]) => {
    const rootCounts = new Map<IncidentRootCause, number>();
    matches.forEach(match => rootCounts.set(match.rootCause, (rootCounts.get(match.rootCause) ?? 0) + 1));
    const durations = matches.map(resolutionMs).filter((value): value is number => value !== undefined);
    const fixes = [...new Set(matches.flatMap(match => match.fixCommit ? [match.fixCommit] : []))];
    return {
      signature,
      frequency: matches.length,
      rootCauses: [...rootCounts.entries()]
        .map(([rootCause, count]) => ({ rootCause, count }))
        .sort((left, right) => right.count - left.count),
      fixes,
      recommendation: preventionRecommendation(matches[0].errorMessage, fixes[0]),
      suggestedTests: suggestedTests(matches[0].errorMessage),
      ...(durations.length ? { averageResolutionMs: average(durations) } : {}),
      lastSeen: matches.map(match => match.occurredAt).sort().at(-1) as string,
      recommendationImplemented: implemented.has(signature)
    };
  }).sort((left, right) => right.frequency - left.frequency || Date.parse(right.lastSeen) - Date.parse(left.lastSeen));
}

function calculateMetrics(incidents: HistoricalIncident[]): IncidentPatternMetrics {
  const frequencyByRootCause: Record<IncidentRootCause, number> = {
    TEST_GAP: 0, CODE_BUG: 0, SPEC_GAP: 0, DEPLOYMENT: 0
  };
  incidents.forEach(incident => { frequencyByRootCause[incident.rootCause] += 1; });
  const resolved = incidents
    .map(incident => ({ incident, duration: resolutionMs(incident) }))
    .filter((item): item is { incident: HistoricalIncident; duration: number } => item.duration !== undefined);
  const months = new Map<string, number[]>();
  for (const item of resolved) {
    const month = item.incident.resolvedAt?.slice(0, 7) as string;
    months.set(month, [...(months.get(month) ?? []), item.duration]);
  }
  return {
    totalIncidents: incidents.length,
    frequencyByRootCause,
    ...(resolved.length ? { averageResolutionMs: average(resolved.map(item => item.duration)) } : {}),
    resolutionTrend: [...months.entries()].sort().map(([month, durations]) => ({
      month, averageResolutionMs: average(durations), resolved: durations.length
    }))
  };
}

function historicalRecommendation(incident: HistoricalIncident): string {
  const weeks = Math.max(0, Math.round((Date.now() - Date.parse(incident.occurredAt)) / 604_800_000));
  const fix = incident.fixCommit ? `, check fix in commit ${incident.fixCommit}` : '';
  return `Similar incident ${weeks} weeks ago${fix}`;
}

function preventionRecommendation(message: string, fix?: string): string {
  const lower = message.toLowerCase();
  let guidance = 'Add a regression test for this error signature and monitor recurrence';
  if (/sql|database|column|schema/.test(lower)) guidance = 'Check schema changes and add migration compatibility tests';
  else if (/timeout|timed out|connection/.test(lower)) guidance = 'Add timeout, retry, and dependency degradation tests';
  else if (/auth|token|unauthorized|forbidden/.test(lower)) guidance = 'Add token expiry and authorization boundary tests';
  else if (/null|undefined|cannot read/.test(lower)) guidance = 'Add null, missing-field, and partial-payload tests';
  return fix ? `${guidance}; review fix ${fix}` : guidance;
}

function suggestedTests(message: string): string[] {
  const recommendation = preventionRecommendation(message);
  const suggestions = [recommendation.replace(/^Add /, 'Test ')];
  if (/sql|database|column|schema/i.test(message)) suggestions.push('Test backward-compatible schema migration and rollback');
  if (/timeout|timed out|connection/i.test(message)) suggestions.push('Test dependency timeout with bounded retry');
  return [...new Set(suggestions)];
}

function normalize(value: string): string {
  return value.toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '<id>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/[^a-z0-9<>]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function validateIncident(incident: HistoricalIncident): void {
  required(incident.id, 'id');
  required(incident.goldenThreadId, 'goldenThreadId');
  required(incident.errorMessage, 'errorMessage');
  if (!['TEST_GAP', 'CODE_BUG', 'SPEC_GAP', 'DEPLOYMENT'].includes(incident.rootCause)) {
    throw new Error(`Invalid rootCause: ${String(incident.rootCause)}`);
  }
  const occurred = validDate(incident.occurredAt, 'occurredAt');
  if (incident.resolvedAt && validDate(incident.resolvedAt, 'resolvedAt') < occurred) {
    throw new Error('resolvedAt must not be before occurredAt');
  }
}

function resolutionMs(incident: HistoricalIncident): number | undefined {
  return incident.resolvedAt ? Date.parse(incident.resolvedAt) - Date.parse(incident.occurredAt) : undefined;
}

function validDate(value: string, name: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid ISO date`);
  return timestamp;
}

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
