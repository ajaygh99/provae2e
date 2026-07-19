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

const program = new Command();

program
  .name('qe-tool')
  .description('PROVA — AI-native QE automation platform | provae2e.com')
  .version('0.1.0');

program
  .command('run')
  .description('Run tests against a URL')
  .requiredOption('--url <url>',             'Target URL to test')
  .option('--type <type>',                   'Test type: browser|api|mobile|all', 'browser')
  .option('--device <device>',               'Device for mobile: iPhone14|Pixel7|iPad', 'iPhone14')
  .option('--workers <n>',                   'Parallel workers', '3')
  .option('--suite <suite>',                 'Test suite name to run')
  .option('--scope <scope>',                 'Scope: full|cr|smoke|component', 'full')
  .option('--report',                        'Generate HTML report', false)
  .option('--ai',                            'Enable Ollama AI summaries (requires local Ollama)', false)
  .option('--premium',                       'Use cloud LLM instead of local Ollama', false)
  .option('--env <env>',                     'Target environment: dev|qe|uat|staging|prod', 'qe')
  .option('--method <method>',               'API method (--type api): GET|POST|PUT|DELETE', 'GET')
  .option('--body <json>',                   'API request body as JSON (--type api): REST body or GraphQL variables')
  .option('--graphql <query>',               'GraphQL query/mutation document (--type api). Switches the request to GraphQL')
  .option('--expect-status <code>',          'Expected HTTP status code (--type api)', '200')
  .action(async (opts) => {
    log.info('PROVA starting', { url: opts.url, type: opts.type, env: opts.env });

    if (opts.type === 'browser') {
      const result = await runBrowserTest({ url: opts.url });
      log.info('Run result', {
        status: result.status,
        durationMs: result.durationMs,
        screenshotPath: result.screenshotPath
      });
      if (result.status === 'FAIL') {
        process.exitCode = 1;
        return;
      }
      log.success('Run complete');
      return;
    }

    if (opts.type === 'api') {
      let body: unknown;
      if (opts.body) {
        try {
          body = JSON.parse(opts.body) as unknown;
        } catch {
          log.error('Invalid JSON provided to --body');
          process.exitCode = 1;
          return;
        }
      }

      const graphql = opts.graphql
        ? { query: opts.graphql as string, variables: (body as Record<string, unknown>) ?? {} }
        : undefined;

      const result = await runApiTest({
        url: opts.url,
        method: opts.method as HttpMethod,
        body: graphql ? undefined : body,
        graphql,
        expectedStatus: Number(opts.expectStatus)
      });

      log.info('Run result', {
        status: result.status,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
        responseSummary: result.responseSummary
      });

      if (result.status === 'FAIL') {
        process.exitCode = 1;
        return;
      }
      log.success('Run complete');
      return;
    }

    // FORGE will implement the remaining runners (mobile, all) here
    log.info(`Running ${opts.type} tests against ${opts.url}`);
    log.info('FORGE: Implement src/runners/ and wire them here');

    log.success('Run complete');
  });

program
  .command('init')
  .description('Initialise PROVA config in current project')
  .action(() => {
    log.info('Creating prova.config.yml...');
    log.info('FORGE: Implement config initialisation here');
  });

program.parse(process.argv);
