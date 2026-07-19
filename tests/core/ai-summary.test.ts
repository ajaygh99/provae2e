/**
 * AI Summary Tests
 */
import axios from 'axios';
import { generateAiSummary, printAiSummary } from '../../src/core/ai-summary.js';
import { browserResultToCase, apiResultToCase, mobileResultToCase } from '../../src/reporters/allure-reporter.js';
import type { BrowserRunResult } from '../../src/runners/browser-runner.js';
import type { ApiRunResult } from '../../src/runners/api-runner.js';
import type { MobileRunResult } from '../../src/runners/mobile-runner.js';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('generateAiSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ok:true with the summary text on a successful Ollama call', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: '  All tests passed.  ' } });

    const result = await generateAiSummary({
      runs: [{ name: 'browser: https://example.com', status: 'PASS', durationMs: 120, details: {} }]
    });

    expect(result).toEqual({ ok: true, summary: 'All tests passed.' });
  });

  it('sends the configured endpoint, model, and prompt containing pass/fail counts and failure details', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: 'Summary.' } });

    await generateAiSummary({
      runs: [
        { name: 'browser: https://example.com', status: 'PASS', durationMs: 100, details: {} },
        { name: 'api: https://example.com/users', status: 'FAIL', durationMs: 50, error: 'Expected status 200 but got 500', details: {} }
      ],
      endpoint: 'http://localhost:11434/api/generate',
      model: 'llama3.1:8b',
      timeoutMs: 5000
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [endpoint, body, config] = mockedAxios.post.mock.calls[0];
    expect(endpoint).toBe('http://localhost:11434/api/generate');
    expect(body).toMatchObject({ model: 'llama3.1:8b', stream: false });
    expect((body as { prompt: string }).prompt).toContain('Total: 2, Passed: 1, Failed: 1');
    expect((body as { prompt: string }).prompt).toContain('api: https://example.com/users: Expected status 200 but got 500 (50ms)');
    expect(config).toMatchObject({ timeout: 5000 });
  });

  it('reports no failures in the prompt when every case passed', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: 'Summary.' } });

    await generateAiSummary({
      runs: [{ name: 'mobile (iPhone 14): https://example.com', status: 'PASS', durationMs: 80, details: {} }]
    });

    const [, body] = mockedAxios.post.mock.calls[0];
    expect((body as { prompt: string }).prompt).toContain('No failures.');
  });

  it('returns ok:false when Ollama is unreachable', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:11434'));

    const result = await generateAiSummary({
      runs: [{ name: 'browser: https://example.com', status: 'PASS', durationMs: 10, details: {} }]
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('ECONNREFUSED');
  });

  it('returns ok:false when Ollama responds with an empty response field', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: '   ' } });

    const result = await generateAiSummary({
      runs: [{ name: 'browser: https://example.com', status: 'PASS', durationMs: 10, details: {} }]
    });

    expect(result).toEqual({ ok: false, error: 'Ollama returned an empty response' });
  });

  it('returns ok:false when Ollama responds without a response field at all', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: {} });

    const result = await generateAiSummary({
      runs: [{ name: 'browser: https://example.com', status: 'PASS', durationMs: 10, details: {} }]
    });

    expect(result).toEqual({ ok: false, error: 'Ollama returned an empty response' });
  });

  it('works across browser, api, and mobile result shapes normalised via the allure-reporter converters', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: 'Mixed run summary.' } });

    const browserResult: BrowserRunResult = { status: 'PASS', url: 'https://example.com', title: 'Example', durationMs: 100 };
    const apiResult: ApiRunResult = { status: 'FAIL', url: 'https://example.com/api', method: 'GET', statusCode: 500, durationMs: 30, error: 'boom' };
    const mobileResult: MobileRunResult = { status: 'PASS', url: 'https://example.com', device: 'iPhone 14', title: 'Example', durationMs: 200 };

    const result = await generateAiSummary({
      runs: [
        browserResultToCase(browserResult),
        apiResultToCase(apiResult),
        mobileResultToCase(mobileResult)
      ]
    });

    expect(result).toEqual({ ok: true, summary: 'Mixed run summary.' });
    const [, body] = mockedAxios.post.mock.calls[0];
    expect((body as { prompt: string }).prompt).toContain('Total: 3, Passed: 2, Failed: 1');
  });
});

describe('printAiSummary', () => {
  let warnSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('prints the summary to stdout on success', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: 'Everything looks good.' } });

    await printAiSummary({ runs: [{ name: 'browser: https://example.com', status: 'PASS', durationMs: 10, details: {} }] });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Everything looks good.'));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns and does not throw when Ollama is unreachable, never blocking the run', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:11434'));

    await expect(
      printAiSummary({ runs: [{ name: 'browser: https://example.com', status: 'PASS', durationMs: 10, details: {} }] })
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('AI summary unavailable'));
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
