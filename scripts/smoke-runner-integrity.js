#!/usr/bin/env node

/**
 * SLICE 1 SMOKE RUNNER (INTEGRITY VERSION)
 * Executes actual smoke tests and captures complete per-run metrics
 * Every run record includes: command, timestamp, duration, exit code, counts, output hash, commit SHA
 * Usage: node scripts/smoke-runner-integrity.js [--runs 100] [--output releases]
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');

const args = process.argv.slice(2);
const runCount = parseInt(args.find(a => a.startsWith('--runs='))?.split('=')[1] || '100', 10);
const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1] || 'releases';

const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, outputDir);
const manifestPath = path.join(outputPath, 'smoke-runs-manifest-integrity.json');
const logsDir = path.join(outputPath, 'smoke-logs');
const logPath = path.join(outputPath, 'smoke-runner-integrity.log');

// Ensure directories exist
if (!fs.existsSync(outputPath)) {
  fs.mkdirSync(outputPath, { recursive: true });
}
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Initialize log file
fs.writeFileSync(logPath, `Smoke Runner (Integrity) - Started ${new Date().toISOString()}\n\n`);

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level}] ${message}`;
  console.log(entry);
  fs.appendFileSync(logPath, entry + '\n');
}

function hashOutput(output) {
  return crypto.createHash('sha256').update(output).digest('hex').substring(0, 16);
}

function getCommitSHA() {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function parseJestOutput(output) {
  const normalized = output.replace(/\u001b\[[0-9;]*m/g, '');
  const summary = normalized.match(/^Tests:\s+(.+)$/m)?.[1] ?? '';
  const passMatch = summary.match(/(\d+)\s+passed/);
  const failMatch = summary.match(/(\d+)\s+failed/);
  const skipMatch = summary.match(/(\d+)\s+skipped/);
  const totalMatch = summary.match(/(\d+)\s+total/);

  return {
    passed: passMatch ? parseInt(passMatch[1], 10) : 0,
    failed: failMatch ? parseInt(failMatch[1], 10) : 0,
    skipped: skipMatch ? parseInt(skipMatch[1], 10) : 0,
    total: totalMatch ? parseInt(totalMatch[1], 10) : 0
  };
}

function runSmokeTest(runNumber, commitSHA) {
  const runStartTime = Date.now();
  const startTimeISO = new Date(runStartTime).toISOString();
  let exitCode = -1;
  let stdout = '';
  let stderr = '';
  let testCounts = { passed: 0, failed: 0, skipped: 0, total: 0 };

  try {
    log(`Run ${runNumber}/${runCount}: Executing npm run test:smoke...`);

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npmCommand, ['run', 'test:smoke'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    stdout = result.stdout || '';
    stderr = result.stderr || '';
    if (result.error) {
      throw result.error;
    }
    exitCode = result.status ?? 1;

    testCounts = parseJestOutput(stdout + stderr);
    if (testCounts.total === 0) {
      exitCode = exitCode === 0 ? 1 : exitCode;
      stderr += '\nEvidence runner rejected execution because Jest reported zero tests.\n';
    }

    log(`Run ${runNumber}: exit code ${exitCode}, ${testCounts.passed} passed, ${testCounts.failed} failed, ${testCounts.skipped} skipped, ${testCounts.total} total`);
  } catch (e) {
    log(`Run ${runNumber}: ERROR during execution - ${e.message}`, 'ERROR');
    stderr = e.toString();
    exitCode = 1;
  }

  const runEndTime = Date.now();
  const durationMs = runEndTime - runStartTime;
  const durationSec = (durationMs / 1000).toFixed(3);

  // Save raw log
  const runLogFile = path.join(logsDir, `run-${String(runNumber).padStart(3, '0')}.log`);
  fs.writeFileSync(runLogFile, `=== Run ${runNumber} ===\nSTART: ${startTimeISO}\nDURATION: ${durationSec}s\nEXIT CODE: ${exitCode}\n\n=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}\n`);

  const outputHash = hashOutput(stdout + stderr);

  return {
    runNumber,
    timestamp: startTimeISO,
    command: 'npm run test:smoke',
    durationMs,
    durationSeconds: parseFloat(durationSec),
    exitCode,
    status: exitCode === 0 ? 'PASS' : 'FAIL',
    testsPassed: testCounts.passed,
    testsFailed: testCounts.failed,
    testsSkipped: testCounts.skipped,
    testsTotal: testCounts.total,
    outputHash,
    commitSHA,
    logFile: `smoke-logs/run-${String(runNumber).padStart(3, '0')}.log`
  };
}

async function main() {
  log('========== SMOKE RUNNER (INTEGRITY) START ==========');
  log(`Repository: ${repoRoot}`);
  log(`Target runs: ${runCount}`);
  log(`Output directory: ${outputDir}`);

  const commitSHA = getCommitSHA();
  log(`Commit: ${commitSHA}`);

  const globalStartTime = Date.now();
  const globalStartTimeISO = new Date(globalStartTime).toISOString();
  const runs = [];
  let totalDurationMs = 0;

  // Execute runs
  for (let i = 1; i <= runCount; i++) {
    const result = runSmokeTest(i, commitSHA);
    runs.push(result);
    totalDurationMs += result.durationMs;

    // Progress indicator every 10 runs
    if (i % 10 === 0) {
      log(`Progress: ${i}/${runCount} runs completed`);
    }
  }

  const globalEndTime = Date.now();
  const globalEndTimeISO = new Date(globalEndTime).toISOString();
  const totalGlobalDurationMs = globalEndTime - globalStartTime;

  // Calculate flake metrics
  const flakyRuns = runs.filter(r => r.exitCode !== 0);
  const flakeRate = (flakyRuns.length / runs.length) * 100;
  const avgDuration = totalDurationMs / runs.length / 1000;

  log('========== ANALYSIS ==========');
  log(`Total runs: ${runs.length}`);
  log(`Passing runs: ${runs.length - flakyRuns.length}`);
  log(`Failing runs: ${flakyRuns.length}`);
  log(`Flake rate: ${flakeRate.toFixed(2)}%`);
  log(`Average duration: ${avgDuration.toFixed(3)}s`);
  log(`Total execution time: ${(totalGlobalDurationMs / 1000 / 60).toFixed(2)} minutes`);

  // Build manifest with metadata
  const manifest = {
    evidencePackage: 'v0.3.4-beta.1-slice1',
    generated: new Date().toISOString(),
    integrity: {
      schema: '2.0-integrity',
      requiresRealExecution: true,
      perRunFields: ['command', 'timestamp', 'durationMs', 'exitCode', 'testsPassed', 'testsFailed', 'testsSkipped', 'testsTotal', 'outputHash', 'commitSHA', 'logFile']
    },
    executionWindow: {
      globalStartTime: globalStartTimeISO,
      globalEndTime: globalEndTimeISO,
      globalDurationMs: totalGlobalDurationMs,
      globalDurationMinutes: (totalGlobalDurationMs / 1000 / 60).toFixed(2)
    },
    smokeTests: {
      totalRuns: runs.length,
      runs
    },
    analysis: {
      flakyCount: flakyRuns.length,
      passingRuns: runs.length - flakyRuns.length,
      totalRuns: runs.length,
      flakePercentage: parseFloat(flakeRate.toFixed(2)),
      averageDurationSeconds: parseFloat(avgDuration.toFixed(3)),
      totalDurationMs: totalDurationMs,
      status: flakeRate < 2.0 ? 'PASS' : 'FAIL'
    },
    logsDirectory: 'smoke-logs',
    commitHash: commitSHA,
    timestamp: new Date().toISOString()
  };

  // Write manifest
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log(`PASS Manifest (integrity): ${manifestPath}`);
  log(`PASS Logs directory: ${logsDir}`);

  log('========== SMOKE RUNNER (INTEGRITY) COMPLETE ==========');
  process.exit(manifest.analysis.status === 'PASS' ? 0 : 1);
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, 'ERROR');
  process.exit(1);
});
