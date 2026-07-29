import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import type { K6CommandExecutor } from '../../src/core/k6-runner';
import { createK6Script, parseK6Summary, runK6, systemK6Executor } from '../../src/core/k6-runner';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
const mockExecFile = execFile as unknown as jest.Mock;

const SUMMARY = {
  metrics: {
    http_req_duration: { values: { 'p(95)': 180.5 } },
    http_req_failed: { values: { rate: 0.01 } },
    http_reqs: { values: { rate: 42.25 } }
  }
};

describe('createK6Script', () => {
  it('creates a minimal script with safe URL serialization and load options', () => {
    const script = createK6Script('https://example.com/path?value="quoted"', 12, 45);
    expect(script).toContain("export const options = { vus: 12, duration: '45s' }");
    expect(script).toContain('http.get("https://example.com/path?value=\\\"quoted\\\"")');
    expect(script).toContain("'status is below 400'");
  });
});

describe('parseK6Summary', () => {
  it('extracts p95 latency, error rate, and requests per second', () => {
    expect(parseK6Summary(SUMMARY)).toEqual({
      ok: true,
      metrics: { p95ResponseTimeMs: 180.5, errorRate: 0.01, requestsPerSecond: 42.25 }
    });
  });

  it('extracts metrics from the direct-field summary format used by k6 v2', () => {
    expect(parseK6Summary({
      metrics: {
        http_req_duration: { 'p(50)': 75, 'p(95)': 180.5, 'p(99)': 240 },
        http_req_failed: { value: 0.01, passes: 1, fails: 99 },
        http_reqs: { count: 100, rate: 42.25 }
      }
    })).toEqual({
      ok: true,
      metrics: {
        p50ResponseTimeMs: 75,
        p95ResponseTimeMs: 180.5,
        p99ResponseTimeMs: 240,
        errorRate: 0.01,
        requestsPerSecond: 42.25
      }
    });
  });

  it('rejects malformed, incomplete, and out-of-range summaries', () => {
    expect(parseK6Summary(null)).toEqual({ ok: false, error: 'k6 summary is not a JSON object' });
    expect(parseK6Summary({ metrics: {} })).toEqual({
      ok: false,
      error: 'k6 summary is missing http_req_duration p(95), http_req_failed rate, or http_reqs rate'
    });
    expect(parseK6Summary({
      metrics: {
        http_req_duration: { values: { 'p(95)': -1 } },
        http_req_failed: { values: { rate: 2 } },
        http_reqs: { values: { rate: 1 } }
      }
    })).toEqual({ ok: false, error: 'k6 summary contains out-of-range performance metrics' });
  });
});

describe('runK6', () => {
  it('uses the injected executor and parses its summary without a real k6 binary', async () => {
    const executor: K6CommandExecutor = {
      async run(scriptPath, summaryPath, controls) {
        expect(await readFile(scriptPath, 'utf-8')).toContain("duration: '10s'");
        expect(controls?.timeoutMs).toBe(40_000);
        await writeFile(summaryPath, JSON.stringify(SUMMARY), 'utf-8');
        return { ok: true };
      }
    };
    await expect(runK6({ url: 'https://example.com', vus: 2, durationSeconds: 10, executor })).resolves.toEqual({
      ok: true,
      metrics: { p95ResponseTimeMs: 180.5, errorRate: 0.01, requestsPerSecond: 42.25 }
    });
  });

  it('returns the actionable installation message for a missing executable', async () => {
    const executor: K6CommandExecutor = { run: async () => ({ ok: false, notFound: true, error: 'missing' }) };
    const result = await runK6({ url: 'https://example.com', vus: 1, durationSeconds: 1, executor });
    expect(result).toEqual({ ok: false, error: 'k6 not found — install from https://k6.io/docs/get-started/installation/' });
  });

  it('returns command and malformed-summary failures without throwing', async () => {
    const failed: K6CommandExecutor = { run: async () => ({ ok: false, error: 'k6 execution failed: threshold crossed' }) };
    await expect(runK6({ url: 'https://example.com', vus: 1, durationSeconds: 1, executor: failed }))
      .resolves.toEqual({ ok: false, error: 'k6 execution failed: threshold crossed' });

    const invalid: K6CommandExecutor = {
      async run(_scriptPath, summaryPath) {
        await writeFile(summaryPath, 'not-json', 'utf-8');
        return { ok: true };
      }
    };
    await expect(runK6({ url: 'https://example.com', vus: 1, durationSeconds: 1, executor: invalid }))
      .resolves.toEqual({ ok: false, error: 'k6 did not produce a valid JSON summary' });
  });

  it('supports request options and redacts header secrets from failures', async () => {
    const script = createK6Script('https://example.com', 1, 1, {
      method: 'POST', headers: { Authorization: 'Bearer secret-value' }, body: { ok: true }
    });
    expect(script).toContain('http.request("POST"');
    expect(script).toContain('Authorization');
    const executor: K6CommandExecutor = {
      run: async () => ({ ok: false, error: 'failed with Bearer secret-value' })
    };
    await expect(runK6({
      url: 'https://example.com', vus: 1, durationSeconds: 1,
      headers: { Authorization: 'Bearer secret-value' }, executor
    })).resolves.toEqual({ ok: false, error: 'failed with [REDACTED]' });
  });

  it('returns a safe error when the injected executor throws', async () => {
    const executor: K6CommandExecutor = { run: async () => { throw new Error('adapter crashed'); } };
    await expect(runK6({ url: 'https://example.com', vus: 1, durationSeconds: 1, executor }))
      .resolves.toEqual({ ok: false, error: 'Unable to run k6: adapter crashed' });
  });

  it('rejects unsafe limits before creating a process and supports cancellation', async () => {
    const executor: K6CommandExecutor = { run: jest.fn() };
    await expect(runK6({ url: 'file:///tmp/a', vus: 1, durationSeconds: 1, executor }))
      .resolves.toEqual({ ok: false, error: 'k6 URL must be an absolute http:// or https:// URL' });
    await expect(runK6({ url: 'https://example.com', vus: 1001, durationSeconds: 1, executor }))
      .resolves.toEqual({ ok: false, error: 'k6 vus must be an integer from 1 to 1000' });
    await expect(runK6({ url: 'https://example.com', vus: 1, durationSeconds: 3601, executor }))
      .resolves.toEqual({ ok: false, error: 'k6 durationSeconds must be an integer from 1 to 3600' });
    await expect(runK6({
      url: 'https://example.com', vus: 1, durationSeconds: 1,
      body: 'x'.repeat((1024 * 1024) + 1), executor
    })).resolves.toEqual({ ok: false, error: 'k6 request body cannot exceed 1 MB' });
    const controller = new AbortController();
    controller.abort();
    await expect(runK6({
      url: 'https://example.com', vus: 1, durationSeconds: 1,
      signal: controller.signal, executor
    })).resolves.toEqual({ ok: false, error: 'k6 execution was cancelled' });
    expect(executor.run).not.toHaveBeenCalled();
  });
});

describe('systemK6Executor', () => {
  beforeEach(() => mockExecFile.mockReset());

  function callback(): (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void {
    const latestCall = mockExecFile.mock.calls[mockExecFile.mock.calls.length - 1];
    return latestCall[3] as (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void;
  }

  it('invokes k6 with summary export and resolves successful completion', async () => {
    const pending = systemK6Executor.run('test.js', 'summary.json');
    expect(mockExecFile).toHaveBeenCalledWith(
      'k6',
      ['run', '--summary-export', 'summary.json', 'test.js'],
      { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 },
      expect.any(Function)
    );
    callback()(null, '', '');
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('identifies ENOENT and reports other command failures without stacks', async () => {
    const missing = systemK6Executor.run('test.js', 'summary.json');
    callback()(Object.assign(new Error('spawn k6 ENOENT'), { code: 'ENOENT' }), '', '');
    await expect(missing).resolves.toEqual({ ok: false, notFound: true, error: 'k6 executable was not found' });

    const failed = systemK6Executor.run('test.js', 'summary.json');
    callback()(Object.assign(new Error('exit 1'), { code: '1' }), '', 'threshold failed');
    await expect(failed).resolves.toEqual({ ok: false, error: 'k6 execution failed: threshold failed' });
  });

  it('reports timeout and cancellation distinctly', async () => {
    const timedOut = systemK6Executor.run('test.js', 'summary.json', { timeoutMs: 1_000 });
    callback()(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), '', '');
    await expect(timedOut).resolves.toEqual({
      ok: false, error: 'k6 execution exceeded 1000ms timeout'
    });
    const cancelled = systemK6Executor.run('test.js', 'summary.json', { timeoutMs: 1_000 });
    callback()(Object.assign(new Error('aborted'), { name: 'AbortError' }), '', '');
    await expect(cancelled).resolves.toEqual({ ok: false, error: 'k6 execution was cancelled' });
  });
});
