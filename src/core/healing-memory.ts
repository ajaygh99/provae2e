/** Local SQLite memory for explainable, token-free selector learning. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SelectorDescriptor, SelectorTier } from './self-healing-selector.js';

export interface HealingRecommendation {
  id: number;
  descriptor: SelectorDescriptor;
  tier: SelectorTier;
  confidence: number;
  successes: number;
  failures: number;
}

/** Persistent selector repair history. It stores descriptors, never DOM content. */
export class HealingMemoryStore {
  private database?: Database;
  private sql?: SqlJsStatic;

  constructor(private readonly filePath = '.prova/healing.db') {}

  /** Opens the local store and applies its idempotent schema. */
  async initialize(): Promise<void> {
    this.sql = await initSqlJs();
    this.database = existsSync(this.filePath)
      ? new this.sql.Database(await readFile(this.filePath))
      : new this.sql.Database();
    this.database.run(`CREATE TABLE IF NOT EXISTS selector_repairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_key TEXT NOT NULL,
      intent_key TEXT NOT NULL,
      descriptor_json TEXT NOT NULL,
      tier TEXT NOT NULL,
      successes INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(page_key, intent_key, descriptor_json, tier)
    );
    CREATE INDEX IF NOT EXISTS idx_selector_repairs_lookup
      ON selector_repairs(page_key, intent_key);`);
    await this.persist();
  }

  /** Returns the strongest previously proven selector strategy above a threshold. */
  recommend(pageKey: string, intentKey: string, minimumConfidence = 0.8): HealingRecommendation | undefined {
    const statement = this.db().prepare(`SELECT * FROM selector_repairs
      WHERE page_key=? AND intent_key=?
      ORDER BY ((successes + 1.0) / (successes + failures + 2.0)) DESC, successes DESC LIMIT 1`,
    [pageKey, intentKey]);
    try {
      if (!statement.step()) return undefined;
      const row = statement.getAsObject();
      const successes = Number(row['successes']);
      const failures = Number(row['failures']);
      const confidence = (successes + 1) / (successes + failures + 2);
      if (confidence < minimumConfidence) return undefined;
      return {
        id: Number(row['id']),
        descriptor: JSON.parse(String(row['descriptor_json'])) as SelectorDescriptor,
        tier: String(row['tier']) as SelectorTier,
        confidence,
        successes,
        failures
      };
    } finally {
      statement.free();
    }
  }

  /** Records a successful strategy and persists it for later runs. */
  async recordSuccess(pageKey: string, intentKey: string, descriptor: SelectorDescriptor, tier: SelectorTier): Promise<void> {
    const json = JSON.stringify(descriptor);
    this.db().run(`INSERT INTO selector_repairs
      (page_key,intent_key,descriptor_json,tier,successes,failures,updated_at)
      VALUES (?,?,?,?,1,0,?)
      ON CONFLICT(page_key,intent_key,descriptor_json,tier) DO UPDATE SET
      successes=successes+1, updated_at=excluded.updated_at`,
    [pageKey, intentKey, json, tier, new Date().toISOString()]);
    await this.persist();
  }

  /** Reduces confidence after a remembered strategy fails. */
  async recordFailure(id: number): Promise<void> {
    this.db().run('UPDATE selector_repairs SET failures=failures+1, updated_at=? WHERE id=?',
      [new Date().toISOString(), id]);
    await this.persist();
  }

  /** Closes the in-memory SQLite handle. */
  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  private db(): Database {
    if (!this.database) throw new Error('Healing memory is not initialized');
    return this.database;
  }

  private async persist(): Promise<void> {
    if (!this.database) return;
    await mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
    await writeFile(this.filePath, Buffer.from(this.database.export()));
  }
}
