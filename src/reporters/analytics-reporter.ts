import type { AnalyticsStore, Anomaly, FlakyTest, TrendData } from '../storage/analytics-store.js';

export interface AnalyticsReport {
  generatedAt: Date;
  period: { days: number; startDate: Date };
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
    failureRate: number;
    skipRate: number;
    flakeRate: number;
    averageDuration: number;
  };
  quality: {
    status: 'no-data' | 'healthy' | 'warning' | 'critical';
    highSeverityAnomalies: number;
    anomalyCount: number;
    flakyTestCount: number;
  };
  trends: AnalyticsTrendPoint[];
  anomalies: Anomaly[];
  flakyTests: FlakyTest[];
}

export interface AnalyticsTrendPoint extends TrendData {
  totalTests: number;
  passRate: number;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class AnalyticsReporter {
  constructor(private readonly store: AnalyticsStore, private readonly now: () => Date = () => new Date()) {}

  async generateReport(options: { days?: number } = {}): Promise<AnalyticsReport> {
    const days = options.days ?? 7;
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('days must be an integer from 1 to 3650');
    const generatedAt = this.now();
    if (Number.isNaN(generatedAt.getTime())) throw new Error('report clock must return a valid Date');
    const [trends, anomalies, flakyTests] = await Promise.all([
      this.store.getTrends(days, generatedAt), this.store.detectAnomalies(generatedAt),
      this.store.getFlakiestTests(50, generatedAt)
    ]);
    trends.forEach(validateTrend);
    const trendPoints = trends.map(enrichTrend);
    const orderedAnomalies = [...anomalies].sort(compareAnomalies).slice(0, 100);
    const orderedFlakyTests = [...flakyTests].sort(compareFlakyTests).slice(0, 50);
    const passed = trendPoints.reduce((sum, trend) => sum + trend.passCount, 0);
    const failed = trendPoints.reduce((sum, trend) => sum + trend.failCount, 0);
    const skipped = trendPoints.reduce((sum, trend) => sum + trend.skipCount, 0);
    const totalTests = passed + failed + skipped;
    const executed = passed + failed;
    const weightedDuration = trendPoints.reduce((sum, trend) =>
      sum + trend.averageDuration * (trend.passCount + trend.failCount + trend.skipCount), 0);
    const weightedFlakes = trendPoints.reduce((sum, trend) => sum + trend.flakeRate * trend.totalTests, 0);
    const passRate = executed ? passed / executed * 100 : 0;
    const highSeverityAnomalies = orderedAnomalies.filter(item => item.severity === 'high').length;
    return {
      generatedAt, period: { days, startDate: new Date(generatedAt.getTime() - days * 86_400_000) },
      summary: { totalTests, passed, failed, skipped,
        passRate,
        failureRate: executed ? failed / executed * 100 : 0,
        skipRate: totalTests ? skipped / totalTests * 100 : 0,
        flakeRate: totalTests ? weightedFlakes / totalTests * 100 : 0,
        averageDuration: totalTests ? weightedDuration / totalTests : 0 },
      quality: {
        status: qualityStatus(totalTests, passRate, highSeverityAnomalies, orderedAnomalies.length, orderedFlakyTests.length),
        highSeverityAnomalies,
        anomalyCount: orderedAnomalies.length,
        flakyTestCount: orderedFlakyTests.length
      },
      trends: trendPoints,
      anomalies: orderedAnomalies,
      flakyTests: orderedFlakyTests
    };
  }

  async renderJSON(days = 7): Promise<string> { return JSON.stringify(await this.generateReport({ days }), null, 2); }

  async renderHTML(days = 7): Promise<string> {
    const report = await this.generateReport({ days });
    const trendRows = report.trends.map((trend) => `<tr><td>${trend.date.toISOString().slice(0, 10)}</td>
      <td>${trend.passCount}</td><td>${trend.failCount}</td><td>${trend.skipCount}</td>
      <td>${trend.averageDuration.toFixed(1)}ms</td></tr>`).join('');
    const anomalies = report.anomalies.length ? report.anomalies.map((item) =>
      `<li><strong>${escapeHtml(item.testName)}</strong>: ${escapeHtml(item.description)} (${item.severity})</li>`).join('')
      : '<li>No anomalies detected</li>';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PROVA Analytics Report</title>
<style>body{font:15px system-ui;margin:2rem;color:#172033}.summary{display:flex;gap:2rem;background:#eef3ff;padding:1rem}
table{border-collapse:collapse;width:100%;margin-top:1rem}th,td{padding:.55rem;border-bottom:1px solid #ccd5e4;text-align:left}
.anomalies{background:#fff4e5;padding:1rem;margin-top:1rem}</style></head><body><h1>PROVA Analytics Report</h1>
<div class="summary"><span>Total: ${report.summary.totalTests}</span><span>Pass rate: ${report.summary.passRate.toFixed(1)}%</span>
<span>Average: ${report.summary.averageDuration.toFixed(1)}ms</span></div>
<h2>${report.period.days}-day trend</h2><table><thead><tr><th>Date</th><th>Pass</th><th>Fail</th><th>Skip</th>
<th>Duration</th></tr></thead><tbody>${trendRows}</tbody></table>
<section class="anomalies"><h2>Anomalies</h2><ul>${anomalies}</ul></section></body></html>`;
  }
}

function enrichTrend(trend: TrendData): AnalyticsTrendPoint {
  const totalTests = trend.passCount + trend.failCount + trend.skipCount;
  const executed = trend.passCount + trend.failCount;
  return { ...trend, totalTests, passRate: executed ? trend.passCount / executed * 100 : 0 };
}

function validateTrend(trend: TrendData, index: number): void {
  if (Number.isNaN(trend.date.getTime())) throw new Error(`trend ${index + 1} date must be valid`);
  const values = [trend.passCount, trend.failCount, trend.skipCount, trend.averageDuration, trend.flakeRate];
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error(`trend ${index + 1} metrics must be finite and non-negative`);
  }
  if (![trend.passCount, trend.failCount, trend.skipCount].every(Number.isInteger) || trend.flakeRate > 1) {
    throw new Error(`trend ${index + 1} counts or flake rate are invalid`);
  }
}

function compareAnomalies(left: Anomaly, right: Anomaly): number {
  const rank = { high: 0, medium: 1, low: 2 };
  return rank[left.severity] - rank[right.severity]
    || right.detectedAt.getTime() - left.detectedAt.getTime()
    || left.testName.localeCompare(right.testName);
}

function compareFlakyTests(left: FlakyTest, right: FlakyTest): number {
  return right.flakeRate - left.flakeRate || right.runs - left.runs || left.testName.localeCompare(right.testName);
}

function qualityStatus(
  totalTests: number,
  passRate: number,
  highSeverityAnomalies: number,
  anomalyCount: number,
  flakyTestCount: number
): AnalyticsReport['quality']['status'] {
  if (totalTests === 0) return 'no-data';
  if (passRate < 80 || highSeverityAnomalies > 0) return 'critical';
  if (passRate < 95 || anomalyCount > 0 || flakyTestCount > 0) return 'warning';
  return 'healthy';
}
