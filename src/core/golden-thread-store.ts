/** SQLite-backed Golden Thread traceability store. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** The seven stages of the Golden Thread. */
export type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const STAGE_NAMES: Record<Stage, string> = {
  1: 'Spec',
  2: 'Test',
  3: 'Evidence',
  4: 'Build',
  5: 'Deploy',
  6: 'Monitor',
  7: 'Debug'
};

/** Status of a stage in the chain. */
export type StageStatus = 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED';

/** One log entry in a Golden Thread chain. */
export interface StageLog {
  id?: number;
  golden_thread_id: string;
  stage: Stage;
  status: StageStatus;
  timestamp: string;
  actor: string;
  artifact_url: string;
  parent_id: string | null;
  metadata: string;
}

/** Complete 7-stage chain. */
export interface GoldenThreadChain {
  golden_thread_id: string;
  created_at: string;
  stages: StageLog[];
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;

function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/** SQLite-backed repository for Golden Thread stage logs. */
export class GoldenThreadStore {
  private constructor(private readonly filePath: string, private readonly database: Database) {}

  /** Opens or creates a Golden Thread database and applies its schema. */
  static async open(filePath: string): Promise<GoldenThreadStore> {
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS golden_thread_chains (
        golden_thread_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        golden_thread_id TEXT NOT NULL,
        stage INTEGER NOT NULL CHECK(stage >= 1 AND stage <= 7),
        status TEXT NOT NULL CHECK(status IN ('PENDING','IN_PROGRESS','PASSED','FAILED')),
        timestamp TEXT NOT NULL,
        actor TEXT NOT NULL,
        artifact_url TEXT NOT NULL,
        parent_id TEXT,
        metadata TEXT NOT NULL,
        FOREIGN KEY (golden_thread_id) REFERENCES golden_thread_chains(golden_thread_id),
        UNIQUE(golden_thread_id, stage)
      );
    `);
    const store = new GoldenThreadStore(path.resolve(filePath), database);
    await store.persist();
    return store;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const bytes = this.database.export();
    const buffer = Buffer.from(bytes);
    await writeFile(this.filePath, buffer);
  }

  /** Creates a new Golden Thread chain starting with Spec stage. */
  async initiate(actor: string, artifact_url: string, metadata?: Record<string, unknown>): Promise<string> {
    const golden_thread_id = randomUUID();
    const now = new Date().toISOString();
    this.database.run(
      'INSERT INTO golden_thread_chains (golden_thread_id, created_at) VALUES (?, ?)',
      [golden_thread_id, now]
    );
    await this.insertStage({
      golden_thread_id,
      stage: 1,
      status: 'PASSED',
      timestamp: now,
      actor,
      artifact_url,
      parent_id: null,
      metadata: JSON.stringify(metadata || {})
    });
    await this.persist();
    return golden_thread_id;
  }

  /** Logs a new stage in an existing chain. */
  async linkStage(golden_thread_id: string, stage: Stage, status: StageStatus, actor: string, artifact_url: string, metadata?: Record<string, unknown>): Promise<void> {
    if (stage < 1 || stage > 7) throw new Error(`Stage must be between 1 and 7, got ${stage}`);
    const chain = await this.getChain(golden_thread_id);
    if (!chain) throw new Error(`Golden Thread ${golden_thread_id} not found`);

    const prevStage = chain.stages.find(s => s.stage === (stage - 1) as Stage);
    const parent_id = prevStage ? String(prevStage.id) : null;

    const now = new Date().toISOString();
    await this.insertStage({
      golden_thread_id,
      stage,
      status,
      timestamp: now,
      actor,
      artifact_url,
      parent_id,
      metadata: JSON.stringify(metadata || {})
    });
    await this.persist();
  }

  /** Retrieves the complete chain for a Golden Thread. */
  async getChain(golden_thread_id: string): Promise<GoldenThreadChain | null> {
    const chainRows = this.database.exec(
      'SELECT golden_thread_id, created_at FROM golden_thread_chains WHERE golden_thread_id = ?',
      [golden_thread_id]
    );
    if (!chainRows.length || !chainRows[0].values.length) return null;

    const [chainId, created_at] = chainRows[0].values[0] as [string, string];

    const stageRows = this.database.exec(
      'SELECT id, golden_thread_id, stage, status, timestamp, actor, artifact_url, parent_id, metadata FROM stage_logs WHERE golden_thread_id = ? ORDER BY stage ASC',
      [golden_thread_id]
    );

    const stages: StageLog[] = stageRows[0]?.values?.map(row => ({
      id: row[0] as number,
      golden_thread_id: row[1] as string,
      stage: row[2] as Stage,
      status: row[3] as StageStatus,
      timestamp: row[4] as string,
      actor: row[5] as string,
      artifact_url: row[6] as string,
      parent_id: row[7] as string | null,
      metadata: row[8] as string
    })) || [];

    return { golden_thread_id: chainId, created_at, stages };
  }

  /** Validates that a chain is complete (all 7 stages present and linked). */
  async validateChain(golden_thread_id: string): Promise<{ valid: boolean; errors: string[] }> {
    const chain = await this.getChain(golden_thread_id);
    if (!chain) return { valid: false, errors: [`Chain ${golden_thread_id} not found`] };

    const errors: string[] = [];

    for (let i = 1; i <= 7; i++) {
      const stage = chain.stages.find(s => s.stage === i as Stage);
      if (!stage) {
        errors.push(`Stage ${i} (${STAGE_NAMES[i as Stage]}) missing`);
      } else if (i > 1) {
        const prevStage = chain.stages.find(s => s.stage === (i - 1) as Stage);
        if (!prevStage || stage.parent_id !== String(prevStage.id)) {
          errors.push(`Stage ${i} not linked to stage ${i - 1}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Lists all chains in the database. */
  async listChains(): Promise<string[]> {
    const rows = this.database.exec(
      'SELECT golden_thread_id FROM golden_thread_chains ORDER BY created_at DESC'
    );
    return rows[0]?.values?.map(row => row[0] as string) || [];
  }

  private async insertStage(stage: StageLog): Promise<void> {
    this.database.run(
      `INSERT INTO stage_logs
       (golden_thread_id, stage, status, timestamp, actor, artifact_url, parent_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stage.golden_thread_id,
        stage.stage,
        stage.status,
        stage.timestamp,
        stage.actor,
        stage.artifact_url,
        stage.parent_id,
        stage.metadata
      ]
    );
  }
}
