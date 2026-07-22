/** SQLite-backed evidence store for Golden Thread Stage 3 (Evidence). */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Evidence artifact type. */
export type EvidenceType = 'screenshot' | 'video' | 'log' | 'network';

/** Evidence captured during test execution. */
export interface Evidence {
  id?: number;
  test_execution_id: string;
  type: EvidenceType;
  artifact_url: string;
  captured_at: string;
  metadata: string;
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;

function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/**
 * SQLite-backed repository for test execution evidence.
 * Stores screenshots, videos, logs, and network traces linked to test executions.
 */
export class EvidenceStore {
  private constructor(private readonly filePath: string, private readonly database: Database) {}

  /**
   * Opens or creates an Evidence database and applies its schema.
   * @param filePath Path to the SQLite database file.
   * @returns An initialized EvidenceStore instance.
   */
  static async open(filePath: string): Promise<EvidenceStore> {
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_execution_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('screenshot','video','log','network')),
        artifact_url TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        metadata TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_execution ON evidence(test_execution_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_type ON evidence(type);
    `);
    const store = new EvidenceStore(path.resolve(filePath), database);
    await store.persist();
    return store;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const bytes = this.database.export();
    const buffer = Buffer.from(bytes);
    await writeFile(this.filePath, buffer);
  }

  /**
   * Records a new evidence artifact.
   * @param evidence Evidence to record, without the id field.
   * @returns The auto-generated id of the inserted record.
   */
  async recordEvidence(evidence: Omit<Evidence, 'id'>): Promise<number> {
    this.database.run(
      `INSERT INTO evidence (test_execution_id, type, artifact_url, captured_at, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      [evidence.test_execution_id, evidence.type, evidence.artifact_url, evidence.captured_at, evidence.metadata]
    );
    const rows = this.database.exec('SELECT last_insert_rowid() as id');
    const result = rows[0]?.values[0]?.[0] as number | undefined;
    await this.persist();
    return result ?? 0;
  }

  /**
   * Retrieves all evidence for a specific test execution.
   * @param test_execution_id The test execution ID (Stage 2 ID from Golden Thread).
   * @returns Array of evidence records for that execution.
   */
  async getEvidenceForExecution(test_execution_id: string): Promise<Evidence[]> {
    const rows = this.database.exec(
      `SELECT id, test_execution_id, type, artifact_url, captured_at, metadata
       FROM evidence WHERE test_execution_id = ? ORDER BY captured_at ASC`,
      [test_execution_id]
    );
    return rows[0]?.values?.map(row => ({
      id: row[0] as number,
      test_execution_id: row[1] as string,
      type: row[2] as EvidenceType,
      artifact_url: row[3] as string,
      captured_at: row[4] as string,
      metadata: row[5] as string
    })) || [];
  }

  /**
   * Retrieves evidence by type, optionally filtered by test execution.
   * @param type The evidence type to filter by.
   * @param test_execution_id Optional: filter to a specific test execution.
   * @returns Array of matching evidence records.
   */
  async getEvidenceByType(type: EvidenceType, test_execution_id?: string): Promise<Evidence[]> {
    let query = `SELECT id, test_execution_id, type, artifact_url, captured_at, metadata
                 FROM evidence WHERE type = ?`;
    const params: string[] = [type];

    if (test_execution_id) {
      query += ' AND test_execution_id = ?';
      params.push(test_execution_id);
    }

    query += ' ORDER BY captured_at DESC';

    const rows = this.database.exec(query, params);
    return rows[0]?.values?.map(row => ({
      id: row[0] as number,
      test_execution_id: row[1] as string,
      type: row[2] as EvidenceType,
      artifact_url: row[3] as string,
      captured_at: row[4] as string,
      metadata: row[5] as string
    })) || [];
  }

  /**
   * Deletes evidence records older than a specified number of days.
   * Used for storage cleanup of old test artifacts.
   * @param days Number of days to retain (deletes older than this).
   * @returns Number of deleted records.
   */
  async deleteEvidenceOlderThan(days: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const isoString = cutoff.toISOString();

    this.database.run(
      'DELETE FROM evidence WHERE captured_at < ?',
      [isoString]
    );

    const rows = this.database.exec('SELECT changes() as count');
    const count = rows[0]?.values[0]?.[0] as number | undefined;
    await this.persist();
    return count ?? 0;
  }
}
