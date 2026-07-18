#!/usr/bin/env node
/**
 * PROVA CLI entry point
 * Usage: qe-tool run --url <url> [options]
 */
import { Command } from 'commander';
import { log } from '../core/logger.js';

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
  .action(async (opts) => {
    log.info('PROVA starting', { url: opts.url, type: opts.type, env: opts.env });
    
    // FORGE will implement the full runner here
    // This stub exists so TypeScript compiles and CLI works
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
