import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  generateSentinelDashboardHtml,
  writeSentinelDashboard
} from '../../src/reporters/sentinel-dashboard.js';
import {
  aggregateSentinelDashboard,
  type SentinelDashboardInput,
  type SentinelDashboardModel
} from '../../src/core/sentinel-dashboard-aggregator.js';

const NOW = new Date('2026-07-23T12:00:00.000Z');
const clock = (): Date => NOW;

function buildModel(overrides: Partial<SentinelDashboardInput> = {}): SentinelDashboardModel {
  const input: SentinelDashboardInput = {
    service: 'checkout-api',
    status: { trafficRpm: 1200, errorRatePercent: 6, latencyMsP95: 210, uptimePercent: 99.98 },
    incidents: [
      { id: 'INC-1', title: 'Checkout 500s', startedAt: '2026-07-23T11:30:00Z', endedAt: '2026-07-23T11:45:00Z', severity: 'critical', usersAffected: 320, revenueAtRisk: 1450 },
      { id: 'INC-2', title: 'Slow search', startedAt: '2026-07-23T11:50:00Z', severity: 'medium', usersAffected: 12, revenueAtRisk: 40 }
    ],
    gaps: [
      { pattern: 'PaymentTimeout', occurrences: 9, coveragePercent: 0 },
      { pattern: 'CartRetry', occurrences: 3, coveragePercent: 55 }
    ],
    alerts: [
      { id: 'A1', title: 'Error rate high', severity: 'critical', raisedAt: '2026-07-23T11:00:00Z' },
      { id: 'A2', title: 'Old resolved', severity: 'info', raisedAt: '2026-07-23T08:00:00Z', resolvedAt: '2026-07-23T08:30:00Z' }
    ],
    trends: {
      '24h': [
        { timestamp: '2026-07-23T10:00:00Z', latencyMs: 150, errorRatePercent: 1 },
        { timestamp: '2026-07-23T11:00:00Z', latencyMs: 300, errorRatePercent: 3 }
      ]
    },
    ...overrides
  };
  return aggregateSentinelDashboard(input, { now: clock });
}

describe('generateSentinelDashboardHtml', () => {
  it('renders a self-contained document with all AC sections', () => {
    const html = generateSentinelDashboardHtml(buildModel());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Live Status');
    expect(html).toContain('Incidents');
    expect(html).toContain('Test Coverage Gaps');
    expect(html).toContain('Active Alerts');
    expect(html).toContain('Trends');
    expect(html).toContain('Recommendations');
  });

  it('renders live-status big numbers with units', () => {
    const html = generateSentinelDashboardHtml(buildModel());
    expect(html).toContain('req/min');
    expect(html).toContain('Uptime');
    expect(html).toContain('99.98');
    expect(html).toContain('Latency (p95)');
  });

  it('renders incident timeline and impact, marking ongoing incidents', () => {
    const html = generateSentinelDashboardHtml(buildModel());
    expect(html).toContain('Checkout 500s');
    expect(html).toContain('ongoing');
    expect(html).toContain('320 user(s) affected');
  });

  it('renders test gaps sorted by frequency with coverage percentages', () => {
    const html = generateSentinelDashboardHtml(buildModel());
    const timeoutIndex = html.indexOf('PaymentTimeout');
    const retryIndex = html.indexOf('CartRetry');
    expect(timeoutIndex).toBeGreaterThan(-1);
    expect(retryIndex).toBeGreaterThan(timeoutIndex);
    expect(html).toContain('0%');
    expect(html).toContain('55%');
  });

  it('renders active alerts with severity and age, dismissing resolved ones', () => {
    const html = generateSentinelDashboardHtml(buildModel());
    expect(html).toContain('Error rate high');
    expect(html).not.toContain('Old resolved');
  });

  it('renders selectable trend controls for 24h/7d/30d', () => {
    const html = generateSentinelDashboardHtml(buildModel());
    expect(html).toContain("selectTrend('24h')");
    expect(html).toContain("selectTrend('7d')");
    expect(html).toContain("selectTrend('30d')");
    expect(html).toContain('<polyline');
  });

  it('renders all three action buttons', () => {
    const html = generateSentinelDashboardHtml(buildModel());
    expect(html).toContain("sentinelAction('view-incident'");
    expect(html).toContain("sentinelAction('create-test'");
    expect(html).toContain("sentinelAction('page-oncall'");
  });

  it('escapes HTML to prevent injection', () => {
    const html = generateSentinelDashboardHtml(buildModel({
      incidents: [{ id: 'x', title: '<script>alert(1)</script>', startedAt: '2026-07-23T11:00:00Z', severity: 'low', usersAffected: 1, revenueAtRisk: 1 }]
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('supports dark mode and a custom title', () => {
    const html = generateSentinelDashboardHtml(buildModel(), { darkMode: true, title: 'My Sentinel' });
    expect(html).toContain('#1a1a1a');
    expect(html).toContain('My Sentinel');
  });

  it('renders empty-state placeholders when there is no data', () => {
    const html = generateSentinelDashboardHtml(buildModel({ incidents: [], gaps: [], alerts: [], trends: {} }));
    expect(html).toContain('No incidents recorded');
    expect(html).toContain('No coverage gaps');
    expect(html).toContain('No active alerts');
    expect(html).toContain('No data');
  });
});

describe('writeSentinelDashboard', () => {
  it('writes the dashboard to disk', async () => {
    const outPath = path.join(tmpdir(), `sentinel-dash-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    const written = await writeSentinelDashboard(buildModel(), outPath);
    const contents = await readFile(written, 'utf-8');
    expect(contents).toContain('Sentinel Studio');
    expect(contents).toContain('checkout-api');
  });

  it('wraps write failures with a helpful error', async () => {
    const badPath = path.join(tmpdir(), `sentinel-dash-${Date.now()}`, '\0invalid', 'x.html');
    await expect(writeSentinelDashboard(buildModel(), badPath)).rejects.toBeInstanceOf(Error);
  });
});
