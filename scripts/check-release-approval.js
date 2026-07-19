#!/usr/bin/env node
// Used by .github/workflows/prova-ci.yml's SHIP job. Gates npm publish on an
// approval doc named for the *next* version (current version, patch-bumped) -
// not the currently-published version, and not just "any approval file".
'use strict';

const fs = require('fs');
const path = require('path');

function computeNextVersion(currentVersion) {
  const parts = currentVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid semver version: ${currentVersion}`);
  }
  const [major, minor, patch] = parts;
  return `${major}.${minor}.${patch + 1}`;
}

function checkReleaseApproval(rootDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const currentVersion = pkg.version;
  const nextVersion = computeNextVersion(currentVersion);
  const approvalPath = path.join(rootDir, 'releases', `v${nextVersion}-approval.md`);
  const approved = fs.existsSync(approvalPath);
  return { currentVersion, nextVersion, approvalPath, approved };
}

if (require.main === module) {
  const rootDir = process.argv[2] || process.cwd();
  const result = checkReleaseApproval(rootDir);
  if (!result.approved) {
    console.error(
      `::error::No release approval found at ${result.approvalPath} for the next version ` +
      `v${result.nextVersion} (current published: v${result.currentVersion}). Publishing aborted.`
    );
    process.exit(1);
  }
  console.log(`Approval found at ${result.approvalPath}. Proceeding to publish v${result.nextVersion}...`);
  process.exit(0);
}

module.exports = { computeNextVersion, checkReleaseApproval };
