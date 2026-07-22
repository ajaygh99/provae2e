/** Datadog connector for fetching production logs. */
import axios, { type AxiosInstance } from 'axios';
import { type LogEntry } from './production-logs-model.js';

/** Options for Datadog connector initialization. */
export interface DatadogConnectorOptions {
  apiKey: string;
  appKey?: string;
  baseUrl?: string;
}

/**
 * Connects to Datadog API to fetch production logs.
 * Queries logs by deployment version tag and converts to LogEntry format.
 */
export class DatadogConnector {
  private readonly client: AxiosInstance;
  private readonly appKey: string;

  constructor(opts: DatadogConnectorOptions) {
    const baseUrl = opts.baseUrl || 'https://api.datadoghq.com';
    this.appKey = opts.appKey || '';
    const headers: Record<string, string> = { 'DD-API-KEY': opts.apiKey };
    if (this.appKey) {
      headers['DD-APPLICATION-KEY'] = this.appKey;
    }
    this.client = axios.create({
      baseURL: baseUrl,
      headers,
      timeout: 30000
    });
  }

  /**
   * Queries logs by deployment SHA using Datadog's query syntax.
   * @param deploymentSha Git commit SHA
   * @param service Service name for filtering
   * @param environment Environment name (e.g., production)
   * @returns Array of log entries
   * @throws Error if API call fails
   */
  async queryByDeploymentSha(
    deploymentSha: string,
    service: string,
    environment: string
  ): Promise<LogEntry[]> {
    const query = `service:${service} env:${environment} deployed_commit_sha:${deploymentSha}`;
    return this.queryLogs(query);
  }

  /**
   * Queries logs using Datadog query syntax.
   * @param query Datadog query string
   * @returns Array of log entries
   * @throws Error if API call fails
   */
  async queryLogs(query: string): Promise<LogEntry[]> {
    try {
      const response = await this.client.get<{ logs: DatadogLogResponse[] }>('/api/v2/logs-queries/list', {
        params: {
          query,
          sort: 'timestamp',
          page: { limit: 1000 }
        }
      });

      return (response.data.logs || []).map(log => ({
        source: 'datadog',
        level: this.parseLogLevel(log.attributes?.status),
        message: log.attributes?.message || '',
        timestamp: log.attributes?.timestamp || new Date().toISOString(),
        tags: this.extractTags(log.attributes?.tags || []),
        deployment_sha: log.attributes?.deployment_sha || ''
      }));
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? `Datadog API error: ${error.response?.status} ${error.response?.data?.['error']}`
        : String(error);
      throw new Error(`Failed to query Datadog logs: ${message}`);
    }
  }

  private parseLogLevel(status?: string): 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG' {
    if (!status) return 'INFO';
    const upper = status.toUpperCase();
    if (upper === 'ERROR' || upper === 'CRITICAL' || upper === 'EMERGENCY') return 'ERROR';
    if (upper === 'WARNING' || upper === 'ALERT') return 'WARNING';
    if (upper === 'DEBUG') return 'DEBUG';
    return 'INFO';
  }

  private extractTags(tags: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const tag of tags) {
      const [key, value] = tag.split(':');
      if (key && value) result[key] = value;
    }
    return result;
  }
}

/** Datadog API log response format. */
interface DatadogLogResponse {
  attributes?: {
    status?: string;
    message?: string;
    timestamp?: string;
    tags?: string[];
    deployment_sha?: string;
  };
}
