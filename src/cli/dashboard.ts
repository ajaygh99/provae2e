/** Dashboard command for Golden Thread visualization and reporting. */
import { GoldenThreadStore } from '../core/golden-thread-store.js';
import { log } from '../core/logger.js';
import { generateDashboardHtml } from '../reporters/dashboard-generator.js';
import { getMetricsSummary } from '../reporters/dashboard-metrics.js';
import { filterChains } from '../reporters/dashboard-aggregator.js';
import { generatePdfReportHtml } from '../reporters/dashboard-pdf-export.js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DashboardFilter } from '../core/dashboard-types.js';

export interface DashboardOptions {
  database?: string;
  output?: string;
  pdf?: string;
  darkMode?: boolean;
  dateStart?: string;
  dateEnd?: string;
  environment?: string;
  team?: string;
  project?: string;
}

/**
 * Executes the dashboard command.
 * Generates interactive HTML dashboard and optional PDF report.
 * @param opts Command options
 */
export async function dashboardCommand(opts: DashboardOptions): Promise<void> {
  const dbPath = opts.database ?? './prova-golden-thread.sqlite';

  try {
    const store = await GoldenThreadStore.open(dbPath);
    const chainIds = await store.listChains();

    if (chainIds.length === 0) {
      log.info('No chains found in database. Generating an empty-state dashboard.');
    }

    const chains = await Promise.all(
      chainIds.map(async (id) => {
        const chain = await store.getChain(id);
        return chain!;
      })
    );

    const filters = buildFilters(opts);
    const filteredChains = filterChains(chains, filters);

    if (filteredChains.length === 0 && filters) {
      log.info('No chains match the specified filters.');
      return;
    }

    const metrics = getMetricsSummary(filteredChains);
    const dashboardHtml = generateDashboardHtml(filteredChains, metrics, { darkMode: opts.darkMode });

    const outputPath = opts.output ?? './prova-dashboard.html';
    await ensureDirectory(path.dirname(outputPath));
    await writeFile(outputPath, dashboardHtml, 'utf-8');
    log.success(`Dashboard generated: ${outputPath}`);

    if (opts.pdf && filteredChains.length > 0) {
      const pdfChain = filteredChains[0];
      const pdfHtml = generatePdfReportHtml(pdfChain);
      const pdfPath = opts.pdf;
      await ensureDirectory(path.dirname(pdfPath));
      await writeFile(pdfPath.replace(/\.pdf$/, '.html'), pdfHtml, 'utf-8');
      log.info(`PDF report HTML generated (use Playwright to convert to PDF): ${pdfPath.replace(/\.pdf$/, '.html')}`);
    }

    log.success('Dashboard command complete', {
      totalChains: filteredChains.length,
      passRate: `${metrics.overallPassRate.toFixed(1)}%`,
      avgDuration: `${(metrics.avgChainDuration / 1000).toFixed(1)}s`
    });
  } catch (error) {
    log.error(`Dashboard generation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function buildFilters(opts: DashboardOptions): DashboardFilter | undefined {
  if (!opts.dateStart && !opts.dateEnd && !opts.environment && !opts.team && !opts.project) {
    return undefined;
  }

  const filters: DashboardFilter = {};

  if (opts.dateStart) {
    filters.dateStart = new Date(opts.dateStart);
    if (Number.isNaN(filters.dateStart.getTime())) {
      log.warn(`Invalid date-start: ${opts.dateStart}`);
      delete filters.dateStart;
    }
  }

  if (opts.dateEnd) {
    filters.dateEnd = new Date(opts.dateEnd);
    if (Number.isNaN(filters.dateEnd.getTime())) {
      log.warn(`Invalid date-end: ${opts.dateEnd}`);
      delete filters.dateEnd;
    }
  }

  if (opts.environment) filters.environment = opts.environment;
  if (opts.team) filters.team = opts.team;
  if (opts.project) filters.project = opts.project;

  return Object.keys(filters).length > 0 ? filters : undefined;
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}
