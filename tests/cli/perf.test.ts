import { mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildProgram, perfCommand, type PerfActionOptions } from '../../src/cli/run';
import { runK6 } from '../../src/core/k6-runner';

jest.mock('../../src/core/k6-runner', () => ({ runK6: jest.fn() }));
const mockRunK6 = runK6 as jest.MockedFunction<typeof runK6>;

const BASELINE = { p95ResponseTimeMs: 100, errorRate: 0.01, requestsPerSecond: 50 };

function options(overrides: Partial<PerfActionOptions> = {}): PerfActionOptions {
  return { url: 'https://example.com', vus: '10', duration: '30', updateBaseline: false, ...overrides };
}

describe('perfCommand', () => {
  let stderrSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    process.exitCode = undefined;
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('passes a run within the 20% baseline threshold', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'prova-perf-cli-'));
    const baseline = path.join(directory, 'baseline.json');
    await writeFile(baseline, JSON.stringify(BASELINE), 'utf-8');
    mockRunK6.mockResolvedValueOnce({
      ok: true,
      metrics: { p95ResponseTimeMs: 115, errorRate: 0.011, requestsPerSecond: 48 }
    });
    await perfCommand(options({ baseline }));
    expect(mockRunK6).toHaveBeenCalledWith({ url: 'https://example.com', vus: 10, durationSeconds: 30 });
    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Performance check passed'));
  });

  it('fails when p95 latency or error rate regresses beyond 20%', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'prova-perf-regression-'));
    const baseline = path.join(directory, 'baseline.json');
    await writeFile(baseline, JSON.stringify(BASELINE), 'utf-8');
    mockRunK6.mockResolvedValueOnce({
      ok: true,
      metrics: { p95ResponseTimeMs: 130, errorRate: 0.02, requestsPerSecond: 55 }
    });
    await perfCommand(options({ baseline, updateBaseline: true }));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('p95 response time regressed'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('error rate regressed'));
    expect(JSON.parse(await readFile(baseline, 'utf-8'))).toEqual(BASELINE);
  });

  it('reports a missing k6 binary actionably', async () => {
    mockRunK6.mockResolvedValueOnce({
      ok: false,
      error: 'k6 not found — install from https://k6.io/docs/get-started/installation/'
    });
    await perfCommand(options());
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('k6 not found'));
  });

  it('fails for a missing baseline unless update is requested', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'prova-perf-missing-'));
    const baseline = path.join(directory, 'baseline.json');
    await perfCommand(options({ baseline }));
    expect(process.exitCode).toBe(1);
    expect(mockRunK6).not.toHaveBeenCalled();

    process.exitCode = undefined;
    mockRunK6.mockResolvedValueOnce({ ok: true, metrics: BASELINE });
    await perfCommand(options({ baseline, updateBaseline: true }));
    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(await readFile(baseline, 'utf-8'))).toEqual({
      schemaVersion: 1,
      updatedAt: expect.any(String),
      metrics: BASELINE
    });
  });

  it.each([
    [{ vus: '0' }, '--vus'],
    [{ vus: 'abc' }, '--vus'],
    [{ duration: '-1' }, '--duration'],
    [{ duration: 'abc' }, '--duration'],
    [{ url: 'not-a-url' }, '--url']
  ])('rejects invalid performance input %j', async (override, expected) => {
    await perfCommand(options(override));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining(expected));
    expect(mockRunK6).not.toHaveBeenCalled();
  });

  it('requires a baseline path when updating', async () => {
    await perfCommand(options({ updateBaseline: true }));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('requires --baseline'));
  });

  it('accepts a positive fractional duration', async () => {
    mockRunK6.mockResolvedValueOnce({ ok: true, metrics: BASELINE });
    await perfCommand(options({ duration: '1.5' }));
    expect(mockRunK6).toHaveBeenCalledWith({ url: 'https://example.com', vus: 10, durationSeconds: 1.5 });
    expect(process.exitCode).toBeUndefined();
  });
});

describe('perf CLI registration', () => {
  it('exposes URL, load, baseline, and update flags', () => {
    const command = buildProgram().commands.find((candidate) => candidate.name() === 'perf');
    expect(command?.options.map((option) => option.long)).toEqual([
      '--url', '--action', '--database', '--threshold', '--days', '--output', '--format', '--fail-on-trend', '--method',
      '--headers', '--body', '--vus', '--duration', '--baseline', '--update-baseline'
    ]);
    expect(command?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual([]);
  });
});
