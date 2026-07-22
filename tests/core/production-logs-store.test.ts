import { ProductionLogsStore } from '../../src/core/production-logs-store.js';
import { type LogEntry } from '../../src/core/production-logs-model.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

describe('ProductionLogsStore', () => {
  let dbPath: string;
  let store: ProductionLogsStore;

  beforeEach(async () => {
    const tmpDir = tmpdir();
    await mkdir(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, `test-logs-${Date.now()}.sqlite`);
    store = await ProductionLogsStore.open(dbPath);
  });

  describe('ingestLogs - Sampling Logic', () => {
    it('should store 100% of ERROR logs', async () => {
      const errorEntries: LogEntry[] = Array.from({ length: 10 }, (_, i) => ({
        source: 'datadog',
        level: 'ERROR',
        message: `Error ${i}`,
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        tags: {},
        deployment_sha: 'abc123'
      }));

      const stats = await store.ingestLogs(errorEntries, 'abc123');

      expect(stats.errors_stored).toBe(10);
      expect(stats.total_ingested).toBe(10);

      const queried = await store.queryLogs({ deployment_sha: 'abc123' });
      expect(queried).toHaveLength(10);
    });

    it('should store 100% of WARNING logs', async () => {
      const warningEntries: LogEntry[] = Array.from({ length: 10 }, (_, i) => ({
        source: 'cloudwatch',
        level: 'WARNING',
        message: `Warning ${i}`,
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        tags: {},
        deployment_sha: 'def456'
      }));

      const stats = await store.ingestLogs(warningEntries, 'def456');

      expect(stats.warnings_stored).toBe(10);
      expect(stats.total_ingested).toBe(10);
    });

    it('should sample ~10% of INFO logs', async () => {
      const infoEntries: LogEntry[] = Array.from({ length: 100 }, (_, i) => ({
        source: 'elk',
        level: 'INFO',
        message: `Info ${i}`,
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        tags: {},
        deployment_sha: 'ghi789'
      }));

      const stats = await store.ingestLogs(infoEntries, 'ghi789');

      expect(stats.sample_rate_applied).toBe(true);
      expect(stats.info_stored).toBeGreaterThan(0);
      expect(stats.info_stored).toBeLessThanOrEqual(20);
    });

    it('should store 0% of DEBUG logs', async () => {
      const debugEntries: LogEntry[] = Array.from({ length: 50 }, (_, i) => ({
        source: 'datadog',
        level: 'DEBUG',
        message: `Debug ${i}`,
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        tags: {},
        deployment_sha: 'jkl000'
      }));

      const stats = await store.ingestLogs(debugEntries, 'jkl000');

      expect(stats.debug_stored).toBe(0);

      const queried = await store.queryLogs({ deployment_sha: 'jkl000' });
      expect(queried).toHaveLength(0);
    });

    it('should handle mixed log levels correctly', async () => {
      const mixedEntries: LogEntry[] = [
        { source: 'datadog', level: 'ERROR', message: 'Error 1', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'mixed1' },
        { source: 'datadog', level: 'WARNING', message: 'Warning 1', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'mixed1' },
        { source: 'datadog', level: 'INFO', message: 'Info 1', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'mixed1' },
        { source: 'datadog', level: 'DEBUG', message: 'Debug 1', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'mixed1' }
      ];

      const stats = await store.ingestLogs(mixedEntries, 'mixed1');

      expect(stats.errors_stored).toBe(1);
      expect(stats.warnings_stored).toBe(1);
      expect(stats.info_stored).toBeGreaterThanOrEqual(0);
      expect(stats.debug_stored).toBe(0);
    });
  });

  describe('ingestLogs - Deduplication', () => {
    it('should deduplicate identical log entries', async () => {
      const entry: LogEntry = {
        source: 'datadog',
        level: 'ERROR',
        message: 'Duplicate error',
        timestamp: '2026-01-01T10:00:00.000Z',
        tags: {},
        deployment_sha: 'dup1'
      };

      await store.ingestLogs([entry], 'dup1');
      await store.ingestLogs([entry], 'dup1');

      const queried = await store.queryLogs({ deployment_sha: 'dup1' });
      expect(queried).toHaveLength(1);
    });

    it('should store identical messages with different timestamps separately', async () => {
      const entries: LogEntry[] = [
        { source: 'datadog', level: 'ERROR', message: 'Same error', timestamp: '2026-01-01T10:00:00.000Z', tags: {}, deployment_sha: 'dup2' },
        { source: 'datadog', level: 'ERROR', message: 'Same error', timestamp: '2026-01-01T10:01:00.000Z', tags: {}, deployment_sha: 'dup2' }
      ];

      await store.ingestLogs(entries, 'dup2');

      const queried = await store.queryLogs({ deployment_sha: 'dup2' });
      expect(queried).toHaveLength(2);
    });
  });

  describe('queryLogs - Filtering', () => {
    beforeEach(async () => {
      const entries: LogEntry[] = [
        { source: 'datadog', level: 'ERROR', message: 'Error', timestamp: '2026-01-01T10:00:00.000Z', tags: { service: 'api' }, deployment_sha: 'filter1' },
        { source: 'cloudwatch', level: 'WARNING', message: 'Warning', timestamp: '2026-01-01T11:00:00.000Z', tags: { service: 'web' }, deployment_sha: 'filter1' },
        { source: 'elk', level: 'INFO', message: 'Info', timestamp: '2026-01-01T12:00:00.000Z', tags: { service: 'worker' }, deployment_sha: 'filter1' }
      ];
      await store.ingestLogs(entries, 'filter1');
    });

    it('should query all logs by deployment SHA', async () => {
      const logs = await store.queryLogs({ deployment_sha: 'filter1' });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should filter logs by single level', async () => {
      const logs = await store.queryLogs({ deployment_sha: 'filter1', level: 'ERROR' });
      expect(logs.every(log => log.level === 'ERROR')).toBe(true);
    });

    it('should filter logs by multiple levels', async () => {
      const logs = await store.queryLogs({ deployment_sha: 'filter1', level: ['ERROR', 'WARNING'] });
      expect(logs.every(log => log.level === 'ERROR' || log.level === 'WARNING')).toBe(true);
    });

    it('should filter logs by source', async () => {
      const logs = await store.queryLogs({ deployment_sha: 'filter1', source: 'datadog' });
      expect(logs.every(log => log.source === 'datadog')).toBe(true);
    });

    it('should filter logs by time range', async () => {
      const logs = await store.queryLogs({
        deployment_sha: 'filter1',
        startTime: '2026-01-01T10:30:00.000Z',
        endTime: '2026-01-01T11:30:00.000Z'
      });
      expect(logs.every(log => log.timestamp >= '2026-01-01T10:30:00.000Z' && log.timestamp <= '2026-01-01T11:30:00.000Z')).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const logs = await store.queryLogs({ deployment_sha: 'filter1', limit: 1 });
      expect(logs.length).toBeLessThanOrEqual(1);
    });

    it('should return results in descending timestamp order', async () => {
      const logs = await store.queryLogs({ deployment_sha: 'filter1' });
      for (let i = 0; i < logs.length - 1; i++) {
        const current = new Date(logs[i].timestamp).getTime();
        const next = new Date(logs[i + 1].timestamp).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });
  });

  describe('cleanupOldLogs - Rolling Window', () => {
    it('should delete logs older than specified days', async () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const recentDate = now.toISOString();

      const entries: LogEntry[] = [
        { source: 'datadog', level: 'ERROR', message: 'Old error', timestamp: oldDate, tags: {}, deployment_sha: 'cleanup1' },
        { source: 'datadog', level: 'ERROR', message: 'Recent error', timestamp: recentDate, tags: {}, deployment_sha: 'cleanup1' }
      ];

      await store.ingestLogs(entries, 'cleanup1');
      const deletedCount = await store.cleanupOldLogs(30);

      expect(deletedCount).toBe(1);

      const remaining = await store.queryLogs({ deployment_sha: 'cleanup1' });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].message).toBe('Recent error');
    });

    it('should keep logs within the retention window', async () => {
      const now = new Date();
      const withinWindow = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

      const entries: LogEntry[] = [
        { source: 'datadog', level: 'ERROR', message: 'Keep this', timestamp: withinWindow, tags: {}, deployment_sha: 'cleanup2' }
      ];

      await store.ingestLogs(entries, 'cleanup2');
      const deletedCount = await store.cleanupOldLogs(30);

      expect(deletedCount).toBe(0);

      const remaining = await store.queryLogs({ deployment_sha: 'cleanup2' });
      expect(remaining).toHaveLength(1);
    });
  });

  describe('getSummary', () => {
    it('should return zero counts for non-existent deployment', async () => {
      const summary = await store.getSummary('nonexistent');
      expect(summary).toEqual({ ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 });
    });

    it('should count logs by level', async () => {
      const entries: LogEntry[] = [
        { source: 'datadog', level: 'ERROR', message: 'E1', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'summ1' },
        { source: 'datadog', level: 'ERROR', message: 'E2', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'summ1' },
        { source: 'datadog', level: 'WARNING', message: 'W1', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'summ1' }
      ];

      await store.ingestLogs(entries, 'summ1');
      const summary = await store.getSummary('summ1');

      expect(summary.ERROR).toBe(2);
      expect(summary.WARNING).toBe(1);
    });
  });

  describe('listDeployments', () => {
    it('should list all unique deployments', async () => {
      const entries1: LogEntry[] = [
        { source: 'datadog', level: 'ERROR', message: 'E1', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'dep1' }
      ];
      const entries2: LogEntry[] = [
        { source: 'datadog', level: 'ERROR', message: 'E2', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'dep2' }
      ];

      await store.ingestLogs(entries1, 'dep1');
      await store.ingestLogs(entries2, 'dep2');

      const deployments = await store.listDeployments();
      expect(deployments).toContain('dep1');
      expect(deployments).toContain('dep2');
    });
  });

  describe('ingestLogs - Tag handling', () => {
    it('should preserve tags as JSON', async () => {
      const entry: LogEntry = {
        source: 'datadog',
        level: 'ERROR',
        message: 'Error with tags',
        timestamp: new Date().toISOString(),
        tags: { service: 'api', region: 'us-east-1', version: '1.2.3' },
        deployment_sha: 'tags1'
      };

      await store.ingestLogs([entry], 'tags1');

      const queried = await store.queryLogs({ deployment_sha: 'tags1' });
      expect(queried[0].tags).toEqual({ service: 'api', region: 'us-east-1', version: '1.2.3' });
    });

    it('should handle empty tags', async () => {
      const entry: LogEntry = {
        source: 'datadog',
        level: 'ERROR',
        message: 'Error without tags',
        timestamp: new Date().toISOString(),
        tags: {},
        deployment_sha: 'tags2'
      };

      await store.ingestLogs([entry], 'tags2');

      const queried = await store.queryLogs({ deployment_sha: 'tags2' });
      expect(queried[0].tags).toEqual({});
    });
  });
});
