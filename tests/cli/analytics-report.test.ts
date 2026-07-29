import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  analyticsReportCommand,
  redactAnalyticsError,
  writeAnalyticsReport,
  type AnalyticsReportOptions
} from '../../src/cli/report';

function options(directory: string, overrides: Partial<AnalyticsReportOptions> = {}): AnalyticsReportOptions {
  return {
    analytics: true,
    days: '7',
    database: path.join(directory, 'analytics.sqlite'),
    format: 'json',
    ...overrides
  };
}

describe('analytics report CLI', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    process.exitCode = undefined;
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = undefined;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('keeps JSON stdout machine-readable and free of status logs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-analytics-stdout-'));
    await analyticsReportCommand(options(directory));
    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls.map(call => call[0]).join('');
    expect(JSON.parse(output)).toMatchObject({ quality: { status: 'no-data' } });
    expect(output.endsWith('\n')).toBe(true);
  });

  it('creates nested output directories and atomically replaces reports', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-analytics-output-'));
    const output = path.join(directory, 'nested', 'dashboard.json');
    await writeAnalyticsReport(output, 'old');
    await analyticsReportCommand(options(directory, { output }));
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({
      summary: { totalTests: 0 },
      quality: { status: 'no-data' }
    });
    expect((await readdir(path.dirname(output))).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it.each([
    [{ analytics: false }, 'Use --analytics'],
    [{ days: '0' }, '--days'],
    [{ format: 'csv' }, '--format'],
    [{ output: ' ' }, '--output']
  ])('returns a failing exit code for invalid input %j', async (override, expected) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-analytics-invalid-'));
    await analyticsReportCommand(options(directory, override));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining(expected));
  });

  it('cleans temporary files when an atomic destination cannot be replaced', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-analytics-failure-'));
    const destination = path.join(directory, 'destination');
    await writeFile(destination, 'existing');
    await expect(writeAnalyticsReport(path.join(destination, 'report.html'), 'new')).rejects.toBeDefined();
    expect((await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false);
    expect(await readFile(destination, 'utf8')).toBe('existing');
  });

  it('redacts database URLs and named secrets from errors', () => {
    const redacted = redactAnalyticsError(
      new Error('connect postgresql://alice:private@db.example.test/prova password=hunter2 token=abc')
    );
    expect(redacted).toBe(
      'connect [REDACTED_DATABASE_URL] password=[REDACTED] token=[REDACTED]'
    );
    expect(redacted).not.toMatch(/alice|private|hunter2|abc/);
  });
});
