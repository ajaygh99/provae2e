#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function verifyBrowserStackEvidence(evidenceDir, expectedCount) {
  const files = fs.readdirSync(evidenceDir)
    .filter((name) => /^run-\d+\.json$/.test(name))
    .sort((left, right) => Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]));
  const runs = files.flatMap((name) => {
    const document = JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8'));
    return Array.isArray(document.runs) ? document.runs : [];
  });

  const failures = [];
  if (runs.length !== expectedCount) {
    failures.push(`Expected ${expectedCount} runs, found ${runs.length}`);
  }

  const sessionIds = new Set();
  for (const [index, run] of runs.entries()) {
    const label = `run ${index + 1}`;
    if (run.status !== 'PASS') failures.push(`${label}: status is not PASS`);
    if (run.provider !== 'browserstack') failures.push(`${label}: provider is not browserstack`);
    if (!run.sessionId) failures.push(`${label}: missing sessionId`);
    else if (sessionIds.has(run.sessionId)) failures.push(`${label}: duplicate sessionId`);
    else sessionIds.add(run.sessionId);
    if (!run.videoUrl) failures.push(`${label}: missing videoUrl`);
    if (!Array.isArray(run.logUrls) || run.logUrls.length === 0) failures.push(`${label}: missing logUrls`);
    if (!run.screenshotPath || !fs.existsSync(run.screenshotPath)) failures.push(`${label}: missing screenshot`);
  }

  const devices = [...new Set(runs.map((run) => run.device).filter(Boolean))];
  const manifest = {
    generatedAt: new Date().toISOString(),
    expectedCount,
    actualCount: runs.length,
    passed: runs.filter((run) => run.status === 'PASS').length,
    failed: runs.filter((run) => run.status !== 'PASS').length,
    uniqueSessions: sessionIds.size,
    devices,
    videoEvidenceCount: runs.filter((run) => Boolean(run.videoUrl)).length,
    logEvidenceCount: runs.filter((run) => Array.isArray(run.logUrls) && run.logUrls.length > 0).length,
    screenshotEvidenceCount: runs.filter((run) => run.screenshotPath && fs.existsSync(run.screenshotPath)).length,
    verified: failures.length === 0,
    failures
  };
  fs.writeFileSync(path.join(evidenceDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (failures.length > 0) {
    throw new Error(`BrowserStack evidence verification failed:\n- ${failures.join('\n- ')}`);
  }
  return manifest;
}

if (require.main === module) {
  const evidenceDir = process.argv[2];
  const expectedCount = Number(process.argv[3]);
  if (!evidenceDir || !Number.isInteger(expectedCount) || expectedCount < 1) {
    console.error('Usage: node scripts/verify-browserstack-evidence.js <evidence-dir> <expected-count>');
    process.exit(1);
  }
  const manifest = verifyBrowserStackEvidence(evidenceDir, expectedCount);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

module.exports = { verifyBrowserStackEvidence };
