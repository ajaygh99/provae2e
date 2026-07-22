/** Datadog integration for Golden Thread Monitor/Debug stages. */
import { GoldenThreadLinker } from './golden-thread-linker.js';

/** Options for linking Datadog logs/traces to a chain. */
export interface DatadogStageOptions {
  golden_thread_id: string;
  stage: 6 | 7; // Monitor (6) or Debug (7)
  environment: string;
  service_name: string;
  golden_thread_linker: GoldenThreadLinker;
}

/**
 * Links Datadog logs or traces to a Golden Thread chain.
 * @param opts Options including environment and service
 * @note Phase 4: Implement full Datadog API integration for logs, metrics, and traces
 */
export async function linkDatadogStage(opts: DatadogStageOptions): Promise<void> {
  const { golden_thread_id, stage, environment, service_name, golden_thread_linker } = opts;

  const datadogBaseUrl = 'https://app.datadoghq.com';
  const stageName = stage === 6 ? 'Monitor' : 'Debug';
  const artifact_url = `${datadogBaseUrl}/logs?query=service:${service_name}%20env:${environment}`;

  await golden_thread_linker.linkStage({
    golden_thread_id,
    stage,
    status: 'PASSED',
    actor: 'datadog-connector',
    artifact_url,
    metadata: {
      environment,
      service_name,
      stage_name: stageName,
      note: 'Phase 4: Full Datadog API integration pending'
    }
  });
}
