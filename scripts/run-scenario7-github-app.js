#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

async function github(path, token, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub ${path} failed with HTTP ${response.status}`);
  return text ? JSON.parse(text) : {};
}

(async () => {
  const appId = argument('--app-id');
  const privateKeyPath = argument('--private-key');
  const releaseRoot = argument('--release-root');
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  const timeResponse = await fetch('https://api.github.com/meta', {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'ProvaE2E-Validation' }
  });
  const serverDate = timeResponse.headers.get('date');
  if (!serverDate) throw new Error('GitHub server time was unavailable');
  const now = Math.floor(new Date(serverDate).getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  const jwt = `${unsigned}.${signature}`;

  const installation = await github('/repos/ajaygh99/provae2e/installation', jwt);
  if (!Number.isSafeInteger(installation.id)) throw new Error('GitHub App is not installed on ajaygh99/provae2e');
  const access = await github(`/app/installations/${installation.id}/access_tokens`, jwt, {
    method: 'POST',
    body: JSON.stringify({ repositories: ['provae2e'], permissions: { checks: 'write', metadata: 'read' } })
  });
  if (typeof access.token !== 'string') throw new Error('GitHub did not return an installation token');

  process.env.GITHUB_TOKEN = access.token;
  const { GitHubChecksIntegration, IntegrationRegistry } = require(`${releaseRoot}/dist/index.js`);
  const registry = new IntegrationRegistry(process.env);
  await registry.register(new GitHubChecksIntegration());
  try {
    const commit = '67d6512c1fe3430455f8f010220abb98c9460228';
    const result = await registry.execute('github', 'publish-check', {
      owner: 'ajaygh99',
      repository: 'provae2e',
      sha: commit,
      name: 'PROVA Phase 4 Scenario 7 live validation',
      status: 'completed',
      conclusion: 'success',
      evidenceUrl: `https://github.com/ajaygh99/provae2e/commit/${commit}`,
      summary: 'Scenario 7 live GitHub, Jira, and Slack provider validation completed.'
    });
    console.log(JSON.stringify({
      provider: 'github', status: 'PASS', testedAt: new Date().toISOString(),
      appId, installationId: installation.id, repository: 'ajaygh99/provae2e', result
    }, null, 2));
  } finally {
    await registry.disposeAll();
    delete process.env.GITHUB_TOKEN;
  }
})().catch((error) => {
  console.error(JSON.stringify({ provider: 'github', status: 'FAIL', error: error.message }));
  process.exitCode = 1;
});
