import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SentinelCostOptimizer,
  recommendation,
  type CloudCostCollector,
  type CloudCostRecord,
  type CloudProvider
} from '../../src/core/sentinel-cost-optimizer.js';

const dir = path.join(process.cwd(), '.test-cost-optimizer');
let sequence = 0;
const now = (): Date => new Date('2026-07-23T12:00:00Z');

function record(overrides: Partial<CloudCostRecord> = {}): CloudCostRecord {
  sequence += 1;
  return {
    id: `cost-${sequence}`,
    provider: 'aws',
    service: 'checkout',
    resourceId: `i-${sequence}`,
    resourceKind: 'compute',
    month: '2026-07',
    cost: 1000,
    cpuPercent: 5,
    memoryPercent: 10,
    dataTransferGb: 50,
    tags: { environment: 'production' },
    ...overrides
  };
}

async function optimizer(options = {}): Promise<SentinelCostOptimizer> {
  sequence += 1;
  return SentinelCostOptimizer.open(path.join(dir, `${sequence}.db`), { now, ...options });
}

class FakeCollector implements CloudCostCollector {
  constructor(
    readonly provider: CloudProvider,
    private readonly values: CloudCostRecord[]
  ) {}
  async collect(): Promise<CloudCostRecord[]> {
    return this.values;
  }
}

beforeAll(async () => rm(dir, { recursive: true, force: true }));
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe('cost collection', () => {
  it.each(['aws', 'gcp', 'azure'] as const)('collects %s billing records', async provider => {
    const value = await optimizer();
    const input = record({ provider });
    expect(await value.collect(new FakeCollector(provider, [input]), '2026-07')).toBe(1);
    expect(value.monthlyReport('2026-07').costByProvider[provider]).toBe(1000);
  });

  it('deduplicates billing records', async () => {
    const value = await optimizer();
    const input = record();
    expect(await value.record(input)).toBe(true);
    expect(await value.record(input)).toBe(false);
  });

  it('rejects unsupported collector provider', async () => {
    const collector = new FakeCollector('aws', []);
    Object.defineProperty(collector, 'provider', { value: 'oracle' });
    await expect((await optimizer()).collect(collector, '2026-07')).rejects.toThrow('Unsupported');
  });

  it('rejects collector provider mismatch', async () => {
    await expect((await optimizer()).collect(
      new FakeCollector('aws', [record({ provider: 'gcp' })]),
      '2026-07'
    )).rejects.toThrow('provider mismatch');
  });

  it('rejects collector month mismatch', async () => {
    await expect((await optimizer()).collect(
      new FakeCollector('aws', [record({ month: '2026-06' })]),
      '2026-07'
    )).rejects.toThrow('month mismatch');
  });

  it('surfaces database read errors', async () => {
    const databasePath = path.join(dir, 'directory.db');
    await mkdir(databasePath, { recursive: true });
    await expect(SentinelCostOptimizer.open(databasePath)).rejects.toThrow();
  });

  it.each([
    [{ id: '' }, 'id'],
    [{ service: '' }, 'service'],
    [{ resourceId: '' }, 'resourceId'],
    [{ provider: 'oracle' as 'aws' }, 'provider'],
    [{ resourceKind: 'queue' as 'compute' }, 'resourceKind'],
    [{ month: 'July' }, 'YYYY-MM'],
    [{ cost: 0 }, 'cost'],
    [{ cpuPercent: -1 }, 'cpuPercent'],
    [{ cpuPercent: 101 }, 'cpuPercent'],
    [{ memoryPercent: Number.NaN }, 'memoryPercent'],
    [{ dataTransferGb: -1 }, 'dataTransferGb'],
    [{ storageUsedPercent: 101 }, 'storageUsedPercent']
  ])('validates records', async (overrides, message) => {
    await expect((await optimizer()).record(record(overrides))).rejects.toThrow(message);
  });

  it.each([
    [{ autoSurfaceMonthlySavings: -1 }, 'autoSurfaceMonthlySavings'],
    [{ unexpectedIncreasePercent: -1 }, 'unexpectedIncreasePercent']
  ])('validates options', async (options, message) => {
    await expect(optimizer(options)).rejects.toThrow(message);
  });

  it.each(['2026-00', '2026-13', 'bad'])('validates report month %s', async month => {
    const value = await optimizer();
    expect(() => value.monthlyReport(month)).toThrow();
  });

  it('persists costs across reopen', async () => {
    const file = path.join(dir, 'persist.db');
    const first = await SentinelCostOptimizer.open(file, { now });
    await first.record(record());
    const reopened = await SentinelCostOptimizer.open(file, { now });
    expect(reopened.monthlyReport('2026-07').totalCost).toBe(1000);
  });
});

describe('optimization recommendations', () => {
  it('identifies idle compute', () => {
    const result = recommendation(record({ cpuPercent: 0.5, memoryPercent: 4, dataTransferGb: 0.5 }));
    expect(result?.opportunity).toBe('idle-resource');
    expect(result?.monthlySavings).toBe(800);
    expect(result?.recommendation).toContain('turn off after 10 PM');
  });

  it('identifies low utilization', () => {
    const result = recommendation(record());
    expect(result?.opportunity).toBe('low-utilization');
    expect(result?.savingsPercent).toBe(30);
  });

  it('identifies unused storage', () => {
    const result = recommendation(record({
      resourceKind: 'storage',
      storageUsedPercent: 0,
      cost: 250,
      cpuPercent: 0,
      memoryPercent: 0,
      dataTransferGb: 0
    }));
    expect(result?.opportunity).toBe('unused-storage');
    expect(result?.recommendedMonthlyCost).toBe(0);
  });

  it('does not flag healthy resources', () => {
    expect(recommendation(record({ cpuPercent: 40, memoryPercent: 50, dataTransferGb: 200 }))).toBeUndefined();
  });

  it('calculates annual ROI', () => {
    expect(recommendation(record())?.annualSavings).toBe(3600);
  });

  it('auto-surfaces savings over threshold', () => {
    expect(recommendation(record({ cost: 2000 }))?.autoSurfaced).toBe(true);
  });

  it('does not auto-surface savings equal to threshold', () => {
    expect(recommendation(record({ cost: 1000, cpuPercent: 0, memoryPercent: 0, dataTransferGb: 0 }), 800)
      ?.autoSurfaced).toBe(false);
  });

  it('validates recommendation threshold', () => {
    expect(() => recommendation(record(), -1)).toThrow('autoSurface');
  });
});

describe('monthly reporting and trends', () => {
  it('breaks down cost by provider and service', async () => {
    const value = await optimizer();
    await value.record(record({ provider: 'aws', service: 'checkout', cost: 100 }));
    await value.record(record({ provider: 'gcp', service: 'search', cost: 200 }));
    const report = value.monthlyReport('2026-07');
    expect(report.totalCost).toBe(300);
    expect(report.costByService).toEqual({ checkout: 100, search: 200 });
  });

  it('calculates projected monthly and annual savings', async () => {
    const value = await optimizer();
    await value.record(record({ cost: 1000 }));
    const report = value.monthlyReport('2026-07');
    expect(report.projectedMonthlySavings).toBe(300);
    expect(report.projectedAnnualSavings).toBe(3600);
    expect(report.projectedSavingsPercent).toBe(30);
  });

  it('returns zero savings percentage for empty month', async () => {
    expect((await optimizer()).monthlyReport('2026-07').projectedSavingsPercent).toBe(0);
  });

  it('sorts recommendations by savings', async () => {
    const value = await optimizer();
    await value.record(record({ service: 'small', cost: 100 }));
    await value.record(record({ service: 'large', cost: 1000 }));
    expect(value.monthlyReport('2026-07').recommendations[0]?.service).toBe('large');
  });

  it('calculates cost trend from previous month', async () => {
    const value = await optimizer();
    await value.record(record({ month: '2026-06', cost: 100 }));
    await value.record(record({ month: '2026-07', cost: 125 }));
    expect(value.monthlyReport('2026-07').trends[0]).toMatchObject({
      previousCost: 100,
      currentCost: 125,
      changePercent: 25
    });
  });

  it('alerts on unexpected increase', async () => {
    const value = await optimizer();
    await value.record(record({ month: '2026-06', cost: 100 }));
    await value.record(record({ month: '2026-07', cost: 130 }));
    expect(value.monthlyReport('2026-07').alerts[0]).toContain('increased 30%');
  });

  it('does not alert below threshold', async () => {
    const value = await optimizer();
    await value.record(record({ month: '2026-06', cost: 100 }));
    await value.record(record({ month: '2026-07', cost: 110 }));
    expect(value.monthlyReport('2026-07').alerts).toHaveLength(0);
  });

  it('supports custom increase threshold', async () => {
    const value = await optimizer({ unexpectedIncreasePercent: 5 });
    await value.record(record({ month: '2026-06', cost: 100 }));
    await value.record(record({ month: '2026-07', cost: 106 }));
    expect(value.monthlyReport('2026-07').alerts).toHaveLength(1);
  });

  it('handles a newly created service trend', async () => {
    const value = await optimizer();
    await value.record(record({ cost: 100 }));
    expect(value.monthlyReport('2026-07').trends[0]?.changePercent).toBe(100);
    expect(value.monthlyReport('2026-07').alerts).toHaveLength(0);
  });

  it('handles January previous-month rollover', async () => {
    const value = await optimizer();
    await value.record(record({ month: '2025-12', cost: 100 }));
    await value.record(record({ month: '2026-01', cost: 120 }));
    expect(value.monthlyReport('2026-01').trends[0]?.previousCost).toBe(100);
  });

  it('includes report generation timestamp', async () => {
    expect((await optimizer()).monthlyReport('2026-07').generatedAt).toBe('2026-07-23T12:00:00.000Z');
  });

  it('rejects invalid report clock', async () => {
    const value = await SentinelCostOptimizer.open(path.join(dir, 'bad-clock.db'), {
      now: () => new Date('invalid')
    });
    expect(() => value.monthlyReport('2026-07')).toThrow('Current time');
  });
});
