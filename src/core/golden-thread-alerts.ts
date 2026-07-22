/** Golden Thread Alert Detection - Production vs Test mismatch detection. */
import { GoldenThreadLinker } from './golden-thread-linker.js';
import { ProductionLogsStore } from './production-logs-store.js';
import { type LogEntry } from './production-logs-model.js';

/** Alert for errors found in production logs but not in test evidence. */
export interface ProductionAlert {
  id: string;
  golden_thread_id: string;
  error_message: string;
  error_severity: 'ERROR' | 'WARNING';
  found_in_stage_6: boolean;
  found_in_stage_3: boolean;
  first_occurrence: string;
  last_occurrence: string;
  occurrence_count: number;
  recommendation: string;
}

/**
 * Detects discrepancies between test evidence (Stage 3) and production logs (Stage 6).
 * Identifies errors/warnings in production that weren't caught in testing.
 * @param golden_thread_id The chain ID to analyze
 * @param linker Golden Thread linker for accessing chain data
 * @param logs_store Production logs store for querying logs
 * @returns Array of alerts for unseen errors
 */
export async function detectUnseenErrors(
  golden_thread_id: string,
  linker: GoldenThreadLinker,
  logs_store: ProductionLogsStore
): Promise<ProductionAlert[]> {
  const chain = await linker.getChain(golden_thread_id);
  if (!chain) throw new Error(`Chain ${golden_thread_id} not found`);

  const stage3 = chain.stages.find(s => s.stage === 3);
  const stage6 = chain.stages.find(s => s.stage === 6);

  if (!stage6) return [];

  const alerts: ProductionAlert[] = [];

  let stage6Metadata: Record<string, unknown> = {};
  if (stage6.metadata) {
    try {
      stage6Metadata = JSON.parse(stage6.metadata) as Record<string, unknown>;
    } catch {
      // Metadata parsing failed, continue with empty object
    }
  }

  const deploymentSha = stage6Metadata.deployment_sha as string | undefined;
  if (!deploymentSha) return [];

  const errorLogs = await logs_store.queryLogs({
    deployment_sha: deploymentSha,
    level: ['ERROR', 'WARNING']
  });

  if (!errorLogs.length) return [];

  let stage3Evidence: Record<string, boolean> = {};
  if (stage3 && stage3.metadata) {
    try {
      const stage3Metadata = JSON.parse(stage3.metadata) as Record<string, unknown>;
      const errors = (stage3Metadata.errors || []) as string[];
      stage3Evidence = Object.fromEntries(errors.map((e: string) => [e.toLowerCase(), true]));
    } catch {
      // Stage 3 parsing failed, treat as no evidence
    }
  }

  const groupedByMessage = new Map<string, LogEntry[]>();
  for (const log of errorLogs) {
    const key = log.message.toLowerCase();
    if (!groupedByMessage.has(key)) {
      groupedByMessage.set(key, []);
    }
    groupedByMessage.get(key)!.push(log);
  }

  let alertId = 1;
  for (const [messageKey, logs] of groupedByMessage.entries()) {
    const isInEvidence = stage3Evidence[messageKey];

    if (!isInEvidence && logs.length > 0) {
      const timestamps = logs.map(l => new Date(l.timestamp).getTime()).sort();
      const firstTime = new Date(timestamps[0]).toISOString();
      const lastTime = new Date(timestamps[timestamps.length - 1]).toISOString();
      const severity = logs[0].level === 'ERROR' || logs[0].level === 'WARNING' ? logs[0].level : 'ERROR';

      alerts.push({
        id: `${golden_thread_id}-alert-${alertId++}`,
        golden_thread_id,
        error_message: logs[0].message,
        error_severity: severity,
        found_in_stage_6: true,
        found_in_stage_3: false,
        first_occurrence: firstTime,
        last_occurrence: lastTime,
        occurrence_count: logs.length,
        recommendation: `Add test case to cover: "${logs[0].message}". This error occurred ${logs.length} times in production but was not detected during testing.`
      });
    }
  }

  return alerts;
}

/**
 * Generates a summary of alert health for a chain.
 * @param alerts Array of production alerts
 * @returns Summary with total count and severity breakdown
 */
export function summarizeAlerts(alerts: ProductionAlert[]): {
  total: number;
  errors: number;
  warnings: number;
  avgOccurrencesPerAlert: number;
} {
  return {
    total: alerts.length,
    errors: alerts.filter(a => a.error_severity === 'ERROR').length,
    warnings: alerts.filter(a => a.error_severity === 'WARNING').length,
    avgOccurrencesPerAlert: alerts.length ? Math.round(alerts.reduce((sum, a) => sum + a.occurrence_count, 0) / alerts.length) : 0
  };
}
