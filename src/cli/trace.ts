#!/usr/bin/env node
/**
 * qe-tool trace — Query and export Golden Thread traceability data
 */
import { log } from '../core/logger.js';
import { GoldenThreadStore } from '../core/golden-thread-store.js';
import { TraceQueryEngine, type SLAThreshold } from '../queries/trace-query.js';
import { exportChainToPDF } from '../exporters/pdf-exporter.js';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

/**
 * Options for the trace command.
 */
export interface TraceOptions {
  issueKey?: string;
  commit?: string;
  testId?: string;
  database?: string;
  format?: string;
  output?: string;
  from?: string;
  to?: string;
  sla?: boolean;
  maxStageDurationMs?: number;
  maxTotalDurationMs?: number;
}

/**
 * Main trace command handler.
 */
export async function traceCommand(opts: TraceOptions): Promise<void> {
  try {
    // Validate database path
    const dbPath = opts.database || path.join(process.cwd(), '.prova', 'golden-thread.db');

    // Open store
    let store: GoldenThreadStore;
    try {
      store = await GoldenThreadStore.open(dbPath);
    } catch {
      log.error(`Failed to open Golden Thread database: ${dbPath}`);
      process.exitCode = 1;
      return;
    }

    const engine = new TraceQueryEngine(store);

    // Route to appropriate query
    if (opts.issueKey) {
      await handleQueryByIssueKey(engine, opts);
    } else if (opts.commit) {
      await handleQueryByCommit(engine, opts);
    } else if (opts.testId) {
      await handleQueryByTestId(engine, opts);
    } else if (opts.from && opts.to) {
      await handleQueryByDateRange(engine, opts);
    } else if (opts.sla) {
      await handleVerifySLA(engine, opts);
    } else {
      log.error('Choose one: --issue-key, --commit, --test-id, (--from --to), or --sla');
      log.info('Usage: qe-tool trace --issue-key PROJ-123');
      log.info('       qe-tool trace --commit <SHA>');
      log.info('       qe-tool trace --test-id <UUID>');
      log.info('       qe-tool trace export --format pdf --from YYYY-MM-DD --to YYYY-MM-DD');
      log.info('       qe-tool trace verify --sla');
      process.exitCode = 1;
    }
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

/**
 * Handle: qe-tool trace --issue-key PROJ-123
 */
async function handleQueryByIssueKey(engine: TraceQueryEngine, opts: TraceOptions): Promise<void> {
  if (!opts.issueKey) return;

  const result = await engine.queryByIssueKey(opts.issueKey);

  if (result.errors.length > 0) {
    result.errors.forEach(err => log.warn(err));
  }

  if (result.chains.length === 0) {
    log.error(`No chains found for issue: ${opts.issueKey}`);
    process.exitCode = 1;
    return;
  }

  // Display each chain
  for (const chain of result.chains) {
    log.success(engine.formatAsTable(chain));

    if (opts.format === 'json' || opts.output?.endsWith('.json')) {
      const json = engine.exportAsJson(chain);
      if (opts.output) {
        await writeFile(opts.output, JSON.stringify(json, null, 2));
        log.success(`Exported JSON to ${opts.output}`);
      } else {
        log.info(JSON.stringify(json, null, 2));
      }
    } else if (opts.format === 'pdf' || opts.output?.endsWith('.pdf')) {
      const pdfPath = opts.output || `./trace-${opts.issueKey}-${Date.now()}.pdf`;
      await exportChainToPDF(chain, pdfPath);
      log.success(`Exported PDF to ${pdfPath}`);
    }
  }

  process.exitCode = 0;
}

/**
 * Handle: qe-tool trace --commit <SHA>
 */
async function handleQueryByCommit(engine: TraceQueryEngine, opts: TraceOptions): Promise<void> {
  if (!opts.commit) return;

  const result = await engine.queryByCommit(opts.commit);

  if (result.errors.length > 0) {
    result.errors.forEach(err => log.warn(err));
  }

  if (result.chains.length === 0) {
    log.error(`No chains found for commit: ${opts.commit}`);
    process.exitCode = 1;
    return;
  }

  // Display each chain
  for (const chain of result.chains) {
    log.success(engine.formatAsTable(chain));

    if (opts.format === 'json' || opts.output?.endsWith('.json')) {
      const json = engine.exportAsJson(chain);
      if (opts.output) {
        await writeFile(opts.output, JSON.stringify(json, null, 2));
        log.success(`Exported JSON to ${opts.output}`);
      } else {
        log.info(JSON.stringify(json, null, 2));
      }
    } else if (opts.format === 'pdf' || opts.output?.endsWith('.pdf')) {
      const pdfPath = opts.output || `./trace-${opts.commit.slice(0, 7)}-${Date.now()}.pdf`;
      await exportChainToPDF(chain, pdfPath);
      log.success(`Exported PDF to ${pdfPath}`);
    }
  }

  process.exitCode = 0;
}

/**
 * Handle: qe-tool trace --test-id <UUID>
 */
async function handleQueryByTestId(engine: TraceQueryEngine, opts: TraceOptions): Promise<void> {
  if (!opts.testId) return;

  const result = await engine.queryByTestId(opts.testId);

  if (result.errors.length > 0) {
    result.errors.forEach(err => log.warn(err));
  }

  if (result.chains.length === 0) {
    log.error(`No chains found for test ID: ${opts.testId}`);
    process.exitCode = 1;
    return;
  }

  // Display each chain
  for (const chain of result.chains) {
    log.success(engine.formatAsTable(chain));

    if (opts.format === 'json' || opts.output?.endsWith('.json')) {
      const json = engine.exportAsJson(chain);
      if (opts.output) {
        await writeFile(opts.output, JSON.stringify(json, null, 2));
        log.success(`Exported JSON to ${opts.output}`);
      } else {
        log.info(JSON.stringify(json, null, 2));
      }
    } else if (opts.format === 'pdf' || opts.output?.endsWith('.pdf')) {
      const pdfPath = opts.output || `./trace-${opts.testId.slice(0, 8)}-${Date.now()}.pdf`;
      await exportChainToPDF(chain, pdfPath);
      log.success(`Exported PDF to ${pdfPath}`);
    }
  }

  process.exitCode = 0;
}

/**
 * Handle: qe-tool trace list --from DATE --to DATE
 */
async function handleQueryByDateRange(engine: TraceQueryEngine, opts: TraceOptions): Promise<void> {
  if (!opts.from || !opts.to) return;

  const result = await engine.queryByDateRange(opts.from, opts.to);

  if (result.errors.length > 0) {
    result.errors.forEach(err => log.error(err));
    process.exitCode = 1;
    return;
  }

  if (result.chains.length === 0) {
    log.warn(`No chains found between ${opts.from} and ${opts.to}`);
    process.exitCode = 0;
    return;
  }

  log.success(`Found ${result.chains.length} chains`);

  // Export based on format
  if (opts.format === 'json' || opts.output?.endsWith('.json')) {
    const exported = result.chains.map(c => engine.exportAsJson(c));
    const json = { count: exported.length, chains: exported };
    if (opts.output) {
      await writeFile(opts.output, JSON.stringify(json, null, 2));
      log.success(`Exported ${exported.length} chains to ${opts.output}`);
    } else {
      log.info(JSON.stringify(json, null, 2));
    }
  } else if (opts.format === 'csv' || opts.output?.endsWith('.csv')) {
    const csv = generateCSV(result.chains);
    if (opts.output) {
      await writeFile(opts.output, csv);
      log.success(`Exported ${result.chains.length} chains to ${opts.output}`);
    } else {
      log.info(csv);
    }
  } else {
    // Display tables
    result.chains.forEach(chain => {
      log.info(engine.formatAsTable(chain));
    });
  }

  process.exitCode = 0;
}

/**
 * Handle: qe-tool trace verify --sla
 */
async function handleVerifySLA(engine: TraceQueryEngine, opts: TraceOptions): Promise<void> {
  // Default SLA thresholds (configurable)
  const thresholds: SLAThreshold = {
    maxStageDurationMs: opts.maxStageDurationMs || 300000, // 5 min per stage
    maxTotalDurationMs: opts.maxTotalDurationMs || 1800000, // 30 min total
    deploymentStatus: 'YELLOW'
  };

  const allChainIds = await (
    await GoldenThreadStore.open(opts.database || path.join(process.cwd(), '.prova', 'golden-thread.db'))
  ).listChains();
  const store = await GoldenThreadStore.open(opts.database || path.join(process.cwd(), '.prova', 'golden-thread.db'));
  const allChains = [];

  for (const id of allChainIds) {
    const chain = await store.getChain(id);
    if (chain) allChains.push(chain);
  }

  if (allChains.length === 0) {
    log.warn('No chains to verify');
    process.exitCode = 0;
    return;
  }

  let passCount = 0;
  let failCount = 0;
  const failures: Array<{ chainId: string; breaches: string[] }> = [];

  for (const chain of allChains) {
    const result = engine.validateSLA(chain, thresholds);
    if (result.valid) {
      passCount++;
      log.success(`✓ ${chain.golden_thread_id}`);
    } else {
      failCount++;
      log.error(`✗ ${chain.golden_thread_id}`);
      result.breaches.forEach(b => log.error(`  - ${b}`));
      failures.push({ chainId: chain.golden_thread_id, breaches: result.breaches });
    }
  }

  log.info(`\nSLA Verification: ${passCount} passed, ${failCount} failed`);

  // Exit with code 2 if SLA breaches detected
  if (failCount > 0) {
    process.exitCode = 2;
  } else {
    process.exitCode = 0;
  }
}

/**
 * Generate CSV from chains.
 */
function generateCSV(chains: Array<{ golden_thread_id: string; created_at: string; stages: Array<{ timestamp: string; status: string; deployment_status?: string }> }>): string {
  const rows = [
    'ChainID,CreatedAt,StageCount,Status,DurationMs,DeploymentStatus'
  ];

  for (const chain of chains) {
    const firstStage = chain.stages[0];
    const lastStage = chain.stages[chain.stages.length - 1];
    const duration = firstStage && lastStage
      ? new Date(lastStage.timestamp).getTime() - new Date(firstStage.timestamp).getTime()
      : 0;
    const deploymentStatus = chain.stages.find(s => s.deployment_status)?.deployment_status || '—';

    rows.push([
      chain.golden_thread_id,
      chain.created_at,
      chain.stages.length,
      chain.stages.every((s: { status: string }) => s.status === 'PASSED') ? 'PASSED' : 'FAILED',
      duration,
      deploymentStatus
    ].join(','));
  }

  return rows.join('\n');
}
