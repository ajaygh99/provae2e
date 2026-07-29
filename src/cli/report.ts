import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from '../core/logger.js';
import { AnalyticsReporter } from '../reporters/analytics-reporter.js';
import { PostgresAnalyticsStore } from '../storage/postgres-analytics-store.js';
import { SQLiteAnalyticsStore } from '../storage/sqlite-analytics-store.js';
import type { AnalyticsStore } from '../storage/analytics-store.js';

export interface AnalyticsReportOptions {
  analytics: boolean;
  days: string;
  database: string;
  output?: string;
  format: string;
}

export function createAnalyticsStore(database = '.prova/analytics.db'): AnalyticsStore {
  const connection = process.env['DATABASE_URL'];
  return connection ? new PostgresAnalyticsStore(connection) : new SQLiteAnalyticsStore(database);
}

function parseDays(value: string): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('--days must be an integer from 1 to 3650');
  return days;
}

export async function analyticsReportCommand(opts: AnalyticsReportOptions): Promise<void> {
  let store: AnalyticsStore | undefined;
  try {
    if (!opts.analytics) throw new Error('Use --analytics to select the analytics report');
    if (!['html', 'json'].includes(opts.format)) throw new Error('--format must be html or json');
    const days = parseDays(opts.days);
    if (opts.output !== undefined && !opts.output.trim()) throw new Error('--output must not be empty');
    store = createAnalyticsStore(opts.database);
    await store.initialize();
    const reporter = new AnalyticsReporter(store);
    const content = opts.format === 'json'
      ? `${await reporter.renderJSON(days)}\n` : await reporter.renderHTML(days);
    if (opts.output) {
      const outputPath = path.resolve(opts.output);
      await writeAnalyticsReport(outputPath, content);
      log.success('Analytics report written', { output: outputPath });
    } else {
      process.stdout.write(content);
    }
  } catch (error) {
    log.error(`Analytics report failed: ${redactAnalyticsError(error)}`);
    process.exitCode = 1;
  } finally {
    if (store) {
      try {
        await store.close();
      } catch (error) {
        log.error(`Analytics store close failed: ${redactAnalyticsError(error)}`);
        process.exitCode = 1;
      }
    }
  }
}

/** Atomically replaces a report without exposing a partially written artifact. */
export async function writeAnalyticsReport(outputPath: string, content: string): Promise<void> {
  const absolutePath = path.resolve(outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export function redactAnalyticsError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/((?:password|token|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
