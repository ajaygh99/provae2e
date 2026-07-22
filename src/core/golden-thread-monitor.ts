/** Golden Thread Monitor (Stage 6) - Production logs integration. */
import { GoldenThreadLinker } from './golden-thread-linker.js';
import { ProductionLogsStore } from './production-logs-store.js';
import { type LogEntry } from './production-logs-model.js';
import { DatadogConnector } from './production-logs-datadog.js';
import { CloudWatchConnector } from './production-logs-cloudwatch.js';
import { ElasticsearchConnector } from './production-logs-elk.js';

/** Options for linking Monitor (Stage 6) to a chain. */
export interface MonitorStageOptions {
  golden_thread_id: string;
  deployment_sha: string;
  environment: string;
  service_name: string;
  golden_thread_linker: GoldenThreadLinker;
  logs_store: ProductionLogsStore;

  datadog?: { apiKey: string; appKey?: string; baseUrl?: string };
  cloudwatch?: { region: string; accessKeyId?: string; secretAccessKey?: string };
  elasticsearch?: { url: string; username?: string; password?: string; apiKey?: string };
}

/**
 * Links production logs to a Golden Thread chain at Stage 6 (Monitor).
 * Ingests logs from configured sources and creates a summary in the stage metadata.
 * @param opts Options including deployment SHA and connector configs
 * @throws Error if chain not found or log ingestion fails
 */
export async function linkMonitorStage(opts: MonitorStageOptions): Promise<void> {
  const {
    golden_thread_id,
    deployment_sha,
    environment,
    service_name,
    golden_thread_linker,
    logs_store
  } = opts;

  const allLogs: LogEntry[] = [];

  if (opts.datadog) {
    const connector = new DatadogConnector(opts.datadog);
    const logs = await connector.queryByDeploymentSha(deployment_sha, service_name, environment);
    allLogs.push(...logs);
  }

  if (opts.cloudwatch) {
    const connector = new CloudWatchConnector(opts.cloudwatch);
    const logGroupName = `/aws/${service_name}/${environment}`;
    const logs = await connector.queryLogs(logGroupName, deployment_sha);
    allLogs.push(...logs);
  }

  if (opts.elasticsearch) {
    const connector = new ElasticsearchConnector(opts.elasticsearch);
    const indexPattern = `logs-${service_name}-${environment}-*`;
    const logs = await connector.queryLogs(indexPattern, deployment_sha);
    allLogs.push(...logs);
  }

  const stats = await logs_store.ingestLogs(allLogs, deployment_sha);
  const summary = await logs_store.getSummary(deployment_sha);

  const artifact_url = `https://dashboard.example.com/logs/${deployment_sha}?env=${environment}&service=${service_name}`;

  await golden_thread_linker.linkStage({
    golden_thread_id,
    stage: 6,
    status: 'PASSED',
    actor: 'monitor-connector',
    artifact_url,
    metadata: {
      environment,
      service_name,
      stage_name: 'Monitor',
      deployment_sha,
      log_count: summary.ERROR + summary.WARNING + summary.INFO + summary.DEBUG,
      error_count: summary.ERROR,
      warning_count: summary.WARNING,
      info_count: summary.INFO,
      debug_count: summary.DEBUG,
      sample_rate_applied: stats.sample_rate_applied,
      sources: [
        ...(opts.datadog ? ['datadog'] : []),
        ...(opts.cloudwatch ? ['cloudwatch'] : []),
        ...(opts.elasticsearch ? ['elk'] : [])
      ]
    }
  });
}
