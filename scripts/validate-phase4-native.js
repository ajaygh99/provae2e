#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('Run native validation through npm so npm_execpath is available');
}
const full = process.argv.includes('--full') || process.argv.includes('-Full');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const runNpm = (args) => run(process.execPath, [npmCli, ...args]);

runNpm(['test', '--', '--runInBand', '--testPathPatterns=native-appium|native-device-farm|native-test-data']);
runNpm(['run', 'typecheck']);
runNpm(['run', 'lint', '--', '--quiet']);
runNpm(['run', 'build']);
run(process.execPath, ['./dist/cli/run.js', 'native', '--help']);

if (full) {
  runNpm(['test', '--', '--runInBand', '--forceExit']);
  runNpm(['pack', '--dry-run']);
}
