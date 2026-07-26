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
  expect(report.summary).toEqual(expect.objectContaining({ totalTests: 11, passed: 8, failed: 2, passRate: 80 }));
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
  expect(await reporter.renderHTML()).toContain('No anomalies detected');
});
