/**
 * Allure-style HTML Reporter Tests
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  generateAllureReport,
  browserResultToCase,
  apiResultToCase,
  mobileResultToCase,
  type ReportTestCase
} from '../../src/reporters/allure-reporter';
import type { BrowserRunResult } from '../../src/runners/browser-runner';
import type { ApiRunResult } from '../../src/runners/api-runner';
import type { MobileRunResult } from '../../src/runners/mobile-runner';

describe('Allure Reporter', () => {
  const outputDir = path.join(__dirname, '.tmp-allure-report');

  afterEach(() => {
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  describe('generateAllureReport', () => {
    it('writes an HTML report and a history file with correct pass/fail counts', async () => {
      const runs: ReportTestCase[] = [
        { name: 'browser: https://example.com', status: 'PASS', durationMs: 120 },
        { name: 'api: https://example.com/api', status: 'FAIL', durationMs: 50, error: 'Expected status 200 but got 500' }
      ];

      const result = await generateAllureReport({ runs, outputDir, now: new Date('2026-07-19T10:00:00.000Z') });

      expect(result.summary).toEqual({ total: 2, passed: 1, failed: 1 });
      expect(existsSync(result.reportPath)).toBe(true);
      expect(existsSync(result.historyPath)).toBe(true);

      const html = readFileSync(result.reportPath, 'utf-8');
      expect(html).toContain('PROVA Test Report');
      expect(html).toContain('browser: https://example.com');
      expect(html).toContain('Expected status 200 but got 500');

      const history = JSON.parse(readFileSync(result.historyPath, 'utf-8')) as unknown[];
      expect(history).toHaveLength(1);
    });

    it('renders "no test cases" when runs is empty', async () => {
      const result = await generateAllureReport({ runs: [], outputDir });
      const html = readFileSync(result.reportPath, 'utf-8');

      expect(result.summary).toEqual({ total: 0, passed: 0, failed: 0 });
      expect(html).toContain('No test cases were run.');
    });

    it('renders "no run history" on the first report, then a trend bar on the second', async () => {
      const firstHtml = readFileSync(
        (await generateAllureReport({ runs: [{ name: 'a', status: 'PASS', durationMs: 10 }], outputDir })).reportPath,
        'utf-8'
      );
      expect(firstHtml).toContain('No run history yet');

      const secondResult = await generateAllureReport({
        runs: [{ name: 'b', status: 'FAIL', durationMs: 10 }],
        outputDir
      });
      const secondHtml = readFileSync(secondResult.reportPath, 'utf-8');
      expect(secondHtml).toContain('trend-bar');

      const history = JSON.parse(readFileSync(secondResult.historyPath, 'utf-8')) as unknown[];
      expect(history).toHaveLength(2);
    });

    it('caps history at 20 entries', async () => {
      for (let i = 0; i < 22; i++) {
        // eslint-disable-next-line no-await-in-loop
        await generateAllureReport({ runs: [{ name: `run-${i}`, status: 'PASS', durationMs: 1 }], outputDir });
      }
      const historyPath = path.join(outputDir, 'history.json');
      const history = JSON.parse(readFileSync(historyPath, 'utf-8')) as unknown[];
      expect(history).toHaveLength(20);
    });

    it('treats an unreadable/corrupt history file as empty history rather than throwing', async () => {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(path.join(outputDir, 'history.json'), 'not valid json{{{', 'utf-8');

      const result = await generateAllureReport({ runs: [{ name: 'a', status: 'PASS', durationMs: 1 }], outputDir });

      expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
      const history = JSON.parse(readFileSync(result.historyPath, 'utf-8')) as unknown[];
      expect(history).toHaveLength(1);
    });

    it('treats a history file containing non-array JSON as empty history', async () => {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(path.join(outputDir, 'history.json'), JSON.stringify({ not: 'an array' }), 'utf-8');

      const result = await generateAllureReport({ runs: [{ name: 'a', status: 'PASS', durationMs: 1 }], outputDir });

      const history = JSON.parse(readFileSync(result.historyPath, 'utf-8')) as unknown[];
      expect(history).toHaveLength(1);
    });

    it('only embeds a screenshot for FAIL cases with a screenshotPath', async () => {
      const runs: ReportTestCase[] = [
        { name: 'pass-with-screenshot', status: 'PASS', durationMs: 1, screenshotPath: '/tmp/pass.png' },
        { name: 'fail-with-screenshot', status: 'FAIL', durationMs: 1, screenshotPath: '/tmp/fail.png' },
        { name: 'fail-without-screenshot', status: 'FAIL', durationMs: 1 }
      ];

      const result = await generateAllureReport({ runs, outputDir });
      const html = readFileSync(result.reportPath, 'utf-8');

      expect(html).not.toContain('/tmp/pass.png');
      expect(html).toContain('/tmp/fail.png');
    });

    it('renders details key/value pairs under a test case', async () => {
      const runs: ReportTestCase[] = [
        { name: 'with-details', status: 'PASS', durationMs: 1, details: { statusCode: 200, method: 'GET' } }
      ];

      const result = await generateAllureReport({ runs, outputDir });
      const html = readFileSync(result.reportPath, 'utf-8');

      expect(html).toContain('statusCode');
      expect(html).toContain('200');
      expect(html).toContain('method');
    });

    it('escapes HTML-unsafe characters in names and errors', async () => {
      const runs: ReportTestCase[] = [
        { name: '<script>alert(1)</script>', status: 'FAIL', durationMs: 1, error: '"bad" & <weird>' }
      ];

      const result = await generateAllureReport({ runs, outputDir });
      const html = readFileSync(result.reportPath, 'utf-8');

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('defaults the output directory when none is provided', async () => {
      const defaultDir = path.join(process.cwd(), 'allure-report');
      const result = await generateAllureReport({ runs: [{ name: 'a', status: 'PASS', durationMs: 1 }] });

      expect(result.reportPath).toContain('allure-report');
      expect(existsSync(defaultDir)).toBe(true);
      rmSync(defaultDir, { recursive: true, force: true });
    });
  });

  describe('result converters', () => {
    it('converts a BrowserRunResult, including title when present', () => {
      const result: BrowserRunResult = {
        status: 'PASS',
        url: 'https://example.com',
        title: 'Example',
        durationMs: 100,
        screenshotPath: '/tmp/shot.png'
      };

      expect(browserResultToCase(result)).toEqual({
        name: 'browser: https://example.com',
        status: 'PASS',
        durationMs: 100,
        error: undefined,
        screenshotPath: '/tmp/shot.png',
        details: { title: 'Example' }
      });
    });

    it('converts a BrowserRunResult without a title', () => {
      const result: BrowserRunResult = { status: 'FAIL', url: 'https://example.com', durationMs: 5, error: 'boom' };
      expect(browserResultToCase(result).details).toEqual({});
    });

    it('converts an ApiRunResult, including statusCode and responseSummary when present', () => {
      const result: ApiRunResult = {
        status: 'PASS',
        url: 'https://example.com/api',
        method: 'GET',
        statusCode: 200,
        durationMs: 30,
        responseSummary: '{"ok":true}'
      };

      expect(apiResultToCase(result)).toEqual({
        name: 'api: https://example.com/api',
        status: 'PASS',
        durationMs: 30,
        error: undefined,
        details: { method: 'GET', statusCode: 200, response: '{"ok":true}' }
      });
    });

    it('converts an ApiRunResult without statusCode/responseSummary', () => {
      const result: ApiRunResult = { status: 'FAIL', url: 'https://example.com/api', method: 'GET', durationMs: 5, error: 'timeout' };
      expect(apiResultToCase(result).details).toEqual({ method: 'GET' });
    });

    it('converts a MobileRunResult, including title when present', () => {
      const result: MobileRunResult = {
        status: 'PASS',
        url: 'https://example.com',
        device: 'iPhone 14',
        title: 'Example',
        durationMs: 80,
        screenshotPath: '/tmp/mobile.png'
      };

      expect(mobileResultToCase(result)).toEqual({
        name: 'mobile (iPhone 14): https://example.com',
        status: 'PASS',
        durationMs: 80,
        error: undefined,
        screenshotPath: '/tmp/mobile.png',
        details: { device: 'iPhone 14', title: 'Example' }
      });
    });

    it('converts a MobileRunResult without a title', () => {
      const result: MobileRunResult = { status: 'FAIL', url: 'https://example.com', device: 'iPhone 14', durationMs: 5, error: 'boom' };
      expect(mobileResultToCase(result).details).toEqual({ device: 'iPhone 14' });
    });
  });
});
