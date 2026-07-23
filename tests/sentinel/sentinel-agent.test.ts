import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SENTINEL_RESOURCE_BUDGET,
  SentinelAgent,
  shouldSample,
  type SentinelCoverageMatcher,
  type SentinelJiraCreator,
  type SentinelJiraIssue
} from '../../src/core/sentinel-agent.js';
import type { LogEntry, LogLevel } from '../../src/core/production-logs-model.js';

const testDir = path.join(process.cwd(), '.test-sentinel');
let index = 0;
const covered: SentinelCoverageMatcher = async () => ({ covered: true, coveragePercent: 100, evidence: 'test-1' });

function log(level: LogLevel = 'ERROR', overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    source: 'datadog',
    level,
    message: 'Database connection failed',
    timestamp: '2026-07-23T10:00:00.000Z',
    tags: { service: 'api' },
    deployment_sha: 'abc123',
    ...overrides
  };
}

async function agent(options: {
  matcher?: SentinelCoverageMatcher;
  jira?: SentinelJiraCreator;
  random?: () => number;
} = {}): Promise<SentinelAgent> {
  index += 1;
  return SentinelAgent.open(path.join(testDir, `${index}.db`), {
    coverageMatcher: options.matcher ?? covered,
    ...(options.jira ? { jiraCreator: options.jira } : {}),
    ...(options.random ? { random: options.random } : {})
  });
}

beforeAll(async () => rm(testDir, { recursive: true, force: true }));
afterAll(async () => rm(testDir, { recursive: true, force: true }));

describe('Sentinel sampling', () => {
  it.each([0, 0.5, 0.999])('samples every error at %s', value => expect(shouldSample('ERROR', value)).toBe(true));
  it.each([[0, true], [0.49, true], [0.5, false], [0.99, false]])(
    'samples warnings at 50%% for %s', (value, expected) => expect(shouldSample('WARNING', value as number)).toBe(expected)
  );
  it.each([[0, true], [0.09, true], [0.1, false], [0.99, false]])(
    'samples info at 10%% for %s', (value, expected) => expect(shouldSample('INFO', value as number)).toBe(expected)
  );
  it.each([0, 0.5, 0.999])('never samples debug at %s', value => expect(shouldSample('DEBUG', value)).toBe(false));
  it.each([-1, 1, Number.NaN])('rejects invalid random value %s', value => {
    expect(() => shouldSample('ERROR', value)).toThrow('randomValue');
  });
  it('rejects unsupported runtime levels', () => {
    expect(() => shouldSample('TRACE' as LogLevel, 0)).toThrow('Unsupported');
  });
});

describe('Sentinel production agent', () => {
  it('documents the lightweight sidecar resource budget', () => {
    expect(SENTINEL_RESOURCE_BUDGET).toEqual({
      deployment: 'sidecar-or-log-processor', maxImageSizeMb: 100, targetCpuPercent: 1
    });
  });

  it('persists covered error evidence', async () => {
    const sentinel = await agent();
    const result = await sentinel.process(log());
    expect(result.evidence).toMatchObject({ covered: true, testCoveragePercent: 100, actionTaken: 'covered' });
    expect(sentinel.listIncidents()).toHaveLength(1);
  });

  it('answers whether the scenario was covered', async () => {
    const sentinel = await agent({ matcher: async () => ({ covered: false, coveragePercent: 0 }) });
    expect((await sentinel.process(log())).evidence?.covered).toBe(false);
  });

  it('does not call coverage matching for dropped logs', async () => {
    const matcher = jest.fn(covered);
    const sentinel = await agent({ matcher, random: () => 0.9 });
    expect(await sentinel.process(log('INFO'))).toEqual({ sampled: false });
    expect(matcher).not.toHaveBeenCalled();
  });

  it('creates JIRA for an uncovered error', async () => {
    const created: SentinelJiraIssue[] = [];
    const jira: SentinelJiraCreator = async issue => {
      created.push(issue);
      return { issueKey: 'SENT-1', issueUrl: 'https://jira/SENT-1' };
    };
    const sentinel = await agent({
      matcher: async () => ({ covered: false, coveragePercent: 20 }),
      jira
    });
    const result = await sentinel.process(log());
    expect(result.evidence).toMatchObject({ actionTaken: 'jira-created', jiraIssueKey: 'SENT-1' });
    expect(created[0]).toMatchObject({
      summary: 'Sentinel: Uncovered Incident - Database connection failed',
      labels: ['sentinel', 'uncovered-incident', 'production']
    });
    expect(created[0].description).toContain('Was this error scenario covered in automated tests? No.');
  });

  it('creates JIRA for an uncovered sampled warning', async () => {
    const jira = jest.fn(async () => ({ issueKey: 'SENT-2' }));
    const sentinel = await agent({
      matcher: async () => ({ covered: false, coveragePercent: 40 }), jira, random: () => 0.1
    });
    expect((await sentinel.process(log('WARNING'))).jira?.issueKey).toBe('SENT-2');
  });

  it('does not create JIRA for covered errors', async () => {
    const jira = jest.fn(async () => ({ issueKey: 'SENT-3' }));
    const sentinel = await agent({ jira });
    await sentinel.process(log());
    expect(jira).not.toHaveBeenCalled();
  });

  it('does not create JIRA for uncovered info', async () => {
    const jira = jest.fn(async () => ({ issueKey: 'SENT-4' }));
    const sentinel = await agent({
      matcher: async () => ({ covered: false, coveragePercent: 0 }), jira, random: () => 0
    });
    expect((await sentinel.process(log('INFO'))).evidence?.actionTaken).toBe('none');
    expect(jira).not.toHaveBeenCalled();
  });

  it('records JIRA failures without crashing the agent', async () => {
    const sentinel = await agent({
      matcher: async () => ({ covered: false, coveragePercent: 0 }),
      jira: async () => { throw new Error('offline'); }
    });
    expect((await sentinel.process(log())).evidence?.actionTaken).toBe('jira-failed');
  });

  it('records empty JIRA issue keys as failures', async () => {
    const sentinel = await agent({
      matcher: async () => ({ covered: false, coveragePercent: 0 }),
      jira: async () => ({ issueKey: ' ' })
    });
    expect((await sentinel.process(log())).evidence?.actionTaken).toBe('jira-failed');
  });

  it('filters uncovered incident evidence', async () => {
    const matcher = jest.fn()
      .mockResolvedValueOnce({ covered: true, coveragePercent: 100 })
      .mockResolvedValueOnce({ covered: false, coveragePercent: 0 });
    const sentinel = await agent({ matcher });
    await sentinel.process(log('ERROR', { message: 'covered' }));
    await sentinel.process(log('ERROR', { message: 'uncovered' }));
    expect(sentinel.listIncidents(true).map(item => item.error)).toEqual(['uncovered']);
  });

  it('preserves append order', async () => {
    const sentinel = await agent();
    await sentinel.process(log('ERROR', { message: 'first' }));
    await sentinel.process(log('ERROR', { message: 'second' }));
    expect(sentinel.listIncidents().map(item => item.error)).toEqual(['first', 'second']);
  });

  it('deduplicates the same log event', async () => {
    const sentinel = await agent();
    await sentinel.process(log());
    await sentinel.process(log());
    expect(sentinel.listIncidents()).toHaveLength(1);
  });

  it('reloads persisted evidence', async () => {
    const file = path.join(testDir, 'reload.db');
    const first = await SentinelAgent.open(file, { coverageMatcher: covered });
    await first.process(log());
    const second = await SentinelAgent.open(file, { coverageMatcher: covered });
    expect(second.listIncidents()[0].deploymentSha).toBe('abc123');
  });

  it('generates different evidence ids for different deployments', async () => {
    const sentinel = await agent();
    const first = await sentinel.process(log());
    const second = await sentinel.process(log('ERROR', { deployment_sha: 'def456' }));
    expect(first.evidence?.id).not.toBe(second.evidence?.id);
  });

  it.each([
    [{ message: '' }, 'message'],
    [{ deployment_sha: '' }, 'deployment_sha'],
    [{ timestamp: 'bad' }, 'timestamp'],
    [{ level: 'TRACE' as LogLevel }, 'Unsupported']
  ])('validates malformed log input', async (override, expected) => {
    const sentinel = await agent();
    await expect(sentinel.process(log('ERROR', override))).rejects.toThrow(expected);
  });

  it.each([-1, 101, Number.NaN])('validates coverage percentage %s', async coveragePercent => {
    const sentinel = await agent({ matcher: async () => ({ covered: false, coveragePercent }) });
    await expect(sentinel.process(log())).rejects.toThrow('coveragePercent');
  });
});
