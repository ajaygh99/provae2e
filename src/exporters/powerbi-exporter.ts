import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type { AnalyticsStore } from '../storage/analytics-store.js';

export interface PowerBIConfig {
  workspaceId: string;
  datasetId: string;
  accessToken: string;
  tableName?: string;
}

export interface PowerBIExportResult { rows: number; endpoint: string; }

function segment(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label} contains invalid characters`);
  return encodeURIComponent(value);
}

export class PowerBIExporter {
  constructor(private readonly store: AnalyticsStore, private readonly config: PowerBIConfig,
    private readonly http: AxiosInstance = axios) {}

  async export(days = 90): Promise<PowerBIExportResult> {
    if (!this.config.accessToken.trim()) throw new Error('Power BI access token is required');
    const trends = await this.store.getTrends(days);
    const rows = trends.map((trend) => ({
      date: trend.date.toISOString(), passCount: trend.passCount, failCount: trend.failCount,
      skipCount: trend.skipCount,
      passRate: trend.passCount + trend.failCount ? trend.passCount / (trend.passCount + trend.failCount) * 100 : 0,
      averageDuration: trend.averageDuration, flakeRate: trend.flakeRate
    }));
    const workspace = segment(this.config.workspaceId, 'workspaceId');
    const dataset = segment(this.config.datasetId, 'datasetId');
    const table = segment(this.config.tableName ?? 'TestTrends', 'tableName');
    const endpoint = `https://api.powerbi.com/v1.0/myorg/groups/${workspace}/datasets/${dataset}/tables/${table}/rows`;
    if (rows.length > 0) await this.http.post(endpoint, { rows }, {
      headers: { Authorization: `Bearer ${this.config.accessToken}`, 'Content-Type': 'application/json' },
      timeout: 30_000
    });
    return { rows: rows.length, endpoint };
  }
}
