import { linkMonitorStage, type MonitorStageOptions } from '../../src/core/golden-thread-monitor.js';
import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { GoldenThreadStore } from '../../src/core/golden-thread-store.js';
import { ProductionLogsStore } from '../../src/core/production-logs-store.js';
import { type LogEntry } from '../../src/core/production-logs-model.js';
import { DatadogConnector } from '../../src/core/production-logs-datadog.js';
import { CloudWatchConnector } from '../../src/core/production-logs-cloudwatch.js';
import { ElasticsearchConnector } from '../../src/core/production-logs-elk.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

jest.mock('../../src/core/production-logs-datadog.js');
jest.mock('../../src/core/production-logs-cloudwatch.js');
jest.mock('../../src/core/production-logs-elk.js');

describe('Golden Thread Monitor Stage (Stage 6)', () => {
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

  describe('linkMonitorStage - Basic linking', () => {
    it('should link Monitor stage to chain', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'abc123',
        environment: 'production',
        service_name: 'api-service',
        golden_thread_linker: linker,
        logs_store: logsStore
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);

      expect(monitorStage).toBeDefined();
      expect(monitorStage!.status).toBe('PASSED');
      expect(monitorStage!.stage).toBe(6);
    });

    it('should set actor to monitor-connector', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/def456'
      });

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'def456',
        environment: 'staging',
        service_name: 'worker',
        golden_thread_linker: linker,
        logs_store: logsStore
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);

      expect(monitorStage!.actor).toBe('monitor-connector');
    });

    it('should include environment and service in metadata', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/ghi789'
      });

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'ghi789',
        environment: 'production',
        service_name: 'payment-api',
        golden_thread_linker: linker,
        logs_store: logsStore
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.environment).toBe('production');
      expect(metadata.service_name).toBe('payment-api');
      expect(metadata.stage_name).toBe('Monitor');
    });

    it('should include log counts in metadata', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/jkl000'
      });

      const logEntries: LogEntry[] = [
        { source: 'datadog' as const, level: 'ERROR', message: 'Error 1', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'jkl000' },
        { source: 'datadog' as const, level: 'ERROR', message: 'Error 2', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'jkl000' },
        { source: 'datadog' as const, level: 'WARNING', message: 'Warning 1', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'jkl000' }
      ];

      await logsStore.ingestLogs(logEntries as LogEntry[], 'jkl000');

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'jkl000',
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker,
        logs_store: logsStore
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.error_count).toBe(2);
      expect(metadata.warning_count).toBe(1);
      expect(metadata.log_count).toBe(3);
    });

    it('should generate artifact URL with environment and service', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'abc123',
        environment: 'production',
        service_name: 'api-service',
        golden_thread_linker: linker,
        logs_store: logsStore
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);

      expect(monitorStage!.artifact_url).toContain('abc123');
      expect(monitorStage!.artifact_url).toContain('env=production');
      expect(monitorStage!.artifact_url).toContain('service=api-service');
    });
  });

  describe('linkMonitorStage - Log source integration', () => {
    it('should include datadog in sources when configured', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/dd1'
      });

      (DatadogConnector as jest.MockedClass<typeof DatadogConnector>).mockImplementation(() => ({
        queryByDeploymentSha: jest.fn().mockResolvedValue([
          { source: 'datadog', level: 'ERROR', message: 'Error', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'dd1' }
        ])
      }) as unknown as DatadogConnector);

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'dd1',
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker,
        logs_store: logsStore,
        datadog: { apiKey: 'test-key' }
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.sources).toContain('datadog');
    });

    it('should include cloudwatch in sources when configured', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/cw1'
      });

      (CloudWatchConnector as jest.MockedClass<typeof CloudWatchConnector>).mockImplementation(() => ({
        queryLogs: jest.fn().mockResolvedValue([
          { source: 'cloudwatch', level: 'ERROR', message: 'Error', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'cw1' }
        ])
      }) as unknown as CloudWatchConnector);

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'cw1',
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker,
        logs_store: logsStore,
        cloudwatch: { region: 'us-east-1' }
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.sources).toContain('cloudwatch');
    });

    it('should include elk in sources when configured', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/elk1'
      });

      (ElasticsearchConnector as jest.MockedClass<typeof ElasticsearchConnector>).mockImplementation(() => ({
        queryLogs: jest.fn().mockResolvedValue([
          { source: 'elk', level: 'ERROR', message: 'Error', timestamp: new Date().toISOString(), tags: {}, deployment_sha: 'elk1' }
        ])
      }) as unknown as ElasticsearchConnector);

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'elk1',
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker,
        logs_store: logsStore,
        elasticsearch: { url: 'http://localhost:9200' }
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.sources).toContain('elk');
    });

    it('should support multiple sources simultaneously', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/multi1'
      });

      (DatadogConnector as jest.MockedClass<typeof DatadogConnector>).mockImplementation(() => ({
        queryByDeploymentSha: jest.fn().mockResolvedValue([])
      }) as unknown as DatadogConnector);

      (CloudWatchConnector as jest.MockedClass<typeof CloudWatchConnector>).mockImplementation(() => ({
        queryLogs: jest.fn().mockResolvedValue([])
      }) as unknown as CloudWatchConnector);

      (ElasticsearchConnector as jest.MockedClass<typeof ElasticsearchConnector>).mockImplementation(() => ({
        queryLogs: jest.fn().mockResolvedValue([])
      }) as unknown as ElasticsearchConnector);

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'multi1',
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker,
        logs_store: logsStore,
        datadog: { apiKey: 'key' },
        cloudwatch: { region: 'us-east-1' },
        elasticsearch: { url: 'http://localhost:9200' }
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.sources).toEqual(expect.arrayContaining(['datadog', 'cloudwatch', 'elk']));
    });
  });

  describe('linkMonitorStage - Metadata completeness', () => {
    it('should include deployment SHA in metadata', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/meta1'
      });

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'meta1sha',
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker,
        logs_store: logsStore
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.deployment_sha).toBe('meta1sha');
    });

    it('should include sample rate indicator', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/sample1'
      });

      const infoLogs = Array.from({ length: 50 }, (_, i) => ({
        source: 'datadog' as const,
        level: 'INFO' as const,
        message: `Info ${i}`,
        timestamp: new Date().toISOString(),
        tags: {},
        deployment_sha: 'sample1'
      }));

      await logsStore.ingestLogs(infoLogs, 'sample1');

      const opts: MonitorStageOptions = {
        golden_thread_id,
        deployment_sha: 'sample1',
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker,
        logs_store: logsStore
      };

      await linkMonitorStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata).toHaveProperty('sample_rate_applied');
    });
  });
});
