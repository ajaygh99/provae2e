import { PowerBIExporter } from '../../src/exporters/powerbi-exporter';
import type { AnalyticsStore } from '../../src/storage/analytics-store';

test('posts real trend rows to the Power BI push rows contract', async () => {
  const store = { getTrends: jest.fn().mockResolvedValue([
    { date: new Date('2026-01-01'), passCount: 9, failCount: 1, skipCount: 0, averageDuration: 42, flakeRate: 0 }
  ]) } as unknown as AnalyticsStore;
  const http = { post: jest.fn().mockResolvedValue({ status: 200 }) };
  const exporter = new PowerBIExporter(store, {
    workspaceId: 'workspace-1', datasetId: 'dataset-1', accessToken: 'secret', tableName: 'Runs'
  }, http as never);
  const result = await exporter.export(30);
  expect(result.rows).toBe(1);
  expect(http.post).toHaveBeenCalledWith(
    'https://api.powerbi.com/v1.0/myorg/groups/workspace-1/datasets/dataset-1/tables/Runs/rows',
    { rows: [expect.objectContaining({ passRate: 90, averageDuration: 42 })] },
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) })
  );
});

test('rejects unsafe resource identifiers before making a request', async () => {
  const exporter = new PowerBIExporter({ getTrends: jest.fn().mockResolvedValue([]) } as unknown as AnalyticsStore,
    { workspaceId: '../bad', datasetId: 'ok', accessToken: 'secret' });
  await expect(exporter.export()).rejects.toThrow('workspaceId contains invalid characters');
});

test('does not call Power BI when there are no trend rows', async () => {
  const http = { post: jest.fn() };
  const exporter = new PowerBIExporter({ getTrends: jest.fn().mockResolvedValue([]) } as unknown as AnalyticsStore,
    { workspaceId: 'workspace', datasetId: 'dataset', accessToken: 'secret' }, http as never);
  expect(await exporter.export()).toEqual(expect.objectContaining({ rows: 0 }));
  expect(http.post).not.toHaveBeenCalled();
});

test('requires an access token', async () => {
  const exporter = new PowerBIExporter({} as AnalyticsStore,
    { workspaceId: 'workspace', datasetId: 'dataset', accessToken: ' ' });
  await expect(exporter.export()).rejects.toThrow('access token is required');
});
