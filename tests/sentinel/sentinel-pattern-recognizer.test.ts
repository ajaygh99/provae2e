import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SentinelPatternRecognizer,
  detectSpike,
  extractSentinelPattern,
  type SentinelPatternCoverageMatcher,
  type SentinelPatternEvent
} from '../../src/core/sentinel-pattern-recognizer.js';

const testDir = path.join(process.cwd(), '.test-sentinel-patterns');
let index = 0;
const uncovered: SentinelPatternCoverageMatcher = async () => ({ covered: false, testIds: [], coveragePercent: 0 });

function event(message = 'Request Timeout after 5000 ms', overrides: Partial<SentinelPatternEvent> = {}): SentinelPatternEvent {
  index += 1;
  return {
    log: {
      source: 'datadog',
      level: 'ERROR',
      message,
      timestamp: `2026-07-${String((index % 7) + 1).padStart(2, '0')}T10:00:00.000Z`,
      tags: { service: 'checkout' },
      deployment_sha: `sha-${index}`
    },
    stackTrace: 'at CheckoutClient.send (checkout.ts:42:7)',
    ...overrides
  };
}

async function store(matcher: SentinelPatternCoverageMatcher = uncovered): Promise<SentinelPatternRecognizer> {
  index += 1;
  return SentinelPatternRecognizer.open(path.join(testDir, `${index}.db`), { coverageMatcher: matcher });
}

beforeAll(async () => rm(testDir, { recursive: true, force: true }));
afterAll(async () => rm(testDir, { recursive: true, force: true }));

describe('Sentinel pattern extraction', () => {
  it('extracts all signature dimensions', () => {
    expect(extractSentinelPattern(event())).toMatchObject({
      service: 'checkout', errorType: 'timeout',
      messagePrefix: 'request timeout after <n> ms',
      stackTopFrame: 'at checkoutclient.send (checkout.ts:<n>:<n>)'
    });
  });
  it('normalizes different numeric parameters', () => {
    expect(extractSentinelPattern(event('Request Timeout after 1000 ms')).messagePrefix)
      .toBe(extractSentinelPattern(event('Request Timeout after 9000 ms')).messagePrefix);
  });
  it('normalizes UUIDs and URLs', () => {
    const pattern = extractSentinelPattern(event('Error 123e4567-e89b-12d3-a456-426614174000 at https://api/x'));
    expect(pattern.messagePrefix).toBe('error <id> at <url>');
  });
  it('uses unknown when service is absent', () => {
    expect(extractSentinelPattern(event('boom', { log: { ...event().log, tags: {} } })).service).toBe('unknown');
  });
  it.each([
    ['TypeError: bad value', 'typeerror'],
    ['NullPointerException happened', 'nullpointerexception'],
    ['connection timed out', 'timeout'],
    ['plain failure', 'error']
  ])('extracts error type from %s', (message, expected) => {
    expect(extractSentinelPattern(event(message)).errorType).toBe(expected);
  });
  it('rejects blank messages', () => {
    expect(() => extractSentinelPattern(event(' '))).toThrow('message');
  });
  it('rejects invalid timestamps', () => {
    const value = event();
    value.log.timestamp = 'bad';
    expect(() => extractSentinelPattern(value)).toThrow('timestamp');
  });
});

describe('spike detection', () => {
  it('detects a two-times spike', () => {
    expect(detectSpike([{ date: '2026-01-01', count: 2 }, { date: '2026-01-02', count: 4 }])).toEqual({ detected: true, ratio: 2 });
  });
  it('does not flag normal variation', () => {
    expect(detectSpike([{ date: '2026-01-01', count: 3 }, { date: '2026-01-02', count: 4 }]).detected).toBe(false);
  });
  it('sorts dates before assessing latest', () => {
    expect(detectSpike([{ date: '2026-01-02', count: 6 }, { date: '2026-01-01', count: 2 }]).detected).toBe(true);
  });
  it('requires a baseline day', () => {
    expect(detectSpike([{ date: '2026-01-01', count: 9 }])).toEqual({ detected: false, ratio: 0 });
  });
  it.each([1, 0, Number.NaN])('rejects invalid multiplier %s', multiplier => {
    expect(() => detectSpike([], multiplier)).toThrow('multiplier');
  });
});

describe('Sentinel clusters and gap reporting', () => {
  it('persists and reloads patterns', async () => {
    const file = path.join(testDir, 'reload.db');
    const first = await SentinelPatternRecognizer.open(file, { coverageMatcher: uncovered });
    await first.ingest(event());
    const second = await SentinelPatternRecognizer.open(file, { coverageMatcher: uncovered });
    expect((await second.gapReport('2026-07-01', '2026-07-31')).totalPatterns).toBe(1);
  });
  it('clusters timeout variants across services', async () => {
    const recognizer = await store();
    await recognizer.ingest(event('Request Timeout after 1000 ms'));
    const second = event('Request Timeout after 9000 ms');
    second.log.tags = { service: 'payments' };
    await recognizer.ingest(second);
    const pattern = (await recognizer.gapReport('2026-07-01', '2026-07-31')).topUncoveredPatterns[0];
    expect(pattern.count).toBe(2);
    expect(pattern.services).toEqual(['checkout', 'payments']);
  });
  it('keeps different error types separate', async () => {
    const recognizer = await store();
    await recognizer.ingest(event('TypeError request failed'));
    await recognizer.ingest(event('AuthError request failed'));
    expect((await recognizer.gapReport('2026-07-01', '2026-07-31')).totalPatterns).toBe(2);
  });
  it('deduplicates the exact same event', async () => {
    const recognizer = await store();
    const same = event();
    await recognizer.ingest(same);
    await recognizer.ingest(same);
    expect((await recognizer.gapReport('2026-07-01', '2026-07-31')).topUncoveredPatterns[0].count).toBe(1);
  });
  it('filters events outside the range', async () => {
    const recognizer = await store();
    const old = event();
    old.log.timestamp = '2025-01-01T00:00:00Z';
    await recognizer.ingest(old);
    expect((await recognizer.gapReport('2026-07-01', '2026-07-31')).totalPatterns).toBe(0);
  });
  it('excludes covered patterns from the gap list', async () => {
    const recognizer = await store(async () => ({ covered: true, testIds: ['test-1'], coveragePercent: 100 }));
    await recognizer.ingest(event());
    const report = await recognizer.gapReport('2026-07-01', '2026-07-31');
    expect(report).toMatchObject({ totalPatterns: 1, uncoveredPatterns: 0, topUncoveredPatterns: [] });
  });
  it('returns top five uncovered patterns by default', async () => {
    const recognizer = await store();
    for (const errorType of ['TypeError', 'AuthError', 'NetworkError', 'ParseError', 'SchemaError', 'StateError', 'CacheError']) {
      await recognizer.ingest(event(`${errorType} category failed`));
    }
    expect((await recognizer.gapReport('2026-07-01', '2026-07-31')).topUncoveredPatterns).toHaveLength(5);
  });
  it('honors a custom report limit', async () => {
    const recognizer = await store();
    await recognizer.ingest(event('TypeError one'));
    await recognizer.ingest(event('AuthError two'));
    expect((await recognizer.gapReport('2026-07-01', '2026-07-31', 1)).topUncoveredPatterns).toHaveLength(1);
  });
  it('ranks spikes ahead of non-spikes', async () => {
    const recognizer = await store();
    const normal = event('TypeError normal');
    normal.log.timestamp = '2026-07-01T00:00:00Z';
    await recognizer.ingest(normal);
    const spikeBase = event('AuthError spike');
    spikeBase.log.timestamp = '2026-07-01T01:00:00Z';
    await recognizer.ingest(spikeBase);
    for (let count = 0; count < 3; count += 1) {
      const spike = event('AuthError spike');
      spike.log.timestamp = `2026-07-02T0${count}:00:00Z`;
      await recognizer.ingest(spike);
    }
    expect((await recognizer.gapReport('2026-07-01', '2026-07-31')).topUncoveredPatterns[0].spike).toBe(true);
  });
  it('provides daily visualization data', async () => {
    const recognizer = await store();
    const first = event();
    first.log.timestamp = '2026-07-01T00:00:00Z';
    const second = event();
    second.log.timestamp = '2026-07-02T00:00:00Z';
    await recognizer.ingest(first);
    await recognizer.ingest(second);
    expect((await recognizer.gapReport('2026-07-01', '2026-07-31')).topUncoveredPatterns[0].dailyTrend)
      .toEqual([{ date: '2026-07-01', count: 1 }, { date: '2026-07-02', count: 1 }]);
  });
  it.each([
    ['bad', '2026-07-31', 5, 'from'],
    ['2026-07-01', 'bad', 5, 'to'],
    ['2026-08-01', '2026-07-01', 5, 'before'],
    ['2026-07-01', '2026-07-31', 0, 'limit']
  ])('validates report inputs', async (from, to, limit, expected) => {
    const recognizer = await store();
    await expect(recognizer.gapReport(from, to, limit)).rejects.toThrow(expected);
  });
  it.each([-1, 101, Number.NaN])('validates coverage %s', async coveragePercent => {
    const recognizer = await store(async () => ({ covered: false, testIds: [], coveragePercent }));
    await recognizer.ingest(event());
    await expect(recognizer.gapReport('2026-07-01', '2026-07-31')).rejects.toThrow('coveragePercent');
  });
  it('requires test evidence for covered patterns', async () => {
    const recognizer = await store(async () => ({ covered: true, testIds: [], coveragePercent: 100 }));
    await recognizer.ingest(event());
    await expect(recognizer.gapReport('2026-07-01', '2026-07-31')).rejects.toThrow('test id');
  });
  it('validates clustering options', async () => {
    await expect(SentinelPatternRecognizer.open(path.join(testDir, 'bad.db'), {
      coverageMatcher: uncovered, similarityThreshold: 2
    })).rejects.toThrow('similarityThreshold');
  });
  it('validates spike options', async () => {
    await expect(SentinelPatternRecognizer.open(path.join(testDir, 'bad-spike.db'), {
      coverageMatcher: uncovered, spikeMultiplier: 1
    })).rejects.toThrow('spikeMultiplier');
  });
});
