#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REQUIRED = [
  'screenshot.png',
  'trace.zip',
  'logs.json',
  'metadata.json',
  'selectors.json',
  'failure.txt',
  'allure-result.json'
];

const SECRET_PATTERNS = [
  { name: 'GitHub token', regex: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{12,}\b/g },
  { name: 'OpenAI-style key', regex: /\bsk-[A-Za-z0-9_-]{12,}\b/g },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Authorization value', regex: /\b(?:Bearer|Basic)\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{8,}/gi },
  { name: 'credential assignment', regex: /\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*(?!\[REDACTED\])["']?[^\s"',}]{8,}/gi }
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function scanText(content) {
  return SECRET_PATTERNS.flatMap(({ name, regex }) => {
    regex.lastIndex = 0;
    return [...content.matchAll(regex)].map((match) => ({ pattern: name, match: match[0] }));
  });
}

function scanZip(filePath) {
  const unzipListing = spawnSync('unzip', ['-Z1', filePath], { encoding: 'utf8' });
  const useUnzip = unzipListing.status === 0;
  const listing = useUnzip
    ? unzipListing
    : spawnSync('tar', ['-tf', filePath], { encoding: 'utf8' });
  if (listing.status !== 0) return [{ pattern: 'unreadable trace archive', match: '' }];
  return listing.stdout.split(/\r?\n/).filter(Boolean).flatMap((entry) => {
    const extracted = useUnzip
      ? spawnSync('unzip', ['-p', filePath, entry], {
          encoding: 'utf8',
          maxBuffer: 20 * 1024 * 1024
        })
      : spawnSync('tar', ['-xOf', filePath, entry], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
    if (extracted.status !== 0) return [{ pattern: `unreadable trace entry (${entry})`, match: '' }];
    return scanText(extracted.stdout);
  });
}

function scanFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length === 0) return [{ pattern: 'empty artifact', match: '' }];
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return [];
  if (extension === '.zip') return scanZip(filePath);
  return scanText(buffer.toString('utf8'));
}

function validateEvidence(evidenceDir, minimumCompleteness = 95) {
  const manifestPath = path.join(evidenceDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const failures = [];
  let complete = 0;

  for (const result of manifest.results || []) {
    const scenarioDir = path.join(evidenceDir, result.scenarioId);
    const missing = REQUIRED.filter((name) => {
      const candidate = path.join(scenarioDir, name);
      return !fs.existsSync(candidate) || fs.statSync(candidate).size === 0;
    });
    if (missing.length === 0) complete += 1;
    else failures.push(`${result.scenarioId}: missing ${missing.join(', ')}`);
  }

  const total = manifest.totalFailures || 0;
  const completeness = total > 0 ? (complete / total) * 100 : 0;
  const secretFindings = walk(evidenceDir).flatMap((filePath) =>
    scanFile(filePath).map((finding) => ({
      file: path.relative(evidenceDir, filePath),
      pattern: finding.pattern
    }))
  );
  if (completeness < minimumCompleteness) {
    failures.push(`Completeness ${completeness.toFixed(2)}% is below ${minimumCompleteness}%`);
  }
  if (secretFindings.length) failures.push(`${secretFindings.length} potential secret exposure(s) detected`);
  if (manifest.cleanup?.successPath !== 'PASS' || manifest.cleanup?.failurePath !== 'PASS') {
    failures.push('Artifact scratch cleanup did not pass both success and failure paths');
  }

  const validation = {
    validatedAt: new Date().toISOString(),
    totalFailures: total,
    completeFailures: complete,
    completenessPercent: Number(completeness.toFixed(2)),
    requiredCompletenessPercent: minimumCompleteness,
    secretFindings,
    cleanup: manifest.cleanup,
    status: failures.length ? 'FAIL' : 'PASS',
    failures
  };
  fs.writeFileSync(path.join(evidenceDir, 'validation.json'), `${JSON.stringify(validation, null, 2)}\n`);
  if (failures.length) throw new Error(`Slice 2 evidence validation failed:\n- ${failures.join('\n- ')}`);
  return validation;
}

if (require.main === module) {
  try {
    const result = validateEvidence(path.resolve(process.argv[2] || 'artifacts/slice2'));
    console.log(`Slice 2 PASS: ${result.completeFailures}/${result.totalFailures} complete; 0 secret findings.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { REQUIRED, SECRET_PATTERNS, scanFile, validateEvidence };
