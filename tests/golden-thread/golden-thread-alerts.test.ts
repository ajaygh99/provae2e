import { detectUnseenErrors, summarizeAlerts, type ProductionAlert } from '../../src/core/golden-thread-alerts.js';
import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { GoldenThreadStore } from '../../src/core/golden-thread-store.js';
import { ProductionLogsStore } from '../../src/core/production-logs-store.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

describe('Golden Thread Alerts - Error Mismatch Detection', () => {
  let dbPath: string;
  let logsDbPath: string;
  let store: GoldenThreadStore;
  let logsStore: ProductionLogsStore;
  let linker: GoldenThreadLinker;

  beforeEach(async () => {
    const tmpDir = tmpdir();
    await mkdir(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, `test-gt-${Date.now()}.sqlite`);
    logsDbPath = path.join(tmpDir, `test-logs-${Date.now()}.sqlite`);
    store = await GoldenThreadStore.open(dbPath);
    logsStore = await ProductionLogsStore.open(logsDbPath);
    linker = new GoldenThreadLinker(store);
  });

  describe('detectUnseenErrors', () => {
    it('should detect errors in production logs not in test evidence', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/alert1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://test-results.example.com',
        metadata: { errors: ['TimeoutError'] }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://logs.example.com',
        metadata: { deployment_sha: 'alert1' }
      });

      const errorLogs = [
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'Database connection timeout', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'alert1' },
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'Database connection timeout', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'alert1' }
      ];

      await logsStore.ingestLogs(errorLogs, 'alert1');

      const alerts = await detectUnseenErrors(golden_thread_id, linker, logsStore);

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].found_in_stage_6).toBe(true);
      expect(alerts[0].found_in_stage_3).toBe(false);
    });

    it('should not alert for errors that are in test evidence', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/alert2'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://test-results.example.com',
        metadata: { errors: ['Database connection timeout'] }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://logs.example.com',
        metadata: { deployment_sha: 'alert2' }
      });

      const errorLogs = [
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'Database connection timeout', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'alert2' }
      ];

      await logsStore.ingestLogs(errorLogs, 'alert2');

      const alerts = await detectUnseenErrors(golden_thread_id, linker, logsStore);

      expect(alerts).toHaveLength(0);
    });

    it('should return empty array if no stage 6 found', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/alert3'
      });

      const alerts = await detectUnseenErrors(golden_thread_id, linker, logsStore);

      expect(alerts).toHaveLength(0);
    });

    it('should return empty array if stage 6 has no deployment SHA', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/alert4'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://logs.example.com',
        metadata: { invalid_field: 'no_sha' }
      });

      const alerts = await detectUnseenErrors(golden_thread_id, linker, logsStore);

      expect(alerts).toHaveLength(0);
    });

    it('should track first and last occurrence timestamps', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/alert5'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://logs.example.com',
        metadata: { deployment_sha: 'alert5' }
      });

      const now = new Date();
      const firstTime = new Date(now.getTime() - 60000).toISOString();
      const lastTime = new Date(now.getTime() - 1000).toISOString();

      const errorLogs = [
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'Memory leak detected', timestamp: firstTime, tags: {}, deployment_sha: 'alert5' },
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'Memory leak detected', timestamp: lastTime, tags: {}, deployment_sha: 'alert5' }
      ];

      await logsStore.ingestLogs(errorLogs, 'alert5');

      const alerts = await detectUnseenErrors(golden_thread_id, linker, logsStore);

      expect(alerts).toHaveLength(1);
      expect(new Date(alerts[0].first_occurrence).getTime()).toBeLessThanOrEqual(new Date(alerts[0].last_occurrence).getTime());
    });

    it('should count occurrences for each unique error', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/alert6'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://logs.example.com',
        metadata: { deployment_sha: 'alert6' }
      });

      const now = new Date();
      const errorLogs = [
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'Disk full error', timestamp: new Date(now.getTime()).toISOString(), tags: {}, deployment_sha: 'alert6' },
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'Disk full error', timestamp: new Date(now.getTime() + 1000).toISOString(), tags: {}, deployment_sha: 'alert6' },
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'Disk full error', timestamp: new Date(now.getTime() + 2000).toISOString(), tags: {}, deployment_sha: 'alert6' }
      ];

      await logsStore.ingestLogs(errorLogs, 'alert6');

      const alerts = await detectUnseenErrors(golden_thread_id, linker, logsStore);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].occurrence_count).toBe(3);
    });

    it('should include recommendation in alert', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/alert7'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://logs.example.com',
        metadata: { deployment_sha: 'alert7' }
      });

      const errorLogs = [
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'Cache miss on critical endpoint', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'alert7' }
      ];

      await logsStore.ingestLogs(errorLogs, 'alert7');

      const alerts = await detectUnseenErrors(golden_thread_id, linker, logsStore);

      expect(alerts[0].recommendation).toContain('Add test case');
      expect(alerts[0].recommendation).toContain('Cache miss on critical endpoint');
    });

    it('should detect both ERROR and WARNING level mismatches', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/alert8'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://logs.example.com',
        metadata: { deployment_sha: 'alert8' }
      });

      const errorLogs = [
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'Service unavailable', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'alert8' },
        { source: 'datadog' as const, level: 'WARNING' as const, message: 'High latency detected', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'alert8' }
      ];

      await logsStore.ingestLogs(errorLogs, 'alert8');

      const alerts = await detectUnseenErrors(golden_thread_id, linker, logsStore);

      expect(alerts).toHaveLength(2);
      const errorAlert = alerts.find(a => a.error_severity === 'ERROR');
      const warningAlert = alerts.find(a => a.error_severity === 'WARNING');
      expect(errorAlert).toBeDefined();
      expect(warningAlert).toBeDefined();
    });

    it('should be case-insensitive when matching errors', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/alert9'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://test-results.example.com',
        metadata: { errors: ['Database Connection Error'] }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://logs.example.com',
        metadata: { deployment_sha: 'alert9' }
      });

      const errorLogs = [
        { source: 'datadog' as const, level: 'ERROR' as const, message: 'database connection error', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'alert9' }
      ];

      await logsStore.ingestLogs(errorLogs, 'alert9');

      const alerts = await detectUnseenErrors(golden_thread_id, linker, logsStore);

      expect(alerts).toHaveLength(0);
    });
  });

  describe('summarizeAlerts', () => {
    it('should count total alerts', () => {
      const alerts: ProductionAlert[] = [
        { id: '1', golden_thread_id: 'chain1', error_message: 'Error 1', error_severity: 'ERROR', found_in_stage_6: true, found_in_stage_3: false, first_occurrence: '2026-01-01T10:00:00Z', last_occurrence: '2026-01-01T10:10:00Z', occurrence_count: 5, recommendation: 'Test' },
        { id: '2', golden_thread_id: 'chain1', error_message: 'Error 2', error_severity: 'ERROR', found_in_stage_6: true, found_in_stage_3: false, first_occurrence: '2026-01-01T10:00:00Z', last_occurrence: '2026-01-01T10:10:00Z', occurrence_count: 3, recommendation: 'Test' }
      ];

      const summary = summarizeAlerts(alerts);

      expect(summary.total).toBe(2);
    });

    it('should count errors separately from warnings', () => {
      const alerts: ProductionAlert[] = [
        { id: '1', golden_thread_id: 'chain1', error_message: 'Error', error_severity: 'ERROR', found_in_stage_6: true, found_in_stage_3: false, first_occurrence: '2026-01-01T10:00:00Z', last_occurrence: '2026-01-01T10:10:00Z', occurrence_count: 1, recommendation: 'Test' },
        { id: '2', golden_thread_id: 'chain1', error_message: 'Warning', error_severity: 'WARNING', found_in_stage_6: true, found_in_stage_3: false, first_occurrence: '2026-01-01T10:00:00Z', last_occurrence: '2026-01-01T10:10:00Z', occurrence_count: 1, recommendation: 'Test' },
        { id: '3', golden_thread_id: 'chain1', error_message: 'Error 2', error_severity: 'ERROR', found_in_stage_6: true, found_in_stage_3: false, first_occurrence: '2026-01-01T10:00:00Z', last_occurrence: '2026-01-01T10:10:00Z', occurrence_count: 1, recommendation: 'Test' }
      ];

      const summary = summarizeAlerts(alerts);

      expect(summary.errors).toBe(2);
      expect(summary.warnings).toBe(1);
    });

    it('should calculate average occurrences per alert', () => {
      const alerts: ProductionAlert[] = [
        { id: '1', golden_thread_id: 'chain1', error_message: 'Error 1', error_severity: 'ERROR', found_in_stage_6: true, found_in_stage_3: false, first_occurrence: '2026-01-01T10:00:00Z', last_occurrence: '2026-01-01T10:10:00Z', occurrence_count: 10, recommendation: 'Test' },
        { id: '2', golden_thread_id: 'chain1', error_message: 'Error 2', error_severity: 'ERROR', found_in_stage_6: true, found_in_stage_3: false, first_occurrence: '2026-01-01T10:00:00Z', last_occurrence: '2026-01-01T10:10:00Z', occurrence_count: 20, recommendation: 'Test' }
      ];

      const summary = summarizeAlerts(alerts);

      expect(summary.avgOccurrencesPerAlert).toBe(15);
    });

    it('should return 0 average for empty array', () => {
      const summary = summarizeAlerts([]);

      expect(summary.total).toBe(0);
      expect(summary.avgOccurrencesPerAlert).toBe(0);
    });
  });
});
