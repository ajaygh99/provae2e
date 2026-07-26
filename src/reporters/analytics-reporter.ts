import type { AnalyticsStore, Anomaly, FlakyTest, TrendData } from '../storage/analytics-store.js';

export interface AnalyticsReport {
  generatedAt: Date;
  period: { days: number; startDate: Date };
  summary: { totalTests: number; passed: number; failed: number; skipped: number; passRate: number; averageDuration: number };
  trends: TrendData[];
  anomalies: Anomaly[];
  flakyTests: FlakyTest[];
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
    const [trends, anomalies, flakyTests] = await Promise.all([
      this.store.getTrends(days, generatedAt), this.store.detectAnomalies(generatedAt),
      this.store.getFlakiestTests(10, generatedAt)
    ]);
    const passed = trends.reduce((sum, trend) => sum + trend.passCount, 0);
    const failed = trends.reduce((sum, trend) => sum + trend.failCount, 0);
    const skipped = trends.reduce((sum, trend) => sum + trend.skipCount, 0);
    const totalTests = passed + failed + skipped;
    const weightedDuration = trends.reduce((sum, trend) =>
      sum + trend.averageDuration * (trend.passCount + trend.failCount + trend.skipCount), 0);
    return {
      generatedAt, period: { days, startDate: new Date(generatedAt.getTime() - days * 86_400_000) },
      summary: { totalTests, passed, failed, skipped,
        passRate: passed + failed ? passed / (passed + failed) * 100 : 0,
        averageDuration: totalTests ? weightedDuration / totalTests : 0 },
      trends, anomalies, flakyTests
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
