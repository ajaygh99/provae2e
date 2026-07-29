import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PerformanceStore, type PerformanceRun } from '../../src/perf/performance-store';
import {
  detectRegressions,
  hasDegradingTrend,
  performanceRunsToCsv,
  performanceRunsToJson,
  performanceRunsToMarkdown
} from '../../src/perf/regression-detector';

const run: PerformanceRun = {
  url: 'https://api.example.com', vus: 10, durationSeconds: 30,
  p50ResponseTimeMs: 50, p95ResponseTimeMs: 100, p99ResponseTimeMs: 150,
  errorRate: 0.01, requestsPerSecond: 25, status: 'PASS', timestamp: '2026-07-21T00:00:00.000Z'
};

describe('PerformanceStore', () => {
  it('persists baselines and history in a reopenable SQLite file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-sqlite-'));
    const file = path.join(directory, 'performance.sqlite');
    const first = await PerformanceStore.open(file);
    expect(first.getSchemaVersion()).toBe(1);
    await first.setBaseline(run);
    await first.addRun(run);
    first.close();
    const reopened = await PerformanceStore.open(file);
    expect(reopened.getBaseline(run.url, 10, 30)).toMatchObject(run);
    expect(reopened.listRuns({ url: run.url })).toEqual([expect.objectContaining(run)]);
    reopened.close();
  });

  it('stores separate baselines for different load profiles', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-sqlite-'));
    const store = await PerformanceStore.open(path.join(directory, 'performance.sqlite'));
    await store.setBaseline(run);
    await store.setBaseline({ ...run, vus: 20, p95ResponseTimeMs: 200 });
    expect(store.getBaseline(run.url, 10, 30)?.p95ResponseTimeMs).toBe(100);
    expect(store.getBaseline(run.url, 20, 30)?.p95ResponseTimeMs).toBe(200);
    expect(store.getBaseline(run.url, 99, 30)).toBeUndefined();
    store.close();
  });

  it('rejects invalid persisted runs', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-sqlite-'));
    const store = await PerformanceStore.open(path.join(directory, 'performance.sqlite'));
    await expect(store.addRun({ ...run, url: 'bad' })).rejects.toThrow('HTTP(S)');
    await expect(store.addRun({ ...run, errorRate: 2 })).rejects.toThrow('between 0 and 1');
    store.close();
  });

  it('serializes concurrent atomic writes and rejects corrupt databases', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-sqlite-'));
    const file = path.join(directory, 'performance.sqlite');
    const store = await PerformanceStore.open(file);
    await Promise.all(Array.from({ length: 10 }, (_, index) => store.addRun({
      ...run,
      timestamp: `2026-07-21T00:00:${String(index).padStart(2, '0')}.000Z`
    })));
    expect(store.listRuns()).toHaveLength(10);
    store.close();
    const reopened = await PerformanceStore.open(file);
    expect(reopened.listRuns()).toHaveLength(10);
    reopened.close();

    const corrupt = path.join(directory, 'corrupt.sqlite');
    await writeFile(corrupt, 'not sqlite');
    await expect(PerformanceStore.open(corrupt)).rejects.toThrow('corrupt');
  });
});

describe('performance regression reporting', () => {
  it('detects latency/error/throughput regressions above threshold', () => {
    const regressions = detectRegressions({
      p50ResponseTimeMs: 70, p95ResponseTimeMs: 120, p99ResponseTimeMs: 180,
      errorRate: 0.02, requestsPerSecond: 20
    }, run, 10);
    expect(regressions.map((item) => item.metric)).toEqual([
      'p50ResponseTimeMs', 'p95ResponseTimeMs', 'p99ResponseTimeMs', 'errorRate', 'requestsPerSecond'
    ]);
  });

  it('ignores fluctuations below the two-percent noise floor', () => {
    expect(detectRegressions({ ...run, p95ResponseTimeMs: 101 }, run, 0)).toEqual([]);
  });

  it('uses absolute floors to avoid noisy low-baseline regressions', () => {
    expect(detectRegressions(
      { ...run, p95ResponseTimeMs: 103, errorRate: 0.0005 },
      { ...run, p95ResponseTimeMs: 100, errorRate: 0 },
      0
    )).toEqual([]);
    expect(detectRegressions(
      { ...run, errorRate: 0.002 },
      { ...run, errorRate: 0 },
      10
    ).map((item) => item.metric)).toContain('errorRate');
  });

  it('rejects invalid policy and metric inputs', () => {
    expect(() => detectRegressions(run, run, -1)).toThrow('threshold');
    expect(() => detectRegressions(run, run, 10, -1)).toThrow('Noise floor');
    expect(() => detectRegressions({ ...run, errorRate: Number.NaN }, run)).toThrow('errorRate');
  });

  it('exports CSV safely and identifies three-run degradation', () => {
    const runs = [run, { ...run, p95ResponseTimeMs: 110 }, { ...run, p95ResponseTimeMs: 120 }];
    expect(hasDegradingTrend(runs)).toBe(true);
    expect(performanceRunsToCsv(runs)).toContain('https://api.example.com');
    expect(JSON.parse(performanceRunsToJson(runs)).summary).toEqual(expect.objectContaining({
      runs: 3, failed: 0, degradingTrend: true
    }));
    expect(performanceRunsToMarkdown(runs)).toContain('| Timestamp | URL | VUs |');
    expect(hasDegradingTrend(runs.slice(0, 2))).toBe(false);
    expect(hasDegradingTrend([run, { ...run, p95ResponseTimeMs: 101 }, { ...run, p95ResponseTimeMs: 102 }])).toBe(false);
  });
});
