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
import { generateTestDataFromFile } from '../core/test-data-factory.js';
import { writeFile } from 'node:fs/promises';
import { fetchFigmaElements } from '../core/figma-connector.js';
import type { FigmaElement } from '../core/figma-connector.js';

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
  schema?: string;
  figmaFile?: string;
  figmaNode?: string;
}

/** Raw CLI values accepted by the `data` command. */
export interface DataActionOptions {
  schema: string;
  count: string;
  output?: string;
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
  const result = await generateTestDataFromFile(opts.schema, { count });
  if (!result.ok) {
    log.error(result.error);
    process.exitCode = 1;
    return;
  }
  const json = `${JSON.stringify(result.data, null, 2)}\n`;
  if (!opts.output) {
    process.stdout.write(json);
    return;
  }
  try {
    await writeFile(opts.output, json, { encoding: 'utf-8' });
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
  if (opts.jiraUrl && !hasJiraTicket) {
    log.error('--jira-url can only be used with --jira-ticket');
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
    outputDir: opts.output,
    requestBody,
    figmaElements
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
    .command('data')
    .description('Generate realistic JSON test data from a schema or example file')
    .requiredOption('--schema <file.json>', 'JSON Schema, descriptor shape, or example JSON file')
    .option('--count <n>', 'Number of records to generate', '1')
    .option('--output <file.json>', 'Write JSON to a file instead of stdout')
    .action(dataCommand);

  program
    .command('generate')
    .description('Generate Playwright test skeletons from a local spec, JIRA ticket, or Figma frame using local Ollama')
    .option('--spec <file>', 'Plain-text or Markdown specification file (mutually exclusive with --jira-ticket)')
    .option('--jira-ticket <key>', 'JIRA ticket key (mutually exclusive with --spec)')
    .option('--jira-url <base-url>', 'JIRA base URL; required with --jira-ticket')
    .option('--figma-file <file-key>', 'Figma file key; requires --figma-node and FIGMA_API_TOKEN')
    .option('--figma-node <node-id>', 'Figma frame/node ID; requires --figma-file and FIGMA_API_TOKEN')
    .requiredOption('--type <type>', 'Generated test type: browser|api')
    .requiredOption('--url <url>', 'Target URL for generated tests')
    .option('--output <dir>', 'Directory for generated test files', './generated-tests')
    .option('--schema <file.json>', 'Populate API request bodies from a schema or example JSON file')
    .action(generateCommand);

  return program;
}

/* istanbul ignore next -- exercised via the built CLI binary, not unit tests */
if (require.main === module) {
  buildProgram().parse(process.argv);
}
