#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const initSqlJs = require('sql.js');

const LEGACY_ROWS = 1_500;
const RETENTION_NOW = new Date('2026-07-27T00:00:00.000Z');

function hashRows(rows) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp.toISOString(),
      testName: row.testName,
      testType: row.testType,
      status: row.status,
      durationMs: row.durationMs,
      tags: row.tags,
      metadata: row.metadata
    }))))
    .digest('hex');
}

async function createLegacyDatabase(filePath) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE test_runs (
    id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, test_name TEXT NOT NULL, test_type TEXT NOT NULL,
    status TEXT NOT NULL, duration_ms INTEGER NOT NULL, device TEXT, browser TEXT, tags TEXT NOT NULL,
    error_message TEXT, metadata TEXT NOT NULL);
    CREATE INDEX idx_analytics_timestamp ON test_runs(timestamp);
    CREATE INDEX idx_analytics_test_name ON test_runs(test_name);
    CREATE INDEX idx_analytics_status ON test_runs(status);`);
  db.run('BEGIN');
  for (let index = 0; index < LEGACY_ROWS; index += 1) {
    const ageDays = index % 120;
    const timestamp = new Date(RETENTION_NOW.getTime() - ageDays * 86_400_000).toISOString();
    db.run(`INSERT INTO test_runs
      (id,timestamp,test_name,test_type,status,duration_ms,device,browser,tags,error_message,metadata)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
      `legacy-${String(index).padStart(4, '0')}`,
      timestamp,
      `checkout-${index % 25}`,
      ['browser', 'api', 'mobile'][index % 3],
      index % 11 === 0 ? 'FAIL' : 'PASS',
      50 + index % 250,
      index % 3 === 2 ? 'iPhone 14' : null,
      index % 3 === 0 ? 'chromium' : null,
      JSON.stringify(['v0.3.3', 'migration']),
      index % 11 === 0 ? 'Synthetic legacy failure' : null,
      JSON.stringify({ legacyIndex: index, sourceVersion: '0.3.3-beta.1' })
    ]);
  }
  db.run('COMMIT');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(db.export()));
  db.close();
}

async function inspectSchema(filePath) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(await fs.readFile(filePath));
  const integrity = String(db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0]);
  const userVersion = Number(db.exec('PRAGMA user_version')[0]?.values[0]?.[0]);
  const columns = db.exec('PRAGMA table_info(test_runs)')[0]?.values.map((row) => String(row[1])) || [];
  const indexes = db.exec(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='test_runs' ORDER BY name`)
    [0]?.values.map((row) => String(row[0])) || [];
  db.close();
  return { integrity, userVersion, columns, indexes };
}

async function main(options = {}) {
  const outputDir = path.resolve(options.outputDir || process.argv[2] || 'artifacts/slice3');
  const databasePath = path.join(outputDir, 'analytics-v0.3.3-upgraded.db');
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await createLegacyDatabase(databasePath);

  const { SQLiteAnalyticsStore } = require('../dist/storage/sqlite-analytics-store.js');
  let store = new SQLiteAnalyticsStore(databasePath);
  await store.initialize();
  const before = await store.getRuns();
  const beforeHash = hashRows(before);
  await store.close();

  store = new SQLiteAnalyticsStore(databasePath);
  await store.initialize();
  const afterReopen = await store.getRuns();
  const afterHash = hashRows(afterReopen);

  const queryTimingsMs = [];
  let trends = [];
  for (let sample = 0; sample < 5; sample += 1) {
    const started = performance.now();
    trends = await store.getTrends(120, RETENTION_NOW);
    queryTimingsMs.push(Number((performance.now() - started).toFixed(3)));
  }
  const concurrentStarted = performance.now();
  const concurrentResults = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    index % 2 === 0
      ? store.getRuns({ testName: `checkout-${index % 25}`, limit: 20 })
      : store.getTrends(90, RETENTION_NOW)
  ));
  const concurrentDurationMs = Number((performance.now() - concurrentStarted).toFixed(3));

  const expectedRemoved = afterReopen.filter((row) =>
    row.timestamp < new Date(RETENTION_NOW.getTime() - 90 * 86_400_000)).length;
  const removed = await store.cleanup(90, RETENTION_NOW);
  const retained = await store.getRuns();
  await store.close();

  const corruptPath = path.join(outputDir, 'corrupt-analytics.db');
  await fs.writeFile(corruptPath, 'not a sqlite database', 'utf8');
  let corruptHandling = 'FAIL';
  let corruptError = '';
  try {
    const corruptStore = new SQLiteAnalyticsStore(corruptPath);
    await corruptStore.initialize();
    await corruptStore.close();
  } catch (error) {
    corruptHandling = 'PASS';
    corruptError = error instanceof Error ? error.message : String(error);
  }

  const schema = await inspectSchema(databasePath);
  const priorBrowserStackPath = path.resolve('releases/v0.3.2-beta.1-browserstack-evidence.json');
  const priorBrowserStack = JSON.parse(await fs.readFile(priorBrowserStackPath, 'utf8'));
  const browserStackCredentialsAvailable = Boolean(
    process.env.BROWSERSTACK_USERNAME && process.env.BROWSERSTACK_ACCESS_KEY
  );
  const browserStack = browserStackCredentialsAvailable
    ? {
        status: 'CREDENTIALS_AVAILABLE_REQUIRES_WORKFLOW_DISPATCH',
        priorEvidenceVerified: priorBrowserStack.verified === true,
        priorWorkflowRun: priorBrowserStack.workflowRun,
        action: 'Dispatch .github/workflows/browserstack-evidence.yml against the Slice 3 commit.'
      }
    : {
        status: 'VALIDATION_GAP_CREDENTIALS_UNAVAILABLE',
        priorEvidenceVerified: priorBrowserStack.verified === true,
        priorPassed: priorBrowserStack.passed,
        priorFailed: priorBrowserStack.failed,
        priorWorkflowRun: priorBrowserStack.workflowRun,
        action: 'Run credentialed BrowserStack regression after credentials are provisioned; do not claim current-code validation.'
      };

  const report = {
    evidencePackage: 'v0.3.4-beta.1-slice3',
    generatedAt: new Date().toISOString(),
    sourceVersion: 'v0.3.3-beta.1-compatible-schema',
    targetVersion: 'v0.3.4-beta.1',
    migration: {
      rowsBefore: before.length,
      rowsAfterReopen: afterReopen.length,
      beforeHash,
      afterHash,
      zeroDataLoss: before.length === afterReopen.length && beforeHash === afterHash
    },
    schema,
    performance: {
      datasetRows: afterReopen.length,
      trendDays: trends.length,
      queryTimingsMs,
      fastestQueryMs: Math.min(...queryTimingsMs),
      slowestQueryMs: Math.max(...queryTimingsMs),
      concurrentQueries: concurrentResults.length,
      concurrentDurationMs
    },
    retention: {
      policyDays: 90,
      expectedRemoved,
      actualRemoved: removed,
      retainedRows: retained.length,
      pass: removed === expectedRemoved && retained.length === afterReopen.length - expectedRemoved
    },
    corruptData: { status: corruptHandling, error: corruptError },
    browserStack
  };
  report.status = report.migration.zeroDataLoss
    && schema.integrity === 'ok'
    && schema.userVersion === 1
    && report.retention.pass
    && corruptHandling === 'PASS'
    && report.performance.datasetRows >= 1_000
    && report.performance.slowestQueryMs < 100
    ? 'PASS'
    : 'FAIL';
  await fs.writeFile(path.join(outputDir, 'validation.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (report.status !== 'PASS') throw new Error(`Slice 3 analytics validation failed: ${JSON.stringify(report)}`);
  console.log(`Slice 3 PASS: ${afterReopen.length} rows preserved; slowest trend query ${report.performance.slowestQueryMs}ms.`);
  console.log(`BrowserStack: ${browserStack.status}`);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { LEGACY_ROWS, hashRows, main };
