/**
 * Allure-style HTML Reporter
 * Aggregates PASS/FAIL results from any runner (browser/api/mobile) into a
 * single self-contained static HTML report — pass/fail counts, duration per
 * test, screenshots on failure, and a trend across past runs. No server is
 * required: all data and styling is inlined into one HTML file that opens
 * directly from disk.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { log } from '../core/logger.js';
import type { BrowserRunResult } from '../runners/browser-runner.js';
import type { ApiRunResult } from '../runners/api-runner.js';
import type { MobileRunResult } from '../runners/mobile-runner.js';

/** A single test outcome normalised for reporting, regardless of the runner it came from. */
export interface ReportTestCase {
  /** Human-readable test name, e.g. "browser: https://example.com". */
  name: string;
  /** PASS or FAIL outcome. */
  status: 'PASS' | 'FAIL';
  /** Duration of the run, in milliseconds. */
  durationMs: number;
  /** Error message, present only on FAIL. */
  error?: string;
  /** Path to a screenshot on disk. Only rendered in the report when status is FAIL. */
  screenshotPath?: string;
  /** Extra key/value details rendered under the test case (e.g. page title, HTTP status code). */
  details?: Record<string, string | number>;
}

/** One historical report run, used to render the trend. */
export interface ReportHistoryEntry {
  /** ISO-8601 timestamp of when this report was generated. */
  timestamp: string;
  /** Total number of test cases in that run. */
  total: number;
  /** Number of passed test cases. */
  passed: number;
  /** Number of failed test cases. */
  failed: number;
}

/** Options accepted by {@link generateAllureReport}. */
export interface GenerateReportOptions {
  /** Test cases to include in this report. */
  runs: ReportTestCase[];
  /** Directory the report (and history file) are written into. Defaults to './allure-report'. */
  outputDir?: string;
  /** Injectable clock, for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
}

/** Result of {@link generateAllureReport}. */
export interface GenerateReportResult {
  /** Path to the generated index.html. */
  reportPath: string;
  /** Path to the JSON history file the trend is read from and appended to. */
  historyPath: string;
  /** Pass/fail summary for this run. */
  summary: { total: number; passed: number; failed: number };
  /** Immutable copy of this run's HTML report. */
  archivedReportPath: string;
}

/** Maximum number of past runs kept in the history file / rendered in the trend. */
const MAX_HISTORY_ENTRIES = 20;

/** Escapes text for safe embedding in the generated HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Reads prior report runs from the history file.
 * Treats a missing or unparsable history file as "no history yet" rather than an error.
 */
async function readHistory(historyPath: string): Promise<ReportHistoryEntry[]> {
  if (!existsSync(historyPath)) {
    return [];
  }
  try {
    const raw = await readFile(historyPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ReportHistoryEntry[]) : [];
  } catch (err) {
    log.warn('Could not read report history, starting fresh', { error: String(err) });
    return [];
  }
}

/** Renders the trend section from past report runs, as a simple bar-per-run pass-rate chart. */
function renderTrend(history: ReportHistoryEntry[]): string {
  if (history.length === 0) {
    return '<p class="empty">No run history yet — this is the first report.</p>';
  }
  const bars = history
    .map((entry) => {
      const passRate = entry.total > 0 ? Math.round((entry.passed / entry.total) * 100) : 0;
      const label = `${new Date(entry.timestamp).toLocaleString()}: ${entry.passed}/${entry.total} passed`;
      return `<div class="trend-bar" title="${escapeHtml(label)}"><div class="trend-bar-fill" style="height:${passRate}%"></div></div>`;
    })
    .join('\n');
  return `<div class="trend">${bars}</div>`;
}

/** Renders a single test case as an HTML card, including a failure screenshot when available. */
function renderCase(testCase: ReportTestCase): string {
  const statusClass = testCase.status === 'PASS' ? 'pass' : 'fail';
  const details = testCase.details
    ? Object.entries(testCase.details)
        .map(([key, value]) => `<div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</div>`)
        .join('')
    : '';
  const error = testCase.error ? `<div class="error">${escapeHtml(testCase.error)}</div>` : '';
  // Screenshots are taken to paths relative to the process cwd at run time, which may
  // not match where the generated report's index.html ends up on disk. Resolve to an
  // absolute file:// URL so the <img> tag loads correctly regardless of either location.
  const screenshotSrc = testCase.screenshotPath
    ? pathToFileURL(path.resolve(testCase.screenshotPath)).href
    : undefined;
  const screenshot =
    testCase.status === 'FAIL' && screenshotSrc
      ? `<img class="screenshot" src="${escapeHtml(screenshotSrc)}" alt="Failure screenshot" />`
      : '';
  return `<div class="case ${statusClass}">
    <div class="case-header">
      <span class="badge ${statusClass}">${testCase.status}</span>
      <span class="name">${escapeHtml(testCase.name)}</span>
      <span class="duration">${testCase.durationMs}ms</span>
    </div>
    ${details}
    ${error}
    ${screenshot}
  </div>`;
}

/**
 * Generates a self-contained static HTML report (Allure-style) from a set of
 * test case results, and updates the on-disk run history used for the trend.
 * Never throws for report-generation concerns — a corrupt or missing history
 * file is treated as "no history yet" rather than a failure.
 *
 * @param options - Test cases to report on, output directory, and an injectable clock.
 * @returns Paths to the written report/history files and the pass/fail summary.
 */
export async function generateAllureReport(options: GenerateReportOptions): Promise<GenerateReportResult> {
  const outputDir = options.outputDir ?? './allure-report';
  const now = options.now ?? new Date();
  const historyPath = path.join(outputDir, 'history.json');
  const reportPath = path.join(outputDir, 'index.html');
  const runId = now.toISOString().replace(/[:.]/g, '-');
  const archivedReportPath = path.join(outputDir, 'runs', runId, 'index.html');

  const total = options.runs.length;
  const passed = options.runs.filter((run) => run.status === 'PASS').length;
  const failed = total - passed;

  await mkdir(outputDir, { recursive: true });

  const history = await readHistory(historyPath);
  const updatedHistory = [...history, { timestamp: now.toISOString(), total, passed, failed }].slice(
    -MAX_HISTORY_ENTRIES
  );

  const casesHtml =
    options.runs.length > 0 ? options.runs.map(renderCase).join('\n') : '<p class="empty">No test cases were run.</p>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>PROVA Test Report</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f7f8fa; color: #1a1a1a; }
  header { background: #1a1a2e; color: #fff; padding: 24px; }
  header h1 { margin: 0 0 8px; font-size: 20px; }
  h2 { padding: 0 24px; }
  .summary { display: flex; gap: 16px; padding: 16px 24px; }
  .stat { background: #fff; border-radius: 8px; padding: 12px 20px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .stat .value { font-size: 24px; font-weight: 700; }
  .stat.passed .value { color: #2e7d32; }
  .stat.failed .value { color: #c62828; }
  .trend { display: flex; align-items: flex-end; gap: 4px; height: 60px; padding: 0 24px 16px; }
  .trend-bar { width: 12px; height: 100%; background: #e0e0e0; display: flex; align-items: flex-end; border-radius: 2px; overflow: hidden; }
  .trend-bar-fill { width: 100%; background: #2e7d32; }
  .cases { padding: 0 24px 24px; display: flex; flex-direction: column; gap: 10px; }
  .case { background: #fff; border-radius: 8px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); border-left: 4px solid #ccc; }
  .case.pass { border-left-color: #2e7d32; }
  .case.fail { border-left-color: #c62828; }
  .case-header { display: flex; align-items: center; gap: 10px; }
  .badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; color: #fff; }
  .badge.pass { background: #2e7d32; }
  .badge.fail { background: #c62828; }
  .name { flex: 1; font-weight: 600; }
  .duration { color: #666; font-size: 13px; }
  .error { color: #c62828; margin-top: 8px; font-family: monospace; font-size: 13px; }
  .screenshot { max-width: 320px; margin-top: 10px; border-radius: 4px; border: 1px solid #ddd; }
  .empty { color: #666; padding: 24px; }
</style>
</head>
<body>
<header>
  <h1>PROVA Test Report</h1>
  <div>Generated ${escapeHtml(now.toISOString())}</div>
</header>
<div class="summary">
  <div class="stat"><div class="value">${total}</div><div>Total</div></div>
  <div class="stat passed"><div class="value">${passed}</div><div>Passed</div></div>
  <div class="stat failed"><div class="value">${failed}</div><div>Failed</div></div>
</div>
<h2>Trend</h2>
${renderTrend(updatedHistory)}
<h2>Test Cases</h2>
<div class="cases">
${casesHtml}
</div>
</body>
</html>`;

  await writeFile(reportPath, html, 'utf-8');
  await mkdir(path.dirname(archivedReportPath), { recursive: true });
  await writeFile(archivedReportPath, html, 'utf-8');
  await writeFile(historyPath, JSON.stringify(updatedHistory, null, 2), 'utf-8');

  log.success('Report generated', { reportPath, total, passed, failed });

  return { reportPath, archivedReportPath, historyPath, summary: { total, passed, failed } };
}

/** Converts a {@link BrowserRunResult} into a {@link ReportTestCase}. */
export function browserResultToCase(result: BrowserRunResult): ReportTestCase {
  const details: Record<string, string | number> = {};
  if (result.title !== undefined) {
    details['title'] = result.title;
  }
  if (result.checks?.length) {
    details['checks'] = result.checks.join(', ');
  }
  if (result.warnings?.length) {
    details['limitations'] = result.warnings.join('; ');
  }
  if (result.browser) {
    details['browser'] = result.browser;
  }
  return {
    name: `browser${result.browser && result.browser !== 'chromium' ? `:${result.browser}` : ''}: ${result.url}`,
    status: result.status,
    durationMs: result.durationMs,
    error: result.error,
    screenshotPath: result.screenshotPath,
    details
  };
}

/** Converts an {@link ApiRunResult} into a {@link ReportTestCase}. */
export function apiResultToCase(result: ApiRunResult): ReportTestCase {
  const details: Record<string, string | number> = { method: result.method };
  if (result.statusCode !== undefined) {
    details['statusCode'] = result.statusCode;
  }
  if (result.responseSummary !== undefined) {
    details['response'] = result.responseSummary;
  }
  return {
    name: `api: ${result.url}`,
    status: result.status,
    durationMs: result.durationMs,
    error: result.error,
    details
  };
}

/** Converts a {@link MobileRunResult} into a {@link ReportTestCase}. */
export function mobileResultToCase(result: MobileRunResult): ReportTestCase {
  const details: Record<string, string | number> = { device: result.device };
  if (result.title !== undefined) {
    details['title'] = result.title;
  }
  if (result.checks?.length) {
    details['checks'] = result.checks.join(', ');
  }
  if (result.provider) {
    details['provider'] = result.provider;
  }
  if (result.sessionId) {
    details['sessionId'] = result.sessionId;
  }
  if (result.videoUrl) {
    details['videoUrl'] = result.videoUrl;
  }
  if (result.logUrls?.length) {
    details['logUrls'] = result.logUrls.join(', ');
  }
  return {
    name: `mobile (${result.device}): ${result.url}`,
    status: result.status,
    durationMs: result.durationMs,
    error: result.error,
    screenshotPath: result.screenshotPath,
    details
  };
}
