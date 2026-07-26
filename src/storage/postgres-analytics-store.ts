import { Pool } from 'pg';
import type { PoolConfig, QueryResult } from 'pg';
import {
  AnalyticsStore, DEFAULT_ANALYTICS_RETENTION_DAYS, calculateAnomalies, calculateFlakyTests,
  calculateTrends, exportRuns, validateRun
} from './analytics-store.js';
import type { Anomaly, FlakyTest, RunQuery, TestRunRecord, TrendData } from './analytics-store.js';

export interface PostgresClient {
  query(text: string, values?: unknown[]): Promise<QueryResult<Record<string, unknown>>>;
  end(): Promise<void>;
}

export class PostgresAnalyticsStore extends AnalyticsStore {
  private readonly client: PostgresClient;
  constructor(connectionString: string, client?: PostgresClient) {
    super();
    if (!connectionString && !client) throw new Error('PostgreSQL connection string is required');
    this.client = client ?? new Pool({ connectionString } satisfies PoolConfig) as unknown as PostgresClient;
  }

  async initialize(): Promise<void> {
    await this.client.query(`CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY, timestamp TIMESTAMPTZ NOT NULL, test_name TEXT NOT NULL, test_type TEXT NOT NULL,
      status TEXT NOT NULL, duration_ms INTEGER NOT NULL, device TEXT, browser TEXT, tags JSONB NOT NULL,
      error_message TEXT, metadata JSONB NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON test_runs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_analytics_test_name ON test_runs(test_name);
      CREATE INDEX IF NOT EXISTS idx_analytics_status ON test_runs(status);`);
  }

  async saveTestRun(run: TestRunRecord): Promise<void> {
    validateRun(run);
    await this.client.query(`INSERT INTO test_runs
      (id,timestamp,test_name,test_type,status,duration_ms,device,browser,tags,error_message,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)
      ON CONFLICT (id) DO UPDATE SET timestamp=EXCLUDED.timestamp,test_name=EXCLUDED.test_name,
      test_type=EXCLUDED.test_type,status=EXCLUDED.status,duration_ms=EXCLUDED.duration_ms,
      device=EXCLUDED.device,browser=EXCLUDED.browser,tags=EXCLUDED.tags,
      error_message=EXCLUDED.error_message,metadata=EXCLUDED.metadata`,
    [run.id, run.timestamp.toISOString(), run.testName, run.testType, run.status, run.durationMs,
      run.device ?? null, run.browser ?? null, JSON.stringify(run.tags), run.errorMessage ?? null,
      JSON.stringify(run.metadata)]);
  }

  async getRuns(query: RunQuery = {}): Promise<TestRunRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (query.days !== undefined) {
      values.push(new Date((query.now ?? new Date()).getTime() - query.days * 86_400_000).toISOString());
      conditions.push(`timestamp >= $${values.length}`);
    }
    if (query.testName) { values.push(query.testName); conditions.push(`test_name = $${values.length}`); }
    let limit = '';
    if (query.limit !== undefined) { values.push(Math.max(0, Math.floor(query.limit))); limit = ` LIMIT $${values.length}`; }
    const result = await this.client.query(`SELECT * FROM test_runs
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY timestamp ASC${limit}`, values);
    return result.rows.map((row) => ({
      id: String(row['id']), timestamp: new Date(String(row['timestamp'])), testName: String(row['test_name']),
      testType: String(row['test_type']) as TestRunRecord['testType'],
      status: String(row['status']) as TestRunRecord['status'], durationMs: Number(row['duration_ms']),
      ...(row['device'] ? { device: String(row['device']) } : {}),
      ...(row['browser'] ? { browser: String(row['browser']) } : {}),
      tags: (typeof row['tags'] === 'string' ? JSON.parse(row['tags']) : row['tags']) as string[],
      ...(row['error_message'] ? { errorMessage: String(row['error_message']) } : {}),
      metadata: (typeof row['metadata'] === 'string' ? JSON.parse(row['metadata']) : row['metadata']) as Record<string, unknown>
    }));
  }

  async getTrends(days: number, now = new Date()): Promise<TrendData[]> {
    return calculateTrends(await this.getRuns({ days, now }));
  }
  async detectAnomalies(now = new Date()): Promise<Anomaly[]> {
    return calculateAnomalies(await this.getRuns({ days: DEFAULT_ANALYTICS_RETENTION_DAYS, now }), now);
  }
  async getFlakiestTests(limit: number, now = new Date()): Promise<FlakyTest[]> {
    return calculateFlakyTests(await this.getRuns({ days: DEFAULT_ANALYTICS_RETENTION_DAYS, now }), limit);
  }
  async export(format: 'json' | 'csv'): Promise<Buffer> { return exportRuns(await this.getRuns(), format); }
  async cleanup(retentionDays = DEFAULT_ANALYTICS_RETENTION_DAYS, now = new Date()): Promise<number> {
    const result = await this.client.query('DELETE FROM test_runs WHERE timestamp < $1',
      [new Date(now.getTime() - retentionDays * 86_400_000).toISOString()]);
    return result.rowCount ?? 0;
  }
  async close(): Promise<void> { await this.client.end(); }
}
