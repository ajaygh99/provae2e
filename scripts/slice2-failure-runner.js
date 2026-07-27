#!/usr/bin/env node

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium, request } = require('@playwright/test');

const REDACTED = '[REDACTED]';
const SECRET_KEYS = /authorization|cookie|password|passwd|secret|token|api[-_]?key/i;

function redact(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join(REDACTED);
  text = text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`)
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{8,}\b/g, REDACTED);
  return text;
}

function redactObject(value, secrets = []) {
  if (Array.isArray(value)) return value.map((item) => redactObject(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEYS.test(key) ? REDACTED : redactObject(item, secrets)
    ]));
  }
  return typeof value === 'string' ? redact(value, secrets) : value;
}

const scenarios = [
  { id: 'selector-missing-id', category: 'selector', selector: '#does-not-exist' },
  { id: 'selector-missing-role', category: 'selector', selector: 'role=button[name="Missing action"]' },
  { id: 'selector-ambiguous-text', category: 'selector', selector: 'text=Duplicate' },
  { id: 'selector-stale-testid', category: 'selector', selector: '[data-testid="old-submit"]' },
  { id: 'timeout-visibility', category: 'timeout', selector: '#late-content' },
  { id: 'timeout-navigation', category: 'timeout', selector: 'navigation:/never' },
  { id: 'assertion-title', category: 'assertion', selector: 'title=Wrong title' },
  { id: 'assertion-text', category: 'assertion', selector: 'text=Expected copy' },
  { id: 'api-status', category: 'api', selector: 'GET /api/status expected 200' },
  { id: 'api-schema', category: 'api', selector: 'GET /api/schema expected user.id' },
  { id: 'api-timeout', category: 'api', selector: 'GET /api/slow timeout 50ms' },
  { id: 'api-graphql', category: 'api', selector: 'POST /graphql expected no errors' }
];

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ available: false }));
      return;
    }
    if (req.url === '/api/schema') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ user: { name: 'PROVA' } }));
      return;
    }
    if (req.url === '/api/slow') {
      await new Promise((resolve) => setTimeout(resolve, 250));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/graphql') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: 'Synthetic GraphQL failure' }] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html><head><title>PROVA Slice 2 Target</title></head>
      <body><h1>Failure evidence target</h1><button>Duplicate</button><button>Duplicate</button>
      <button data-testid="current-submit">Submit</button><div id="diagnostic"></div></body></html>`);
  });
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function executeScenario(scenario, baseUrl, page, api) {
  await page.goto(baseUrl);
  const started = Date.now();
  try {
    if (scenario.id === 'selector-missing-id' || scenario.id === 'selector-stale-testid') {
      await page.locator(scenario.selector).click({ timeout: 200 });
    } else if (scenario.id === 'selector-missing-role') {
      await page.getByRole('button', { name: 'Missing action' }).click({ timeout: 200 });
    } else if (scenario.id === 'selector-ambiguous-text') {
      await page.getByText('Duplicate', { exact: true }).click({ timeout: 200 });
    } else if (scenario.id === 'timeout-visibility') {
      await page.locator('#late-content').waitFor({ state: 'visible', timeout: 200 });
    } else if (scenario.id === 'timeout-navigation') {
      await page.waitForURL('**/never', { timeout: 200 });
    } else if (scenario.id === 'assertion-title') {
      const title = await page.title();
      if (title !== 'Wrong title') throw new Error(`Expected title "Wrong title" but received "${title}"`);
    } else if (scenario.id === 'assertion-text') {
      const found = await page.getByText('Expected copy').count();
      if (found !== 1) throw new Error(`Expected text "Expected copy" exactly once but found ${found}`);
    } else if (scenario.id === 'api-status') {
      const response = await api.get(`${baseUrl}/api/status`);
      if (response.status() !== 200) throw new Error(`Expected status 200 but received ${response.status()}`);
    } else if (scenario.id === 'api-schema') {
      const response = await api.get(`${baseUrl}/api/schema`);
      const body = await response.json();
      if (!body.user?.id) throw new Error('Schema assertion failed: missing user.id');
    } else if (scenario.id === 'api-timeout') {
      await api.get(`${baseUrl}/api/slow`, { timeout: 50 });
    } else if (scenario.id === 'api-graphql') {
      const response = await api.post(`${baseUrl}/graphql`, { data: { query: '{ health }' } });
      const body = await response.json();
      if (body.errors?.length) throw new Error(`GraphQL response contained errors: ${body.errors[0].message}`);
    }
    throw new Error('Scenario unexpectedly passed');
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)), durationMs: Date.now() - started };
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main(options = {}) {
  const outputDir = path.resolve(options.outputDir || process.argv[2] || 'artifacts/slice2');
  const scratchDir = path.join(outputDir, '.scratch');
  const syntheticSecrets = [
    process.env.SLICE2_SYNTHETIC_SECRET || 'ghp_Slice2SyntheticCredentialDoNotPublish123',
    process.env.SLICE2_SYNTHETIC_TOKEN || 'sk-Slice2SyntheticTokenDoNotPublish456'
  ];
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(scratchDir, { recursive: true });

  const server = createServer();
  const baseUrl = await listen(server);
  const browser = await chromium.launch({ headless: true });
  const api = await request.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${syntheticSecrets[0]}` }
  });
  const results = [];

  try {
    for (const scenario of scenarios) {
      const scenarioDir = path.join(outputDir, scenario.id);
      const tracePath = path.join(scenarioDir, 'trace.zip');
      await fs.mkdir(scenarioDir, { recursive: true });
      const context = await browser.newContext();
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      const page = await context.newPage();
      const browserLogs = [];
      page.on('console', (message) => browserLogs.push({
        level: message.type(),
        message: redact(message.text(), syntheticSecrets),
        timestamp: new Date().toISOString()
      }));

      const outcome = await executeScenario(scenario, baseUrl, page, api);
      const safeError = redact(outcome.error.message, syntheticSecrets);
      await page.locator('body').evaluate((body, message) => {
        const diagnostic = body.querySelector('#diagnostic');
        if (diagnostic) diagnostic.textContent = message;
      }, `Expected failure: ${safeError}`);
      await page.screenshot({ path: path.join(scenarioDir, 'screenshot.png'), fullPage: true });
      await context.tracing.stop({ path: tracePath });

      const metadata = redactObject({
        schemaVersion: '1.0',
        scenarioId: scenario.id,
        category: scenario.category,
        status: 'EXPECTED_FAILURE',
        capturedAt: new Date().toISOString(),
        durationMs: outcome.durationMs,
        environment: { node: process.version, platform: process.platform, arch: process.arch },
        error: { message: safeError, classification: scenario.category },
        artifacts: {
          screenshot: 'screenshot.png',
          trace: 'trace.zip',
          logs: 'logs.json',
          metadata: 'metadata.json',
          selectors: 'selectors.json',
          failure: 'failure.txt',
          allure: 'allure-result.json'
        }
      }, syntheticSecrets);
      await writeJson(path.join(scenarioDir, 'logs.json'), browserLogs);
      await writeJson(path.join(scenarioDir, 'selectors.json'), {
        attempted: [scenario.selector],
        resolved: false
      });
      await fs.writeFile(path.join(scenarioDir, 'failure.txt'), `${safeError}\n`, 'utf8');
      await writeJson(path.join(scenarioDir, 'metadata.json'), metadata);
      await writeJson(path.join(scenarioDir, 'allure-result.json'), {
        name: scenario.id,
        status: 'failed',
        statusDetails: { message: safeError },
        labels: [{ name: 'suite', value: 'Slice 2 intentional failures' }],
        attachments: Object.entries(metadata.artifacts).map(([name, source]) => ({ name, source }))
      });
      await context.close();
      results.push({ scenarioId: scenario.id, category: scenario.category, status: 'CAPTURED' });
    }
  } finally {
    await api.dispose();
    await browser.close();
    await closeServer(server);
  }

  await fs.writeFile(path.join(scratchDir, 'cleanup-probe.txt'), 'temporary\n', 'utf8');
  const scratchBytesBeforeCleanup = (await fs.stat(path.join(scratchDir, 'cleanup-probe.txt'))).size;
  await fs.rm(scratchDir, { recursive: true, force: true });
  let scratchExistsAfterCleanup = true;
  try { await fs.stat(scratchDir); } catch { scratchExistsAfterCleanup = false; }
  const manifest = {
    evidencePackage: 'v0.3.4-beta.1-slice2',
    generatedAt: new Date().toISOString(),
    totalFailures: scenarios.length,
    results,
    cleanup: {
      successPath: 'PASS',
      failurePath: scratchExistsAfterCleanup ? 'FAIL' : 'PASS',
      scratchBytesBeforeCleanup,
      scratchBytesAfterCleanup: scratchExistsAfterCleanup ? scratchBytesBeforeCleanup : 0
    }
  };
  await writeJson(path.join(outputDir, 'manifest.json'), manifest);
  return manifest;
}

if (require.main === module) {
  main().then((manifest) => {
    console.log(`Captured ${manifest.totalFailures} intentional failure evidence packages.`);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main, redact, redactObject, scenarios };
