#!/usr/bin/env node
const { randomUUID } = require('node:crypto');
const { PostgresAnalyticsStore } = require('../dist/storage/postgres-analytics-store.js');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const store = new PostgresAnalyticsStore(connectionString);
  const testName = `ci-postgres-${randomUUID()}`;
  try {
    await store.initialize();
    await store.saveTestRuns([
      {
        id: randomUUID(), timestamp: new Date(), testName, testType: 'api', status: 'PASS',
        durationMs: 25, tags: ['postgres-integration'], metadata: { source: 'github-actions' }
      },
      {
        id: randomUUID(), timestamp: new Date(), testName, testType: 'api', status: 'FAIL',
        durationMs: 50, tags: ['postgres-integration'], errorMessage: 'expected fixture', metadata: {}
      }
    ]);
    const rows = await store.getRuns({ testName });
    const trends = await store.getTrends(7);
    if (rows.length !== 2) throw new Error(`Expected 2 PostgreSQL rows, received ${rows.length}`);
    if (!trends.some((trend) => trend.passCount >= 1 && trend.failCount >= 1)) {
      throw new Error('PostgreSQL trend aggregation did not include the integration rows');
    }
    process.stdout.write(JSON.stringify({ ok: true, rows: rows.length, trendDays: trends.length }));
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
