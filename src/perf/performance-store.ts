/** Portable SQLite persistence for performance baselines and run history. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Complete metrics stored for performance history. */
export interface StoredPerformanceMetrics {
  p50ResponseTimeMs: number;
  p95ResponseTimeMs: number;
  p99ResponseTimeMs: number;
  errorRate: number;
  requestsPerSecond: number;
}

/** One historical performance run. */
export interface PerformanceRun extends StoredPerformanceMetrics {
  id?: number;
  url: string;
  vus: number;
  durationSeconds: number;
  status: 'PASS' | 'FAIL';
  timestamp: string;
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;

function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
}

function validateRun(run: PerformanceRun): void {
  let parsed: URL;
  try { parsed = new URL(run.url); } catch { throw new Error('Performance URL must be an absolute HTTP(S) URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Performance URL must be an absolute HTTP(S) URL');
  if (!Number.isInteger(run.vus) || run.vus < 1) throw new Error('VUs must be a positive integer');
  if (!Number.isInteger(run.durationSeconds) || run.durationSeconds < 1) throw new Error('Duration must be a positive integer');
  finite(run.p50ResponseTimeMs, 'p50');
  finite(run.p95ResponseTimeMs, 'p95');
  finite(run.p99ResponseTimeMs, 'p99');
  finite(run.requestsPerSecond, 'requestsPerSecond');
  if (!Number.isFinite(run.errorRate) || run.errorRate < 0 || run.errorRate > 1) throw new Error('errorRate must be between 0 and 1');
}

/** SQLite-backed baseline and historical-run repository. */
export class PerformanceStore {
  private constructor(private readonly filePath: string, private readonly database: Database) {}

  /** Opens or creates a performance database and applies its schema. */
  static async open(filePath: string): Promise<PerformanceStore> {
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS performance_baselines (
        url TEXT NOT NULL, vus INTEGER NOT NULL, duration_seconds INTEGER NOT NULL,
        p50 REAL NOT NULL, p95 REAL NOT NULL, p99 REAL NOT NULL,
        error_rate REAL NOT NULL, rps REAL NOT NULL, timestamp TEXT NOT NULL,
        PRIMARY KEY (url, vus, duration_seconds)
      );
      CREATE TABLE IF NOT EXISTS performance_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, vus INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL, p50 REAL NOT NULL, p95 REAL NOT NULL,
        p99 REAL NOT NULL, error_rate REAL NOT NULL, rps REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PASS','FAIL')), timestamp TEXT NOT NULL
      );
    `);
    const store = new PerformanceStore(path.resolve(filePath), database);
    await store.persist();
    return store;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }

  /** Inserts or replaces the baseline for one URL/load profile. */
  async setBaseline(run: PerformanceRun): Promise<void> {
    validateRun(run);
    this.database.run(`INSERT OR REPLACE INTO performance_baselines
      (url,vus,duration_seconds,p50,p95,p99,error_rate,rps,timestamp) VALUES (?,?,?,?,?,?,?,?,?)`,
    [run.url, run.vus, run.durationSeconds, run.p50ResponseTimeMs, run.p95ResponseTimeMs,
      run.p99ResponseTimeMs, run.errorRate, run.requestsPerSecond, run.timestamp]);
    await this.persist();
  }

  /** Returns the baseline matching one URL/load profile. */
  getBaseline(url: string, vus: number, durationSeconds: number): PerformanceRun | undefined {
    const statement = this.database.prepare(`SELECT url,vus,duration_seconds,p50,p95,p99,error_rate,rps,timestamp
      FROM performance_baselines WHERE url=? AND vus=? AND duration_seconds=?`);
    statement.bind([url, vus, durationSeconds]);
    const row = statement.step() ? statement.getAsObject() : undefined;
    statement.free();
    return row ? rowToRun(row, 'PASS') : undefined;
  }

  /** Appends one immutable historical performance run. */
  async addRun(run: PerformanceRun): Promise<void> {
    validateRun(run);
    this.database.run(`INSERT INTO performance_history
      (url,vus,duration_seconds,p50,p95,p99,error_rate,rps,status,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [run.url, run.vus, run.durationSeconds, run.p50ResponseTimeMs, run.p95ResponseTimeMs,
      run.p99ResponseTimeMs, run.errorRate, run.requestsPerSecond, run.status, run.timestamp]);
    await this.persist();
  }

  /** Lists recent historical runs, optionally filtered by URL and age. */
  listRuns(options: { url?: string; since?: string } = {}): PerformanceRun[] {
    const clauses: string[] = [];
    const values: Array<string> = [];
    if (options.url) { clauses.push('url=?'); values.push(options.url); }
    if (options.since) { clauses.push('timestamp>=?'); values.push(options.since); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const statement = this.database.prepare(`SELECT id,url,vus,duration_seconds,p50,p95,p99,error_rate,rps,status,timestamp
      FROM performance_history${where} ORDER BY timestamp ASC`);
    statement.bind(values);
    const rows: PerformanceRun[] = [];
    while (statement.step()) rows.push(rowToRun(statement.getAsObject()));
    statement.free();
    return rows;
  }

  /** Releases the in-memory SQLite database. */
  close(): void { this.database.close(); }
}

function rowToRun(row: Record<string, unknown>, forcedStatus?: 'PASS' | 'FAIL'): PerformanceRun {
  return {
    ...(typeof row['id'] === 'number' ? { id: row['id'] } : {}),
    url: String(row['url']), vus: Number(row['vus']), durationSeconds: Number(row['duration_seconds']),
    p50ResponseTimeMs: Number(row['p50']), p95ResponseTimeMs: Number(row['p95']),
    p99ResponseTimeMs: Number(row['p99']), errorRate: Number(row['error_rate']),
    requestsPerSecond: Number(row['rps']), status: forcedStatus ?? String(row['status']) as 'PASS' | 'FAIL',
    timestamp: String(row['timestamp'])
  };
}
