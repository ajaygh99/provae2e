/** Sentinel incident user-impact assessment and historical prioritization. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface UserTrace {
  traceId: string;
  sessionId: string;
  userId: string;
}

export interface IncidentImpactInput {
  id: string;
  startedAt: string;
  endedAt: string;
  traceIds: string[];
  failedRequests: number;
  annualRecurringRevenue: number;
  dailyActiveUsers: number;
  testCoveragePercent: number;
  experience: string;
}

export interface IncidentImpactAssessment {
  incidentId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  durationMinutes: number;
  usersAffected: number;
  sessionsAffected: number;
  requestsFailed: number;
  revenuePerUser: number;
  revenueAtRisk: number;
  impactScore: number;
  experience: string;
  alert: string;
  testCoveragePercent: number;
  preventability: string;
}

export interface QuarterlyImpactReport {
  quarter: string;
  generatedAt: string;
  incidents: IncidentImpactAssessment[];
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** SQLite-backed trace correlation and incident impact assessment. */
export class SentinelUserImpactAssessor {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly now: () => Date
  ) {}

  /**
   * Opens or creates an impact assessment store.
   * @param filePath SQLite database path.
   * @param now Injectable report clock.
   * @returns Initialized assessor.
   */
  static async open(
    filePath: string,
    now: () => Date = () => new Date()
  ): Promise<SentinelUserImpactAssessor> {
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS sentinel_user_traces (
        trace_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sentinel_incident_impacts (
        incident_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL, users_affected INTEGER NOT NULL,
        sessions_affected INTEGER NOT NULL, requests_failed INTEGER NOT NULL,
        revenue_per_user REAL NOT NULL, revenue_at_risk REAL NOT NULL,
        impact_score REAL NOT NULL, experience TEXT NOT NULL, alert TEXT NOT NULL,
        test_coverage_percent REAL NOT NULL, preventability TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_incident_impact_start
        ON sentinel_incident_impacts(started_at);
      CREATE INDEX IF NOT EXISTS idx_incident_impact_score
        ON sentinel_incident_impacts(impact_score);
    `);
    const assessor = new SentinelUserImpactAssessor(path.resolve(filePath), database, now);
    await assessor.persist();
    return assessor;
  }

  /**
   * Registers an application trace-to-session-to-user mapping.
   * Re-registering the same trace updates its correlation.
   * @param trace Instrumentation identifiers.
   */
  async registerTrace(trace: UserTrace): Promise<void> {
    validateTrace(trace);
    this.database.run(
      `INSERT INTO sentinel_user_traces (trace_id, session_id, user_id)
       VALUES (?, ?, ?)
       ON CONFLICT(trace_id) DO UPDATE SET
         session_id = excluded.session_id, user_id = excluded.user_id`,
      [trace.traceId, trace.sessionId, trace.userId]
    );
    await this.persist();
  }

  /**
   * Quantifies and stores the customer impact of an incident.
   * @param input Incident telemetry and commercial context.
   * @returns User, request, revenue, and preventability assessment.
   */
  async assessIncident(input: IncidentImpactInput): Promise<IncidentImpactAssessment> {
    validateIncident(input);
    const started = Date.parse(input.startedAt);
    const ended = Date.parse(input.endedAt);
    const durationMs = ended - started;
    const correlations = this.correlations(input.traceIds);
    const usersAffected = new Set(correlations.map(item => item.userId)).size;
    const sessionsAffected = new Set(correlations.map(item => item.sessionId)).size;
    const revenuePerUser = input.annualRecurringRevenue / 30 / input.dailyActiveUsers;
    const revenueAtRisk = revenuePerUser * usersAffected;
    const durationMinutes = durationMs / 60_000;
    const impactScore = usersAffected * durationMinutes * revenuePerUser;
    const testCoveragePercent = round(input.testCoveragePercent);
    const assessment: IncidentImpactAssessment = {
      incidentId: input.id,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      durationMs,
      durationMinutes: round(durationMinutes),
      usersAffected,
      sessionsAffected,
      requestsFailed: input.failedRequests,
      revenuePerUser: round(revenuePerUser),
      revenueAtRisk: round(revenueAtRisk),
      impactScore: round(impactScore),
      experience: input.experience.trim(),
      alert: impactAlert(usersAffected, durationMinutes, revenueAtRisk),
      testCoveragePercent,
      preventability: preventionRecommendation(testCoveragePercent)
    };
    this.storeAssessment(assessment);
    await this.persist();
    return assessment;
  }

  /**
   * Returns one previously assessed incident.
   * @param incidentId Incident identifier.
   * @returns Assessment, or undefined when absent.
   */
  getAssessment(incidentId: string): IncidentImpactAssessment | undefined {
    const result = this.database.exec(
      'SELECT * FROM sentinel_incident_impacts WHERE incident_id = ?',
      [incidentId]
    );
    return result[0]?.values[0] ? rowToAssessment(result[0].columns, result[0].values[0]) : undefined;
  }

  /**
   * Ranks the ten highest-impact incidents in a calendar quarter.
   * @param quarter Quarter formatted YYYY-Q1 through YYYY-Q4.
   * @returns Quarterly impact report.
   */
  topQuarterlyIncidents(quarter: string): QuarterlyImpactReport {
    const { from, to } = quarterWindow(quarter);
    const result = this.database.exec(
      `SELECT * FROM sentinel_incident_impacts
       WHERE started_at >= ? AND started_at < ?
       ORDER BY impact_score DESC, started_at DESC LIMIT 10`,
      [new Date(from).toISOString(), new Date(to).toISOString()]
    );
    const incidents = result[0]?.values.map(row => rowToAssessment(result[0].columns, row)) ?? [];
    return {
      quarter,
      generatedAt: new Date(this.currentTime()).toISOString(),
      incidents
    };
  }

  private correlations(traceIds: string[]): UserTrace[] {
    if (traceIds.length === 0) return [];
    const unique = [...new Set(traceIds)];
    const placeholders = unique.map(() => '?').join(', ');
    const result = this.database.exec(
      `SELECT trace_id, session_id, user_id FROM sentinel_user_traces
       WHERE trace_id IN (${placeholders})`,
      unique
    );
    return result[0]?.values.map(row => ({
      traceId: row[0] as string,
      sessionId: row[1] as string,
      userId: row[2] as string
    })) ?? [];
  }

  private storeAssessment(assessment: IncidentImpactAssessment): void {
    this.database.run(
      `INSERT INTO sentinel_incident_impacts
       (incident_id, started_at, ended_at, duration_ms, users_affected,
        sessions_affected, requests_failed, revenue_per_user, revenue_at_risk,
        impact_score, experience, alert, test_coverage_percent, preventability)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(incident_id) DO UPDATE SET
        started_at=excluded.started_at, ended_at=excluded.ended_at,
        duration_ms=excluded.duration_ms, users_affected=excluded.users_affected,
        sessions_affected=excluded.sessions_affected, requests_failed=excluded.requests_failed,
        revenue_per_user=excluded.revenue_per_user, revenue_at_risk=excluded.revenue_at_risk,
        impact_score=excluded.impact_score, experience=excluded.experience,
        alert=excluded.alert, test_coverage_percent=excluded.test_coverage_percent,
        preventability=excluded.preventability`,
      [
        assessment.incidentId, assessment.startedAt, assessment.endedAt,
        assessment.durationMs, assessment.usersAffected, assessment.sessionsAffected,
        assessment.requestsFailed, assessment.revenuePerUser, assessment.revenueAtRisk,
        assessment.impactScore, assessment.experience, assessment.alert,
        assessment.testCoveragePercent, assessment.preventability
      ]
    );
  }

  private currentTime(): number {
    const timestamp = this.now().getTime();
    if (!Number.isFinite(timestamp)) throw new Error('Current time must be valid');
    return timestamp;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }
}

/** Formats an actionable customer-impact alert payload. */
export function impactAlert(users: number, durationMinutes: number, revenueAtRisk: number): string {
  return `${users.toLocaleString('en-US')} users impacted for ${round(durationMinutes)} minutes, est. $${round(revenueAtRisk).toLocaleString('en-US')} revenue at risk`;
}

/** Builds a test-gap recommendation from scenario coverage. */
export function preventionRecommendation(coveragePercent: number): string {
  if (coveragePercent < 0 || coveragePercent > 100 || !Number.isFinite(coveragePercent)) {
    throw new Error('testCoveragePercent must be between 0 and 100');
  }
  if (coveragePercent === 0) {
    return 'Test coverage for this scenario: 0%, recommending gap fill';
  }
  if (coveragePercent < 80) {
    return `Test coverage for this scenario: ${round(coveragePercent)}%, recommending coverage improvement`;
  }
  return `Test coverage for this scenario: ${round(coveragePercent)}%, no critical test gap detected`;
}

function rowToAssessment(columns: string[], row: Array<number | string | Uint8Array | null>): IncidentImpactAssessment {
  const value = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
  return {
    incidentId: String(value.incident_id),
    startedAt: String(value.started_at),
    endedAt: String(value.ended_at),
    durationMs: Number(value.duration_ms),
    durationMinutes: round(Number(value.duration_ms) / 60_000),
    usersAffected: Number(value.users_affected),
    sessionsAffected: Number(value.sessions_affected),
    requestsFailed: Number(value.requests_failed),
    revenuePerUser: Number(value.revenue_per_user),
    revenueAtRisk: Number(value.revenue_at_risk),
    impactScore: Number(value.impact_score),
    experience: String(value.experience),
    alert: String(value.alert),
    testCoveragePercent: Number(value.test_coverage_percent),
    preventability: String(value.preventability)
  };
}

function validateTrace(trace: UserTrace): void {
  required(trace.traceId, 'traceId');
  required(trace.sessionId, 'sessionId');
  required(trace.userId, 'userId');
}

function validateIncident(input: IncidentImpactInput): void {
  required(input.id, 'id');
  required(input.experience, 'experience');
  const started = validDate(input.startedAt, 'startedAt');
  const ended = validDate(input.endedAt, 'endedAt');
  if (ended <= started) throw new Error('endedAt must be after startedAt');
  nonNegativeInteger(input.failedRequests, 'failedRequests');
  positive(input.annualRecurringRevenue, 'annualRecurringRevenue');
  positive(input.dailyActiveUsers, 'dailyActiveUsers');
  preventionRecommendation(input.testCoveragePercent);
  if (!Array.isArray(input.traceIds) || input.traceIds.some(traceId => !traceId.trim())) {
    throw new Error('traceIds must contain valid trace identifiers');
  }
}

function quarterWindow(quarter: string): { from: number; to: number } {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new Error('quarter must use YYYY-Q1 through YYYY-Q4');
  const year = Number(match[1]);
  const startMonth = (Number(match[2]) - 1) * 3;
  return {
    from: Date.UTC(year, startMonth, 1),
    to: Date.UTC(year, startMonth + 3, 1)
  };
}

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function validDate(value: string, name: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid timestamp`);
  return timestamp;
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
