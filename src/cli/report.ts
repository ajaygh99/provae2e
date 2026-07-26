import { writeFile } from 'node:fs/promises';
import { log } from '../core/logger.js';
import { AnalyticsReporter } from '../reporters/analytics-reporter.js';
import { PowerBIExporter } from '../exporters/powerbi-exporter.js';
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

export interface AnalyticsExportOptions {
  analytics: boolean;
  days: string;
  database: string;
  format: string;
  workspaceId?: string;
  datasetId?: string;
  table?: string;
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

export async function analyticsExportCommand(opts: AnalyticsExportOptions): Promise<void> {
  if (!opts.analytics || opts.format !== 'powerbi') throw new Error('Use --analytics --format powerbi');
  const workspaceId = opts.workspaceId ?? process.env['POWERBI_WORKSPACE_ID'];
  const datasetId = opts.datasetId ?? process.env['POWERBI_DATASET_ID'];
  const accessToken = process.env['POWERBI_ACCESS_TOKEN'];
  if (!workspaceId || !datasetId || !accessToken) {
    throw new Error('Power BI requires workspace/dataset options and POWERBI_ACCESS_TOKEN');
  }
  const store = createAnalyticsStore(opts.database);
  try {
    await store.initialize();
    const result = await new PowerBIExporter(store, {
      workspaceId, datasetId, accessToken, ...(opts.table ? { tableName: opts.table } : {})
    }).export(parseDays(opts.days));
    log.success('Power BI analytics export complete', { rows: result.rows, endpoint: result.endpoint });
  } finally { await store.close(); }
}
