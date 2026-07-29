import { AnalyticsReporter } from '../../src/reporters/analytics-reporter';
import type { AnalyticsStore } from '../../src/storage/analytics-store';

const store = {
  getTrends: jest.fn().mockResolvedValue([
    { date: new Date('2026-01-01'), passCount: 8, failCount: 2, skipCount: 1, averageDuration: 120, flakeRate: 0.1 }
  ]),
  detectAnomalies: jest.fn().mockResolvedValue([{
    testName: '<checkout>', type: 'duration', severity: 'high', description: '<script>', detectedAt: new Date()
  }]),
  getFlakiestTests: jest.fn().mockResolvedValue([])
} as unknown as AnalyticsStore;

test('computes a weighted analytics summary and safe HTML', async () => {
  const reporter = new AnalyticsReporter(store, () => new Date('2026-01-08T00:00:00Z'));
  const report = await reporter.generateReport({ days: 7 });
  expect(report.summary).toEqual(expect.objectContaining({
    totalTests: 11, passed: 8, failed: 2, passRate: 80, failureRate: 20,
    skipRate: 100 / 11, flakeRate: 10
  }));
  expect(report.trends[0]).toEqual(expect.objectContaining({ totalTests: 11, passRate: 80 }));
  expect(report.quality).toEqual({
    status: 'critical', highSeverityAnomalies: 1, anomalyCount: 1, flakyTestCount: 0
  });
  expect(store.getFlakiestTests).toHaveBeenCalledWith(50, new Date('2026-01-08T00:00:00Z'));
  const html = await reporter.renderHTML(7);
  expect(html).toContain('&lt;checkout&gt;');
  expect(html).not.toContain('<script>');
});

test('renders machine-readable JSON', async () => {
  expect(JSON.parse(await new AnalyticsReporter(store).renderJSON()).summary.totalTests).toBe(11);
});

test('validates the report window and handles an empty report', async () => {
  const empty = {
    getTrends: jest.fn().mockResolvedValue([]), detectAnomalies: jest.fn().mockResolvedValue([]),
    getFlakiestTests: jest.fn().mockResolvedValue([])
  } as unknown as AnalyticsStore;
  const reporter = new AnalyticsReporter(empty);
  await expect(reporter.generateReport({ days: 0 })).rejects.toThrow('days must be an integer');
  expect((await reporter.generateReport()).summary).toEqual(expect.objectContaining({
    totalTests: 0, passRate: 0, averageDuration: 0
  }));
  expect((await reporter.generateReport()).quality.status).toBe('no-data');
  expect(await reporter.renderHTML()).toContain('No anomalies detected');
});

test('orders and bounds dashboard insights deterministically', async () => {
  const insights = {
    getTrends: jest.fn().mockResolvedValue([
      { date: new Date('2026-01-01'), passCount: 19, failCount: 1, skipCount: 0, averageDuration: 50, flakeRate: 0 }
    ]),
    detectAnomalies: jest.fn().mockResolvedValue([
      { testName: 'low', type: 'duration', severity: 'low', description: 'low', detectedAt: new Date('2026-01-03') },
      { testName: 'high', type: 'duration', severity: 'high', description: 'high', detectedAt: new Date('2026-01-01') },
      { testName: 'medium', type: 'duration', severity: 'medium', description: 'medium', detectedAt: new Date('2026-01-02') }
    ]),
    getFlakiestTests: jest.fn().mockResolvedValue([
      { testName: 'zeta', runs: 3, transitions: 1, flakeRate: 0.5 },
      { testName: 'alpha', runs: 4, transitions: 2, flakeRate: 0.5 }
    ])
  } as unknown as AnalyticsStore;
  const report = await new AnalyticsReporter(insights).generateReport();
  expect(report.anomalies.map(item => item.severity)).toEqual(['high', 'medium', 'low']);
  expect(report.flakyTests.map(item => item.testName)).toEqual(['alpha', 'zeta']);
});

test('rejects invalid clock and trend metrics before rendering', async () => {
  const invalid = {
    getTrends: jest.fn().mockResolvedValue([
      { date: new Date('bad'), passCount: 1, failCount: 0, skipCount: 0, averageDuration: 1, flakeRate: 0 }
    ]),
    detectAnomalies: jest.fn().mockResolvedValue([]),
    getFlakiestTests: jest.fn().mockResolvedValue([])
  } as unknown as AnalyticsStore;
  await expect(new AnalyticsReporter(invalid).generateReport()).rejects.toThrow('date must be valid');
  await expect(new AnalyticsReporter(invalid, () => new Date('bad')).generateReport()).rejects.toThrow(
    'report clock must return a valid Date'
  );
});

test('renders a self-contained accessible responsive dashboard with safe insights', async () => {
  const dashboardStore = {
    getTrends: jest.fn().mockResolvedValue([
      { date: new Date('2026-01-01'), passCount: 8, failCount: 1, skipCount: 1, averageDuration: 120, flakeRate: 0.2 }
    ]),
    detectAnomalies: jest.fn().mockResolvedValue([{
      testName: '<checkout>', type: 'failure_rate', severity: 'medium',
      description: '<img src=x onerror=alert(1)>', detectedAt: new Date('2026-01-02')
    }]),
    getFlakiestTests: jest.fn().mockResolvedValue([{
      testName: '<script>alert(1)</script>', runs: 5, transitions: 3, flakeRate: 0.75
    }])
  } as unknown as AnalyticsStore;
  const html = await new AnalyticsReporter(dashboardStore, () => new Date('2026-01-08')).renderHTML();
  expect(html).toContain('<meta name="viewport"');
  expect(html).toContain('<main class="shell">');
  expect(html).toContain('aria-label="Quality status:');
  expect(html).toContain('<caption>Daily test outcomes and performance</caption>');
  expect(html).toContain('role="img" aria-label="8 passed, 1 failed, 1 skipped"');
  expect(html).toContain('@media(max-width:780px)');
  expect(html).toContain('@media(prefers-reduced-motion:reduce)');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<img src=x');
  expect(html).not.toMatch(/NaN|Infinity/);
  expect(html).not.toMatch(/https?:\/\/|<link\b/);
});

test('renders explicit dashboard empty states', async () => {
  const empty = {
    getTrends: jest.fn().mockResolvedValue([]),
    detectAnomalies: jest.fn().mockResolvedValue([]),
    getFlakiestTests: jest.fn().mockResolvedValue([])
  } as unknown as AnalyticsStore;
  const html = await new AnalyticsReporter(empty).renderHTML();
  expect(html).toContain('No trend data yet');
  expect(html).toContain('No anomalies detected');
  expect(html).toContain('No flaky tests detected');
});
