/** CI/CD pipeline integration for Golden Thread traceability capture. */
import { GoldenThreadLinker } from './golden-thread-linker.js';
import { ProductionLogsStore } from './production-logs-store.js';
import { type GoldenThreadChain, STAGE_NAMES } from './golden-thread-store.js';
import { log } from './logger.js';

/** Build outcome as reported by the CI system. */
export type CicdBuildStatus = 'success' | 'failure' | 'unknown';

/**
 * Traceability metadata captured from a CI/CD pipeline run.
 * Populated from GitHub Actions environment variables plus explicit overrides.
 */
export interface CicdMetadata {
  /** Full git commit SHA that triggered the pipeline. */
  commit_sha: string;
  /** Short branch (or tag) name, e.g. `main`. */
  branch: string;
  /** Repository slug in `owner/name` form. */
  repo: string;
  /** CI run identifier (GitHub Actions run id). */
  run_id: string;
  /** User or bot that triggered the run. */
  actor: string;
  /** Workflow name. */
  workflow: string;
  /** Triggering event name, e.g. `push` or `deployment`. */
  event_name: string;
  /** Target deployment environment, e.g. `production`. */
  deployment_env: string;
  /** Test coverage percentage (0-100), or null when unknown. */
  test_coverage: number | null;
  /** Build status reported by CI. */
  build_status: CicdBuildStatus;
}

/** Options for {@link captureCicdContext}. */
export interface CaptureCicdContextOptions {
  /** Environment source. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Explicit deployment environment override. */
  deployment_env?: string;
  /** Explicit test coverage override (0-100). */
  test_coverage?: number;
  /** Explicit build status override. */
  build_status?: CicdBuildStatus;
}

/** PROVA test-run results captured from the pipeline. */
export interface CicdTestResults {
  /** Total number of tests executed. */
  total: number;
  /** Number of tests that passed. */
  passed: number;
  /** Number of tests that failed. */
  failed: number;
  /** Coverage percentage (0-100) if measured. */
  coverage?: number;
  /** URL to the full test/evidence report. */
  report_url?: string;
}

/** Options shared by the CI/CD stage-capture helpers. */
export interface CaptureStageOptions {
  /** Chain to link the captured stage into. */
  golden_thread_id: string;
  /** Linker used to persist the stage. */
  golden_thread_linker: GoldenThreadLinker;
  /** CI/CD metadata captured for this run. */
  metadata: CicdMetadata;
}

/** Result of a pipeline gate evaluation. */
export interface PipelineGateResult {
  /** True when the deploy is permitted. */
  passed: boolean;
  /** Human-readable reasons a gate failed (empty when passed). */
  reasons: string[];
}

/** A production incident correlated with a failed test. */
export interface TestIncidentLink {
  /** Name/identifier of the failed test. */
  test_name: string;
  /** Error text reported by the failed test. */
  test_error: string;
  /** Matched production log message. */
  incident_message: string;
  /** Log source the incident came from. */
  incident_source: string;
  /** Number of matching log occurrences. */
  occurrence_count: number;
  /** First occurrence timestamp (ISO 8601). */
  first_occurrence: string;
  /** Last occurrence timestamp (ISO 8601). */
  last_occurrence: string;
  /** Deployment SHA the incident logs belong to. */
  deployment_sha: string;
}

/** Options for {@link linkFailedTestToIncidents}. */
export interface FailedTestIncidentOptions {
  /** Name/identifier of the failed test. */
  failed_test_name: string;
  /** Error text reported by the failed test. */
  failed_test_error: string;
  /** Deployment SHA to search production logs for. */
  deployment_sha: string;
  /** Production logs store to query. */
  logs_store: ProductionLogsStore;
}

const GITHUB_ACTIONS_ACTOR = 'github-actions';

/** Reads a trimmed env value, returning a fallback when unset or empty. */
function readEnv(env: Record<string, string | undefined>, key: string, fallback: string): string {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

/** Maps a raw GitHub ref/branch value into a short branch name. */
function shortBranchName(ref: string): string {
  return ref.replace(/^refs\/(heads|tags)\//, '');
}

/**
 * Captures CI/CD traceability metadata from the pipeline environment.
 * Reads standard GitHub Actions variables and merges explicit overrides.
 * @param opts Environment source and explicit overrides
 * @returns Normalized CI/CD metadata
 */
export function captureCicdContext(opts: CaptureCicdContextOptions = {}): CicdMetadata {
  const env = opts.env ?? process.env;

  const rawBranch = readEnv(env, 'GITHUB_REF_NAME', readEnv(env, 'GITHUB_REF', ''));
  const buildStatus: CicdBuildStatus =
    opts.build_status ?? normalizeBuildStatus(readEnv(env, 'PROVA_BUILD_STATUS', 'unknown'));

  const coverageFromEnv = env['PROVA_TEST_COVERAGE'];
  const parsedCoverage =
    opts.test_coverage ?? (coverageFromEnv !== undefined ? Number(coverageFromEnv) : NaN);
  const test_coverage = Number.isFinite(parsedCoverage) ? clampCoverage(parsedCoverage) : null;

  const metadata: CicdMetadata = {
    commit_sha: readEnv(env, 'GITHUB_SHA', 'unknown'),
    branch: shortBranchName(rawBranch) || 'unknown',
    repo: readEnv(env, 'GITHUB_REPOSITORY', 'unknown'),
    run_id: readEnv(env, 'GITHUB_RUN_ID', 'unknown'),
    actor: readEnv(env, 'GITHUB_ACTOR', GITHUB_ACTIONS_ACTOR),
    workflow: readEnv(env, 'GITHUB_WORKFLOW', 'unknown'),
    event_name: readEnv(env, 'GITHUB_EVENT_NAME', 'unknown'),
    deployment_env: opts.deployment_env ?? readEnv(env, 'PROVA_DEPLOY_ENV', 'unknown'),
    test_coverage,
    build_status: buildStatus
  };

  log.debug('Captured CI/CD context', { ...metadata, test_coverage: metadata.test_coverage ?? -1 });
  return metadata;
}

/** Clamps a coverage number into the inclusive 0-100 range. */
function clampCoverage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Normalizes an arbitrary build-status string into a {@link CicdBuildStatus}. */
function normalizeBuildStatus(value: string): CicdBuildStatus {
  const lower = value.toLowerCase();
  if (lower === 'success' || lower === 'passed' || lower === 'passing') return 'success';
  if (lower === 'failure' || lower === 'failed' || lower === 'failing') return 'failure';
  return 'unknown';
}

/**
 * Captures the Test (stage 2) and Evidence (stage 3) stages from PROVA test results.
 * @param opts Chain, linker, and captured CI/CD metadata
 * @param results PROVA test-run results
 * @throws Error if the chain is missing or linking fails
 */
export async function captureTestEvidenceStages(
  opts: CaptureStageOptions,
  results: CicdTestResults
): Promise<void> {
  const { golden_thread_id, golden_thread_linker, metadata } = opts;
  const status = results.failed === 0 && results.total > 0 ? 'PASSED' : 'FAILED';
  const coverage = results.coverage ?? metadata.test_coverage ?? null;
  const reportUrl =
    results.report_url ?? `https://github.com/${metadata.repo}/actions/runs/${metadata.run_id}`;

  try {
    await golden_thread_linker.linkStage({
      golden_thread_id,
      stage: 2,
      status,
      actor: 'cicd-connector',
      artifact_url: reportUrl,
      metadata: {
        stage_name: STAGE_NAMES[2],
        commit_sha: metadata.commit_sha,
        branch: metadata.branch,
        total: results.total,
        passed: results.passed,
        failed: results.failed
      }
    });

    await golden_thread_linker.linkStage({
      golden_thread_id,
      stage: 3,
      status,
      actor: 'cicd-connector',
      artifact_url: reportUrl,
      metadata: {
        stage_name: STAGE_NAMES[3],
        commit_sha: metadata.commit_sha,
        test_coverage: coverage,
        pass_rate: results.total > 0 ? Math.round((results.passed / results.total) * 100) : 0,
        report_url: reportUrl
      }
    });
  } catch (error) {
    log.error('Failed to capture Test/Evidence stages', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Captures the Build stage (stage 4) from the CI build status.
 * @param opts Chain, linker, and captured CI/CD metadata
 * @throws Error if the chain is missing or linking fails
 */
export async function captureBuildStage(opts: CaptureStageOptions): Promise<void> {
  const { golden_thread_id, golden_thread_linker, metadata } = opts;
  const status = metadata.build_status === 'success' ? 'PASSED' : metadata.build_status === 'failure' ? 'FAILED' : 'IN_PROGRESS';
  const artifact_url = `https://github.com/${metadata.repo}/actions/runs/${metadata.run_id}`;

  try {
    await golden_thread_linker.linkStage({
      golden_thread_id,
      stage: 4,
      status,
      actor: 'cicd-connector',
      artifact_url,
      metadata: {
        stage_name: STAGE_NAMES[4],
        commit_sha: metadata.commit_sha,
        branch: metadata.branch,
        run_id: metadata.run_id,
        workflow: metadata.workflow,
        build_status: metadata.build_status
      }
    });
  } catch (error) {
    log.error('Failed to capture Build stage', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Captures the Deploy stage (stage 5) with deployment information.
 * @param opts Chain, linker, and captured CI/CD metadata
 * @param deployed True when the deployment succeeded
 * @throws Error if the chain is missing or linking fails
 */
export async function captureDeployStage(opts: CaptureStageOptions, deployed: boolean): Promise<void> {
  const { golden_thread_id, golden_thread_linker, metadata } = opts;
  const status = deployed ? 'PASSED' : 'FAILED';
  const deployment_status = deployed ? 'GREEN' : 'RED';
  const artifact_url = `https://github.com/${metadata.repo}/deployments/${metadata.deployment_env}`;

  try {
    await golden_thread_linker.linkStage({
      golden_thread_id,
      stage: 5,
      status,
      actor: 'cicd-connector',
      artifact_url,
      metadata: {
        stage_name: STAGE_NAMES[5],
        commit_sha: metadata.commit_sha,
        branch: metadata.branch,
        environment: metadata.deployment_env,
        deployed_by: metadata.actor
      },
      deployment_status,
      deployment_metadata: JSON.stringify({
        environment: metadata.deployment_env,
        deployed_by: metadata.actor,
        commit_sha: metadata.commit_sha,
        run_id: metadata.run_id,
        timestamp: new Date().toISOString()
      })
    });
  } catch (error) {
    log.error('Failed to capture Deploy stage', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Evaluates the deployment gate: a deploy is only permitted when the Test (stage 2)
 * and Evidence (stage 3) stages are present and PASSED.
 * @param chain The Golden Thread chain to evaluate
 * @returns Gate result with reasons when blocked
 */
export function evaluatePipelineGate(chain: GoldenThreadChain): PipelineGateResult {
  const reasons: string[] = [];

  for (const stageNumber of [2, 3] as const) {
    const stage = chain.stages.find(s => s.stage === stageNumber);
    if (!stage) {
      reasons.push(`Stage ${stageNumber} (${STAGE_NAMES[stageNumber]}) is missing`);
    } else if (stage.status !== 'PASSED') {
      reasons.push(`Stage ${stageNumber} (${STAGE_NAMES[stageNumber]}) is ${stage.status}, expected PASSED`);
    }
  }

  return { passed: reasons.length === 0, reasons };
}

/**
 * Correlates a failed test with production incidents by scanning production logs
 * for the same deployment SHA and matching error signatures.
 * @param opts Failed test details and the production logs store
 * @returns Incident links, one per matching production log message
 * @throws Error if the log query fails
 */
export async function linkFailedTestToIncidents(
  opts: FailedTestIncidentOptions
): Promise<TestIncidentLink[]> {
  const { failed_test_name, failed_test_error, deployment_sha, logs_store } = opts;

  let errorLogs;
  try {
    errorLogs = await logs_store.queryLogs({
      deployment_sha,
      level: ['ERROR', 'WARNING']
    });
  } catch (error) {
    log.error('Failed to query production logs for incident linking', error);
    throw error instanceof Error ? error : new Error(String(error));
  }

  const errorTokens = significantTokens(failed_test_error);
  const grouped = new Map<string, { messages: string[]; source: string; timestamps: number[] }>();

  for (const entry of errorLogs) {
    if (!incidentMatches(failed_test_error, errorTokens, entry.message)) continue;
    const key = entry.message.toLowerCase();
    const bucket = grouped.get(key) ?? { messages: [], source: entry.source, timestamps: [] };
    bucket.messages.push(entry.message);
    bucket.timestamps.push(new Date(entry.timestamp).getTime());
    grouped.set(key, bucket);
  }

  const links: TestIncidentLink[] = [];
  for (const bucket of grouped.values()) {
    const sorted = [...bucket.timestamps].sort((a, b) => a - b);
    links.push({
      test_name: failed_test_name,
      test_error: failed_test_error,
      incident_message: bucket.messages[0],
      incident_source: bucket.source,
      occurrence_count: bucket.messages.length,
      first_occurrence: new Date(sorted[0]).toISOString(),
      last_occurrence: new Date(sorted[sorted.length - 1]).toISOString(),
      deployment_sha
    });
  }

  log.info('Linked failed test to production incidents', {
    failed_test_name,
    deployment_sha,
    incident_count: links.length
  });

  return links;
}

/** Extracts lowercased significant tokens (length >= 4) from a string. */
function significantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length >= 4)
  );
}

/**
 * Determines whether a production log message corresponds to a failed test error.
 * Matches on direct substring containment (either direction) or a shared
 * significant-token overlap of at least two tokens.
 */
function incidentMatches(testError: string, testErrorTokens: Set<string>, logMessage: string): boolean {
  const normalizedError = testError.trim().toLowerCase();
  const normalizedMessage = logMessage.trim().toLowerCase();
  if (normalizedError.length === 0 || normalizedMessage.length === 0) return false;
  if (normalizedMessage.includes(normalizedError) || normalizedError.includes(normalizedMessage)) {
    return true;
  }

  const messageTokens = significantTokens(logMessage);
  let shared = 0;
  for (const token of messageTokens) {
    if (testErrorTokens.has(token)) shared++;
    if (shared >= 2) return true;
  }
  return false;
}
