import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SentinelUserImpactAssessor,
  impactAlert,
  preventionRecommendation,
  type IncidentImpactInput
} from '../../src/core/sentinel-user-impact.js';

const dir = path.join(process.cwd(), '.test-user-impact');
let sequence = 0;
const now = (): Date => new Date('2026-07-23T12:00:00Z');

function incident(overrides: Partial<IncidentImpactInput> = {}): IncidentImpactInput {
  sequence += 1;
  return {
    id: `incident-${sequence}`,
    startedAt: '2026-07-10T10:00:00Z',
    endedAt: '2026-07-10T10:02:18Z',
    traceIds: ['trace-1', 'trace-2', 'trace-3'],
    failedRequests: 5000,
    annualRecurringRevenue: 18_000_000,
    dailyActiveUsers: 120_000,
    testCoveragePercent: 0,
    experience: 'Checkout requests returned HTTP 500',
    ...overrides
  };
}

async function assessor(): Promise<SentinelUserImpactAssessor> {
  sequence += 1;
  return SentinelUserImpactAssessor.open(path.join(dir, `${sequence}.db`), now);
}

async function mappedAssessor(): Promise<SentinelUserImpactAssessor> {
  const value = await assessor();
  await value.registerTrace({ traceId: 'trace-1', sessionId: 'session-1', userId: 'user-1' });
  await value.registerTrace({ traceId: 'trace-2', sessionId: 'session-2', userId: 'user-2' });
  await value.registerTrace({ traceId: 'trace-3', sessionId: 'session-3', userId: 'user-2' });
  return value;
}

beforeAll(async () => rm(dir, { recursive: true, force: true }));
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe('Sentinel user impact', () => {
  it('surfaces database read errors', async () => {
    const databasePath = path.join(dir, 'directory.db');
    await mkdir(databasePath, { recursive: true });
    await expect(SentinelUserImpactAssessor.open(databasePath)).rejects.toThrow();
  });

  it.each([
    [{ traceId: '', sessionId: 's', userId: 'u' }, 'traceId'],
    [{ traceId: 't', sessionId: '', userId: 'u' }, 'sessionId'],
    [{ traceId: 't', sessionId: 's', userId: '' }, 'userId']
  ])('validates trace mappings', async (trace, message) => {
    await expect((await assessor()).registerTrace(trace)).rejects.toThrow(message);
  });

  it('correlates unique users and sessions', async () => {
    const result = await (await mappedAssessor()).assessIncident(incident());
    expect(result.usersAffected).toBe(2);
    expect(result.sessionsAffected).toBe(3);
  });

  it('ignores unknown trace ids', async () => {
    const result = await (await mappedAssessor()).assessIncident(incident({ traceIds: ['trace-1', 'missing'] }));
    expect(result.usersAffected).toBe(1);
  });

  it('handles incidents with no trace ids', async () => {
    const result = await (await assessor()).assessIncident(incident({ traceIds: [] }));
    expect(result.usersAffected).toBe(0);
  });

  it('updates an existing trace mapping', async () => {
    const value = await assessor();
    await value.registerTrace({ traceId: 'trace-1', sessionId: 'old', userId: 'old' });
    await value.registerTrace({ traceId: 'trace-1', sessionId: 'new', userId: 'new' });
    const result = await value.assessIncident(incident({ traceIds: ['trace-1'] }));
    expect(result.sessionsAffected).toBe(1);
  });

  it('calculates duration and failed requests', async () => {
    const result = await (await mappedAssessor()).assessIncident(incident());
    expect(result.durationMinutes).toBe(2.3);
    expect(result.requestsFailed).toBe(5000);
  });

  it('calculates revenue per affected user', async () => {
    const result = await (await mappedAssessor()).assessIncident(incident());
    expect(result.revenuePerUser).toBe(5);
    expect(result.revenueAtRisk).toBe(10);
  });

  it('calculates multiplicative severity score', async () => {
    const result = await (await mappedAssessor()).assessIncident(incident());
    expect(result.impactScore).toBe(23);
  });

  it('includes customer experience in assessment', async () => {
    const result = await (await mappedAssessor()).assessIncident(incident());
    expect(result.experience).toContain('HTTP 500');
  });

  it('builds the required alert payload', async () => {
    const result = await (await mappedAssessor()).assessIncident(incident());
    expect(result.alert).toBe('2 users impacted for 2.3 minutes, est. $10 revenue at risk');
  });

  it('formats thousands in alerts', () => {
    expect(impactAlert(3200, 2.3, 500)).toBe(
      '3,200 users impacted for 2.3 minutes, est. $500 revenue at risk'
    );
  });

  it.each([
    [0, 'recommending gap fill'],
    [50, 'recommending coverage improvement'],
    [80, 'no critical test gap detected'],
    [100, 'no critical test gap detected']
  ])('builds preventability recommendation for %s coverage', (coverage, expected) => {
    expect(preventionRecommendation(coverage)).toContain(expected);
  });

  it.each([-1, 101, Number.NaN])('rejects invalid coverage %s', coverage => {
    expect(() => preventionRecommendation(coverage)).toThrow('between 0 and 100');
  });

  it.each([
    [{ id: '' }, 'id'],
    [{ experience: '' }, 'experience'],
    [{ startedAt: 'bad' }, 'startedAt'],
    [{ endedAt: 'bad' }, 'endedAt'],
    [{ endedAt: '2026-07-10T09:00:00Z' }, 'after startedAt'],
    [{ failedRequests: -1 }, 'failedRequests'],
    [{ failedRequests: 1.2 }, 'failedRequests'],
    [{ annualRecurringRevenue: 0 }, 'annualRecurringRevenue'],
    [{ dailyActiveUsers: 0 }, 'dailyActiveUsers'],
    [{ traceIds: [''] }, 'traceIds'],
    [{ testCoveragePercent: 101 }, 'testCoveragePercent']
  ])('validates incident input', async (overrides, message) => {
    await expect((await assessor()).assessIncident(incident(overrides))).rejects.toThrow(message);
  });

  it('retrieves a stored assessment', async () => {
    const value = await mappedAssessor();
    const input = incident();
    const expected = await value.assessIncident(input);
    expect(value.getAssessment(input.id)).toEqual(expected);
  });

  it('returns undefined for unknown assessments', async () => {
    expect((await assessor()).getAssessment('missing')).toBeUndefined();
  });

  it('updates duplicate incident assessments', async () => {
    const value = await mappedAssessor();
    const input = incident();
    await value.assessIncident(input);
    await value.assessIncident({ ...input, failedRequests: 7000 });
    expect(value.getAssessment(input.id)?.requestsFailed).toBe(7000);
  });

  it('persists assessments across reopen', async () => {
    const databasePath = path.join(dir, 'persist.db');
    const first = await SentinelUserImpactAssessor.open(databasePath, now);
    const input = incident({ traceIds: [] });
    await first.assessIncident(input);
    const reopened = await SentinelUserImpactAssessor.open(databasePath, now);
    expect(reopened.getAssessment(input.id)?.incidentId).toBe(input.id);
  });

  it('returns highest-impact incidents for the quarter', async () => {
    const value = await mappedAssessor();
    await value.assessIncident(incident({ id: 'low', annualRecurringRevenue: 1000 }));
    await value.assessIncident(incident({ id: 'high', annualRecurringRevenue: 1_000_000 }));
    const report = value.topQuarterlyIncidents('2026-Q3');
    expect(report.incidents.map(item => item.incidentId)).toEqual(['high', 'low']);
    expect(report.generatedAt).toBe('2026-07-23T12:00:00.000Z');
  });

  it('limits quarterly history to ten incidents', async () => {
    const value = await assessor();
    for (let index = 0; index < 12; index += 1) {
      await value.assessIncident(incident({ id: `rank-${index}`, traceIds: [] }));
    }
    expect(value.topQuarterlyIncidents('2026-Q3').incidents).toHaveLength(10);
  });

  it('excludes incidents outside the quarter', async () => {
    const value = await assessor();
    await value.assessIncident(incident({ startedAt: '2026-06-01T00:00:00Z', endedAt: '2026-06-01T00:01:00Z' }));
    expect(value.topQuarterlyIncidents('2026-Q3').incidents).toHaveLength(0);
  });

  it.each(['2026-Q0', '2026-Q5', 'Q3-2026', ''])('rejects invalid quarter %s', async quarter => {
    const value = await assessor();
    expect(() => value.topQuarterlyIncidents(quarter)).toThrow('quarter must use');
  });

  it('rejects an invalid report clock', async () => {
    const value = await SentinelUserImpactAssessor.open(
      path.join(dir, 'bad-clock.db'),
      () => new Date('invalid')
    );
    expect(() => value.topQuarterlyIncidents('2026-Q3')).toThrow('Current time');
  });
});
