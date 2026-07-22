/** Data models for production log entries. */

/** Log level severity. */
export type LogLevel = 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';

/** Source of log entry. */
export type LogSource = 'datadog' | 'cloudwatch' | 'elk';

/** One production log entry linked to a deployment. */
export interface LogEntry {
  id?: number;
  source: LogSource;
  level: LogLevel;
  message: string;
  timestamp: string;
  tags: Record<string, string>;
  deployment_sha: string;
}

/** Log query filter criteria. */
export interface LogQueryFilter {
  deployment_sha: string;
  level?: LogLevel | LogLevel[];
  source?: LogSource;
  startTime?: string;
  endTime?: string;
  limit?: number;
}

/** Log ingestion statistics. */
export interface LogIngestionStats {
  total_ingested: number;
  errors_stored: number;
  warnings_stored: number;
  info_stored: number;
  debug_stored: number;
  sample_rate_applied: boolean;
}
