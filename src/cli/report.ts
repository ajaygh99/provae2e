import { writeFile } from 'node:fs/promises';
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
  if (!opts.analytics) throw new Error('Use --analytics to select the analytics report');
  if (!['html', 'json'].includes(opts.format)) throw new Error('--format must be html or json');
  const store = createAnalyticsStore(opts.database);
  try {
    await store.initialize();
    const reporter = new AnalyticsReporter(store);
    const content = opts.format === 'json'
      ? await reporter.renderJSON(parseDays(opts.days)) : await reporter.renderHTML(parseDays(opts.days));
    if (opts.output) { await writeFile(opts.output, content, 'utf-8'); log.success('Analytics report written', { output: opts.output }); }
    else process.stdout.write(content);
  } finally { await store.close(); }
}
