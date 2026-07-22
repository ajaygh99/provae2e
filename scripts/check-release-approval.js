#!/usr/bin/env node
// Used by .github/workflows/prova-ci.yml's SHIP job. Gates npm publish on an
// approval doc named for the exact version already declared in package.json.
'use strict';

const fs = require('fs');
const path = require('path');

function checkReleaseApproval(rootDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  const approvalPath = path.join(rootDir, 'releases', `v${version}-approval.md`);
  const approved = fs.existsSync(approvalPath);
  return { version, approvalPath, approved };
}

if (require.main === module) {
  const rootDir = process.argv[2] || process.cwd();
  const result = checkReleaseApproval(rootDir);
  if (!result.approved) {
    console.error(
      `::error::No release approval found at ${result.approvalPath} for the declared version ` +
      `v${result.version}. Publishing aborted.`
    );
    process.exit(1);
  }
  console.log(`Approval found at ${result.approvalPath}. Proceeding to publish v${result.version}...`);
  process.exit(0);
}

module.exports = { checkReleaseApproval };
