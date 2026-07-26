#!/usr/bin/env node
/**
 * PROVA CLI entry point
 * Usage: qe-tool run --url <url> [options]
 */
import { Command } from 'commander';
import { log } from '../core/logger.js';
import { runBrowserTest } from '../runners/browser-runner.js';
import { runApiTest } from '../runners/api-runner.js';
import type { HttpMethod } from '../runners/api-runner.js';
import { runMobileTest } from '../runners/mobile-runner.js';
import type { MobileRunResult } from '../runners/mobile-runner.js';
import { parseDevices } from '../core/input-validator.js';
import { mapWithConcurrency } from '../core/concurrency.js';
import {
  generateAllureReport,
  browserResultToCase,
  apiResultToCase,
  mobileResultToCase
} from '../reporters/allure-reporter.js';
import type { ReportTestCase } from '../reporters/allure-reporter.js';
import { printAiSummary } from '../core/ai-summary.js';
import { validateRunOptions } from './validate.js';
import type { RunOptionsInput } from './validate.js';
import { generateTestsFromSpec } from '../generators/spec-test-generator.js';
import type { GeneratedTestType } from '../generators/spec-test-generator.js';
import { generateAiSpec } from '../generators/ai-spec-generator.js';
import type { AcceptanceLanguage } from '../parsers/gherkin-parser.js';
import { fetchJiraTicketDescription, syncJiraTestStatus } from '../core/jira-connector.js';
import { parseJiraEnvironments, resolveJiraEnvironment } from '../core/jira-environments.js';
import { generateTestDataFromFile } from '../core/test-data-factory.js';
import {
  generateAdvancedTestDataFromFile,
  serializeTestData
} from '../generators/test-data-factory.js';
import type { DataFormat } from '../generators/test-data-factory.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchFigmaElements } from '../core/figma-connector.js';
import type { FigmaElement } from '../core/figma-connector.js';
import { generateFigmaTests } from '../generators/figma-test-generator.js';
import { FigmaCredentialStore } from '../storage/figma-credentials.js';
import { runK6 } from '../core/k6-runner.js';
import type { K6Metrics } from '../core/k6-runner.js';
import { PerformanceStore } from '../perf/performance-store.js';
import type { PerformanceRun } from '../perf/performance-store.js';
import { detectRegressions, hasDegradingTrend, performanceRunsToCsv } from '../perf/regression-detector.js';
import {
  comparePerformanceMetrics,
  loadPerformanceBaseline,
  savePerformanceBaseline
} from '../core/performance-baseline.js';
import { loadPromotionConfig } from '../promotions/env-config-loader.js';
import { runPromotionChain } from '../promotions/env-chain-manager.js';
import { writePromotionReport } from '../promotions/promotion-reporter.js';
import { syncCommand } from './sync.js';
import { dashboardCommand } from './dashboard.js';
import { graphCommand } from './graph.js';

/** Raw CLI option values Commander hands to the `run` action. */
export interface RunActionOptions extends RunOptionsInput {
  suite?: string;
  report: boolean;
  ai: boolean;
  premium: boolean;
  evidence?: string;
}

/** Raw CLI values accepted by the `generate` command. */
export interface GenerateActionOptions {
  spec?: string;
  jiraTicket?: string;
  jiraUrl?: string;
  jiraEnv?: string;
  jiraCloudId?: string;
  jiraSync?: boolean;
  type: string;
  url: string;
  output: string;
  schema?: string;
  figmaFile?: string;
  figmaNode?: string;
}

/** Values accepted by deterministic `ai-gen`. */
export interface AiGenActionOptions {
  spec: string;
  output: string;
  url: string;
  lang: string;
  browsers: string;
}

/** Values accepted by Figma credential and sync workflows. */
export interface FigmaActionOptions {
  auth: boolean;
  sync?: string;
  node?: string;
  output: string;
  database: string;
}

/** Stores encrypted OAuth credentials or creates tests from a Figma frame. */
export async function figmaCommand(opts: FigmaActionOptions): Promise<void> {
  if (opts.auth === Boolean(opts.sync)) {
    log.error('Choose exactly one Figma action: --auth or --sync <file-key>'); process.exitCode = 1; return;
  }
  const secret = process.env['PROVA_CREDENTIAL_KEY'];
  if (opts.auth) {
    const accessToken = process.env['FIGMA_OAUTH_ACCESS_TOKEN'];
    if (!secret || !accessToken) {
      log.error('PROVA_CREDENTIAL_KEY and FIGMA_OAUTH_ACCESS_TOKEN are required for --auth'); process.exitCode = 1; return;
    }
    const store = await FigmaCredentialStore.open(opts.database, secret);
    try {
      await store.save({
        accessToken,
        ...(process.env['FIGMA_OAUTH_REFRESH_TOKEN'] ? { refreshToken: process.env['FIGMA_OAUTH_REFRESH_TOKEN'] } : {}),
        ...(process.env['FIGMA_OAUTH_EXPIRES_AT'] ? { expiresAt: process.env['FIGMA_OAUTH_EXPIRES_AT'] } : {})
      });
    } finally { store.close(); }
    log.success('Encrypted Figma OAuth credentials saved');
    return;
  }
  if (!opts.sync || !opts.node) {
    log.error('--sync requires --node <node-id>'); process.exitCode = 1; return;
  }
  let accessToken: string | undefined;
  if (secret) {
    const store = await FigmaCredentialStore.open(opts.database, secret);
    try { accessToken = store.load()?.accessToken; } finally { store.close(); }
  }
  const apiToken = process.env['FIGMA_API_TOKEN'];
  const fetched = await fetchFigmaElements({
    fileKey: opts.sync, nodeId: opts.node,
    ...(accessToken ? { accessToken } : { apiToken })
  });
  if (!fetched.ok) { log.error(fetched.error); process.exitCode = 1; return; }
  try {
    const files = await generateFigmaTests(fetched.elements, opts.output);
    log.success('Figma component tests generated', { files });
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  }
}

/** Generates a deterministic Playwright skeleton from acceptance criteria. */
export async function aiGenCommand(opts: AiGenActionOptions): Promise<void> {
  if (!['en', 'es', 'fr'].includes(opts.lang)) {
    log.error('--lang must be one of en, es, fr'); process.exitCode = 1; return;
  }
  const result = await generateAiSpec({
    specFile: opts.spec, outputDir: opts.output, url: opts.url,
    language: opts.lang as AcceptanceLanguage,
    browsers: opts.browsers.split(',').map((browser) => browser.trim()).filter(Boolean)
  });
  if (!result.ok) { log.error(result.error); process.exitCode = 1; return; }
  log.success('Playwright specification generated', { file: result.file, scenarios: result.scenarios });
}

/** Raw CLI values accepted by the `data` command. */
export interface DataActionOptions {
  schema: string;
  count: string;
  output?: string;
  format?: string;
  seed?: string;
  edgeCases?: boolean;
  table?: string;
}

/** Raw CLI values accepted by the `perf` command. */
export interface PerfActionOptions {
  url?: string;
  vus: string;
  duration: string;
  baseline?: string;
  updateBaseline: boolean;
  action?: string;
  database?: string;
  threshold?: string;
  days?: string;
  output?: string;
  method?: string;
  headers?: string;
  body?: string;
}

function storedMetrics(metrics: K6Metrics): Pick<PerformanceRun,
'p50ResponseTimeMs' | 'p95ResponseTimeMs' | 'p99ResponseTimeMs' | 'errorRate' | 'requestsPerSecond'> {
  return {
    p50ResponseTimeMs: metrics.p50ResponseTimeMs ?? metrics.p95ResponseTimeMs,
    p95ResponseTimeMs: metrics.p95ResponseTimeMs,
    p99ResponseTimeMs: metrics.p99ResponseTimeMs ?? metrics.p95ResponseTimeMs,
    errorRate: metrics.errorRate,
    requestsPerSecond: metrics.requestsPerSecond
  };
}

async function perfHistoryCommand(opts: PerfActionOptions, vus: number, durationSeconds: number): Promise<void> {
  const action = opts.action;
  if (action !== 'set' && action !== 'check' && action !== 'report') {
    log.error('--action must be one of set, check, report');
    process.exitCode = 1;
    return;
  }
  const threshold = Number(opts.threshold ?? '10');
  const days = Number(opts.days ?? '7');
  if (!Number.isFinite(threshold) || threshold < 0 || !Number.isInteger(days) || days < 1) {
    log.error('--threshold must be non-negative and --days must be a positive integer');
    process.exitCode = 1;
    return;
  }
  const store = await PerformanceStore.open(opts.database ?? './prova-performance.sqlite');
  try {
    if (action === 'report') {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const runs = store.listRuns({ ...(opts.url ? { url: opts.url } : {}), since });
      const report = performanceRunsToCsv(runs);
      if (opts.output) await writeFile(opts.output, report, 'utf-8');
      else process.stdout.write(report);
      log.info('Performance history report complete', { runs: runs.length, degradingTrend: hasDegradingTrend(runs) });
      return;
    }
    if (!opts.url || !isHttpUrl(opts.url)) {
      log.error('--url must be an absolute HTTP(S) URL for set/check');
      process.exitCode = 1;
      return;
    }
    let headers: Record<string, string> | undefined;
    let body: unknown;
    try {
      if (opts.headers) headers = JSON.parse(opts.headers) as Record<string, string>;
      if (opts.body) body = JSON.parse(opts.body) as unknown;
    } catch {
      log.error('--headers and --body must contain valid JSON');
      process.exitCode = 1;
      return;
    }
    if (headers && (typeof headers !== 'object' || Array.isArray(headers)
      || Object.values(headers).some((value) => typeof value !== 'string'))) {
      log.error('--headers must be a JSON object containing string values');
      process.exitCode = 1;
      return;
    }
    const method = (opts.method ?? 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      log.error('--method must be GET, POST, PUT, or DELETE'); process.exitCode = 1; return;
    }
    const result = await runK6({
      url: opts.url, vus, durationSeconds,
      method: method as 'GET' | 'POST' | 'PUT' | 'DELETE', headers, body
    });
    if (!result.ok) { log.error(result.error); process.exitCode = 1; return; }
    const timestamp = new Date().toISOString();
    const metrics = storedMetrics(result.metrics);
    if (action === 'set') {
      const run: PerformanceRun = { url: opts.url, vus, durationSeconds, ...metrics, status: 'PASS', timestamp };
      await store.setBaseline(run);
      await store.addRun(run);
      log.success('SQLite performance baseline saved', { url: opts.url, vus, durationSeconds });
      return;
    }
    const baseline = store.getBaseline(opts.url, vus, durationSeconds);
    if (!baseline) { log.error('No SQLite baseline found for this URL/load profile'); process.exitCode = 1; return; }
    const regressions = detectRegressions(metrics, baseline, threshold);
    await store.addRun({
      url: opts.url, vus, durationSeconds, ...metrics,
      status: regressions.length ? 'FAIL' : 'PASS', timestamp
    });
    if (regressions.length) {
      for (const regression of regressions) log.error(regression.message);
      process.exitCode = 1;
      return;
    }
    log.success('Performance regression check passed');
  } finally { store.close(); }
}

/** Raw CLI values accepted by the `trace` command. */
export interface TraceActionOptions {
  issueKey: string;
  database: string;
  output?: string;
  json: boolean;
  jiraUrl?: string;
  jiraUsername?: string;
  jiraApiToken?: string;
}

/** Generates a Golden Thread traceability report for a JIRA issue. */
export async function traceCommand(opts: TraceActionOptions): Promise<void> {
  try {
    const { GoldenThreadStore } = await import('../core/golden-thread-store.js');
    const { GoldenThreadLinker } = await import('../core/golden-thread-linker.js');
    const { initiateFromJira } = await import('../core/golden-thread-jira.js');
    const { generateHtmlReport, generateJsonReport } = await import('../reporters/golden-thread-reporter.js');
    const { writeFile } = await import('node:fs/promises');

    const jiraUrl = opts.jiraUrl || process.env['JIRA_URL'];
    const jiraApiToken = opts.jiraApiToken || process.env['JIRA_API_TOKEN'];

    if (!jiraUrl || !jiraApiToken) {
      log.error('JIRA credentials required: --jiraUrl, --jiraApiToken or JIRA_URL and JIRA_API_TOKEN environment variables');
      process.exitCode = 1;
      return;
    }

    const store = await GoldenThreadStore.open(opts.database);
    const linker = new GoldenThreadLinker(store);

    log.info(`Initiating Golden Thread for ${opts.issueKey}...`);
    const golden_thread_id = await initiateFromJira({
      issue_key: opts.issueKey,
      golden_thread_linker: linker,
      baseUrl: jiraUrl,
      apiToken: jiraApiToken,
      ticketKey: opts.issueKey
    });

    const chain = await linker.getChain(golden_thread_id);
    if (!chain) {
      log.error('Failed to retrieve created chain');
      process.exitCode = 1;
      return;
    }

    if (opts.json) {
      const jsonReport = generateJsonReport(chain);
      if (opts.output) {
        await writeFile(opts.output, jsonReport);
        log.success(`Golden Thread JSON report written to ${opts.output}`);
      } else {
        log.info('Golden Thread JSON report', { report: jsonReport });
      }
    } else {
      const htmlReport = generateHtmlReport(chain, { title: `Golden Thread — ${opts.issueKey}` });
      const outputPath = opts.output || `golden-thread-${opts.issueKey}.html`;
      await writeFile(outputPath, htmlReport);
      log.success(`Golden Thread HTML report written to ${outputPath}`);
    }
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

/** Raw CLI values accepted by the `trace` command with commit SHA. */
export interface TraceCommitActionOptions {
  commit: string;
  repo?: string;
  database: string;
  output?: string;
  json: boolean;
  githubToken?: string;
}

/** Generates a Golden Thread traceability report for a commit SHA. */
export async function traceCommitCommand(opts: TraceCommitActionOptions): Promise<void> {
  try {
    const { GoldenThreadStore } = await import('../core/golden-thread-store.js');
    const { GoldenThreadLinker } = await import('../core/golden-thread-linker.js');
    const { linkGitHubBuildAndDeploy } = await import('../core/golden-thread-github.js');
    const { renderCommitTraceHtml, renderCommitTraceJson } = await import('../reporters/golden-thread-commit-reporter.js');
    const { writeFile } = await import('node:fs/promises');

    const repoStr = opts.repo || process.env['GITHUB_REPO'];
    const githubToken = opts.githubToken || process.env['GITHUB_TOKEN'];

    if (!repoStr || !githubToken) {
      log.error('GitHub credentials required: --repo owner/repo and --github-token, or GITHUB_REPO and GITHUB_TOKEN environment variables');
      process.exitCode = 1;
      return;
    }

    const [repo_owner, repo_name] = repoStr.split('/');
    if (!repo_owner || !repo_name) {
      log.error('Invalid repo format. Use --repo owner/repo');
      process.exitCode = 1;
      return;
    }

    const store = await GoldenThreadStore.open(opts.database);
    const linker = new GoldenThreadLinker(store);

    log.info(`Initiating Golden Thread for commit ${opts.commit}...`);

    let golden_thread_id = '';
    try {
      golden_thread_id = await linker.initiateChain({
        actor: 'github-connector',
        artifact_url: `https://github.com/${repo_owner}/${repo_name}/commit/${opts.commit}`,
        metadata: { commit_sha: opts.commit, repo: repoStr }
      });

      await linkGitHubBuildAndDeploy({
        golden_thread_id,
        commit_sha: opts.commit,
        repo_owner,
        repo_name,
        github_token: githubToken,
        golden_thread_linker: linker
      });
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }

    const chain = await linker.getChain(golden_thread_id);
    if (!chain) {
      log.error('Failed to retrieve created chain');
      process.exitCode = 1;
      return;
    }

    if (opts.json) {
      const jsonReport = renderCommitTraceJson(chain, opts.commit);
      if (opts.output) {
        await writeFile(opts.output, jsonReport);
        log.success(`Golden Thread JSON report written to ${opts.output}`);
      } else {
        log.info('Golden Thread JSON report', { report: jsonReport });
      }
    } else {
      const htmlReport = renderCommitTraceHtml(chain, opts.commit);
      const outputPath = opts.output || `golden-thread-commit-${opts.commit.substring(0, 7)}.html`;
      await writeFile(outputPath, htmlReport);
      log.success(`Golden Thread HTML report written to ${outputPath}`);
    }
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

/** Raw CLI values accepted by the `promote` command. */
export interface PromoteActionOptions {
  config: string;
  chain: string;
  from: string;
  to: string;
  test: string;
  coverage?: string;
  blockOnFail: boolean;
  report: string;
}

/** Runs a Playwright test through a configured environment promotion chain. */
export async function promoteCommand(opts: PromoteActionOptions): Promise<void> {
  try {
    const coveragePercent = opts.coverage === undefined ? undefined : Number(opts.coverage);
    const config = await loadPromotionConfig(opts.config);
    const result = await runPromotionChain({
      config,
      chain: opts.chain,
      source: opts.from,
      target: opts.to,
      testFile: opts.test,
      coveragePercent,
      blockOnFail: opts.blockOnFail
    });
    const reportPath = await writePromotionReport(result, opts.report);
    log.info(result.summary);
    for (const step of result.steps) {
      log.info('Promotion gate result', {
        environment: step.environment,
        passed: step.passed,
        durationMs: step.durationMs,
        error: step.error
      });
    }
    if (result.status === 'FAIL') {
      log.error(`Promotion blocked for chain "${result.chain}". Report: ${reportPath}`);
      process.exitCode = 1;
      return;
    }
    log.success('Promotion chain passed', { chain: result.chain, reportPath });
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Runs a k6 baseline check and optionally compares or persists its metrics.
 *
 * @param opts - Parsed `perf` command options.
 */
export async function perfCommand(opts: PerfActionOptions): Promise<void> {
  if (opts.action === undefined && (!opts.url || !isHttpUrl(opts.url))) {
    log.error(`Invalid --url "${opts.url}": use an absolute http:// or https:// URL`);
    process.exitCode = 1;
    return;
  }
  const vus = Number(opts.vus);
  if (!Number.isInteger(vus) || vus <= 0) {
    log.error('--vus must be a positive integer');
    process.exitCode = 1;
    return;
  }
  const durationSeconds = Number(opts.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    log.error('--duration must be a positive number of seconds');
    process.exitCode = 1;
    return;
  }
  if (opts.updateBaseline && !opts.baseline) {
    log.error('--update-baseline requires --baseline <file>');
    process.exitCode = 1;
    return;
  }
  if (opts.action !== undefined) {
    await perfHistoryCommand(opts, vus, durationSeconds);
    return;
  }
  if (!opts.url) return;

  let storedBaseline: K6Metrics | undefined;
  if (opts.baseline) {
    const baselineResult = await loadPerformanceBaseline(opts.baseline);
    if (!baselineResult.ok) {
      log.error(baselineResult.error);
      process.exitCode = 1;
      return;
    }
    storedBaseline = baselineResult.baseline;
    if (!storedBaseline && !opts.updateBaseline) {
      log.error(`Performance baseline does not exist: ${opts.baseline}. Use --update-baseline to create it.`);
      process.exitCode = 1;
      return;
    }
  }

  const result = await runK6({ url: opts.url, vus, durationSeconds });
  if (!result.ok) {
    log.error(result.error);
    process.exitCode = 1;
    return;
  }
  log.info('k6 performance metrics', {
    p95ResponseTimeMs: result.metrics.p95ResponseTimeMs,
    errorRate: result.metrics.errorRate,
    requestsPerSecond: result.metrics.requestsPerSecond
  });

  if (storedBaseline) {
    const regressions = comparePerformanceMetrics(result.metrics, storedBaseline);
    if (regressions.length > 0) {
      for (const regression of regressions) log.error(`Performance regression: ${regression}`);
      process.exitCode = 1;
      return;
    }
  }

  if (opts.baseline && opts.updateBaseline) {
    const saveResult = await savePerformanceBaseline(opts.baseline, result.metrics);
    if (!saveResult.ok) {
      log.error(saveResult.error);
      process.exitCode = 1;
      return;
    }
    log.success('Performance baseline updated', { baseline: opts.baseline });
  }
  log.success('Performance check passed');
}

/**
 * Generates test data from a schema file and writes JSON to stdout or a file.
 *
 * @param opts - Parsed `data` command options.
 */
export async function dataCommand(opts: DataActionOptions): Promise<void> {
  const count = Number(opts.count);
  if (!Number.isInteger(count) || count <= 0) {
    log.error('--count must be a positive integer');
    process.exitCode = 1;
    return;
  }
  const format = opts.format ?? 'json';
  const formats = ['json', 'csv', 'env', 'sql'];
  if (!formats.includes(format)) {
    log.error('--format must be one of json, csv, env, sql');
    process.exitCode = 1;
    return;
  }
  const seed = opts.seed === undefined ? undefined : Number(opts.seed);
  if (seed !== undefined && !Number.isInteger(seed)) {
    log.error('--seed must be an integer');
    process.exitCode = 1;
    return;
  }
  const legacyCall = opts.format === undefined && opts.seed === undefined && opts.edgeCases === undefined;
  const result = legacyCall
    ? await generateTestDataFromFile(opts.schema, { count })
    : await generateAdvancedTestDataFromFile(opts.schema, { count, seed, edgeCases: opts.edgeCases });
  if (!result.ok) {
    log.error(result.error);
    process.exitCode = 1;
    return;
  }
  let output: string;
  try {
    const records = 'records' in result
      ? result.records
      : Array.isArray(result.data) && count > 1 ? result.data : [result.data];
    output = serializeTestData(records, format as DataFormat, opts.table ?? 'test_data');
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (!opts.output) {
    process.stdout.write(output);
    return;
  }
  try {
    await writeFile(opts.output, output, { encoding: 'utf-8' });
    log.success('Test data written', { output: opts.output, count });
  } catch (error) {
    log.error(`Unable to write test data file "${opts.output}"`, error);
    process.exitCode = 1;
  }
}

/**
 * Generates Playwright test skeletons from a specification, JIRA ticket, or Figma frame.
 * Sets exit code 1 and logs a concise error for every failure.
 *
 * @param opts - Parsed `generate` command options.
 */
export async function generateCommand(opts: GenerateActionOptions): Promise<void> {
  const hasSpec = Boolean(opts.spec);
  const hasJiraTicket = Boolean(opts.jiraTicket);
  const hasFigmaFile = Boolean(opts.figmaFile);
  const hasFigmaNode = Boolean(opts.figmaNode);
  const hasFigma = hasFigmaFile && hasFigmaNode;
  if (hasSpec && hasJiraTicket) {
    log.error('--spec and --jira-ticket are mutually exclusive');
    process.exitCode = 1;
    return;
  }
  if (hasFigmaFile !== hasFigmaNode) {
    log.error('--figma-file and --figma-node must be provided together');
    process.exitCode = 1;
    return;
  }
  if (!hasSpec && !hasJiraTicket && !hasFigma) {
    log.error('Provide --spec <file>, --jira-ticket <KEY>, or a Figma file/node pair');
    process.exitCode = 1;
    return;
  }
  if ((opts.jiraUrl || opts.jiraEnv || opts.jiraCloudId || opts.jiraSync) && !hasJiraTicket) {
    log.error('JIRA options can only be used with --jira-ticket');
    process.exitCode = 1;
    return;
  }
  if (opts.schema && opts.type !== 'api') {
    log.error('--schema can only be used with --type api');
    process.exitCode = 1;
    return;
  }
  if (hasFigma && opts.type !== 'browser') {
    log.error('Figma ingestion can only be used with --type browser');
    process.exitCode = 1;
    return;
  }

  let requestBody: unknown;
  if (opts.schema) {
    const dataResult = await generateTestDataFromFile(opts.schema);
    if (!dataResult.ok) {
      log.error(dataResult.error);
      process.exitCode = 1;
      return;
    }
    requestBody = dataResult.data;
  }

  let specText: string | undefined;
  let sourceLabel: string | undefined;
  let figmaElements: FigmaElement[] | undefined;
  let jiraConnection: { baseUrl: string; cloudId?: string; apiToken?: string; accessToken?: string } | undefined;
  if (hasFigma && opts.figmaFile && opts.figmaNode) {
    const apiToken = process.env['FIGMA_API_TOKEN'];
    if (!apiToken) {
      log.error('FIGMA_API_TOKEN environment variable is required with --figma-file and --figma-node');
      process.exitCode = 1;
      return;
    }
    const figmaResult = await fetchFigmaElements({
      fileKey: opts.figmaFile,
      nodeId: opts.figmaNode,
      apiToken
    });
    if (!figmaResult.ok) {
      log.error(figmaResult.error);
      process.exitCode = 1;
      return;
    }
    figmaElements = figmaResult.elements;
    if (!hasSpec && !hasJiraTicket) {
      specText = 'Acceptance Criteria\n- Verify the named Figma screen elements exist on the page';
      sourceLabel = `Figma frame ${figmaResult.nodeId}`;
    }
  }
  if (opts.jiraTicket) {
    let configuredUrl = opts.jiraUrl;
    let configuredCloudId = opts.jiraCloudId;
    if (opts.jiraEnv) {
      const environmentsJson = process.env['JIRA_ENVIRONMENTS'];
      if (!environmentsJson) {
        log.error('JIRA_ENVIRONMENTS is required with --jira-env');
        process.exitCode = 1;
        return;
      }
      try {
        const environment = resolveJiraEnvironment(parseJiraEnvironments(environmentsJson), opts.jiraEnv);
        configuredUrl = environment.baseUrl;
        configuredCloudId = environment.cloudId;
      } catch (error) {
        log.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }
    }
    if (!configuredUrl) {
      log.error('--jira-url or --jira-env is required with --jira-ticket');
      process.exitCode = 1;
      return;
    }
    const accessToken = process.env['JIRA_OAUTH_ACCESS_TOKEN'];
    const apiToken = process.env['JIRA_API_TOKEN'];
    if (!accessToken && !apiToken) {
      log.error('JIRA_OAUTH_ACCESS_TOKEN or JIRA_API_TOKEN is required with --jira-ticket');
      process.exitCode = 1;
      return;
    }
    jiraConnection = accessToken
      ? { baseUrl: configuredUrl, cloudId: configuredCloudId, accessToken }
      : { baseUrl: configuredUrl, apiToken };
    const jiraResult = await fetchJiraTicketDescription({
      ticketKey: opts.jiraTicket,
      ...jiraConnection
    });
    if (!jiraResult.ok) {
      log.error(jiraResult.error);
      process.exitCode = 1;
      return;
    }
    specText = jiraResult.description;
    sourceLabel = `JIRA ticket ${jiraResult.ticketKey}`;
  }

  const result = await generateTestsFromSpec({
    specFile: opts.spec,
    specText,
    sourceLabel,
    type: opts.type as GeneratedTestType,
    url: opts.url,
    outputDir: opts.output,
    requestBody,
    figmaElements
  });
  if (!result.ok) {
    log.error(result.error);
    process.exitCode = 1;
    return;
  }
  if (opts.jiraSync && opts.jiraTicket && jiraConnection) {
    const syncResult = await syncJiraTestStatus({
      ...jiraConnection,
      ticketKey: opts.jiraTicket,
      status: 'GENERATED',
      generatedFiles: result.files,
      details: `${result.criteria.length} acceptance criteria converted to Playwright tests.`
    });
    if (!syncResult.ok) {
      log.error(syncResult.error);
      process.exitCode = 1;
      return;
    }
  }
  log.success('AI test generation complete', {
    criteria: result.criteria.length,
    files: result.files
  });
}

/**
 * Executes `qe-tool run` for already-parsed CLI options.
 * Validates input up front, runs every runner implied by `--type`
 * (all three for `--type all`), then reports/summarises the combined results.
 * Sets `process.exitCode = 1` on invalid input or any FAIL — never throws.
 *
 * @param opts - The parsed `run` command options.
 */
export async function runCommand(opts: RunActionOptions): Promise<void> {
  log.info('PROVA starting', {
    url: opts.url,
    type: opts.type,
    env: opts.env,
    scope: opts.scope,
    workers: Number(opts.workers)
  });

  const validation = validateRunOptions(opts);
  if (!validation.valid) {
    for (const error of validation.errors) {
      log.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const type = opts.type;
  const scope = opts.scope as 'smoke' | 'cr' | 'component' | 'full';
  const tasks: Array<() => Promise<ReportTestCase>> = [];
  const mobileEvidence: MobileRunResult[] = [];

  if (type === 'browser' || type === 'all') {
    tasks.push(async () => {
      const result = await runBrowserTest({
        url: opts.url,
        retries: Number(opts.retries ?? '3'),
        scope
      });
      log.info('Run result', {
        status: result.status,
        durationMs: result.durationMs,
        screenshotPath: result.screenshotPath,
        checks: result.checks
      });
      return browserResultToCase(result);
    });
  }

  if (type === 'api' || type === 'all') {
    const graphql = opts.graphql
      ? { query: opts.graphql, variables: validation.graphqlVariables ?? {} }
      : undefined;
    tasks.push(async () => {
      const result = await runApiTest({
        url: opts.url,
        method: opts.method as HttpMethod,
        body: graphql ? undefined : validation.restBody,
        graphql,
        expectedStatus: Number(opts.expectStatus),
        headers: validation.headers,
        timeoutMs: opts.timeout === undefined ? undefined : Number(opts.timeout),
        retries: Number(opts.retries ?? '3')
      });
      log.info('Run result', {
        status: result.status,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
        responseSummary: result.responseSummary
      });
      return apiResultToCase(result);
    });
  }

  if (type === 'mobile' || type === 'all') {
    for (const device of parseDevices(opts.device)) {
      tasks.push(async () => {
        const result = await runMobileTest({
          url: opts.url,
          device,
          retries: Number(opts.retries ?? '3'),
          scope,
          deviceCloud: opts.deviceCloud as 'local' | 'browserstack' | undefined,
          ...(opts.deviceCloud === 'browserstack'
            ? {
                browserstack: {
                  username: opts.browserstackUsername ?? process.env['BROWSERSTACK_USERNAME'] ?? '',
                  accessKey: opts.browserstackKey ?? process.env['BROWSERSTACK_ACCESS_KEY'] ?? '',
                  parallel: Number(opts.browserstackParallel ?? opts.workers),
                  video: (opts.browserstackVideo ?? 'true').toLowerCase() === 'true'
                }
              }
            : {})
        });
        mobileEvidence.push(result);
        log.info('Run result', {
          status: result.status,
          device: result.device,
          durationMs: result.durationMs,
          screenshotPath: result.screenshotPath,
          checks: result.checks,
          provider: result.provider,
          sessionId: result.sessionId,
          videoUrl: result.videoUrl,
          logUrls: result.logUrls
        });
        return mobileResultToCase(result);
      });
    }
  }

  const configuredWorkers = Number(opts.workers);
  const executionWorkers = opts.deviceCloud === 'browserstack'
    ? Math.min(configuredWorkers, Number(opts.browserstackParallel ?? configuredWorkers))
    : configuredWorkers;
  const cases = await mapWithConcurrency(tasks, executionWorkers, (task) => task());
  const anyFailed = cases.some((testCase) => testCase.status === 'FAIL');

  if (opts.report) {
    const { reportPath, archivedReportPath } = await generateAllureReport({ runs: cases });
    log.info('HTML report generated', { reportPath, archivedReportPath });
  }
  if (opts.ai) {
    await printAiSummary({ runs: cases });
  }
  if (opts.evidence) {
    await mkdir(path.dirname(opts.evidence), { recursive: true });
    await writeFile(opts.evidence, JSON.stringify({
      generatedAt: new Date().toISOString(),
      total: mobileEvidence.length,
      passed: mobileEvidence.filter((result) => result.status === 'PASS').length,
      failed: mobileEvidence.filter((result) => result.status === 'FAIL').length,
      runs: mobileEvidence
    }, null, 2), 'utf-8');
    log.info('Machine-readable evidence written', { path: opts.evidence });
  }

  if (anyFailed) {
    process.exitCode = 1;
    return;
  }
  log.success('Run complete');
}

/** Builds the PROVA CLI program. Exported so tests can construct it without invoking `parse()`. */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('qe-tool')
    .description('PROVA — AI-native QE automation platform | provae2e.com')
    .version('0.3.2-beta.1');

  program
    .command('run')
    .description('Run tests against a URL')
    .requiredOption('--url <url>', 'Target URL to test')
    .option('--type <type>', 'Test type: browser|api|mobile|all', 'browser')
    .option('--device <devices>', 'Mobile device(s), comma-separated: iPhone14,Pixel7,iPad', 'iPhone14')
    .option('--device-cloud <provider>', 'Mobile provider: local|browserstack')
    .option('--browserstack-username <user>', 'BrowserStack username (or BROWSERSTACK_USERNAME)')
    .option('--browserstack-key <key>', 'BrowserStack access key (or BROWSERSTACK_ACCESS_KEY)')
    .option('--browserstack-parallel <n>', 'BrowserStack concurrency (1-25)')
    .option('--browserstack-video <bool>', 'Capture BrowserStack video: true|false')
    .option('--workers <n>', 'Maximum concurrent browser/API/mobile runs (1-16)', '3')
    .option('--suite <suite>', 'Test suite name to run')
    .option('--scope <scope>', 'Verification depth: smoke|component|cr|full', 'full')
    .option('--report', 'Generate HTML report', false)
    .option('--evidence <file.json>', 'Write machine-readable mobile/device-cloud evidence')
    .option('--ai', 'Enable Ollama AI summaries (requires local Ollama)', false)
    .option('--premium', 'Use cloud LLM instead of local Ollama', false)
    .option('--env <env>', 'Target environment: dev|qe|uat|staging|prod', 'qe')
    .option('--method <method>', 'API method (--type api): GET|POST|PUT|DELETE', 'GET')
    .option('--body <json>', 'API request body as JSON (--type api): REST body or GraphQL variables')
    .option('--graphql <query>', 'GraphQL query/mutation document (--type api). Switches the request to GraphQL')
    .option('--expect-status <code>', 'Expected HTTP status code (--type api)', '200')
    .option('--retries <n>', 'Retries after a failed test (0-3)', '3')
    .option('--timeout <ms>', 'Positive request timeout in milliseconds')
    .option('--headers <json>', 'Custom API headers as a JSON object')
    .action(runCommand);

  program
    .command('init')
    .description('Initialise PROVA config in current project')
    .action(() => {
      log.info('Creating prova.config.yml...');
      log.info('FORGE: Implement config initialisation here');
    });

  program
    .command('perf')
    .description('Run a k6 performance check and compare it with a stored baseline')
    .option('--url <target>', 'Target URL for the k6 load test')
    .option('--action <action>', 'SQLite workflow: set|check|report')
    .option('--database <file>', 'SQLite performance database', './prova-performance.sqlite')
    .option('--threshold <percent>', 'Allowed regression percentage', '10')
    .option('--days <n>', 'History days included in reports', '7')
    .option('--output <file.csv>', 'CSV report destination')
    .option('--method <method>', 'HTTP method: GET|POST|PUT|DELETE', 'GET')
    .option('--headers <json>', 'Request headers as JSON; use environment expansion for secrets')
    .option('--body <json>', 'JSON request payload for POST/PUT')
    .option('--vus <n>', 'Number of virtual users', '10')
    .option('--duration <s>', 'Test duration in seconds', '30')
    .option('--baseline <file>', 'Performance baseline JSON file')
    .option('--update-baseline', 'Create or update the baseline after a successful run', false)
    .action(perfCommand);

  program
    .command('data')
    .description('Generate realistic JSON test data from a schema or example file')
    .requiredOption('--schema <file.json>', 'JSON Schema, descriptor shape, or example JSON file')
    .option('--count <n>', 'Number of records to generate', '1')
    .option('--format <format>', 'Output format: json|csv|env|sql', 'json')
    .option('--seed <integer>', 'Seed for reproducible Faker output')
    .option('--edge-cases', 'Generate nullable, empty, and maximum boundary values', false)
    .option('--table <name>', 'SQL table name when --format sql is used', 'test_data')
    .option('--output <file>', 'Write output to a file instead of stdout')
    .action(dataCommand);

  program
    .command('generate')
    .description('Generate Playwright test skeletons from a local spec, JIRA ticket, or Figma frame using local Ollama')
    .option('--spec <file>', 'Plain-text or Markdown specification file (mutually exclusive with --jira-ticket)')
    .option('--jira-ticket <key>', 'JIRA ticket key (mutually exclusive with --spec)')
    .option('--jira-url <base-url>', 'JIRA base URL; use this or --jira-env with --jira-ticket')
    .option('--jira-env <name>', 'Named JIRA instance from JIRA_ENVIRONMENTS')
    .option('--jira-cloud-id <id>', 'Atlassian cloud ID for OAuth2 API access')
    .option('--jira-sync', 'Post generated-test status back to the JIRA issue', false)
    .option('--figma-file <file-key>', 'Figma file key; requires --figma-node and FIGMA_API_TOKEN')
    .option('--figma-node <node-id>', 'Figma frame/node ID; requires --figma-file and FIGMA_API_TOKEN')
    .requiredOption('--type <type>', 'Generated test type: browser|api')
    .requiredOption('--url <url>', 'Target URL for generated tests')
    .option('--output <dir>', 'Directory for generated test files', './generated-tests')
    .option('--schema <file.json>', 'Populate API request bodies from a schema or example JSON file')
    .action(generateCommand);

  program
    .command('ai-gen')
    .description('Generate deterministic Playwright tests from multilingual acceptance criteria')
    .requiredOption('--spec <file.md>', 'Markdown, text, or Gherkin specification')
    .requiredOption('--url <url>', 'Default application URL')
    .option('--output <dir>', 'Generated test directory', './generated-tests')
    .option('--lang <language>', 'Acceptance-criteria language: en|es|fr', 'en')
    .option('--browsers <list>', 'Comma-separated tags: chromium,firefox,webkit', 'chromium,firefox,webkit')
    .action(aiGenCommand);

  program
    .command('figma')
    .description('Store encrypted Figma OAuth credentials or generate component test stubs')
    .option('--auth', 'Encrypt FIGMA_OAUTH_ACCESS_TOKEN into SQLite', false)
    .option('--sync <file-key>', 'Figma file key to synchronize')
    .option('--node <node-id>', 'Frame/node ID used with --sync')
    .option('--output <dir>', 'Generated Figma test directory', './generated-tests/figma')
    .option('--database <file>', 'Encrypted credential SQLite database', './prova-credentials.sqlite')
    .action(figmaCommand);

  program
    .command('trace')
    .description('Generate a 7-stage Golden Thread traceability report for a JIRA issue')
    .requiredOption('--issue-key <PROJ-123>', 'JIRA issue key')
    .option('--database <file>', 'SQLite database path', './prova-golden-thread.sqlite')
    .option('--output <file>', 'Report output file path (auto-named if omitted)')
    .option('--json', 'Output JSON instead of HTML', false)
    .option('--jira-url <url>', 'JIRA instance URL (or JIRA_URL env var)')
    .option('--jira-username <username>', 'JIRA username (or JIRA_USERNAME env var)')
    .option('--jira-api-token <token>', 'JIRA API token (or JIRA_API_TOKEN env var)')
    .action((opts) => traceCommand({
      issueKey: opts.issueKey,
      database: opts.database,
      output: opts.output,
      json: opts.json,
      jiraUrl: opts.jiraUrl,
      jiraUsername: opts.jiraUsername,
      jiraApiToken: opts.jiraApiToken
    }));

  program
    .command('trace-commit')
    .description('Generate a Golden Thread traceability report for a GitHub commit')
    .requiredOption('--commit <SHA>', 'Git commit SHA')
    .option('--repo <owner/repo>', 'GitHub repo (or GITHUB_REPO env var)')
    .option('--database <file>', 'SQLite database path', './prova-golden-thread.sqlite')
    .option('--output <file>', 'Report output file path (auto-named if omitted)')
    .option('--json', 'Output JSON instead of HTML', false)
    .option('--github-token <token>', 'GitHub API token (or GITHUB_TOKEN env var)')
    .action((opts) => traceCommitCommand({
      commit: opts.commit,
      repo: opts.repo,
      database: opts.database,
      output: opts.output,
      json: opts.json,
      githubToken: opts.githubToken
    }));

  program
    .command('promote')
    .description('Run a Playwright test through an ordered environment promotion chain')
    .requiredOption('--config <file>', 'Promotion configuration JSON file')
    .requiredOption('--chain <name>', 'Named environment chain')
    .requiredOption('--from <environment>', 'Current/source environment')
    .requiredOption('--to <environment>', 'Next/target environment')
    .requiredOption('--test <suite.spec.ts>', 'Playwright test file to run at each gate')
    .option('--coverage <percent>', 'Observed statement coverage for configured coverage gates')
    .option('--block-on-fail', 'Stop promotion after the first failed environment', true)
    .option('--report <file>', 'Detailed JSON promotion report', './promotion-report.json')
    .action(promoteCommand);

  program
    .command('sync')
    .description('Sync JIRA acceptance criteria to spec-link database for test coverage tracking')
    .requiredOption('--jira-key <PROJ-123>', 'JIRA issue key')
    .option('--jira-url <url>', 'JIRA instance URL (or JIRA_URL env var)')
    .option('--jira-token <token>', 'JIRA API token or OAuth2 access token (or env vars)')
    .option('--jira-cloud-id <id>', 'Atlassian cloud ID for OAuth2 (or JIRA_CLOUD_ID env var)')
    .option('--database <file>', 'SQLite spec-link database path', './prova-spec-links.db')
    .action((opts) => syncCommand({
      jiraKey: opts.jiraKey,
      jiraUrl: opts.jiraUrl,
      jiraToken: opts.jiraToken,
      jiraCloudId: opts.jiraCloudId,
      database: opts.database
    }));

  program
    .command('graph')
    .description('Query requirement coverage, incident chains, test history, or coverage gaps as JSON')
    .option('--requirement <PROJ-123>', 'Show all tests covering a requirement')
    .option('--incident <id>', 'Show the full code, test, deployment, and incident chain')
    .option('--test <id>', 'Show test run history, code changes, and related incidents')
    .option('--suggestions', 'Suggest tests for uncovered requirements', false)
    .option('--database <file>', 'Knowledge graph JSON dataset', './prova-knowledge-graph.json')
    .action(graphCommand);

  program
    .command('dashboard')
    .description('Generate interactive Golden Thread dashboard and PDF traceability report')
    .option('--database <file>', 'SQLite Golden Thread database path', './prova-golden-thread.sqlite')
    .option('--output <file>', 'HTML dashboard output path', './prova-dashboard.html')
    .option('--pdf <file>', 'PDF report output path (generates HTML suitable for PDF conversion)')
    .option('--dark-mode', 'Dark mode for HTML dashboard', false)
    .option('--date-start <YYYY-MM-DD>', 'Filter chains created after this date')
    .option('--date-end <YYYY-MM-DD>', 'Filter chains created before this date')
    .option('--environment <name>', 'Filter by environment (e.g., prod, staging, dev)')
    .option('--team <name>', 'Filter by team name')
    .option('--project <name>', 'Filter by project name')
    .action((opts) => dashboardCommand({
      database: opts.database,
      output: opts.output,
      pdf: opts.pdf,
      darkMode: opts.darkMode,
      dateStart: opts.dateStart,
      dateEnd: opts.dateEnd,
      environment: opts.environment,
      team: opts.team,
      project: opts.project
    }));

  return program;
}

/* istanbul ignore next -- exercised via the built CLI binary, not unit tests */
if (require.main === module) {
  buildProgram().parse(process.argv);
}
