import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SentinelChangeManagement,
  changeProximityMinutes,
  isSuspiciousTiming,
  correlateChanges,
  computeChangeMetrics,
  deploymentToChange,
  configEventToChange,
  incidentFromEvidence,
  type ChangeInput,
  type ChangeRecord,
  type ChangeCollector,
  type IncidentRef,
  type DatadogConfigEvent
} from '../../src/core/sentinel-change-management.js';
import type { GitHubDeployment } from '../../src/core/github-api-client.js';
import type { SentinelEvidence } from '../../src/core/sentinel-agent.js';

const dir = path.join(process.cwd(), '.test-change-management');
let sequence = 0;
const NOW = new Date('2026-07-23T12:00:00Z');
const now = (): Date => NOW;

async function store(): Promise<SentinelChangeManagement> {
  sequence += 1;
  return SentinelChangeManagement.open(path.join(dir, `${sequence}.db`), { now });
}

function change(overrides: Partial<ChangeInput> = {}): ChangeInput {
  sequence += 1;
  return {
    id: `change-${sequence}`,
    changeType: 'deployment',
    source: 'github',
    service: 'checkout',
    timestamp: '2026-07-23T11:00:00Z',
    details: 'Deployed checkout v2',
    author: 'alice',
    ...overrides
  };
}

/** Builds a stored change record for pure-function tests. */
function record(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    ...change(),
    approvalStatus: 'approved',
    rolledBack: false,
    ...overrides
  };
}

const incident: IncidentRef = {
  id: 'inc-1',
  timestamp: '2026-07-23T12:00:00Z',
  message: 'checkout 500s spike',
  service: 'checkout'
};

class FakeCollector implements ChangeCollector {
  constructor(
    readonly source: ChangeCollector['source'],
    private readonly values: ChangeInput[]
  ) {}
  async collect(): Promise<ChangeInput[]> {
    return this.values;
  }
}

beforeAll(async () => rm(dir, { recursive: true, force: true }));
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe('change log', () => {
  it.each(['deployment', 'config', 'permission'] as const)('records a %s change as pending', async changeType => {
    const value = await store();
    const stored = await value.recordChange(change({ changeType }));
    expect(stored.changeType).toBe(changeType);
    expect(stored.approvalStatus).toBe('pending');
    expect(stored.rolledBack).toBe(false);
    expect(value.listChanges()).toHaveLength(1);
    expect(value.auditLog(stored.id).map(entry => entry.action)).toEqual(['created']);
  });

  it('stores an auto-approved change with an approval audit entry', async () => {
    const value = await store();
    const stored = await value.recordChange(change({ autoApproved: true }));
    expect(stored.approvalStatus).toBe('approved');
    expect(stored.approvedBy).toBe('alice');
    expect(value.auditLog(stored.id).map(entry => entry.action)).toEqual(['created', 'approved']);
  });

  it('deduplicates changes by id', async () => {
    const value = await store();
    const input = change();
    await value.recordChange(input);
    await value.recordChange(input);
    expect(value.listChanges()).toHaveLength(1);
  });

  it.each([
    ['empty id', change({ id: '  ' })],
    ['empty service', change({ service: '' })],
    ['empty details', change({ details: '' })],
    ['empty author', change({ author: '' })],
    ['bad timestamp', change({ timestamp: 'not-a-date' })],
    ['bad changeType', change({ changeType: 'schema' as unknown as ChangeInput['changeType'] })],
    ['bad source', change({ source: 'gitlab' as unknown as ChangeInput['source'] })]
  ])('rejects %s', async (_label, input) => {
    const value = await store();
    await expect(value.recordChange(input)).rejects.toThrow();
  });

  it('rejects opening on a directory path', async () => {
    const databasePath = path.join(dir, 'directory.db');
    await mkdir(databasePath, { recursive: true });
    await expect(SentinelChangeManagement.open(databasePath, { now })).rejects.toThrow();
  });
});

describe('collect from source adapters', () => {
  it('collects and counts new changes only', async () => {
    const value = await store();
    const input = change({ source: 'github' });
    const collector = new FakeCollector('github', [input, input]);
    expect(await value.collect(collector)).toBe(1);
    expect(await value.collect(collector)).toBe(0);
  });

  it('rejects an unsupported collector source', async () => {
    const value = await store();
    const collector = new FakeCollector('github', []);
    Object.defineProperty(collector, 'source', { value: 'gitlab' });
    await expect(value.collect(collector)).rejects.toThrow('Unsupported');
  });

  it('rejects a source mismatch', async () => {
    const value = await store();
    await expect(value.collect(new FakeCollector('github', [change({ source: 'datadog' })])))
      .rejects.toThrow('mismatch');
  });

  it('propagates collector failures', async () => {
    const value = await store();
    const collector: ChangeCollector = {
      source: 'datadog',
      collect: async () => { throw new Error('datadog down'); }
    };
    await expect(value.collect(collector)).rejects.toThrow('datadog down');
  });
});

describe('approval gate and audit log', () => {
  it('approves a pending change and audits it', async () => {
    const value = await store();
    const stored = await value.recordChange(change());
    const approved = await value.approveChange(stored.id, 'boss');
    expect(approved.approvalStatus).toBe('approved');
    expect(approved.approvedBy).toBe('boss');
    expect(approved.approvedAt).toBe(NOW.toISOString());
    expect(value.auditLog(stored.id).map(entry => entry.action)).toEqual(['created', 'approved']);
  });

  it('rejects a pending change with a reason', async () => {
    const value = await store();
    const stored = await value.recordChange(change());
    const rejected = await value.rejectChange(stored.id, 'boss', 'risky');
    expect(rejected.approvalStatus).toBe('rejected');
    expect(value.auditLog(stored.id).find(entry => entry.action === 'rejected')?.detail).toBe('risky');
  });

  it('refuses to approve a non-pending change', async () => {
    const value = await store();
    const stored = await value.recordChange(change({ autoApproved: true }));
    await expect(value.approveChange(stored.id, 'boss')).rejects.toThrow('already approved');
  });

  it('refuses to reject a non-pending change', async () => {
    const value = await store();
    const stored = await value.recordChange(change({ autoApproved: true }));
    await expect(value.rejectChange(stored.id, 'boss')).rejects.toThrow('already');
  });

  it('requires an approver and a known change', async () => {
    const value = await store();
    const stored = await value.recordChange(change());
    await expect(value.approveChange(stored.id, ' ')).rejects.toThrow('approver');
    await expect(value.approveChange('missing', 'boss')).rejects.toThrow('not found');
  });

  it('filters the full audit log', async () => {
    const value = await store();
    const a = await value.recordChange(change());
    await value.recordChange(change());
    expect(value.auditLog().length).toBe(2);
    expect(value.auditLog(a.id)).toHaveLength(1);
  });
});

describe('rollback', () => {
  it('rolls back an approved change and audits it', async () => {
    const value = await store();
    const stored = await value.recordChange(change({ autoApproved: true }));
    const rolled = await value.rollbackChange(stored.id, 'oncall');
    expect(rolled.rolledBack).toBe(true);
    expect(rolled.rolledBackAt).toBe(NOW.toISOString());
    expect(value.auditLog(stored.id).map(entry => entry.action)).toContain('rolled-back');
  });

  it('refuses to roll back an unapproved change', async () => {
    const value = await store();
    const stored = await value.recordChange(change());
    await expect(value.rollbackChange(stored.id, 'oncall')).rejects.toThrow('approved before rollback');
  });

  it('refuses to roll back twice', async () => {
    const value = await store();
    const stored = await value.recordChange(change({ autoApproved: true }));
    await value.rollbackChange(stored.id, 'oncall');
    await expect(value.rollbackChange(stored.id, 'oncall')).rejects.toThrow('already rolled back');
  });
});

describe('incident correlation and suspicious timing', () => {
  it('flags a change inside the suspicious window as the likely culprit', async () => {
    const value = await store();
    await value.recordChange(change({
      id: 'suspect',
      timestamp: '2026-07-23T11:50:00Z',
      rollbackUrl: 'https://github.com/o/r/deployments/production'
    }));
    const result = value.correlateIncident(incident);
    expect(result.likelyCulprit?.change.id).toBe('suspect');
    expect(result.likelyCulprit?.suspicious).toBe(true);
    expect(result.likelyCulprit?.rollbackUrl).toBe('https://github.com/o/r/deployments/production');
  });

  it('treats a change exactly at the window edge as suspicious (inclusive)', async () => {
    const value = await store();
    await value.recordChange(change({ id: 'edge', timestamp: '2026-07-23T11:45:00Z' }));
    const result = value.correlateIncident(incident, { suspiciousWindowMinutes: 15 });
    expect(result.correlatedChanges[0].minutesBeforeIncident).toBe(15);
    expect(result.correlatedChanges[0].suspicious).toBe(true);
  });

  it('treats a change just beyond the window as not suspicious', async () => {
    const value = await store();
    await value.recordChange(change({ id: 'past-edge', timestamp: '2026-07-23T11:44:00Z' }));
    const result = value.correlateIncident(incident, { suspiciousWindowMinutes: 15 });
    expect(result.correlatedChanges[0].minutesBeforeIncident).toBe(16);
    expect(result.correlatedChanges[0].suspicious).toBe(false);
    expect(result.likelyCulprit).toBeUndefined();
  });

  it('treats a simultaneous change as suspicious', async () => {
    const value = await store();
    await value.recordChange(change({ id: 'sim', timestamp: incident.timestamp }));
    const result = value.correlateIncident(incident);
    expect(result.correlatedChanges[0].minutesBeforeIncident).toBe(0);
    expect(result.correlatedChanges[0].suspicious).toBe(true);
  });

  it('excludes changes that occur after the incident', async () => {
    const value = await store();
    await value.recordChange(change({ id: 'after', timestamp: '2026-07-23T12:05:00Z' }));
    const result = value.correlateIncident(incident);
    expect(result.correlatedChanges).toHaveLength(0);
  });

  it('excludes changes older than the lookback window', async () => {
    const value = await store();
    await value.recordChange(change({ id: 'old', timestamp: '2026-07-22T11:00:00Z' }));
    const result = value.correlateIncident(incident, { lookbackMinutes: 1440 });
    expect(result.correlatedChanges).toHaveLength(0);
  });

  it('prefers a same-service change as the culprit and sorts by proximity', async () => {
    const value = await store();
    await value.recordChange(change({ id: 'other', service: 'billing', timestamp: '2026-07-23T11:52:00Z' }));
    await value.recordChange(change({ id: 'same', service: 'checkout', timestamp: '2026-07-23T11:55:00Z' }));
    const result = value.correlateIncident(incident);
    expect(result.correlatedChanges[0].change.id).toBe('same');
    expect(result.likelyCulprit?.change.id).toBe('same');
    expect(result.likelyCulprit?.sameService).toBe(true);
  });

  it('rejects an invalid incident timestamp and invalid windows', () => {
    expect(() => correlateChanges([], { ...incident, timestamp: 'nope' })).toThrow('incident timestamp');
    expect(() => correlateChanges([], incident, { lookbackMinutes: 0 })).toThrow('lookbackMinutes');
    expect(() => correlateChanges([], incident, { suspiciousWindowMinutes: -1 })).toThrow('suspiciousWindowMinutes');
  });
});

describe('pure timing helpers', () => {
  it('measures minutes a change preceded an incident', () => {
    expect(changeProximityMinutes(record({ timestamp: '2026-07-23T11:50:00Z' }), incident)).toBe(10);
    expect(changeProximityMinutes(record({ timestamp: '2026-07-23T12:10:00Z' }), incident)).toBe(-10);
  });

  it('evaluates suspicious timing at boundaries', () => {
    expect(isSuspiciousTiming(record({ timestamp: '2026-07-23T11:45:00Z' }), incident, 15)).toBe(true);
    expect(isSuspiciousTiming(record({ timestamp: '2026-07-23T11:44:00Z' }), incident, 15)).toBe(false);
    expect(isSuspiciousTiming(record({ timestamp: incident.timestamp }), incident, 0)).toBe(true);
  });

  it('rejects a negative suspicious window', () => {
    expect(() => isSuspiciousTiming(record(), incident, -1)).toThrow('windowMinutes');
  });
});

describe('metrics', () => {
  it('returns zeroed metrics for no changes', () => {
    const metrics = computeChangeMetrics([]);
    expect(metrics.totalChanges).toBe(0);
    expect(metrics.changeFrequencyPerDay).toBe(0);
    expect(metrics.rollbackRate).toBe(0);
    expect(metrics.approvalRate).toBe(0);
    expect(metrics.mttrByChangeType.deployment).toBeNull();
  });

  it('aggregates counts, rates, and MTTR by change type', () => {
    const changes: ChangeRecord[] = [
      record({ changeType: 'deployment', approvalStatus: 'approved', timestamp: '2026-07-23T11:00:00Z',
        rolledBack: true, rolledBackAt: '2026-07-23T12:00:00Z' }),
      record({ changeType: 'config', approvalStatus: 'pending', timestamp: '2026-07-24T11:00:00Z' }),
      record({ changeType: 'permission', approvalStatus: 'approved', timestamp: '2026-07-25T11:00:00Z' })
    ];
    const metrics = computeChangeMetrics(changes);
    expect(metrics.totalChanges).toBe(3);
    expect(metrics.changesByType).toEqual({ deployment: 1, config: 1, permission: 1 });
    expect(metrics.rollbackCount).toBe(1);
    expect(metrics.rollbackRate).toBe(round(1 / 3));
    expect(metrics.approvalRate).toBe(round(2 / 3));
    expect(metrics.mttrByChangeType.deployment).toBe(60);
    expect(metrics.mttrByChangeType.config).toBeNull();
    expect(metrics.changeFrequencyPerDay).toBe(1.5);
  });

  it('exposes metrics through the store', async () => {
    const value = await store();
    await value.recordChange(change({ autoApproved: true }));
    expect(value.metrics().totalChanges).toBe(1);
    expect(value.metrics().approvalRate).toBe(1);
  });
});

describe('source mappers', () => {
  it('maps a GitHub deployment to a change input', () => {
    const deployment: GitHubDeployment = {
      id: 42,
      environment: 'production',
      state: 'success',
      creator: { login: 'ci-bot' },
      created_at: '2026-07-23T11:00:00Z',
      updated_at: '2026-07-23T11:05:00Z',
      production_environment: true
    };
    const mapped = deploymentToChange(deployment, 'ajaygh99/provae2e');
    expect(mapped).toMatchObject({
      id: 'github-deploy-42',
      changeType: 'deployment',
      source: 'github',
      service: 'production',
      author: 'ci-bot'
    });
    expect(mapped.rollbackUrl).toContain('ajaygh99/provae2e');
  });

  it('defaults the author when a deployment has no creator and requires a repo', () => {
    const deployment: GitHubDeployment = {
      id: 7, environment: 'staging', state: 'pending', creator: null,
      created_at: '2026-07-23T11:00:00Z', updated_at: '2026-07-23T11:00:00Z',
      production_environment: false
    };
    expect(deploymentToChange(deployment, 'o/r').author).toBe('unknown');
    expect(() => deploymentToChange(deployment, '')).toThrow('repo');
  });

  it('classifies a Datadog permission event and reads the service tag', () => {
    const event: DatadogConfigEvent = {
      id: 'evt-1', title: 'IAM policy updated', text: 'attached admin',
      date_happened: Math.floor(Date.parse('2026-07-23T11:00:00Z') / 1000),
      tags: ['service:checkout', 'iam:role-change']
    };
    const mapped = configEventToChange(event);
    expect(mapped.changeType).toBe('permission');
    expect(mapped.service).toBe('checkout');
    expect(mapped.source).toBe('datadog');
  });

  it('classifies a plain Datadog config event and rejects a bad epoch', () => {
    const event: DatadogConfigEvent = {
      id: 'evt-2', title: 'Feature flag', text: 'enabled beta',
      date_happened: 1_700_000_000, tags: []
    };
    const mapped = configEventToChange(event);
    expect(mapped.changeType).toBe('config');
    expect(mapped.service).toBe('unknown');
    expect(() => configEventToChange({ ...event, date_happened: Number.NaN })).toThrow('date_happened');
  });

  it('maps Sentinel evidence to an incident reference', () => {
    const evidence: SentinelEvidence = {
      id: 'sentinel-abc', timestamp: '2026-07-23T12:00:00Z', level: 'ERROR',
      error: 'checkout 500s', deploymentSha: 'deadbeef', source: 'checkout',
      testCoveragePercent: 0, covered: false, actionTaken: 'none'
    };
    expect(incidentFromEvidence(evidence)).toEqual({
      id: 'sentinel-abc', timestamp: '2026-07-23T12:00:00Z',
      message: 'checkout 500s', service: 'checkout'
    });
  });
});

function round(value: number): number {
  return Number(value.toFixed(2));
}
