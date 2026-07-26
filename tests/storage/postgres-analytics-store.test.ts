import { PostgresAnalyticsStore } from '../../src/storage/postgres-analytics-store';
import type { PostgresClient } from '../../src/storage/postgres-analytics-store';

test('uses parameterized PostgreSQL upserts and retention cleanup', async () => {
  const client = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 3 }),
    end: jest.fn().mockResolvedValue(undefined)
  } as unknown as PostgresClient;
  const store = new PostgresAnalyticsStore('', client);
  await store.initialize();
  await store.saveTestRun({
    id: 'id', timestamp: new Date('2026-01-01'), testName: 'test', testType: 'api',
    status: 'PASS', durationMs: 20, tags: [], metadata: {}
  });
  expect((client.query as jest.Mock).mock.calls[1][0]).toContain('ON CONFLICT');
  expect((client.query as jest.Mock).mock.calls[1][1]).toContain('test');
  expect(await store.cleanup(90, new Date('2026-04-10'))).toBe(3);
  expect((client.query as jest.Mock).mock.calls[2][0]).toContain('$1');
  await store.close();
  expect(client.end).toHaveBeenCalled();
});

test('maps PostgreSQL rows into trends, anomaly, flakiness, and exports', async () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    id: String(index), timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    test_name: 'checkout', test_type: 'browser', status: index % 2 ? 'FAIL' : 'PASS',
    duration_ms: 100, device: index ? null : 'Pixel 7', browser: 'chrome',
    tags: ['ci'], error_message: index % 2 ? 'failure' : null, metadata: { build: 1 }
  }));
  const client = {
    query: jest.fn().mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT') ? rows : [], rowCount: 0
    })),
    end: jest.fn().mockResolvedValue(undefined)
  } as unknown as PostgresClient;
  const store = new PostgresAnalyticsStore('', client);
  const selected = await store.getRuns({ days: 30, testName: 'checkout', limit: 20, now: new Date('2026-02-01') });
  expect(selected[0]).toEqual(expect.objectContaining({
    testName: 'checkout', device: 'Pixel 7', browser: 'chrome', tags: ['ci'], metadata: { build: 1 }
  }));
  expect(await store.getTrends(30, new Date('2026-02-01'))).toHaveLength(8);
  expect(await store.getFlakiestTests(5, new Date('2026-02-01'))).toEqual([
    expect.objectContaining({ testName: 'checkout', flakeRate: 1 })
  ]);
  expect((await store.detectAnomalies(new Date('2026-02-01'))).some((item) => item.type === 'flakiness')).toBe(true);
  expect(JSON.parse((await store.export('json')).toString())).toHaveLength(8);
  const select = (client.query as jest.Mock).mock.calls[0];
  expect(select[0]).toContain('LIMIT $3');
  expect(select[1]).toEqual(expect.arrayContaining(['checkout', 20]));
});
