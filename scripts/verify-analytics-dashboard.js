const { mkdir, readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SQLiteAnalyticsStore } = require('../dist/storage/sqlite-analytics-store.js');

async function main() {
  const outputDirectory = path.resolve(process.argv[2] || 'artifacts/analytics-dashboard');
  const database = path.join(outputDirectory, 'analytics.sqlite');
  const json = path.join(outputDirectory, 'analytics.json');
  const html = path.join(outputDirectory, 'analytics.html');
  await mkdir(outputDirectory, { recursive: true });
  await rm(database, { force: true });
  const store = new SQLiteAnalyticsStore(database);
  await store.initialize();
  try {
    await store.saveTestRuns([
      run('dashboard-pass', 'checkout', 'PASS', 120, '2026-07-27T12:00:00.000Z'),
      run('dashboard-fail', 'checkout', 'FAIL', 210, '2026-07-28T12:00:00.000Z'),
      run('dashboard-api', 'health-api', 'PASS', 40, '2026-07-29T12:00:00.000Z', 'api')
    ]);
  } finally {
    await store.close();
  }
  executeReport(database, 'json', json);
  executeReport(database, 'html', html);
  const parsed = JSON.parse(await readFile(json, 'utf8'));
  if (parsed.summary.totalTests !== 3 || parsed.summary.passed !== 2 || parsed.summary.failed !== 1) {
    throw new Error('Generated JSON dashboard totals are incorrect');
  }
  if (!['warning', 'critical'].includes(parsed.quality.status)) {
    throw new Error('Generated JSON dashboard quality status is incorrect');
  }
  const page = await readFile(html, 'utf8');
  const required = [
    '<meta name="viewport"',
    '<main class="shell">',
    'aria-label="Quality status:',
    '<caption>Daily test outcomes and performance</caption>',
    '@media(max-width:780px)'
  ];
  for (const marker of required) {
    if (!page.includes(marker)) throw new Error(`Generated HTML dashboard is missing ${marker}`);
  }
  if (/<script\b|<link\b|https?:\/\//i.test(page)) {
    throw new Error('Generated HTML dashboard contains an external or executable dependency');
  }
  process.stdout.write(`Analytics dashboard verified: ${outputDirectory}\n`);
}

function run(id, testName, status, durationMs, timestamp, testType = 'browser') {
  return {
    id,
    timestamp: new Date(timestamp),
    testName,
    testType,
    status,
    durationMs,
    tags: ['ci', 'analytics-dashboard'],
    metadata: {}
  };
}

function executeReport(database, format, output) {
  const result = spawnSync(process.execPath, [
    path.resolve('dist/cli/run.js'),
    'report',
    '--analytics',
    '--database', database,
    '--days', '30',
    '--format', format,
    '--output', output
  ], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } });
  if (result.status !== 0) {
    throw new Error(`Built analytics CLI ${format} report failed: ${result.stderr || result.stdout}`);
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
