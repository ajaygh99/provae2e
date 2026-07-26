export type TestRunType = 'browser' | 'mobile' | 'api';
export type TestRunStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface TestRunRecord {
  id: string;
  timestamp: Date;
  testName: string;
  testType: TestRunType;
  status: TestRunStatus;
  durationMs: number;
  device?: string;
  browser?: string;
  tags: string[];
  errorMessage?: string;
  metadata: Record<string, unknown>;
}

export interface TrendData {
  date: Date;
  passCount: number;
  failCount: number;
  skipCount: number;
  averageDuration: number;
  flakeRate: number;
}

export interface Anomaly {
  testName: string;
  type: 'duration' | 'failure_rate' | 'flakiness';
  severity: 'low' | 'medium' | 'high';
  description: string;
  detectedAt: Date;
}

export interface FlakyTest {
  testName: string;
  runs: number;
  transitions: number;
  flakeRate: number;
}

export interface RunQuery {
  days?: number;
  testName?: string;
  limit?: number;
  now?: Date;
}

export abstract class AnalyticsStore {
  abstract initialize(): Promise<void>;
  abstract saveTestRun(run: TestRunRecord): Promise<void>;
  async saveTestRuns(runs: TestRunRecord[]): Promise<void> {
    for (const run of runs) await this.saveTestRun(run);
  }
  abstract getRuns(query?: RunQuery): Promise<TestRunRecord[]>;
  abstract getTrends(days: number, now?: Date): Promise<TrendData[]>;
  abstract detectAnomalies(now?: Date): Promise<Anomaly[]>;
  abstract getFlakiestTests(limit: number, now?: Date): Promise<FlakyTest[]>;
  abstract export(format: 'json' | 'csv'): Promise<Buffer>;
  abstract cleanup(retentionDays?: number, now?: Date): Promise<number>;
  abstract close(): Promise<void>;
}

export const DEFAULT_ANALYTICS_RETENTION_DAYS = 90;

export function validateRun(run: TestRunRecord): void {
  if (!run.id || !run.testName) throw new Error('Analytics run id and testName are required');
  if (!['browser', 'mobile', 'api'].includes(run.testType)) throw new Error(`Invalid test type: ${run.testType}`);
  if (!['PASS', 'FAIL', 'SKIP'].includes(run.status)) throw new Error(`Invalid test status: ${run.status}`);
  if (!Number.isFinite(run.durationMs) || run.durationMs < 0) throw new Error('durationMs must be non-negative');
  if (Number.isNaN(run.timestamp.getTime())) throw new Error('timestamp must be a valid Date');
}

export function calculateTrends(runs: TestRunRecord[]): TrendData[] {
  const days = new Map<string, TestRunRecord[]>();
  for (const run of runs) {
    const key = run.timestamp.toISOString().slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), run]);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => {
    const passCount = rows.filter((run) => run.status === 'PASS').length;
    const failCount = rows.filter((run) => run.status === 'FAIL').length;
    const skipCount = rows.filter((run) => run.status === 'SKIP').length;
    const averageDuration = rows.reduce((sum, run) => sum + run.durationMs, 0) / rows.length;
    const byTest = new Map<string, TestRunRecord[]>();
    for (const row of rows) byTest.set(row.testName, [...(byTest.get(row.testName) ?? []), row]);
    const flaky = [...byTest.values()].filter((testRuns) =>
      testRuns.some((run) => run.status === 'PASS') && testRuns.some((run) => run.status === 'FAIL')).length;
    return { date: new Date(`${date}T00:00:00.000Z`), passCount, failCount, skipCount, averageDuration,
      flakeRate: byTest.size ? flaky / byTest.size : 0 };
  });
}

export function calculateFlakyTests(runs: TestRunRecord[], limit: number): FlakyTest[] {
  const grouped = new Map<string, TestRunRecord[]>();
  for (const run of runs) grouped.set(run.testName, [...(grouped.get(run.testName) ?? []), run]);
  return [...grouped.entries()].map(([testName, values]) => {
    const ordered = values.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .filter((run) => run.status !== 'SKIP');
    let transitions = 0;
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]?.status !== ordered[index - 1]?.status) transitions += 1;
    }
    return { testName, runs: ordered.length, transitions,
      flakeRate: ordered.length > 1 ? transitions / (ordered.length - 1) : 0 };
  }).filter((item) => item.transitions > 0)
    .sort((a, b) => b.flakeRate - a.flakeRate || b.runs - a.runs).slice(0, limit);
}

function severity(zScore: number): Anomaly['severity'] {
  return zScore >= 4 ? 'high' : zScore >= 3 ? 'medium' : 'low';
}

export function calculateAnomalies(runs: TestRunRecord[], now = new Date()): Anomaly[] {
  const grouped = new Map<string, TestRunRecord[]>();
  for (const run of runs) grouped.set(run.testName, [...(grouped.get(run.testName) ?? []), run]);
  const anomalies: Anomaly[] = [];
  for (const [testName, values] of grouped) {
    const ordered = values.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (ordered.length < 6) continue;
    const current = ordered[ordered.length - 1];
    if (!current) continue;
    const history = ordered.slice(0, -1);
    const mean = history.reduce((sum, run) => sum + run.durationMs, 0) / history.length;
    const variance = history.reduce((sum, run) => sum + (run.durationMs - mean) ** 2, 0) / history.length;
    const deviation = Math.sqrt(variance);
    const durationZ = deviation === 0 ? (current.durationMs > mean * 1.5 ? 5 : 0)
      : (current.durationMs - mean) / deviation;
    if (durationZ >= 2.5) anomalies.push({
      testName, type: 'duration', severity: severity(durationZ),
      description: `Duration ${Math.round(current.durationMs)}ms is ${durationZ.toFixed(1)} standard deviations above baseline`,
      detectedAt: now
    });
    const recent = ordered.slice(-5);
    const baseline = ordered.slice(0, -5);
    const historicalFailureRate = baseline.length
      ? baseline.filter((run) => run.status === 'FAIL').length / baseline.length : 0;
    const recentFailureRate = recent.filter((run) => run.status === 'FAIL').length / recent.length;
    if (recentFailureRate >= 0.6 && recentFailureRate - historicalFailureRate >= 0.4) anomalies.push({
      testName, type: 'failure_rate', severity: recentFailureRate >= 0.8 ? 'high' : 'medium',
      description: `Recent failure rate ${(recentFailureRate * 100).toFixed(0)}% exceeds baseline ${(historicalFailureRate * 100).toFixed(0)}%`,
      detectedAt: now
    });
  }
  for (const flaky of calculateFlakyTests(runs, Number.MAX_SAFE_INTEGER)) {
    if (flaky.runs >= 5 && flaky.flakeRate >= 0.5) anomalies.push({
      testName: flaky.testName, type: 'flakiness', severity: flaky.flakeRate >= 0.75 ? 'high' : 'medium',
      description: `Result changed in ${(flaky.flakeRate * 100).toFixed(0)}% of consecutive runs`,
      detectedAt: now
    });
  }
  return anomalies;
}

function csvCell(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportRuns(runs: TestRunRecord[], format: 'json' | 'csv'): Buffer {
  if (format === 'json') return Buffer.from(JSON.stringify(runs, null, 2));
  const header = ['id', 'timestamp', 'testName', 'testType', 'status', 'durationMs', 'device', 'browser',
    'tags', 'errorMessage', 'metadata'];
  const rows = runs.map((run) => [
    run.id, run.timestamp.toISOString(), run.testName, run.testType, run.status, run.durationMs,
    run.device ?? '', run.browser ?? '', run.tags, run.errorMessage ?? '', run.metadata
  ].map(csvCell).join(','));
  return Buffer.from([header.join(','), ...rows].join('\n'));
}
