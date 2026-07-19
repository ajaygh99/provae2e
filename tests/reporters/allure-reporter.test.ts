/**
 * Allure Reporter Tests
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateAllureReport } from '../../src/reporters/allure-reporter';
import type { ReportEntry } from '../../src/reporters/allure-reporter';

describe('Allure Reporter', () => {
  const workDir = path.join(__dirname, '.tmp-allure');
  const outputDir = path.join(workDir, 'report');
  const historyFile = path.join(workDir, 'history.json');
  const screenshotPath = path.join(workDir, 'failure.png');

  beforeAll(() => {
    mkdirSync(workDir, { recursive: true });
    // Minimal valid-looking binary content; content doesn't need to be a real PNG for base64 inlining.
    writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  afterAll(() => {
    if (existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true });
    }
    if (existsSync(historyFile)) {
      rmSync(historyFile, { force: true });
    }
  });

  it('computes correct pass/fail/total counts for mixed entries', async () => {
    const entries: ReportEntry[] = [
      { type: 'browser', status: 'PASS', url: 'https://example.com', durationMs: 120 },
      { type: 'api', status: 'FAIL', url: 'https://example.com/api', durationMs: 45, error: 'boom' },
      { type: 'mobile', status: 'PASS', url: 'https://example.com', durationMs: 300 }
    ];

    const result = await generateAllureReport(entries, { outputDir, historyFile });

    expect(result.total).toBe(3);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('writes a single static HTML file at the expected path', async () => {
    const entries: ReportEntry[] = [{ type: 'browser', status: 'PASS', url: 'https://example.com', durationMs: 50 }];

    const result = await generateAllureReport(entries, { outputDir, historyFile });

    expect(result.reportPath).toBe(path.resolve(outputDir, 'index.html'));
    expect(existsSync(result.reportPath)).toBe(true);
    const html = readFileSync(result.reportPath, 'utf-8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('PROVA Test Report');
  });

  it('includes duration per test in the report', async () => {
    const entries: ReportEntry[] = [{ type: 'api', status: 'PASS', url: 'https://example.com/api', durationMs: 987 }];

    const result = await generateAllureReport(entries, { outputDir, historyFile });

    const html = readFileSync(result.reportPath, 'utf-8');
    expect(html).toContain('987ms');
  });

  it('inlines a screenshot as base64 for a failing entry with a readable screenshot file', async () => {
    const entries: ReportEntry[] = [
      { type: 'browser', status: 'FAIL', url: 'https://example.com', durationMs: 10, screenshotPath, error: 'no title' }
    ];

    const result = await generateAllureReport(entries, { outputDir, historyFile });

    const html = readFileSync(result.reportPath, 'utf-8');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('no title');
  });

  it('does not throw and omits the screenshot when the file cannot be read', async () => {
    const entries: ReportEntry[] = [
      {
        type: 'browser',
        status: 'FAIL',
        url: 'https://example.com',
        durationMs: 10,
        screenshotPath: path.join(workDir, 'does-not-exist.png'),
        error: 'boom'
      }
    ];

    const result = await generateAllureReport(entries, { outputDir, historyFile });

    expect(result.failed).toBe(1);
    const html = readFileSync(result.reportPath, 'utf-8');
    expect(html).not.toContain('data:image/png;base64,');
  });

  it('shows no history on the first run and renders history rows afterward', async () => {
    const entries: ReportEntry[] = [{ type: 'browser', status: 'PASS', url: 'https://example.com', durationMs: 10 }];

    const first = await generateAllureReport(entries, { outputDir, historyFile });
    const firstHtml = readFileSync(first.reportPath, 'utf-8');
    expect(firstHtml).toContain('No run history yet');

    const second = await generateAllureReport(entries, { outputDir, historyFile });
    const secondHtml = readFileSync(second.reportPath, 'utf-8');
    expect(secondHtml).not.toContain('No run history yet');
    expect(secondHtml).toContain('<table>');
  });

  it('creates and appends to the history file across runs', async () => {
    const entries: ReportEntry[] = [{ type: 'api', status: 'PASS', url: 'https://example.com', durationMs: 10 }];

    expect(existsSync(historyFile)).toBe(false);
    await generateAllureReport(entries, { outputDir, historyFile });
    expect(existsSync(historyFile)).toBe(true);

    const afterFirst = JSON.parse(readFileSync(historyFile, 'utf-8')) as unknown[];
    expect(afterFirst).toHaveLength(1);

    await generateAllureReport(entries, { outputDir, historyFile });
    const afterSecond = JSON.parse(readFileSync(historyFile, 'utf-8')) as unknown[];
    expect(afterSecond).toHaveLength(2);
  });

  it('produces a valid empty report for zero entries', async () => {
    const result = await generateAllureReport([], { outputDir, historyFile });

    expect(result).toEqual({ reportPath: path.resolve(outputDir, 'index.html'), passed: 0, failed: 0, total: 0 });
    const html = readFileSync(result.reportPath, 'utf-8');
    expect(html).toContain('No tests were run.');
  });

  it('trims history to the configured historyLimit', async () => {
    const entries: ReportEntry[] = [{ type: 'browser', status: 'PASS', url: 'https://example.com', durationMs: 10 }];

    for (let i = 0; i < 5; i += 1) {
      await generateAllureReport(entries, { outputDir, historyFile, historyLimit: 2 });
    }

    const history = JSON.parse(readFileSync(historyFile, 'utf-8')) as unknown[];
    expect(history).toHaveLength(2);
  });
});
