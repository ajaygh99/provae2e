import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { SQLiteAnalyticsStore } from '../../src/storage/sqlite-analytics-store';
import type { TestRunRecord } from '../../src/storage/analytics-store';

describe('Slice 3 analytics migration safety', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'prova-slice3-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('upgrades a v0.3.3-compatible database without losing active data', async () => {
    const databasePath = path.join(directory, 'analytics.db');
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    legacy.run(`CREATE TABLE test_runs (
      id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, test_name TEXT NOT NULL, test_type TEXT NOT NULL,
      status TEXT NOT NULL, duration_ms INTEGER NOT NULL, device TEXT, browser TEXT, tags TEXT NOT NULL,
      error_message TEXT, metadata TEXT NOT NULL)`);
    legacy.run(`INSERT INTO test_runs VALUES
      ('legacy-1','2026-07-20T00:00:00.000Z','checkout','browser','PASS',100,NULL,'chromium','["legacy"]',NULL,'{"source":"v0.3.3"}')`);
    await writeFile(databasePath, Buffer.from(legacy.export()));
    legacy.close();

    const beforeBytes = await readFile(databasePath);
    expect(beforeBytes.length).toBeGreaterThan(0);
    const store = new SQLiteAnalyticsStore(databasePath);
    await store.initialize();
    expect(await store.getRuns()).toEqual([
      expect.objectContaining({ id: 'legacy-1', metadata: { source: 'v0.3.3' } })
    ]);
    await store.close();

    const upgraded = new SQL.Database(await readFile(databasePath));
    expect(upgraded.exec('PRAGMA integrity_check')[0]?.values[0]?.[0]).toBe('ok');
    expect(upgraded.exec('PRAGMA user_version')[0]?.values[0]?.[0]).toBe(1);
    upgraded.close();
  });

  it('fails closed with an actionable error instead of overwriting corrupt data', async () => {
    const databasePath = path.join(directory, 'analytics.db');
    const original = Buffer.from('not-a-sqlite-database');
    await writeFile(databasePath, original);
    const store = new SQLiteAnalyticsStore(databasePath);
    await expect(store.initialize()).rejects.toThrow('corrupt or unreadable');
    expect(await readFile(databasePath)).toEqual(original);
  });

  it('supports concurrent reads over more than 1000 retained records', async () => {
    const store = new SQLiteAnalyticsStore(path.join(directory, 'analytics.db'));
    await store.initialize();
    const rows: TestRunRecord[] = Array.from({ length: 1_200 }, (_, index) => ({
      id: `run-${index}`,
      timestamp: new Date(Date.UTC(2026, 6, 1 + index % 20)),
      testName: `test-${index % 20}`,
      testType: index % 2 ? 'api' : 'browser',
      status: index % 9 ? 'PASS' : 'FAIL',
      durationMs: 50 + index % 100,
      tags: ['slice3'],
      metadata: { index }
    }));
    await store.saveTestRuns(rows);
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      store.getTrends(30, new Date(Date.UTC(2026, 6, 27)))
    ));
    expect(results).toHaveLength(20);
    expect(results.every((result) => result.length > 0)).toBe(true);
    expect(await store.getRuns()).toHaveLength(1_200);
    await store.close();
  });
});
