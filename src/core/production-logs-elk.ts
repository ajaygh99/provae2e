/** Elasticsearch connector for fetching production logs. */
import axios, { type AxiosInstance } from 'axios';
import { type LogEntry } from './production-logs-model.js';

/** Options for Elasticsearch connector initialization. */
export interface ElasticsearchConnectorOptions {
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

/**
 * Connects to Elasticsearch/ELK to fetch production logs.
 * Queries logs from indices filtered by deployment version using Query DSL.
 */
export class ElasticsearchConnector {
  private readonly client: AxiosInstance;

  constructor(opts: ElasticsearchConnectorOptions) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (opts.username && opts.password) {
      const auth = Buffer.from(`${opts.username}:${opts.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    } else if (opts.apiKey) {
      headers['Authorization'] = `ApiKey ${opts.apiKey}`;
    }

    this.client = axios.create({
      baseURL: opts.url,
      timeout: 30000,
      headers
    });
  }

  /**
   * Queries logs from Elasticsearch indices filtered by deployment SHA.
   * @param indexPattern Index pattern (e.g., "logs-*" or "logs-production-*")
   * @param deploymentSha Git commit SHA
   * @returns Array of log entries
   * @throws Error if query fails
   */
  async queryLogs(indexPattern: string, deploymentSha: string): Promise<LogEntry[]> {
    try {
      const query = {
        query: {
          bool: {
            must: [
              { match: { deployment_sha: deploymentSha } }
            ]
          }
        },
        size: 1000,
        sort: [{ timestamp: { order: 'desc' } }]
      };

      const response = await this.client.post<{ hits: { hits: ElasticsearchHit[] } }>(
        `/${indexPattern}/_search`,
        query
      );

      return (response.data.hits?.hits || []).map(hit => ({
        source: 'elk',
        level: this.parseLogLevel(hit._source?.level),
        message: hit._source?.message || '',
        timestamp: hit._source?.timestamp || new Date().toISOString(),
        tags: {
          index: hit._index || indexPattern,
          docId: hit._id || '',
          ...this.extractTags(hit._source?.tags || {})
        },
        deployment_sha: deploymentSha
      }));
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? `Elasticsearch error: ${error.response?.status} ${JSON.stringify(error.response?.data)}`
        : String(error);
      throw new Error(`Failed to query Elasticsearch logs: ${message}`);
    }
  }

  private parseLogLevel(level?: string): 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG' {
    if (!level) return 'INFO';
    const upper = level.toUpperCase();
    if (upper === 'ERROR' || upper === 'CRITICAL' || upper === 'FATAL') return 'ERROR';
    if (upper === 'WARNING' || upper === 'WARN') return 'WARNING';
    if (upper === 'DEBUG') return 'DEBUG';
    return 'INFO';
  }

  private extractTags(tags: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(tags)) {
      if (value !== null && value !== undefined) {
        result[key] = String(value);
      }
    }
    return result;
  }
}

/** Elasticsearch search hit format. */
interface ElasticsearchHit {
  _id: string;
  _index: string;
  _source?: {
    level?: string;
    message?: string;
    timestamp?: string;
    deployment_sha?: string;
    tags?: Record<string, unknown>;
  };
}
