#!/usr/bin/env node
const prova = require('../dist/index.js');

const requiredExports = [
  'IntegrationRegistry',
  'GitHubChecksIntegration',
  'JiraTraceabilityIntegration',
  'SlackReleaseIntegration',
  'validateIntegrationManifest'
];
const missing = requiredExports.filter((name) => typeof prova[name] !== 'function');
if (missing.length > 0) {
  throw new Error(`Missing public integration exports: ${missing.join(', ')}`);
}
process.stdout.write(`Verified integration exports: ${requiredExports.join(', ')}\n`);
