/** Lightweight, append-only production monitoring foundation for PROVA Sentinel. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LogEntry, LogLevel } from './production-logs-model.js';

export interface SentinelCoverage {
  covered: boolean;
  coveragePercent: number;
  evidence?: string;
}

export interface SentinelJiraIssue {
  summary: string;
  description: string;
  labels: string[];
  evidence: SentinelEvidence;
}

export interface SentinelJiraResult { issueKey: string; issueUrl?: string }
export type SentinelCoverageMatcher = (log: LogEntry) => Promise<SentinelCoverage>;
export type SentinelJiraCreator = (issue: SentinelJiraIssue) => Promise<SentinelJiraResult>;

/** Append-only evidence stored for a sampled production log. */
export interface SentinelEvidence {
  id: string;
  timestamp: string;
  level: LogLevel;
  error: string;
  deploymentSha: string;
  source: string;
  testCoveragePercent: number;
  covered: boolean;
  actionTaken: 'none' | 'covered' | 'jira-created' | 'jira-failed';
  jiraIssueKey?: string;
}

export interface SentinelProcessResult {
  sampled: boolean;
  evidence?: SentinelEvidence;
  jira?: SentinelJiraResult;
}

export interface SentinelAgentOptions {
  coverageMatcher: SentinelCoverageMatcher;
  jiraCreator?: SentinelJiraCreator;
  random?: () => number;
}

export const SENTINEL_RESOURCE_BUDGET = Object.freeze({
  deployment: 'sidecar-or-log-processor',
  maxImageSizeMb: 100,
  targetCpuPercent: 1
});

let sqlitePromise: Promise<SqlJsStatic> | undefined;
function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** Samples production logs, checks test coverage, persists evidence, and alerts JIRA. */
export class SentinelAgent {
  private constructor(
    private readonly filePath: string,
    private readonly database: Database,
    private readonly options: SentinelAgentOptions
  ) {}

  /**
   * Opens the append-only Sentinel incident store.
   * @param filePath SQLite database file.
   * @param options Coverage and alert integration boundaries.
   * @returns Initialized Sentinel agent.
   */
  static async open(filePath: string, options: SentinelAgentOptions): Promise<SentinelAgent> {
    if (typeof options.coverageMatcher !== 'function') throw new Error('coverageMatcher is required');
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS sentinel_incidents (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        error TEXT NOT NULL,
        deployment_sha TEXT NOT NULL,
        source TEXT NOT NULL,
        test_coverage_pct REAL NOT NULL,
        covered INTEGER NOT NULL,
        action_taken TEXT NOT NULL,
        jira_issue_key TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sentinel_timestamp ON sentinel_incidents(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sentinel_covered ON sentinel_incidents(covered);
    `);
    const agent = new SentinelAgent(path.resolve(filePath), database, options);
    await agent.persist();
    return agent;
  }

  /**
   * Processes one log with ERROR=100%, WARNING=50%, INFO=10%, DEBUG=0% sampling.
   * @param entry Production log entry.
   * @returns Sampling, evidence, and optional JIRA result.
   */
  async process(entry: LogEntry): Promise<SentinelProcessResult> {
    validateEntry(entry);
    const random = this.options.random ?? Math.random;
    if (!shouldSample(entry.level, random())) return { sampled: false };
    const coverage = await this.options.coverageMatcher(entry);
    validateCoverage(coverage);
    const id = evidenceId(entry);
    let action: SentinelEvidence['actionTaken'] = coverage.covered ? 'covered' : 'none';
    let jira: SentinelJiraResult | undefined;
    if (!coverage.covered && this.options.jiraCreator && (entry.level === 'ERROR' || entry.level === 'WARNING')) {
      try {
        jira = await this.options.jiraCreator(buildJiraIssue(entry, coverage, id));
        if (!jira.issueKey.trim()) throw new Error('JIRA creator returned an empty issue key');
        action = 'jira-created';
      } catch {
        action = 'jira-failed';
      }
    }
    const evidence: SentinelEvidence = {
      id,
      timestamp: new Date(entry.timestamp).toISOString(),
      level: entry.level,
      error: entry.message,
      deploymentSha: entry.deployment_sha,
      source: entry.source,
      testCoveragePercent: coverage.coveragePercent,
      covered: coverage.covered,
      actionTaken: action,
      ...(jira ? { jiraIssueKey: jira.issueKey } : {})
    };
    this.database.run(
      `INSERT OR IGNORE INTO sentinel_incidents
       (id, timestamp, level, error, deployment_sha, source, test_coverage_pct,
        covered, action_taken, jira_issue_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evidence.id, evidence.timestamp, evidence.level, evidence.error,
        evidence.deploymentSha, evidence.source, evidence.testCoveragePercent,
        evidence.covered ? 1 : 0, evidence.actionTaken, evidence.jiraIssueKey ?? null
      ]
    );
    await this.persist();
    return { sampled: true, evidence, ...(jira ? { jira } : {}) };
  }

  /**
   * Returns incident evidence in append order.
   * @param uncoveredOnly When true, returns only coverage gaps.
   * @returns Stored Sentinel evidence.
   */
  listIncidents(uncoveredOnly = false): SentinelEvidence[] {
    const where = uncoveredOnly ? ' WHERE covered = 0' : '';
    const rows = this.database.exec(`
      SELECT id, timestamp, level, error, deployment_sha, source,
             test_coverage_pct, covered, action_taken, jira_issue_key
      FROM sentinel_incidents${where} ORDER BY sequence
    `);
    return rows[0]?.values.map(row => ({
      id: row[0] as string,
      timestamp: row[1] as string,
      level: row[2] as LogLevel,
      error: row[3] as string,
      deploymentSha: row[4] as string,
      source: row[5] as string,
      testCoveragePercent: row[6] as number,
      covered: row[7] === 1,
      actionTaken: row[8] as SentinelEvidence['actionTaken'],
      ...(row[9] ? { jiraIssueKey: row[9] as string } : {})
    })) ?? [];
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }
}

/** Applies Sentinel's fixed severity sampling rates. */
export function shouldSample(level: LogLevel, randomValue: number): boolean {
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new Error('randomValue must be between 0 (inclusive) and 1 (exclusive)');
  }
  if (level === 'ERROR') return true;
  if (level === 'WARNING') return randomValue < 0.5;
  if (level === 'INFO') return randomValue < 0.1;
  if (level === 'DEBUG') return false;
  throw new Error(`Unsupported log level: ${String(level)}`);
}

function buildJiraIssue(entry: LogEntry, coverage: SentinelCoverage, evidenceIdValue: string): SentinelJiraIssue {
  return {
    summary: `Sentinel: Uncovered Incident - ${entry.message.slice(0, 120)}`,
    description: [
      `Production ${entry.level}: ${entry.message}`,
      `Deployment: ${entry.deployment_sha}`,
      `Automated test coverage: ${coverage.coveragePercent}%`,
      'Was this error scenario covered in automated tests? No.',
      `Sentinel evidence: ${evidenceIdValue}`
    ].join('\n'),
    labels: ['sentinel', 'uncovered-incident', 'production'],
    evidence: {
      id: evidenceIdValue,
      timestamp: new Date(entry.timestamp).toISOString(),
      level: entry.level,
      error: entry.message,
      deploymentSha: entry.deployment_sha,
      source: entry.source,
      testCoveragePercent: coverage.coveragePercent,
      covered: false,
      actionTaken: 'none'
    }
  };
}

function evidenceId(entry: LogEntry): string {
  const input = `${entry.source}|${entry.timestamp}|${entry.deployment_sha}|${entry.level}|${entry.message}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `sentinel-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function validateEntry(entry: LogEntry): void {
  if (!entry.message.trim()) throw new Error('Log message is required');
  if (!entry.deployment_sha.trim()) throw new Error('deployment_sha is required');
  if (!Number.isFinite(Date.parse(entry.timestamp))) throw new Error('Log timestamp must be valid');
  if (!['ERROR', 'WARNING', 'INFO', 'DEBUG'].includes(entry.level)) throw new Error(`Unsupported log level: ${String(entry.level)}`);
}

function validateCoverage(coverage: SentinelCoverage): void {
  if (!Number.isFinite(coverage.coveragePercent) || coverage.coveragePercent < 0 || coverage.coveragePercent > 100) {
    throw new Error('coveragePercent must be between 0 and 100');
  }
}
