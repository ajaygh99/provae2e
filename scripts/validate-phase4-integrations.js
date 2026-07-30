#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('Run integration validation through npm so npm_execpath is available');
}
const full = process.argv.includes('--full');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const runNpm = (args) => run(process.execPath, [npmCli, ...args]);
runNpm(['test', '--', '--runInBand', '--testPathPatterns=tests/integrations|integration-(workflow|docs)']);
runNpm(['run', 'typecheck']);
runNpm(['run', 'lint', '--', '--quiet']);
run(process.execPath, [
  './node_modules/eslint/bin/eslint.js',
  'src/integrations',
  'tests/integrations',
  'tests/scripts/integration-workflow.test.ts',
  'tests/scripts/integration-docs.test.ts',
  '--max-warnings',
  '0'
]);
runNpm(['run', 'build']);
run(process.execPath, ['./scripts/verify-integration-exports.js']);

if (full) {
  runNpm(['test', '--', '--runInBand', '--forceExit']);
  runNpm(['pack', '--dry-run']);
}
