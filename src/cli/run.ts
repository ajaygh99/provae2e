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
import { fetchJiraTicketDescription } from '../core/jira-connector.js';

/** Raw CLI option values Commander hands to the `run` action. */
export interface RunActionOptions extends RunOptionsInput {
  suite?: string;
  report: boolean;
  ai: boolean;
  premium: boolean;
}

/** Raw CLI values accepted by the `generate` command. */
export interface GenerateActionOptions {
  spec?: string;
  jiraTicket?: string;
  jiraUrl?: string;
  type: string;
  url: string;
  output: string;
}

/**
 * Generates Playwright test skeletons from a specification file.
 * Sets exit code 1 and logs a concise error for every failure.
 *
 * @param opts - Parsed `generate` command options.
 */
export async function generateCommand(opts: GenerateActionOptions): Promise<void> {
  const hasSpec = Boolean(opts.spec);
  const hasJiraTicket = Boolean(opts.jiraTicket);
  if (hasSpec === hasJiraTicket) {
    log.error('Provide exactly one source: --spec <file> or --jira-ticket <KEY>');
    process.exitCode = 1;
    return;
  }
  if (opts.jiraUrl && !hasJiraTicket) {
    log.error('--jira-url can only be used with --jira-ticket');
    process.exitCode = 1;
    return;
  }

  let specText: string | undefined;
  let sourceLabel: string | undefined;
  if (opts.jiraTicket) {
    if (!opts.jiraUrl) {
      log.error('--jira-url <base-url> is required with --jira-ticket');
      process.exitCode = 1;
      return;
    }
    const apiToken = process.env['JIRA_API_TOKEN'];
    if (!apiToken) {
      log.error('JIRA_API_TOKEN environment variable is required with --jira-ticket');
      process.exitCode = 1;
      return;
    }
    const jiraResult = await fetchJiraTicketDescription({
      baseUrl: opts.jiraUrl,
      ticketKey: opts.jiraTicket,
      apiToken
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
    outputDir: opts.output
  });
  if (!result.ok) {
    log.error(result.error);
    process.exitCode = 1;
    return;
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
  log.info('PROVA starting', { url: opts.url, type: opts.type, env: opts.env });

  const validation = validateRunOptions(opts);
  if (!validation.valid) {
    for (const error of validation.errors) {
      log.error(error);
    }
    process.exitCode = 1;
    return;
  }

  const type = opts.type;
  const cases: ReportTestCase[] = [];
  let anyFailed = false;

  if (type === 'browser' || type === 'all') {
    const result = await runBrowserTest({ url: opts.url });
    log.info('Run result', {
      status: result.status,
      durationMs: result.durationMs,
      screenshotPath: result.screenshotPath
    });
    cases.push(browserResultToCase(result));
    if (result.status === 'FAIL') {
      anyFailed = true;
    }
  }

  if (type === 'api' || type === 'all') {
    const graphql = opts.graphql
      ? { query: opts.graphql, variables: validation.graphqlVariables ?? {} }
      : undefined;

    const result = await runApiTest({
      url: opts.url,
      method: opts.method as HttpMethod,
      body: graphql ? undefined : validation.restBody,
      graphql,
      expectedStatus: Number(opts.expectStatus)
    });

    log.info('Run result', {
      status: result.status,
      statusCode: result.statusCode,
      durationMs: result.durationMs,
      responseSummary: result.responseSummary
    });
    cases.push(apiResultToCase(result));
    if (result.status === 'FAIL') {
      anyFailed = true;
    }
  }

  if (type === 'mobile' || type === 'all') {
    const result = await runMobileTest({ url: opts.url, device: opts.device });
    log.info('Run result', {
      status: result.status,
      device: result.device,
      durationMs: result.durationMs,
      screenshotPath: result.screenshotPath
    });
    cases.push(mobileResultToCase(result));
    if (result.status === 'FAIL') {
      anyFailed = true;
    }
  }

  if (opts.report) {
    const { reportPath } = await generateAllureReport({ runs: cases });
    log.info('HTML report generated', { reportPath });
  }
  if (opts.ai) {
    await printAiSummary({ runs: cases });
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
    .version('0.1.0');

  program
    .command('run')
    .description('Run tests against a URL')
    .requiredOption('--url <url>', 'Target URL to test')
    .option('--type <type>', 'Test type: browser|api|mobile|all', 'browser')
    .option('--device <device>', 'Device for mobile: iPhone14|Pixel7|iPad', 'iPhone14')
    .option('--workers <n>', 'Parallel workers', '3')
    .option('--suite <suite>', 'Test suite name to run')
    .option('--scope <scope>', 'Scope: full|cr|smoke|component', 'full')
    .option('--report', 'Generate HTML report', false)
    .option('--ai', 'Enable Ollama AI summaries (requires local Ollama)', false)
    .option('--premium', 'Use cloud LLM instead of local Ollama', false)
    .option('--env <env>', 'Target environment: dev|qe|uat|staging|prod', 'qe')
    .option('--method <method>', 'API method (--type api): GET|POST|PUT|DELETE', 'GET')
    .option('--body <json>', 'API request body as JSON (--type api): REST body or GraphQL variables')
    .option('--graphql <query>', 'GraphQL query/mutation document (--type api). Switches the request to GraphQL')
    .option('--expect-status <code>', 'Expected HTTP status code (--type api)', '200')
    .action(runCommand);

  program
    .command('init')
    .description('Initialise PROVA config in current project')
    .action(() => {
      log.info('Creating prova.config.yml...');
      log.info('FORGE: Implement config initialisation here');
    });

  program
    .command('generate')
    .description('Generate Playwright test skeletons from a local spec or JIRA ticket using local Ollama')
    .option('--spec <file>', 'Plain-text or Markdown specification file (mutually exclusive with --jira-ticket)')
    .option('--jira-ticket <key>', 'JIRA ticket key (mutually exclusive with --spec)')
    .option('--jira-url <base-url>', 'JIRA base URL; required with --jira-ticket')
    .requiredOption('--type <type>', 'Generated test type: browser|api')
    .requiredOption('--url <url>', 'Target URL for generated tests')
    .option('--output <dir>', 'Directory for generated test files', './generated-tests')
    .action(generateCommand);

  return program;
}

/* istanbul ignore next -- exercised via the built CLI binary, not unit tests */
if (require.main === module) {
  buildProgram().parse(process.argv);
}
