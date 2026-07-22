#!/usr/bin/env node
'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const reportDir = path.join(root, 'reports', 'phase2-use-cases-2026-07-21');
const assetsDir = path.join(reportDir, 'assets');
const generatedDir = path.join(reportDir, 'generated');

function clean(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function serverUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function startDemoServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/user') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 7, name: 'Ada', profile: { age: 36, roles: ['admin', 'qa'] } }));
      return;
    }
    if (req.url === '/graphql') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { user: { id: 7, name: 'Ada', active: true } } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>PROVA Demo Portal</title><style>
      body{font-family:Arial;margin:0;background:#07111f;color:#eef7ff;display:grid;place-items:center;min-height:100vh}
      main{width:min(760px,86vw);padding:48px;border:1px solid #274766;border-radius:24px;background:linear-gradient(145deg,#10243b,#0a1728);box-shadow:0 24px 80px #0008}
      .tag{color:#55e6a5;text-transform:uppercase;letter-spacing:.16em;font-weight:700}h1{font-size:48px;margin:14px 0}p{color:#aec2d6;font-size:18px;line-height:1.6}
      button{background:#55e6a5;color:#052016;border:0;border-radius:12px;padding:14px 22px;font-weight:800;font-size:16px}
    </style></head><body><main><div class="tag">PROVA Phase 2</div><h1>Quality intelligence, proven.</h1><p>Browser, mobile, API, AI generation, design ingestion, performance baselines, and promotion gates.</p><button data-testid="start-testing">Start testing</button></main></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function result(id, title, value, detail, evidence, mode = 'executed') {
  const passed = value === true || value?.status === 'PASS' || value?.ok === true;
  return { id, title, passed, detail, evidence, mode };
}

function render(results, evidenceImages = false) {
  const passed = results.filter((item) => item.passed).length;
  const cards = results.map((item, index) => `<article class="case" id="case-${item.id}">
    <div class="case-head"><span class="number">${String(index + 1).padStart(2, '0')}</span><div><h2>${clean(item.title)}</h2><span class="mode">${clean(item.mode)}</span></div><span class="status ${item.passed ? 'pass' : 'fail'}">${item.passed ? 'PASS' : 'FAIL'}</span></div>
    <p>${clean(item.detail)}</p><pre>${clean(item.evidence)}</pre>
    ${evidenceImages ? `<img class="evidence" src="assets/${item.id}.png" alt="Evidence for ${clean(item.title)}">` : ''}
  </article>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PROVA Phase 2 Use Case Report</title><style>
    :root{--bg:#07111f;--panel:#0e1d30;--line:#25415e;--ink:#edf7ff;--muted:#9bb1c7;--green:#55e6a5;--red:#ff6b7d;--blue:#6bb8ff}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,#163b5b 0,transparent 38%),var(--bg);color:var(--ink);font-family:Inter,Segoe UI,Arial,sans-serif}
    header,main,footer{width:min(1120px,92vw);margin:auto}header{padding:64px 0 30px}.eyebrow{color:var(--green);font-weight:800;letter-spacing:.17em;text-transform:uppercase}h1{font-size:clamp(38px,6vw,72px);line-height:1;margin:16px 0}.lede{color:var(--muted);font-size:20px;max-width:780px;line-height:1.55}
    .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:30px 0}.metric{background:#ffffff0a;border:1px solid var(--line);padding:20px;border-radius:16px}.metric b{display:block;font-size:30px;color:var(--green)}.metric span{color:var(--muted)}
    main{display:grid;gap:20px;padding-bottom:40px}.case{background:linear-gradient(145deg,#10243a,#0b1828);border:1px solid var(--line);border-radius:20px;padding:24px;box-shadow:0 16px 50px #0004}.case-head{display:flex;align-items:center;gap:16px}.case h2{font-size:22px;margin:0 0 5px}.number{font:800 22px ui-monospace;color:var(--blue)}.mode{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}.status{margin-left:auto;border-radius:999px;padding:8px 12px;font-weight:800;font-size:12px}.pass{background:#123d31;color:var(--green)}.fail{background:#4b1f29;color:var(--red)}.case p{color:var(--muted);line-height:1.5}.case pre{white-space:pre-wrap;word-break:break-word;background:#050c15;border:1px solid #1a344d;border-radius:12px;padding:16px;color:#cce4f8;line-height:1.45}.evidence{display:block;width:100%;margin-top:18px;border:1px solid var(--line);border-radius:12px}
    footer{padding:10px 0 60px;color:var(--muted)}@media(max-width:700px){.summary{grid-template-columns:1fr}.case-head{align-items:flex-start}.status{margin-left:0}}
  </style></head><body><header><div class="eyebrow">PROVA v0.2.0 · Verified showcase</div><h1>Top 10 use cases through Phase 2</h1><p class="lede">A local, credential-safe execution report. External JIRA and Figma network calls are replaced with representative payloads while their production parsing and generation code runs unchanged.</p><section class="summary"><div class="metric"><b>${passed}/10</b><span>scenarios passed</span></div><div class="metric"><b>80%+</b><span>release coverage gate</span></div><div class="metric"><b>${new Date().toLocaleString()}</b><span>generated locally</span></div></section></header><main>${cards}</main><footer>Generated by scripts/generate-phase2-use-case-report.js · No production credentials stored.</footer></body></html>`;
}

async function main() {
  await fs.rm(reportDir, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });

  const server = await startDemoServer();
  const baseUrl = serverUrl(server);
  const results = [];
  try {
    const { runBrowserTest } = require('../dist/runners/browser-runner.js');
    const { runMobileTest } = require('../dist/runners/mobile-runner.js');
    const { runApiTest } = require('../dist/runners/api-runner.js');
    const { jiraDescriptionToText } = require('../dist/core/jira-connector.js');
    const { extractAcceptanceCriteria } = require('../dist/generators/spec-test-generator.js');
    const { generateAiSpec } = require('../dist/generators/ai-spec-generator.js');
    const { generateAdvancedTestData } = require('../dist/generators/test-data-factory.js');
    const { extractFigmaElements } = require('../dist/core/figma-connector.js');
    const { generateFigmaTests } = require('../dist/generators/figma-test-generator.js');
    const { runPromotionChain } = require('../dist/promotions/env-chain-manager.js');
    const { PerformanceStore } = require('../dist/perf/performance-store.js');
    const { detectRegressions } = require('../dist/perf/regression-detector.js');

    const browser = await runBrowserTest({ url: baseUrl, screenshotDir: assetsDir });
    await fs.copyFile(browser.screenshotPath, path.join(assetsDir, '01-browser.png'));
    results.push(result('01-browser', 'Browser smoke testing', browser, 'Launch Chromium, navigate to the application, validate its title, and capture a screenshot.', JSON.stringify(browser, null, 2)));

    const mobile = await runMobileTest({ url: baseUrl, device: 'iPhone14', screenshotDir: assetsDir });
    await fs.copyFile(mobile.screenshotPath, path.join(assetsDir, '02-mobile.png'));
    results.push(result('02-mobile', 'Mobile device emulation', mobile, 'Run the same application using Playwright iPhone 14 emulation and retain device-specific evidence.', JSON.stringify(mobile, null, 2)));

    const restSchema = { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' }, profile: { type: 'object', properties: { age: { type: 'number' }, roles: { type: 'array', items: { type: 'string' } } } } } };
    const graphSchema = { type: 'object', properties: { user: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' }, active: { type: 'boolean' } } } } };
    const rest = await runApiTest({ url: `${baseUrl}/api/user`, nestedSchema: restSchema });
    const graphql = await runApiTest({ url: `${baseUrl}/graphql`, graphql: { query: 'query { user { id name active } }' }, nestedSchema: graphSchema });
    results.push(result('03-api', 'REST and GraphQL schema validation', rest.status === 'PASS' && graphql.status === 'PASS', 'Exercise real HTTP requests and deeply nested path-aware response validation for REST and GraphQL.', `REST: ${rest.status} (${rest.statusCode})\nGraphQL: ${graphql.status} (${graphql.statusCode})\n${graphql.responseSummary}`));

    const healed = await runBrowserTest({ url: baseUrl, screenshotDir: assetsDir, selector: { testId: 'start-testing' } });
    await fs.copyFile(healed.screenshotPath, path.join(assetsDir, '04-self-healing.png'));
    results.push(result('04-self-healing', 'Self-healing selector resolution', healed, 'Resolve the target through PROVA’s five-tier selector engine and report the successful tier.', JSON.stringify(healed, null, 2)));

    const jiraText = jiraDescriptionToText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Acceptance Criteria:' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'User sees the dashboard after login' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Invalid password shows an error' }] }] }] }] });
    const criteria = extractAcceptanceCriteria(jiraText);
    results.push(result('05-jira', 'JIRA acceptance-criteria ingestion', criteria.length >= 2, 'Parse an Atlassian Document Format issue description and extract testable acceptance criteria without contacting a customer JIRA instance.', criteria.map((item, i) => `${i + 1}. ${item}`).join('\n'), 'local integration fixture'));

    const specPath = path.join(generatedDir, 'login.feature');
    await fs.writeFile(specPath, 'Feature: Login\nScenario: Valid credentials\nGiven user is on login page\nWhen user clicks "Start testing" button\nThen user should see "Quality intelligence"');
    const ai = await generateAiSpec({ specFile: specPath, outputDir: path.join(generatedDir, 'ai-tests'), url: baseUrl, browsers: ['chromium', 'firefox', 'webkit'] });
    const aiSource = ai.ok ? await fs.readFile(ai.file, 'utf8') : ai.error;
    results.push(result('06-ai-generation', 'AI-ready specification to Playwright', ai, 'Convert Gherkin acceptance criteria into deterministic, tagged Playwright TypeScript for three browser engines.', aiSource.slice(0, 900)));

    const data = generateAdvancedTestData({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, age: { type: 'integer', minimum: 18, maximum: 65 }, plan: { type: 'string', enum: ['free', 'team'] } } }, { count: 3, seed: 123 });
    results.push(result('07-faker', 'Faker-backed schema test data', data, 'Generate reproducible, schema-constrained customer records with no production data exposure.', data.ok ? JSON.stringify(data.records, null, 2) : data.error));

    const figmaPayload = { document: { type: 'DOCUMENT', children: [{ type: 'CANVAS', name: 'App', children: [{ type: 'INSTANCE', name: 'Primary Button' }, { type: 'INSTANCE', name: 'Email Field' }, { type: 'TEXT', name: 'Welcome Text', characters: 'Welcome' }] }] } };
    const elements = extractFigmaElements(figmaPayload.document);
    const figmaFiles = await generateFigmaTests(elements, path.join(generatedDir, 'figma-tests'));
    results.push(result('08-figma', 'Figma design-to-test generation', figmaFiles.length === 3, 'Extract actionable components from a representative Figma payload and generate click, fill, and visibility test stubs.', figmaFiles.map((file) => path.relative(reportDir, file)).join('\n'), 'local integration fixture'));

    const promotion = await runPromotionChain({ config: { environments: { dev: { url: baseUrl, minimumCoverage: 80 }, qe: { url: baseUrl, minimumCoverage: 80 }, staging: { url: baseUrl, minimumCoverage: 80 } }, chains: { release: ['dev', 'qe', 'staging'] } }, chain: 'release', testFile: 'showcase.spec.ts', coveragePercent: 88, blockOnFail: true, executor: { run: async () => ({ passed: true }) } });
    results.push(result('09-promotion', 'Dev → QE → staging promotion gates', promotion, 'Execute the real ordered gate, coverage, stop-on-failure, and reporting logic with a deterministic local executor.', promotion.summary, 'orchestration executed; environment runner simulated'));

    const dbPath = path.join(generatedDir, 'performance.sqlite');
    const baseline = { url: baseUrl, vus: 10, durationSeconds: 30, p50ResponseTimeMs: 50, p95ResponseTimeMs: 100, p99ResponseTimeMs: 150, errorRate: 0.01, requestsPerSecond: 25, status: 'PASS', timestamp: new Date().toISOString() };
    const store = await PerformanceStore.open(dbPath); await store.setBaseline(baseline); await store.addRun(baseline); store.close();
    const reopened = await PerformanceStore.open(dbPath); const persisted = reopened.getBaseline(baseUrl, 10, 30); reopened.close();
    const regressions = detectRegressions({ ...baseline, p95ResponseTimeMs: 125, requestsPerSecond: 20 }, baseline, 10);
    results.push(result('10-performance', 'SQLite performance baselines', Boolean(persisted) && regressions.length >= 2, 'Persist a load-profile baseline, reopen it from SQLite, and detect latency/throughput regressions.', `Persisted p95: ${persisted?.p95ResponseTimeMs}ms\nDetected: ${regressions.map((item) => item.metric).join(', ')}`));

    const reportPath = path.join(reportDir, 'index.html');
    await fs.writeFile(reportPath, render(results, false));
    const captureBrowser = await chromium.launch({ headless: true });
    const page = await captureBrowser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${reportPath.replaceAll('\\', '/')}`);
    for (const item of results) {
      if (!['01-browser', '02-mobile', '04-self-healing'].includes(item.id)) {
        await page.locator(`#case-${item.id}`).screenshot({ path: path.join(assetsDir, `${item.id}.png`) });
      }
    }
    await fs.writeFile(reportPath, render(results, true));
    await page.reload();
    await page.screenshot({ path: path.join(reportDir, 'report-overview.png'), fullPage: true });
    await captureBrowser.close();
    process.stdout.write(`${reportPath}\n${results.filter((item) => item.passed).length}/${results.length} scenarios passed\n`);
    if (results.some((item) => !item.passed)) process.exitCode = 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
