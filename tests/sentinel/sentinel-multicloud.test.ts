import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SentinelMultiCloudMonitor,
  type CloudConnector,
  type CloudMetric,
  type InfrastructureCloud
} from '../../src/core/sentinel-multicloud.js';

const dir = path.join(process.cwd(), '.test-multicloud');
let sequence = 0;
const now = (): Date => new Date('2026-07-23T12:00:00Z');

function metric(overrides: Partial<CloudMetric> = {}): CloudMetric {
  sequence += 1;
  return {
    id: `metric-${sequence}`,
    cloud: 'aws',
    region: 'us-east-1',
    service: 'checkout',
    timestamp: '2026-07-23T10:00:00Z',
    latencyMs: 100,
    errorRate: 1,
    throughput: 1000,
    monthlyCost: 500,
    ...overrides
  };
}

async function monitor(): Promise<SentinelMultiCloudMonitor> {
  sequence += 1;
  return SentinelMultiCloudMonitor.open(path.join(dir, `${sequence}.db`), now);
}

class FakeConnector implements CloudConnector {
  constructor(readonly cloud: InfrastructureCloud, private readonly data: CloudMetric[]) {}
  async collect(): Promise<CloudMetric[]> { return this.data; }
}

beforeAll(async () => rm(dir, { recursive: true, force: true }));
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe('multi-cloud metric collection', () => {
  it.each(['aws', 'gcp', 'azure', 'on-prem'] as const)('collects %s metrics', async cloud => {
    const value = await monitor();
    expect(await value.collect(new FakeConnector(cloud, [metric({ cloud })]))).toBe(1);
    expect(value.dashboard(cloud).metrics[0]?.cloud).toBe(cloud);
  });

  it('deduplicates metric ids', async () => {
    const value = await monitor();
    const input = metric();
    expect(await value.recordMetric(input)).toBe(true);
    expect(await value.recordMetric(input)).toBe(false);
  });

  it('rejects connector cloud mismatch', async () => {
    await expect((await monitor()).collect(new FakeConnector('aws', [metric({ cloud: 'gcp' })])))
      .rejects.toThrow('mismatch');
  });

  it('rejects unsupported connectors', async () => {
    await expect((await monitor()).collect(new FakeConnector('oracle' as 'aws', []))).rejects.toThrow('Unsupported');
  });

  it.each([
    [{ id: '' }, 'id'],
    [{ cloud: 'oracle' as 'aws' }, 'cloud'],
    [{ region: '' }, 'region'],
    [{ service: '' }, 'service'],
    [{ timestamp: 'bad' }, 'timestamp'],
    [{ latencyMs: -1 }, 'latencyMs'],
    [{ errorRate: 101 }, 'errorRate'],
    [{ throughput: -1 }, 'throughput'],
    [{ monthlyCost: -1 }, 'monthlyCost']
  ])('validates metrics', async (overrides, message) => {
    await expect((await monitor()).recordMetric(metric(overrides))).rejects.toThrow(message);
  });

  it('surfaces database read errors', async () => {
    const file = path.join(dir, 'directory.db');
    await mkdir(file, { recursive: true });
    await expect(SentinelMultiCloudMonitor.open(file)).rejects.toThrow();
  });

  it('persists metrics across reopen', async () => {
    const file = path.join(dir, 'persist.db');
    const first = await SentinelMultiCloudMonitor.open(file, now);
    await first.recordMetric(metric());
    const reopened = await SentinelMultiCloudMonitor.open(file, now);
    expect(reopened.dashboard().metrics).toHaveLength(1);
  });
});

describe('unified dashboard', () => {
  it('normalizes averages for all clouds', async () => {
    const value = await monitor();
    await value.recordMetric(metric({ latencyMs: 100 }));
    await value.recordMetric(metric({ latencyMs: 200 }));
    expect(value.dashboard().averageByCloud.aws.latencyMs).toBe(150);
  });

  it('keeps empty cloud averages at zero', async () => {
    expect((await monitor()).dashboard().averageByCloud.gcp.latencyMs).toBe(0);
  });

  it('attributes cost per cloud', async () => {
    const value = await monitor();
    await value.recordMetric(metric({ cloud: 'aws', monthlyCost: 500 }));
    await value.recordMetric(metric({ cloud: 'gcp', monthlyCost: 300 }));
    expect(value.dashboard().costByCloud).toMatchObject({ aws: 500, gcp: 300 });
  });

  it('supports cloud drill-down', async () => {
    const value = await monitor();
    await value.recordMetric(metric({ cloud: 'aws' }));
    await value.recordMetric(metric({ cloud: 'gcp' }));
    expect(value.dashboard('gcp').metrics).toHaveLength(1);
  });

  it('rejects invalid cloud selector', async () => {
    const value = await monitor();
    expect(() => value.dashboard('oracle' as 'aws')).toThrow('Unsupported');
  });

  it('includes generation timestamp', async () => {
    expect((await monitor()).dashboard().generatedAt).toBe('2026-07-23T12:00:00.000Z');
  });

  it('rejects invalid clock', async () => {
    const value = await SentinelMultiCloudMonitor.open(path.join(dir, 'clock.db'), () => new Date('bad'));
    expect(() => value.dashboard()).toThrow('Current time');
  });
});

describe('coverage, incidents, and compliance', () => {
  it('records scenario coverage per cloud', async () => {
    const value = await monitor();
    await value.recordCoverage({ scenario: 'checkout happy path', service: 'checkout', clouds: ['aws', 'gcp'] });
    expect(value.dashboard().coverage[0]?.clouds).toEqual(expect.arrayContaining(['aws', 'gcp']));
  });

  it('deduplicates coverage clouds', async () => {
    const value = await monitor();
    await value.recordCoverage({ scenario: 'checkout', service: 'checkout', clouds: ['aws', 'aws'] });
    expect(value.dashboard().coverage[0]?.clouds).toEqual(['aws']);
  });

  it.each([
    [{ scenario: '', service: 'x', clouds: ['aws'] as InfrastructureCloud[] }, 'scenario'],
    [{ scenario: 'x', service: '', clouds: ['aws'] as InfrastructureCloud[] }, 'service'],
    [{ scenario: 'x', service: 'x', clouds: [] as InfrastructureCloud[] }, 'clouds'],
    [{ scenario: 'x', service: 'x', clouds: ['oracle' as 'aws'] }, 'Unsupported']
  ])('validates coverage', async (input, message) => {
    await expect((await monitor()).recordCoverage(input)).rejects.toThrow(message);
  });

  it('detects cross-cloud recurrence', async () => {
    const value = await monitor();
    await value.recordIncident({ id: 'i1', cloud: 'aws', service: 'checkout', signature: 'timeout', timestamp: '2026-07-01T00:00:00Z' });
    await value.recordIncident({ id: 'i2', cloud: 'gcp', service: 'checkout', signature: 'timeout', timestamp: '2026-07-02T00:00:00Z' });
    expect(value.crossCloudFindings()[0]?.affectedClouds).toEqual(expect.arrayContaining(['aws', 'gcp']));
  });

  it('recommends testing untested cloud', async () => {
    const value = await monitor();
    await value.recordCoverage({ scenario: 'checkout', service: 'checkout', clouds: ['aws'] });
    await value.recordIncident({ id: 'i1', cloud: 'aws', service: 'checkout', signature: 'timeout', timestamp: '2026-07-01T00:00:00Z' });
    expect(value.crossCloudFindings()[0]?.recommendation).toContain('GCP');
  });

  it('reports complete coverage without gap recommendation', async () => {
    const value = await monitor();
    await value.recordCoverage({ scenario: 'checkout', service: 'checkout', clouds: ['aws', 'gcp', 'azure', 'on-prem'] });
    await value.recordIncident({ id: 'i1', cloud: 'aws', service: 'checkout', signature: 'timeout', timestamp: '2026-07-01T00:00:00Z' });
    expect(value.crossCloudFindings()[0]?.recommendation).toContain('coverage exists');
  });

  it('deduplicates incidents', async () => {
    const value = await monitor();
    const input = { id: 'i1', cloud: 'aws' as const, service: 'checkout', signature: 'timeout', timestamp: '2026-07-01T00:00:00Z' };
    expect(await value.recordIncident(input)).toBe(true);
    expect(await value.recordIncident(input)).toBe(false);
  });

  it.each([
    [{ id: '', cloud: 'aws', service: 'x', signature: 'x', timestamp: '2026-01-01' }, 'id'],
    [{ id: 'x', cloud: 'aws', service: '', signature: 'x', timestamp: '2026-01-01' }, 'service'],
    [{ id: 'x', cloud: 'aws', service: 'x', signature: '', timestamp: '2026-01-01' }, 'signature'],
    [{ id: 'x', cloud: 'aws', service: 'x', signature: 'x', timestamp: 'bad' }, 'timestamp']
  ])('validates incidents', async (input, message) => {
    await expect((await monitor()).recordIncident(input as Parameters<SentinelMultiCloudMonitor['recordIncident']>[0]))
      .rejects.toThrow(message);
  });

  it('records GDPR and HIPAA requirements', async () => {
    const value = await monitor();
    await value.recordCompliance({ cloud: 'aws', region: 'eu-west-1', frameworks: ['GDPR'] });
    await value.recordCompliance({ cloud: 'azure', region: 'us-east', frameworks: ['HIPAA'] });
    expect(value.dashboard().compliance).toHaveLength(2);
  });

  it('deduplicates compliance frameworks', async () => {
    const value = await monitor();
    await value.recordCompliance({ cloud: 'aws', region: 'eu', frameworks: ['GDPR', 'GDPR'] });
    expect(value.dashboard().compliance[0]?.frameworks).toEqual(['GDPR']);
  });

  it.each([
    [{ cloud: 'aws', region: '', frameworks: ['GDPR'] }, 'region'],
    [{ cloud: 'aws', region: 'eu', frameworks: [] }, 'frameworks'],
    [{ cloud: 'aws', region: 'eu', frameworks: ['BAD'] }, 'Invalid framework']
  ])('validates compliance', async (input, message) => {
    await expect((await monitor()).recordCompliance(input as never)).rejects.toThrow(message);
  });
});
