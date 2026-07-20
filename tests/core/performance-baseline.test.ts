import { mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  comparePerformanceMetrics,
  loadPerformanceBaseline,
  savePerformanceBaseline
} from '../../src/core/performance-baseline';

const BASELINE = { p95ResponseTimeMs: 100, errorRate: 0.01, requestsPerSecond: 50 };

describe('performance baseline persistence', () => {
  it('loads, validates, saves, and recognizes a missing baseline', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'prova-baseline-'));
    const file = path.join(directory, 'nested', 'baseline.json');
    await expect(loadPerformanceBaseline(file)).resolves.toEqual({ ok: true });
    await expect(savePerformanceBaseline(file, BASELINE)).resolves.toEqual({ ok: true });
    await expect(loadPerformanceBaseline(file)).resolves.toEqual({ ok: true, baseline: BASELINE });
    expect(JSON.parse(await readFile(file, 'utf-8'))).toEqual(BASELINE);
  });

  it('returns clear invalid JSON and invalid metric errors', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'prova-baseline-invalid-'));
    const file = path.join(directory, 'baseline.json');
    await writeFile(file, '{broken', 'utf-8');
    await expect(loadPerformanceBaseline(file)).resolves.toEqual({ ok: false, error: `Performance baseline is not valid JSON: ${file}` });
    await writeFile(file, JSON.stringify({ p95ResponseTimeMs: -1, errorRate: 4, requestsPerSecond: 'fast' }), 'utf-8');
    await expect(loadPerformanceBaseline(file)).resolves.toEqual({ ok: false, error: `Performance baseline is invalid: ${file}` });
  });
});

describe('comparePerformanceMetrics', () => {
  it('passes metrics within 20% and reports latency and error regressions beyond it', () => {
    expect(comparePerformanceMetrics({ p95ResponseTimeMs: 120, errorRate: 0.012, requestsPerSecond: 40 }, BASELINE)).toEqual([]);
    const regressions = comparePerformanceMetrics({ p95ResponseTimeMs: 121, errorRate: 0.013, requestsPerSecond: 60 }, BASELINE);
    expect(regressions).toHaveLength(2);
    expect(regressions[0]).toContain('p95 response time regressed');
    expect(regressions[1]).toContain('error rate regressed');
  });

  it('treats any new errors as a regression from a zero-error baseline', () => {
    expect(comparePerformanceMetrics(
      { p95ResponseTimeMs: 100, errorRate: 0.001, requestsPerSecond: 50 },
      { p95ResponseTimeMs: 100, errorRate: 0, requestsPerSecond: 50 }
    )).toHaveLength(1);
  });
});
