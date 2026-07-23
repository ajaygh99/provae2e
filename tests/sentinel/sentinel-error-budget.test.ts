import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SentinelErrorBudgetTracker,
  monthlyBudgetMs,
  parseSlaConfig,
  type DowntimeEvent,
  type ServiceSlaConfig,
  type SlaTarget
} from '../../src/core/sentinel-error-budget.js';

const dir = path.join(process.cwd(), '.test-error-budgets');
let index = 0;
const config: ServiceSlaConfig = { service: 'checkout', target: 99.9, budgetWindow: 'month' };
const now = (): Date => new Date('2026-07-15T00:00:00Z');

function event(overrides: Partial<DowntimeEvent> = {}): DowntimeEvent {
  index += 1;
  return {
    id: `down-${index}`, service: 'checkout',
    start: '2026-07-10T00:00:00Z', end: '2026-07-10T00:10:00Z',
    cause: 'database maintenance', ...overrides
  };
}
async function tracker(configs = [config]): Promise<SentinelErrorBudgetTracker> {
  index += 1;
  return SentinelErrorBudgetTracker.open(path.join(dir, `${index}.db`), configs, now);
}
beforeAll(async () => rm(dir, { recursive: true, force: true }));
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe('SLA configuration and budgets', () => {
  it('surfaces database read errors', async () => {
    const databasePath = path.join(dir, 'database-directory');
    await mkdir(databasePath, { recursive: true });
    await expect(SentinelErrorBudgetTracker.open(databasePath, [config], now)).rejects.toThrow();
  });

  it('parses service SLA YAML', () => {
    expect(parseSlaConfig('services:\n  - name: checkout\n    sla:\n      target: 99.9\n      budget_window: month'))
      .toEqual([config]);
  });
  it('parses multiple services', () => {
    const yaml = 'services:\n  - name: a\n    sla: { target: 99, budget_window: month }\n  - name: b\n    sla: { target: 99.99, budget_window: month }';
    expect(parseSlaConfig(yaml)).toHaveLength(2);
  });
  it('rejects malformed YAML', () => expect(() => parseSlaConfig('services: [')).toThrow('YAML'));
  it('requires services', () => expect(() => parseSlaConfig('{}')).toThrow('services'));
  it.each([99, 99.5, 99.9, 99.99] as SlaTarget[])('accepts SLA %s', async target => {
    await expect(tracker([{ ...config, target }])).resolves.toBeDefined();
  });
  it.each([98, 100, Number.NaN])('rejects SLA %s', async target => {
    await expect(tracker([{ ...config, target: target as SlaTarget }])).rejects.toThrow('SLA target');
  });
  it('rejects duplicate services', async () => {
    await expect(tracker([config, config])).rejects.toThrow('Duplicate');
  });
  it('rejects non-month windows', async () => {
    await expect(tracker([{ ...config, budgetWindow: 'week' as 'month' }])).rejects.toThrow('month');
  });
  it('calculates 99.9 July budget near 44.64 minutes', () => {
    expect(monthlyBudgetMs(99.9, '2026-07')).toBeCloseTo(2_678_400, -1);
  });
  it('accounts for February length', () => {
    expect(monthlyBudgetMs(99.9, '2026-02')).toBeLessThan(monthlyBudgetMs(99.9, '2026-03'));
  });
  it.each(['2026-00', '2026-13', 'July'])('rejects invalid month %s', month => {
    expect(() => monthlyBudgetMs(99.9, month)).toThrow('YYYY-MM');
  });
});

describe('downtime tracking and compliance', () => {
  it('records and deduplicates downtime ids', async () => {
    const value = await tracker();
    const same = event();
    expect(await value.recordDowntime(same)).toBe(true);
    expect(await value.recordDowntime(same)).toBe(false);
  });
  it.each([
    [{ id: '' }, 'id'],
    [{ service: 'unknown' }, 'service'],
    [{ cause: '' }, 'cause'],
    [{ start: 'bad' }, 'timestamps'],
    [{ end: '2026-07-09T00:00:00Z' }, 'after']
  ])('validates downtime input', async (override, expected) => {
    await expect((await tracker()).recordDowntime(event(override))).rejects.toThrow(expected);
  });
  it('calculates consumed and remaining budget', async () => {
    const value = await tracker();
    await value.recordDowntime(event());
    expect(value.status('checkout', '2026-07')).toMatchObject({
      downtimeMs: 600_000, consumedPercent: 22.4, compliant: true, deploymentAllowed: true
    });
  });
  it('clips cross-month downtime to report window', async () => {
    const value = await tracker();
    await value.recordDowntime(event({
      start: '2026-06-30T23:55:00Z', end: '2026-07-01T00:05:00Z'
    }));
    expect(value.status('checkout', '2026-07').downtimeMs).toBe(300_000);
  });
  it('ignores downtime outside the month', async () => {
    const value = await tracker();
    await value.recordDowntime(event({ start: '2026-06-01T00:00:00Z', end: '2026-06-01T00:10:00Z' }));
    expect(value.status('checkout', '2026-07').downtimeMs).toBe(0);
  });
  it.each([
    [1_340_000, [50]],
    [2_010_000, [50, 75]],
    [2_411_000, [50, 75, 90]]
  ])('raises cumulative threshold alerts at %s ms', async (duration, expected) => {
    const value = await tracker();
    await value.recordDowntime(event({
      start: '2026-07-10T00:00:00Z',
      end: new Date(Date.parse('2026-07-10T00:00:00Z') + duration).toISOString()
    }));
    expect(value.status('checkout', '2026-07').alerts.map(alert => alert.threshold)).toEqual(expected);
  });
  it('blocks risky deployment at 90 percent', async () => {
    const value = await tracker();
    await value.recordDowntime(event({ start: '2026-07-01T00:00:00Z', end: '2026-07-01T00:41:00Z' }));
    expect(value.status('checkout', '2026-07')).toMatchObject({
      deploymentAllowed: false, deploymentDecision: 'Deployment blocked: error budget is at or above 90% consumed'
    });
  });
  it('marks exhausted budgets noncompliant', async () => {
    const value = await tracker();
    await value.recordDowntime(event({ start: '2026-07-01T00:00:00Z', end: '2026-07-01T01:00:00Z' }));
    expect(value.status('checkout', '2026-07')).toMatchObject({ compliant: false, remainingMs: 0 });
  });
  it('projects exhaustion at current rate', async () => {
    const value = await tracker();
    await value.recordDowntime(event({ start: '2026-07-01T00:00:00Z', end: '2026-07-01T00:30:00Z' }));
    expect(value.status('checkout', '2026-07').projection).toContain('exhausted in');
  });
  it('projects availability when burn rate is low', async () => {
    const value = await tracker();
    await value.recordDowntime(event({ start: '2026-07-01T00:00:00Z', end: '2026-07-01T00:01:00Z' }));
    expect(value.status('checkout', '2026-07').projection).toContain('month end');
  });
  it('does not project exhaustion with no downtime', async () => {
    expect((await tracker()).status('checkout', '2026-07').projection).toContain('not projected');
  });
  it('rejects unknown services', async () => {
    const value = await tracker();
    expect(() => value.status('missing', '2026-07')).toThrow();
  });
  it('generates monthly multi-service compliance', async () => {
    const value = await tracker([config, { service: 'payments', target: 99, budgetWindow: 'month' }]);
    const report = value.complianceReport('2026-07');
    expect(report).toMatchObject({ month: '2026-07', compliantServices: 2, nonCompliantServices: 0 });
    expect(report.services).toHaveLength(2);
  });
  it('reloads persisted downtime', async () => {
    const file = path.join(dir, 'reload.db');
    const first = await SentinelErrorBudgetTracker.open(file, [config], now);
    await first.recordDowntime(event());
    const second = await SentinelErrorBudgetTracker.open(file, [config], now);
    expect(second.status('checkout', '2026-07').downtimeMs).toBe(600_000);
  });
});
