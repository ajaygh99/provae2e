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
    const trendRows = report.trends.map((trend) => `<tr><th scope="row">${trend.date.toISOString().slice(0, 10)}</th>
<td>${trend.totalTests}</td><td>${trend.passCount}</td><td>${trend.failCount}</td><td>${trend.skipCount}</td>
<td>${percent(trend.passRate)}</td><td>${duration(trend.averageDuration)}</td><td>${percent(trend.flakeRate * 100)}</td></tr>`).join('');
    const anomalies = report.anomalies.length ? report.anomalies.map((item) =>
      `<li class="insight insight-${item.severity}"><div><span class="severity">${item.severity}</span>
<strong>${escapeHtml(item.testName)}</strong></div><p>${escapeHtml(item.description)}</p>
<small>${item.type.replace('_', ' ')} · ${safeDate(item.detectedAt)}</small></li>`).join('')
      : emptyState('No anomalies detected', 'No unusual duration, failure-rate, or flakiness signals were found.');
    const flakyRows = report.flakyTests.map(item => `<tr><th scope="row">${escapeHtml(item.testName)}</th>
<td>${item.runs}</td><td>${item.transitions}</td><td>${percent(item.flakeRate * 100)}</td></tr>`).join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>PROVA Analytics Dashboard</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:light;--ink:#13213c;--muted:#526079;
--surface:#fff;--canvas:#f3f6fb;--line:#d6deea;--brand:#3457d5;--pass:#16794b;--fail:#bd2c3c;--skip:#667085}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);line-height:1.5}
.shell{width:min(1180px,calc(100% - 2rem));margin:auto;padding:2rem 0 3rem}
header{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:1.5rem}
h1,h2,p{margin-top:0}h1{font-size:clamp(1.8rem,4vw,2.7rem);letter-spacing:-.035em;margin-bottom:.25rem}
h2{font-size:1.15rem}.eyebrow{color:var(--brand);font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:.75rem}
.muted,small{color:var(--muted)}.status{border-radius:999px;padding:.45rem .8rem;font-weight:800;text-transform:uppercase;font-size:.75rem}
.status-healthy{background:#dff7e9;color:#075c37}.status-warning{background:#fff0c2;color:#714b00}
.status-critical{background:#ffe2e5;color:#8c1525}.status-no-data{background:#e8edf5;color:#445066}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem;margin-bottom:1rem}
.card,.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 24px rgba(28,45,80,.06)}
.card{padding:1rem}.metric{font-size:1.7rem;font-weight:850;display:block}.label{color:var(--muted);font-size:.82rem}
.visually-hidden{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.panel{padding:1.25rem;margin-top:1rem;overflow:hidden}.panel-head{display:flex;justify-content:space-between;gap:1rem;align-items:baseline}
.trend-chart{display:grid;gap:.65rem;margin:1rem 0}.trend-line{display:grid;grid-template-columns:6.5rem 1fr 4rem;gap:.75rem;align-items:center}
.bar{height:.8rem;background:#e5e9f1;border-radius:999px;overflow:hidden;display:flex}.bar-pass{background:var(--pass)}
.bar-fail{background:var(--fail)}.bar-skip{background:var(--skip)}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
caption{text-align:left;color:var(--muted);padding:0 0 .65rem}th,td{padding:.7rem;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child{text-align:left}.grid{display:grid;grid-template-columns:1.35fr 1fr;gap:1rem}.insights{list-style:none;padding:0;margin:0;display:grid;gap:.7rem}
.insight{border-left:4px solid var(--line);padding:.75rem;background:var(--canvas);border-radius:8px}.insight-high{border-color:var(--fail)}
.insight-medium{border-color:#d98c00}.insight p{margin:.35rem 0}.severity{text-transform:uppercase;font-size:.68rem;font-weight:850;margin-right:.5rem}
.empty{padding:1.25rem;border:1px dashed var(--line);border-radius:10px;text-align:center}.scroll{overflow-x:auto}
a:focus-visible{outline:3px solid var(--brand);outline-offset:3px}
@media(max-width:780px){.metrics{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}header{display:block}.status{display:inline-block;margin-top:.5rem}}
@media(max-width:460px){.metrics{grid-template-columns:1fr}.shell{width:min(100% - 1rem,1180px);padding-top:1rem}.trend-line{grid-template-columns:5.5rem 1fr}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}@media print{body{background:#fff}.shell{width:100%;padding:0}.card,.panel{box-shadow:none;break-inside:avoid}}
</style></head><body><main class="shell"><header><div><div class="eyebrow">PROVA quality intelligence</div>
<h1>Analytics dashboard</h1><p class="muted">${report.period.days}-day window · generated ${safeDate(report.generatedAt)}</p></div>
<span class="status status-${report.quality.status}" aria-label="Quality status: ${report.quality.status}">${report.quality.status.replace('-', ' ')}</span></header>
<section aria-labelledby="summary-title"><h2 id="summary-title" class="visually-hidden">Summary</h2><div class="metrics">
${metric('Total tests', String(report.summary.totalTests))}${metric('Pass rate', percent(report.summary.passRate))}
${metric('Failure rate', percent(report.summary.failureRate))}${metric('Average duration', duration(report.summary.averageDuration))}
${metric('Skipped', String(report.summary.skipped))}${metric('Flake rate', percent(report.summary.flakeRate))}
${metric('Anomalies', String(report.quality.anomalyCount))}${metric('Flaky tests', String(report.quality.flakyTestCount))}
</div></section><section class="panel" aria-labelledby="trend-title"><div class="panel-head"><div><h2 id="trend-title">Daily trend</h2>
<p class="muted">Pass, fail, and skipped outcomes over time.</p></div></div>
${report.trends.length ? renderTrendChart(report.trends) : emptyState('No trend data yet', 'Persist test runs to populate this dashboard.')}
<div class="scroll"><table><caption>Daily test outcomes and performance</caption><thead><tr><th scope="col">Date</th><th scope="col">Total</th>
<th scope="col">Pass</th><th scope="col">Fail</th><th scope="col">Skip</th><th scope="col">Pass rate</th>
<th scope="col">Avg duration</th><th scope="col">Flake rate</th></tr></thead><tbody>${trendRows}</tbody></table></div></section>
<div class="grid"><section class="panel" aria-labelledby="anomaly-title"><div class="panel-head"><h2 id="anomaly-title">Anomalies</h2>
<span class="muted">${report.quality.highSeverityAnomalies} high severity</span></div><ul class="insights">${anomalies}</ul></section>
<section class="panel" aria-labelledby="flaky-title"><h2 id="flaky-title">Flaky tests</h2>${report.flakyTests.length
  ? `<div class="scroll"><table><caption>Tests ordered by result-transition rate</caption><thead><tr><th scope="col">Test</th>
<th scope="col">Runs</th><th scope="col">Transitions</th><th scope="col">Flake rate</th></tr></thead><tbody>${flakyRows}</tbody></table></div>`
  : emptyState('No flaky tests detected', 'Tests with alternating pass/fail outcomes appear here.')}</section></div>
</main></body></html>`;
  }
}

function metric(label: string, value: string): string {
  return `<article class="card"><span class="label">${label}</span><strong class="metric">${value}</strong></article>`;
}

function emptyState(title: string, message: string): string {
  return `<div class="empty" role="status"><strong>${title}</strong><p class="muted">${message}</p></div>`;
}

function renderTrendChart(trends: AnalyticsTrendPoint[]): string {
  const rows = trends.map(trend => {
    const denominator = Math.max(trend.totalTests, 1);
    const passWidth = trend.passCount / denominator * 100;
    const failWidth = trend.failCount / denominator * 100;
    const skipWidth = trend.skipCount / denominator * 100;
    const label = `${trend.passCount} passed, ${trend.failCount} failed, ${trend.skipCount} skipped`;
    return `<div class="trend-line"><span>${trend.date.toISOString().slice(0, 10)}</span>
<div class="bar" role="img" aria-label="${label}"><span class="bar-pass" style="width:${passWidth}%"></span>
<span class="bar-fail" style="width:${failWidth}%"></span><span class="bar-skip" style="width:${skipWidth}%"></span></div>
<strong>${percent(trend.passRate)}</strong></div>`;
  }).join('');
  return `<div class="trend-chart" aria-label="Daily outcome chart">${rows}</div>`;
}

function percent(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`;
}

function duration(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}ms`;
}

function safeDate(value: Date): string {
  return Number.isNaN(value.getTime()) ? 'Unknown date' : value.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
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
