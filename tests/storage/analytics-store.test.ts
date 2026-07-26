import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SQLiteAnalyticsStore } from '../../src/storage/sqlite-analytics-store';
import { calculateAnomalies, calculateFlakyTests, calculateTrends, validateRun } from '../../src/storage/analytics-store';
import type { TestRunRecord } from '../../src/storage/analytics-store';

function run(id: string, day: number, status: TestRunRecord['status'] = 'PASS',
  durationMs = 100, testName = 'checkout'): TestRunRecord {
  return { id, timestamp: new Date(Date.UTC(2026, 0, day)), testName, testType: 'browser', status,
    durationMs, tags: ['ci'], metadata: {} };
}

describe('SQLiteAnalyticsStore', () => {
  let directory: string;
  let store: SQLiteAnalyticsStore;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'prova-analytics-'));
    store = new SQLiteAnalyticsStore(path.join(directory, 'analytics.db'));
    await store.initialize();
  });
  afterEach(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });

  test('persists, queries, exports, and reopens records', async () => {
    await store.saveTestRuns([run('1', 1), run('2', 1, 'FAIL', 200)]);
    expect(await store.getTrends(30, new Date(Date.UTC(2026, 0, 2)))).toEqual([
      expect.objectContaining({ passCount: 1, failCount: 1, averageDuration: 150 })
    ]);
    expect((await store.export('csv')).toString()).toContain('"checkout"');
    await store.close();
    store = new SQLiteAnalyticsStore(path.join(directory, 'analytics.db'));
    await store.initialize();
    expect(await store.getRuns()).toHaveLength(2);
  });

  test('defaults retention cleanup to 90 days', async () => {
    await store.saveTestRuns([run('old', 1), run('new', 100)]);
    expect(await store.cleanup(undefined, new Date(Date.UTC(2026, 3, 11)))).toBe(1);
    expect((await store.getRuns()).map((item) => item.id)).toEqual(['new']);
  });

  test('filters runs and provides analytics helpers from persisted data', async () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      run(String(index), index + 1, index % 2 ? 'FAIL' : 'PASS', 100, 'flaky'));
    await store.saveTestRuns([...rows, run('other', 8, 'PASS', 100, 'other')]);
    expect(await store.getRuns({ testName: 'other', limit: 1 })).toHaveLength(1);
    expect(await store.getFlakiestTests(2, new Date(Date.UTC(2026, 0, 10)))).toEqual([
      expect.objectContaining({ testName: 'flaky' })
    ]);
    expect((await store.detectAnomalies(new Date(Date.UTC(2026, 0, 10))))
      .some((item) => item.type === 'flakiness')).toBe(true);
    expect(JSON.parse((await store.export('json')).toString())).toHaveLength(9);
  });

  test('serves 10,000-row trend queries under 100ms after load', async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) =>
      run(String(index), 1 + index % 30, index % 8 ? 'PASS' : 'FAIL', 50 + index % 100, `test-${index % 40}`));
    await store.saveTestRuns(rows);
    const started = performance.now();
    const trends = await store.getTrends(30, new Date(Date.UTC(2026, 0, 31)));
    expect(performance.now() - started).toBeLessThan(100);
    expect(trends).toHaveLength(30);
  });
});

describe('analytics calculations', () => {
  test('validates malformed records', () => {
    expect(() => validateRun({ ...run('', 1), testName: '' })).toThrow('required');
    expect(() => validateRun({ ...run('1', 1), testType: 'invalid' as never })).toThrow('Invalid test type');
    expect(() => validateRun({ ...run('1', 1), status: 'invalid' as never })).toThrow('Invalid test status');
    expect(() => validateRun({ ...run('1', 1), durationMs: -1 })).toThrow('non-negative');
    expect(() => validateRun({ ...run('1', 1), timestamp: new Date('invalid') })).toThrow('valid Date');
  });

  test('calculates daily trends and ranked flakiness', () => {
    const rows = [run('1', 1), run('2', 1, 'FAIL'), run('3', 2, 'PASS'), run('4', 2, 'FAIL')];
    expect(calculateTrends(rows)).toHaveLength(2);
    expect(calculateFlakyTests(rows, 1)[0]).toEqual(expect.objectContaining({ testName: 'checkout', flakeRate: 1 }));
  });

  test('detects duration, failure-rate, and flakiness anomalies', () => {
    const stable = Array.from({ length: 10 }, (_, index) => run(`s${index}`, index + 1, 'PASS', 100, 'slow'));
    stable.push(run('spike', 11, 'PASS', 1000, 'slow'));
    const failing = Array.from({ length: 12 }, (_, index) => run(`f${index}`, index + 1,
      index < 7 ? 'PASS' : 'FAIL', 100, 'failure'));
    const alternating = Array.from({ length: 8 }, (_, index) => run(`a${index}`, index + 1,
      index % 2 ? 'FAIL' : 'PASS', 100, 'flaky'));
    const types = calculateAnomalies([...stable, ...failing, ...alternating]).map((item) => item.type);
    expect(types).toEqual(expect.arrayContaining(['duration', 'failure_rate', 'flakiness']));
  });

  test('exceeds 85% anomaly precision and recall on labelled duration fixtures', () => {
    const expected = new Set(Array.from({ length: 10 }, (_, index) => `anomaly-${index}`));
    const rows: TestRunRecord[] = [];
    for (let testIndex = 0; testIndex < 40; testIndex += 1) {
      const testName = testIndex < 10 ? `anomaly-${testIndex}` : `normal-${testIndex}`;
      for (let sample = 0; sample < 10; sample += 1) {
        rows.push(run(`${testIndex}-${sample}`, sample + 1, 'PASS', 100 + sample % 2, testName));
      }
      rows.push(run(`${testIndex}-current`, 11, 'PASS', testIndex < 10 ? 500 : 101, testName));
    }
    const detected = new Set(calculateAnomalies(rows).filter((item) => item.type === 'duration')
      .map((item) => item.testName));
    const truePositives = [...detected].filter((name) => expected.has(name)).length;
    const precision = truePositives / detected.size;
    const recall = truePositives / expected.size;
    expect(precision).toBeGreaterThan(0.85);
    expect(recall).toBeGreaterThan(0.85);
  });
});
