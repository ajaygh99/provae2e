import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SentinelDependencyMonitor,
  classifyCvss,
  parseNpmLock,
  parsePom,
  parseRequirements,
  type CveMatch,
  type CveProvider,
  type ProductionDependency
} from '../../src/core/sentinel-dependency-monitor.js';

const dir = path.join(process.cwd(), '.test-sentinel-dependencies');
let index = 0;
const now = (): Date => new Date('2026-07-23T12:00:00Z');

function dependency(overrides: Partial<ProductionDependency> = {}): ProductionDependency {
  return { service: 'checkout', ecosystem: 'npm', name: 'lodash', version: '4.17.20', testIds: ['e2e-1'], ...overrides };
}
function cve(overrides: Partial<CveMatch> = {}): CveMatch {
  return {
    cveId: 'CVE-2026-12345', packageName: 'lodash', ecosystem: 'npm',
    affectedVersions: '<4.17.21', cvssScore: 9.1, description: 'Prototype pollution',
    fixedVersion: '4.17.21', publishedAt: '2026-07-20T00:00:00Z', ...overrides
  };
}
async function monitor(provider: CveProvider = async () => [cve()]): Promise<SentinelDependencyMonitor> {
  index += 1;
  return SentinelDependencyMonitor.open(path.join(dir, `${index}.db`), { provider, now });
}
beforeAll(async () => rm(dir, { recursive: true, force: true }));
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe('dependency manifest parsers', () => {
  it('parses package-lock v3 packages', () => {
    const result = parseNpmLock(JSON.stringify({ packages: {
      '': { version: '1.0.0' }, 'node_modules/lodash': { version: '4.17.21' },
      'node_modules/@scope/pkg': { version: '2.0.0' }
    } }), 'api', ['test-1']);
    expect(result).toEqual([
      { service: 'api', ecosystem: 'npm', name: 'lodash', version: '4.17.21', testIds: ['test-1'] },
      { service: 'api', ecosystem: 'npm', name: '@scope/pkg', version: '2.0.0', testIds: ['test-1'] }
    ]);
  });
  it('rejects malformed npm JSON', () => expect(() => parseNpmLock('{', 'api')).toThrow('JSON'));
  it('requires npm packages', () => expect(() => parseNpmLock('{}', 'api')).toThrow('packages'));
  it('parses pinned requirements and comments', () => {
    expect(parseRequirements('# prod\nrequests==2.32.0\nflask==3.0.0; python_version>=\"3.9\"', 'worker'))
      .toEqual([
        { service: 'worker', ecosystem: 'pip', name: 'requests', version: '2.32.0', testIds: [] },
        { service: 'worker', ecosystem: 'pip', name: 'flask', version: '3.0.0', testIds: [] }
      ]);
  });
  it('rejects unpinned requirements', () => expect(() => parseRequirements('requests>=2', 'worker')).toThrow('pinned'));
  it('parses Maven dependencies', () => {
    const xml = '<project><dependencies><dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>2.0.1</version></dependency></dependencies></project>';
    expect(parsePom(xml, 'java')).toEqual([
      { service: 'java', ecosystem: 'maven', name: 'org.slf4j:slf4j-api', version: '2.0.1', testIds: [] }
    ]);
  });
  it('rejects unresolved Maven versions', () => {
    const xml = '<dependency><groupId>x</groupId><artifactId>y</artifactId><version>${x.version}</version></dependency>';
    expect(() => parsePom(xml, 'java')).toThrow('explicit');
  });
  it.each(['', ' '])('requires service names', service => {
    expect(() => parseRequirements('requests==2', service)).toThrow('service');
  });
});

describe('CVSS classification', () => {
  it.each([[10, 'CRITICAL'], [7, 'CRITICAL'], [6.9, 'HIGH'], [5, 'HIGH'], [4.9, 'MEDIUM'], [0, 'MEDIUM']] as const)(
    'maps %s to %s', (score, severity) => expect(classifyCvss(score)).toBe(severity)
  );
  it.each([-1, 11, Number.NaN])('rejects invalid CVSS %s', score => expect(() => classifyCvss(score)).toThrow('CVSS'));
});

describe('Sentinel dependency monitoring', () => {
  it('captures and deduplicates snapshots', async () => {
    const value = await monitor();
    expect(await value.captureSnapshot([dependency(), dependency()])).toBe(1);
    expect(value.soc2Report('2026-01-01', '2026-12-31').monitoredDependencies).toBe(1);
  });
  it.each([
    [{ service: '' }, 'service'],
    [{ name: '' }, 'name'],
    [{ version: '' }, 'version'],
    [{ ecosystem: 'cargo' as 'npm' }, 'ecosystem']
  ])('validates dependency snapshots', async (override, expected) => {
    const value = await monitor();
    await expect(value.captureSnapshot([dependency(override)])).rejects.toThrow(expected);
  });
  it('polls every dependency', async () => {
    const provider = jest.fn(async () => [cve()]);
    const value = await monitor(provider);
    await value.captureSnapshot([dependency()]);
    expect((await value.poll()).dependenciesChecked).toBe(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('creates critical alerts at CVSS 7', async () => {
    const alerts: string[] = [];
    const value = await SentinelDependencyMonitor.open(path.join(dir, 'alerts.db'), {
      provider: async () => [cve({ cvssScore: 7 })], notifier: async alert => { alerts.push(alert.action); }, now
    });
    await value.captureSnapshot([dependency()]);
    const result = await value.poll();
    expect(result.alertsSent).toBe(1);
    expect(alerts[0]).toBe('Upgrade lodash to 4.17.21 to fix CVE-2026-12345');
  });
  it('does not alert below CVSS 7', async () => {
    const notifier = jest.fn(async () => undefined);
    const value = await SentinelDependencyMonitor.open(path.join(dir, 'medium.db'), {
      provider: async () => [cve({ cvssScore: 6.9 })], notifier, now
    });
    await value.captureSnapshot([dependency()]);
    expect((await value.poll()).alertsSent).toBe(0);
    expect(notifier).not.toHaveBeenCalled();
  });
  it('continues when notification fails', async () => {
    const value = await SentinelDependencyMonitor.open(path.join(dir, 'notify-fail.db'), {
      provider: async () => [cve()], notifier: async () => { throw new Error('offline'); }, now
    });
    await value.captureSnapshot([dependency()]);
    expect(await value.poll()).toMatchObject({ cvesFound: 1, alertsSent: 0, alertFailures: 1 });
  });
  it('links CVE to service and test coverage', async () => {
    const value = await monitor();
    await value.captureSnapshot([dependency()]);
    expect((await value.poll()).findings[0]).toMatchObject({
      cveId: 'CVE-2026-12345', service: 'checkout', dependency: 'lodash', testCoverage: ['e2e-1']
    });
  });
  it('recommends mitigation when no fixed version exists', async () => {
    const value = await monitor(async () => [cve({ fixedVersion: undefined })]);
    await value.captureSnapshot([dependency()]);
    expect((await value.poll()).findings[0].action).toContain('No fixed version');
  });
  it('supports email alert channel', async () => {
    const channels: string[] = [];
    const value = await SentinelDependencyMonitor.open(path.join(dir, 'email.db'), {
      provider: async () => [cve()], notifier: async alert => { channels.push(alert.channel); },
      alertChannel: 'email', now
    });
    await value.captureSnapshot([dependency()]);
    await value.poll();
    expect(channels).toEqual(['email']);
  });
  it('deduplicates repeated CVE polls in compliance evidence', async () => {
    const value = await monitor();
    await value.captureSnapshot([dependency()]);
    await value.poll();
    await value.poll();
    expect(value.soc2Report('2026-01-01', '2026-12-31').findings).toBe(1);
  });
  it('marks findings patched', async () => {
    const value = await monitor();
    await value.captureSnapshot([dependency()]);
    await value.poll();
    expect(await value.markPatched('CVE-2026-12345', 'checkout', 'lodash')).toBe(1);
    expect(value.soc2Report('2026-01-01', '2026-12-31')).toMatchObject({
      open: 0, patched: 1, patchCompliancePercent: 100
    });
  });
  it('returns zero for unknown patch evidence', async () => {
    expect(await (await monitor()).markPatched('CVE-2026-9999', 'none', 'none')).toBe(0);
  });
  it('reports severity and patch compliance', async () => {
    const value = await monitor(async dep => [
      cve({ cveId: 'CVE-2026-10001', cvssScore: 9, packageName: dep.name }),
      cve({ cveId: 'CVE-2026-10002', cvssScore: 6, packageName: dep.name }),
      cve({ cveId: 'CVE-2026-10003', cvssScore: 4, packageName: dep.name })
    ]);
    await value.captureSnapshot([dependency()]);
    await value.poll();
    expect(value.soc2Report('2026-01-01', '2026-12-31')).toMatchObject({
      findings: 3, critical: 1, high: 1, medium: 1, patchCompliancePercent: 0
    });
  });
  it('returns 100 percent compliance with no findings', async () => {
    expect((await monitor()).soc2Report('2026-01-01', '2026-12-31').patchCompliancePercent).toBe(100);
  });
  it.each([
    ['bad', '2026-12-31', 'from'],
    ['2026-01-01', 'bad', 'to'],
    ['2026-12-31', '2026-01-01', 'before']
  ])('validates report dates', async (from, to, expected) => {
    const value = await monitor();
    expect(() => value.soc2Report(from, to)).toThrow(expected);
  });
  it('validates CVE identifiers', async () => {
    const value = await monitor(async () => [cve({ cveId: 'BAD' })]);
    await value.captureSnapshot([dependency()]);
    await expect(value.poll()).rejects.toThrow('CVE id');
  });
  it('validates CVE package matches', async () => {
    const value = await monitor(async () => [cve({ packageName: 'other' })]);
    await value.captureSnapshot([dependency()]);
    await expect(value.poll()).rejects.toThrow('match');
  });
  it('reloads snapshots and findings', async () => {
    const file = path.join(dir, 'reload.db');
    const first = await SentinelDependencyMonitor.open(file, { provider: async () => [cve()], now });
    await first.captureSnapshot([dependency()]);
    await first.poll();
    const second = await SentinelDependencyMonitor.open(file, { provider: async () => [], now });
    expect(second.soc2Report('2026-01-01', '2026-12-31')).toMatchObject({ monitoredDependencies: 1, findings: 1 });
  });
});
