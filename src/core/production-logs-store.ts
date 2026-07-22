/** SQLite-backed store for production logs linked to deployments. */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type LogEntry, type LogQueryFilter, type LogLevel, type LogIngestionStats } from './production-logs-model.js';

let sqlitePromise: Promise<SqlJsStatic> | undefined;

function sqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  return sqlitePromise;
}

/**
 * SQLite-backed repository for production log entries.
 * Supports sampling to keep disk usage manageable (100% error/warning, 10% info, 0% debug).
 */
export class ProductionLogsStore {
  private constructor(private readonly filePath: string, private readonly database: Database) {}

  /** Opens or creates a production logs database and applies its schema. */
  static async open(filePath: string): Promise<ProductionLogsStore> {
    const SQL = await sqlite();
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(filePath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database();
    database.run(`
      CREATE TABLE IF NOT EXISTS production_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL CHECK(source IN ('datadog','cloudwatch','elk')),
        level TEXT NOT NULL CHECK(level IN ('ERROR','WARNING','INFO','DEBUG')),
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tags TEXT NOT NULL,
        deployment_sha TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(source, timestamp, message, deployment_sha)
      );
      CREATE INDEX IF NOT EXISTS idx_deployment_sha ON production_logs(deployment_sha);
      CREATE INDEX IF NOT EXISTS idx_level ON production_logs(level);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON production_logs(timestamp);
    `);
    const store = new ProductionLogsStore(path.resolve(filePath), database);
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
   * Ingests log entries with sampling to manage disk space.
   * Sampling: 100% ERROR/WARNING, 10% INFO, 0% DEBUG.
   */
  async ingestLogs(entries: LogEntry[], deploymentSha: string): Promise<LogIngestionStats> {
    const now = new Date().toISOString();
    const stats: LogIngestionStats = {
      total_ingested: 0,
      errors_stored: 0,
      warnings_stored: 0,
      info_stored: 0,
      debug_stored: 0,
      sample_rate_applied: false
    };

    for (const entry of entries) {
      if (entry.deployment_sha !== deploymentSha) continue;

      let shouldStore = false;
      if (entry.level === 'ERROR') {
        shouldStore = true;
        stats.errors_stored++;
      } else if (entry.level === 'WARNING') {
        shouldStore = true;
        stats.warnings_stored++;
      } else if (entry.level === 'INFO') {
        shouldStore = Math.random() < 0.1;
        if (shouldStore) {
          stats.info_stored++;
          stats.sample_rate_applied = true;
        }
      } else if (entry.level === 'DEBUG') {
        shouldStore = false;
      }

      if (shouldStore) {
        try {
          this.database.run(
            `INSERT INTO production_logs
             (source, level, message, timestamp, tags, deployment_sha, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.source,
              entry.level,
              entry.message,
              entry.timestamp,
              JSON.stringify(entry.tags || {}),
              deploymentSha,
              now
            ]
          );
        } catch (error) {
          if (!String(error).includes('UNIQUE constraint failed')) throw error;
        }
        stats.total_ingested++;
      }
    }

    await this.persist();
    return stats;
  }

  /**
   * Queries logs by deployment SHA with optional filtering.
   * @param filter Query filter criteria
   * @returns Matching log entries
   */
  async queryLogs(filter: LogQueryFilter): Promise<LogEntry[]> {
    let query = 'SELECT * FROM production_logs WHERE deployment_sha = ?';
    const params: (string | number | null)[] = [filter.deployment_sha];

    if (filter.level) {
      const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
      const placeholders = levels.map(() => '?').join(',');
      query += ` AND level IN (${placeholders})`;
      params.push(...levels);
    }

    if (filter.source) {
      query += ' AND source = ?';
      params.push(filter.source);
    }

    if (filter.startTime) {
      query += ' AND timestamp >= ?';
      params.push(filter.startTime);
    }

    if (filter.endTime) {
      query += ' AND timestamp <= ?';
      params.push(filter.endTime);
    }

    query += ' ORDER BY timestamp DESC';

    if (filter.limit) {
      query += ` LIMIT ${filter.limit}`;
    }

    const rows = this.database.exec(query, params);
    return rows[0]?.values?.map(row => ({
      id: row[0] as number,
      source: row[1] as 'datadog' | 'cloudwatch' | 'elk',
      level: row[2] as LogLevel,
      message: row[3] as string,
      timestamp: row[4] as string,
      tags: JSON.parse(row[5] as string),
      deployment_sha: row[6] as string
    })) || [];
  }

  /**
   * Deletes logs older than the specified number of days (rolling window).
   * @param days Number of days to keep (default: 30)
   */
  async cleanupOldLogs(days: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffIso = cutoffDate.toISOString();

    const countBefore = this.database.exec(
      'SELECT COUNT(*) FROM production_logs WHERE timestamp < ?',
      [cutoffIso]
    );
    const beforeCount = (countBefore[0]?.values?.[0]?.[0] as number) || 0;

    this.database.run(
      'DELETE FROM production_logs WHERE timestamp < ?',
      [cutoffIso]
    );

    await this.persist();

    return beforeCount;
  }

  /**
   * Gets summary statistics for logs in a deployment.
   * @param deploymentSha Deployment SHA to summarize
   * @returns Count of each log level
   */
  async getSummary(deploymentSha: string): Promise<Record<LogLevel, number>> {
    const rows = this.database.exec(
      `SELECT level, COUNT(*) as count FROM production_logs
       WHERE deployment_sha = ? GROUP BY level`,
      [deploymentSha]
    );

    const summary: Record<LogLevel, number> = { ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };
    rows[0]?.values?.forEach(row => {
      const level = row[0] as LogLevel;
      const count = row[1] as number;
      summary[level] = count;
    });

    return summary;
  }

  /**
   * Lists all unique deployment SHAs in the database.
   * @returns Array of deployment SHAs
   */
  async listDeployments(): Promise<string[]> {
    const rows = this.database.exec(
      'SELECT DISTINCT deployment_sha FROM production_logs ORDER BY deployment_sha DESC'
    );
    return rows[0]?.values?.map(row => row[0] as string) || [];
  }
}
