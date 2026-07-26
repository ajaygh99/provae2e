import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AnalyticsStore, DEFAULT_ANALYTICS_RETENTION_DAYS, calculateAnomalies, calculateFlakyTests,
  exportRuns, validateRun
} from './analytics-store.js';
import type { Anomaly, FlakyTest, RunQuery, TestRunRecord, TrendData } from './analytics-store.js';

export class SQLiteAnalyticsStore extends AnalyticsStore {
  private db?: Database;
  private sql?: SqlJsStatic;
  constructor(private readonly dbPath = '.prova/analytics.db') { super(); }

  async initialize(): Promise<void> {
    this.sql = await initSqlJs();
    this.db = existsSync(this.dbPath) ? new this.sql.Database(await readFile(this.dbPath)) : new this.sql.Database();
    this.db.run(`CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, test_name TEXT NOT NULL, test_type TEXT NOT NULL,
      status TEXT NOT NULL, duration_ms INTEGER NOT NULL, device TEXT, browser TEXT, tags TEXT NOT NULL,
      error_message TEXT, metadata TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON test_runs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_analytics_test_name ON test_runs(test_name);
      CREATE INDEX IF NOT EXISTS idx_analytics_status ON test_runs(status);`);
    await this.persist();
  }

  private database(): Database {
    if (!this.db) throw new Error('Analytics store is not initialized');
    return this.db;
  }

  private async persist(): Promise<void> {
    if (!this.db) return;
    await mkdir(path.dirname(path.resolve(this.dbPath)), { recursive: true });
    await writeFile(this.dbPath, Buffer.from(this.db.export()));
  }

  async saveTestRun(run: TestRunRecord): Promise<void> {
    validateRun(run);
    this.database().run(`INSERT OR REPLACE INTO test_runs
      (id,timestamp,test_name,test_type,status,duration_ms,device,browser,tags,error_message,metadata)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [run.id, run.timestamp.toISOString(), run.testName, run.testType,
      run.status, run.durationMs, run.device ?? null, run.browser ?? null, JSON.stringify(run.tags),
      run.errorMessage ?? null, JSON.stringify(run.metadata)]);
    await this.persist();
  }

  override async saveTestRuns(runs: TestRunRecord[]): Promise<void> {
    const db = this.database();
    db.run('BEGIN');
    try {
      for (const run of runs) {
        validateRun(run);
        db.run(`INSERT OR REPLACE INTO test_runs
          (id,timestamp,test_name,test_type,status,duration_ms,device,browser,tags,error_message,metadata)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [run.id, run.timestamp.toISOString(), run.testName, run.testType,
          run.status, run.durationMs, run.device ?? null, run.browser ?? null, JSON.stringify(run.tags),
          run.errorMessage ?? null, JSON.stringify(run.metadata)]);
      }
      db.run('COMMIT');
    } catch (error) { db.run('ROLLBACK'); throw error; }
    await this.persist();
  }

  async getRuns(query: RunQuery = {}): Promise<TestRunRecord[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (query.days !== undefined) {
      const now = query.now ?? new Date();
      conditions.push('timestamp >= ?');
      values.push(new Date(now.getTime() - query.days * 86_400_000).toISOString());
    }
    if (query.testName) { conditions.push('test_name = ?'); values.push(query.testName); }
    const limit = query.limit === undefined ? '' : ` LIMIT ${Math.max(0, Math.floor(query.limit))}`;
    const statement = this.database().prepare(`SELECT * FROM test_runs ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY timestamp ASC${limit}`, values);
    const rows: TestRunRecord[] = [];
    try {
      while (statement.step()) {
        const row = statement.getAsObject();
        rows.push({
          id: String(row['id']), timestamp: new Date(String(row['timestamp'])), testName: String(row['test_name']),
          testType: String(row['test_type']) as TestRunRecord['testType'],
          status: String(row['status']) as TestRunRecord['status'], durationMs: Number(row['duration_ms']),
          ...(row['device'] ? { device: String(row['device']) } : {}),
          ...(row['browser'] ? { browser: String(row['browser']) } : {}),
          tags: JSON.parse(String(row['tags'])) as string[],
          ...(row['error_message'] ? { errorMessage: String(row['error_message']) } : {}),
          metadata: JSON.parse(String(row['metadata'])) as Record<string, unknown>
        });
      }
    } finally { statement.free(); }
    return rows;
  }

  async getTrends(days: number, now = new Date()): Promise<TrendData[]> {
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
    const statement = this.database().prepare(`WITH per_test AS (
      SELECT substr(timestamp,1,10) AS day, test_name,
        MAX(CASE WHEN status='PASS' THEN 1 ELSE 0 END) AS has_pass,
        MAX(CASE WHEN status='FAIL' THEN 1 ELSE 0 END) AS has_fail
      FROM test_runs WHERE timestamp >= ? GROUP BY day,test_name
    ), flakes AS (
      SELECT day, AVG(CASE WHEN has_pass=1 AND has_fail=1 THEN 1.0 ELSE 0.0 END) AS flake_rate
      FROM per_test GROUP BY day
    )
    SELECT substr(r.timestamp,1,10) AS day,
      SUM(CASE WHEN r.status='PASS' THEN 1 ELSE 0 END) AS pass_count,
      SUM(CASE WHEN r.status='FAIL' THEN 1 ELSE 0 END) AS fail_count,
      SUM(CASE WHEN r.status='SKIP' THEN 1 ELSE 0 END) AS skip_count,
      AVG(r.duration_ms) AS average_duration, COALESCE(f.flake_rate,0) AS flake_rate
    FROM test_runs r LEFT JOIN flakes f ON f.day=substr(r.timestamp,1,10)
    WHERE r.timestamp >= ? GROUP BY substr(r.timestamp,1,10) ORDER BY day ASC`, [cutoff, cutoff]);
    const trends: TrendData[] = [];
    try {
      while (statement.step()) {
        const row = statement.getAsObject();
        trends.push({
          date: new Date(`${String(row['day'])}T00:00:00.000Z`), passCount: Number(row['pass_count']),
          failCount: Number(row['fail_count']), skipCount: Number(row['skip_count']),
          averageDuration: Number(row['average_duration']), flakeRate: Number(row['flake_rate'])
        });
      }
    } finally { statement.free(); }
    return trends;
  }
  async detectAnomalies(now = new Date()): Promise<Anomaly[]> {
    return calculateAnomalies(await this.getRuns({ days: DEFAULT_ANALYTICS_RETENTION_DAYS, now }), now);
  }
  async getFlakiestTests(limit: number, now = new Date()): Promise<FlakyTest[]> {
    return calculateFlakyTests(await this.getRuns({ days: DEFAULT_ANALYTICS_RETENTION_DAYS, now }), limit);
  }
  async export(format: 'json' | 'csv'): Promise<Buffer> { return exportRuns(await this.getRuns(), format); }
  async cleanup(retentionDays = DEFAULT_ANALYTICS_RETENTION_DAYS, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
    this.database().run('DELETE FROM test_runs WHERE timestamp < ?', [cutoff]);
    const removed = this.database().getRowsModified();
    await this.persist();
    return Math.max(0, removed);
  }
  async close(): Promise<void> { await this.persist(); this.db?.close(); this.db = undefined; }
}
