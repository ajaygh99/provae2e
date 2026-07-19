/**
 * Allure HTML Reporter — turns runner results (browser/api/mobile) into a
 * single, self-contained static HTML report (screenshots inlined as base64
 * data URIs) that opens directly via `file://`, no server required.
 *
 * `allure-playwright` (see package.json) is a `@playwright/test` reporter that
 * hooks into that runner's test lifecycle; this CLI drives Playwright directly
 * (chromium/request) rather than through `@playwright/test`, so there are no
 * Playwright Test cases for it to attach to. This module produces an
 * Allure-style report (summary, durations, failure screenshots, trend) from
 * the plain result objects the runners already return, with no dependency on
 * the Java-based `allure-commandline` tool.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from '../core/logger.js';

/** The kind of runner that produced a {@link ReportEntry}. */
export type ReportRunType = 'browser' | 'api' | 'mobile';

/** A single test outcome to include in the report, normalized across all runners. */
export interface ReportEntry {
  /** Which runner produced this result. */
  type: ReportRunType;
  /** PASS or FAIL outcome. */
  status: 'PASS' | 'FAIL';
  /** The URL that was tested. */
  url: string;
  /** Wall-clock duration of the run, in milliseconds. */
  durationMs: number;
  /** Human-readable label. Defaults to `${type} ${url}` when omitted. */
  name?: string;
  /** Path to a screenshot on disk to inline into the report, when available. */
  screenshotPath?: string;
  /** Failure message, when status is FAIL. */
  error?: string;
}

/** Options accepted by {@link generateAllureReport}. */
export interface AllureReportOptions {
  /** Directory the static HTML report is written into. Defaults to './allure-report'. */
  outputDir?: string;
  /** JSON file used to persist run history for the trend section. Defaults to './.prova/run-history.json'. */
  historyFile?: string;
  /** Maximum number of past runs to keep/show in the trend section. Defaults to 10. */
  historyLimit?: number;
}

/** One row of persisted run history, used to render the trend section. */
export interface RunHistoryRecord {
  /** ISO timestamp of when the run completed. */
  timestamp: string;
  /** Number of passed entries in that run. */
  passed: number;
  /** Number of failed entries in that run. */
  failed: number;
  /** Total number of entries in that run. */
  total: number;
}

/** Outcome of {@link generateAllureReport}. */
export interface AllureReportResult {
  /** Absolute path to the generated index.html file. */
  reportPath: string;
  /** Number of passed entries in this run. */
  passed: number;
  /** Number of failed entries in this run. */
  failed: number;
  /** Total number of entries in this run. */
  total: number;
}

const DEFAULT_OUTPUT_DIR = './allure-report';
const DEFAULT_HISTORY_FILE = './.prova/run-history.json';
const DEFAULT_HISTORY_LIMIT = 10;

/** Escapes text for safe embedding inside HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Reads a screenshot file and returns it as a base64 data URI, or undefined if it can't be read. */
async function inlineScreenshot(screenshotPath: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(screenshotPath);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch (err) {
    log.warn('Could not read screenshot for report', { screenshotPath, error: String(err) });
    return undefined;
  }
}

/** Reads and parses the run history file, returning an empty array if it doesn't exist or is invalid. */
async function readHistory(historyFile: string): Promise<RunHistoryRecord[]> {
  try {
    const raw = await readFile(historyFile, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RunHistoryRecord[]) : [];
  } catch {
    return [];
  }
}

/** Persists the run history file, trimmed to the configured limit. */
async function writeHistory(historyFile: string, history: RunHistoryRecord[]): Promise<void> {
  await mkdir(path.dirname(historyFile), { recursive: true });
  await writeFile(historyFile, JSON.stringify(history, null, 2), 'utf-8');
}

/** Renders the pass/fail trend section from prior run history. */
function renderTrend(history: RunHistoryRecord[]): string {
  if (history.length === 0) {
    return '<p class="empty">No run history yet — this is the first recorded run.</p>';
  }
  const rows = history
    .map(
      (record) =>
        `<tr><td>${escapeHtml(record.timestamp)}</td><td class="pass">${record.passed}</td><td class="fail">${record.failed}</td><td>${record.total}</td></tr>`
    )
    .join('');
  return `
    <table>
      <thead><tr><th>Run</th><th>Passed</th><th>Failed</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Renders the detail table of individual test entries, including inlined screenshots. */
function renderEntries(entries: ReportEntry[], screenshots: (string | undefined)[]): string {
  if (entries.length === 0) {
    return '<p class="empty">No tests were run.</p>';
  }
  const rows = entries
    .map((entry, index) => {
      const name = escapeHtml(entry.name ?? `${entry.type} ${entry.url}`);
      const statusClass = entry.status === 'PASS' ? 'pass' : 'fail';
      const errorCell = entry.error ? escapeHtml(entry.error) : '';
      const screenshot = screenshots[index];
      const screenshotCell = screenshot
        ? `<img src="${screenshot}" alt="Screenshot for ${name}" class="screenshot" />`
        : '';
      return `<tr class="${statusClass}">
        <td>${name}</td>
        <td>${escapeHtml(entry.type)}</td>
        <td class="${statusClass}">${entry.status}</td>
        <td>${entry.durationMs}ms</td>
        <td>${errorCell}</td>
        <td>${screenshotCell}</td>
      </tr>`;
    })
    .join('');
  return `
    <table>
      <thead><tr><th>Test</th><th>Type</th><th>Status</th><th>Duration</th><th>Error</th><th>Screenshot</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Builds the full static HTML document for the report. */
function renderHtml(
  entries: ReportEntry[],
  screenshots: (string | undefined)[],
  history: RunHistoryRecord[],
  summary: { passed: number; failed: number; total: number }
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>PROVA Test Report</title>
<style>
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { margin-bottom: 0.25rem; }
  .summary { display: flex; gap: 1.5rem; margin: 1rem 0 2rem; }
  .summary .card { padding: 0.75rem 1.25rem; border-radius: 8px; background: #f4f4f5; }
  .summary .pass { color: #15803d; }
  .summary .fail { color: #b91c1c; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e5e5; font-size: 0.9rem; }
  tr.fail td.fail { color: #b91c1c; font-weight: 600; }
  tr.pass td.pass { color: #15803d; font-weight: 600; }
  .screenshot { max-width: 160px; max-height: 120px; border: 1px solid #d4d4d4; }
  .empty { color: #737373; font-style: italic; }
</style>
</head>
<body>
  <h1>PROVA Test Report</h1>
  <p>Generated ${new Date().toISOString()}</p>
  <div class="summary">
    <div class="card">Total: ${summary.total}</div>
    <div class="card pass">Passed: ${summary.passed}</div>
    <div class="card fail">Failed: ${summary.failed}</div>
  </div>
  <h2>Results</h2>
  ${renderEntries(entries, screenshots)}
  <h2>Trend</h2>
  ${renderTrend(history)}
</body>
</html>`;
}

/**
 * Generates a static, self-contained HTML test report from a set of runner results.
 * Inlines any available screenshots as base64 data URIs and appends the run's
 * pass/fail counts to a local history file to render a trend section. Never
 * throws on a missing/unreadable screenshot or a missing/corrupt history file —
 * both degrade gracefully to an empty state.
 *
 * @param entries - The test results to include in the report.
 * @param options - Output location, history file location, and trend depth.
 * @returns The path to the generated report and its pass/fail/total counts.
 */
export async function generateAllureReport(
  entries: ReportEntry[],
  options?: AllureReportOptions
): Promise<AllureReportResult> {
  const outputDir = options?.outputDir ?? DEFAULT_OUTPUT_DIR;
  const historyFile = options?.historyFile ?? DEFAULT_HISTORY_FILE;
  const historyLimit = options?.historyLimit ?? DEFAULT_HISTORY_LIMIT;

  const passed = entries.filter((entry) => entry.status === 'PASS').length;
  const failed = entries.length - passed;
  const total = entries.length;

  log.info('Generating HTML report', { total, passed, failed });

  const screenshots = await Promise.all(
    entries.map((entry) => (entry.screenshotPath ? inlineScreenshot(entry.screenshotPath) : Promise.resolve(undefined)))
  );

  const history = await readHistory(historyFile);
  const html = renderHtml(entries, screenshots, history, { passed, failed, total });

  await mkdir(outputDir, { recursive: true });
  const reportPath = path.resolve(outputDir, 'index.html');
  await writeFile(reportPath, html, 'utf-8');

  const updatedHistory = [...history, { timestamp: new Date().toISOString(), passed, failed, total }].slice(
    -historyLimit
  );
  await writeHistory(historyFile, updatedHistory);

  log.success('HTML report generated', { reportPath });
  return { reportPath, passed, failed, total };
}
