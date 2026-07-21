import { execFile } from 'node:child_process';
import path from 'node:path';
import { log } from '../core/logger.js';
import type { PromotionConfig, PromotionEnvironment } from './env-config-loader.js';

export interface PromotionExecutionResult { passed: boolean; error?: string; }
export interface PromotionExecutor {
  run(testFile: string, environmentName: string, environment: PromotionEnvironment): Promise<PromotionExecutionResult>;
}
export interface PromotionStepResult extends PromotionExecutionResult { environment: string; durationMs: number; }
export interface PromotionResult {
  status: 'PASS' | 'FAIL';
  chain: string;
  source: string;
  target: string;
  testFile: string;
  startedAt: string;
  steps: PromotionStepResult[];
  summary: string;
}
export interface PromotionOptions {
  config: PromotionConfig;
  chain: string;
  source?: string;
  target?: string;
  testFile: string;
  coveragePercent?: number;
  blockOnFail?: boolean;
  executor?: PromotionExecutor;
}

function transitionEnvironments(options: PromotionOptions, names: string[]): string[] {
  if (options.source === undefined && options.target === undefined) return names;
  if (!options.source || !options.target) throw new Error('Both promotion source and target are required');
  const sourceIndex = names.indexOf(options.source);
  const targetIndex = names.indexOf(options.target);
  if (sourceIndex < 0) throw new Error(`Unknown source environment "${options.source}"`);
  if (targetIndex < 0) throw new Error(`Unknown target environment "${options.target}"`);
  if (targetIndex !== sourceIndex + 1) {
    throw new Error(`Invalid promotion transition "${options.source}" -> "${options.target}": environments must be adjacent and ordered`);
  }
  return [options.source];
}

function summaryText(
  status: 'PASS' | 'FAIL', source: string, target: string, startedAt: string, steps: PromotionStepResult[]
): string {
  const gates = steps.map((step) => `${step.environment}: ${step.passed ? 'PASS' : `FAIL (${step.error ?? 'unknown failure'})`}`).join(', ');
  return `${status}: ${source} -> ${target} at ${startedAt}. Gates: ${gates}`;
}

function resolvedEnvironment(environment: PromotionEnvironment): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...process.env, PROVA_BASE_URL: environment.url };
  delete result['JEST_WORKER_ID'];
  if (environment.testData) result['PROVA_TEST_DATA'] = environment.testData;
  for (const [target, source] of Object.entries(environment.variables ?? {})) {
    const value = process.env[source];
    if (value === undefined) throw new Error(`Required credential environment variable "${source}" is not set`);
    result[target] = value;
  }
  return result;
}

function redactSecrets(value: string, environment: PromotionEnvironment): string {
  let redacted = value;
  for (const source of Object.values(environment.variables ?? {})) {
    const secret = process.env[source];
    if (secret) redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

/** System Playwright boundary used by the promotion chain. */
export const systemPromotionExecutor: PromotionExecutor = {
  run(testFile, environmentName, environment): Promise<PromotionExecutionResult> {
    return new Promise((resolve) => {
      let env: NodeJS.ProcessEnv;
      try { env = resolvedEnvironment(environment); } catch (error) {
        resolve({ passed: false, error: error instanceof Error ? error.message : String(error) }); return;
      }
      const playwrightCli = require.resolve('@playwright/test/cli');
      const testArgument = path.isAbsolute(testFile)
        ? path.relative(process.cwd(), testFile).replaceAll(path.sep, '/')
        : testFile.replaceAll(path.sep, '/');
      execFile(process.execPath, [playwrightCli, 'test', testArgument], { env, windowsHide: true }, (error, stdout, stderr) => {
        if (!error) { resolve({ passed: true }); return; }
        const detail = stderr.trim() || stdout.trim() || error.message;
        resolve({ passed: false, error: `${environmentName}: ${redactSecrets(detail, environment)}` });
      });
    });
  }
};

/** Executes a named environment chain sequentially and optionally stops on first failure. */
export async function runPromotionChain(options: PromotionOptions): Promise<PromotionResult> {
  const names = options.config.chains[options.chain];
  if (!names) throw new Error(`Unknown promotion chain "${options.chain}"`);
  if (!options.testFile.trim()) throw new Error('Promotion test file is required');
  if (options.coveragePercent !== undefined && (!Number.isFinite(options.coveragePercent) || options.coveragePercent < 0 || options.coveragePercent > 100)) {
    throw new Error('Coverage percent must be between 0 and 100');
  }
  const selectedNames = transitionEnvironments(options, names);
  const executor = options.executor ?? systemPromotionExecutor;
  const steps: PromotionStepResult[] = [];
  const startedAt = new Date().toISOString();
  for (const name of selectedNames) {
    log.info('Running promotion gate', { chain: options.chain, environment: name });
    const started = Date.now();
    let execution: PromotionExecutionResult;
    try { execution = await executor.run(options.testFile, name, options.config.environments[name]); }
    catch (error) { execution = { passed: false, error: error instanceof Error ? error.message : String(error) }; }
    if (execution.error) {
      execution = { ...execution, error: redactSecrets(execution.error, options.config.environments[name]) };
    }
    const minimumCoverage = options.config.environments[name].minimumCoverage;
    if (execution.passed && minimumCoverage !== undefined) {
      if (options.coveragePercent === undefined) execution = { passed: false, error: `Coverage is required (minimum ${minimumCoverage}%)` };
      else if (options.coveragePercent < minimumCoverage) execution = { passed: false, error: `Coverage ${options.coveragePercent}% is below required ${minimumCoverage}%` };
    }
    steps.push({ environment: name, ...execution, durationMs: Date.now() - started });
    if (!execution.passed && options.blockOnFail !== false) break;
  }
  const status = steps.length === selectedNames.length && steps.every((step) => step.passed) ? 'PASS' : 'FAIL';
  const source = options.source ?? names[0];
  const target = options.target ?? names[names.length - 1];
  return {
    status,
    chain: options.chain,
    source,
    target,
    testFile: options.testFile,
    startedAt,
    steps,
    summary: summaryText(status, source, target, startedAt, steps)
  };
}
