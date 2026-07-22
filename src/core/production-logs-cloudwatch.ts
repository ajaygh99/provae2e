/** CloudWatch Logs connector for fetching production logs. */
import axios, { type AxiosInstance } from 'axios';
import { type LogEntry } from './production-logs-model.js';

/** Options for CloudWatch connector initialization. */
export interface CloudWatchConnectorOptions {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
}

/**
 * Connects to AWS CloudWatch Logs API to fetch production logs.
 * Queries logs from log groups filtered by deployment version.
 */
export class CloudWatchConnector {
  private readonly client: AxiosInstance;
  private readonly region: string;

  constructor(opts: CloudWatchConnectorOptions) {
    this.region = opts.region || 'us-east-1';
    const endpoint = opts.endpoint || `https://logs.${this.region}.amazonaws.com`;
    const headers: Record<string, string> = {};

    if (opts.accessKeyId) {
      headers['X-Amz-Access-Key'] = opts.accessKeyId;
    }
    if (opts.secretAccessKey) {
      headers['X-Amz-Secret-Key'] = opts.secretAccessKey;
    }

    this.client = axios.create({
      baseURL: endpoint,
      timeout: 30000,
      headers
    });
  }

  /**
   * Queries logs from a CloudWatch log group filtered by deployment SHA.
   * @param logGroupName CloudWatch log group name
   * @param deploymentSha Git commit SHA
   * @returns Array of log entries
   * @throws Error if API call fails
   */
  async queryLogs(logGroupName: string, deploymentSha: string): Promise<LogEntry[]> {
    try {
      const filterPattern = `[msg, deployment_sha="${deploymentSha}"]`;
      const response = await this.client.get<{ events: CloudWatchLogEvent[] }>(
        '/api/logs/filter',
        {
          params: {
            logGroupName,
            filterPattern,
            startTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).getTime(),
            endTime: Date.now(),
            limit: 1000
          }
        }
      );

      return (response.data.events || []).map(event => ({
        source: 'cloudwatch',
        level: this.parseLogLevel(event.level),
        message: event.message || '',
        timestamp: new Date(event.timestamp).toISOString(),
        tags: {
          logGroupName,
          logStreamName: event.logStreamName || '',
          deploymentSha
        },
        deployment_sha: deploymentSha
      }));
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? `CloudWatch API error: ${error.response?.status}`
        : String(error);
      throw new Error(`Failed to query CloudWatch logs: ${message}`);
    }
  }

  private parseLogLevel(level?: string): 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG' {
    if (!level) return 'INFO';
    const upper = level.toUpperCase();
    if (upper === 'ERROR' || upper === 'CRITICAL') return 'ERROR';
    if (upper === 'WARNING' || upper === 'WARN') return 'WARNING';
    if (upper === 'DEBUG') return 'DEBUG';
    return 'INFO';
  }
}

/** CloudWatch Logs API event format. */
interface CloudWatchLogEvent {
  message?: string;
  timestamp: number;
  level?: string;
  logStreamName?: string;
}
