import { linkDatadogStage, type DatadogStageOptions } from '../../src/core/golden-thread-datadog.js';
import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { GoldenThreadStore } from '../../src/core/golden-thread-store.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

describe('Golden Thread Datadog Integration', () => {
  let dbPath: string;
  let store: GoldenThreadStore;
  let linker: GoldenThreadLinker;

  beforeEach(async () => {
    const tmpDir = tmpdir();
    await mkdir(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, `test-datadog-${Date.now()}.sqlite`);
    store = await GoldenThreadStore.open(dbPath);
    linker = new GoldenThreadLinker(store);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('linkDatadogStage - Monitor Stage (6)', () => {
    it('should link Datadog logs for Monitor stage', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 6,
        environment: 'production',
        service_name: 'api-service',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);

      expect(monitorStage).toBeDefined();
      expect(monitorStage!.status).toBe('PASSED');
      expect(monitorStage!.artifact_url).toContain('app.datadoghq.com');
      expect(monitorStage!.artifact_url).toContain('service:api-service');
      expect(monitorStage!.artifact_url).toContain('env:production');
    });

    it('should set actor to datadog-connector', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 6,
        environment: 'staging',
        service_name: 'worker-service',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);

      expect(monitorStage!.actor).toBe('datadog-connector');
    });

    it('should include stage name in metadata', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 6,
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.stage_name).toBe('Monitor');
    });

    it('should include environment in metadata', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 6,
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.environment).toBe('production');
    });

    it('should include service name in metadata', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 6,
        environment: 'production',
        service_name: 'payment-service',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.service_name).toBe('payment-service');
    });

    it('should include phase 4 note in metadata', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 6,
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const metadata = JSON.parse(monitorStage!.metadata);

      expect(metadata.note).toContain('Phase 4');
    });

    it('should generate correct Datadog logs query URL', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 6,
        environment: 'production',
        service_name: 'api-service',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);

      expect(monitorStage!.artifact_url).toBe(
        'https://app.datadoghq.com/logs?query=service:api-service%20env:production'
      );
    });
  });

  describe('linkDatadogStage - Debug Stage (7)', () => {
    it('should link Datadog logs for Debug stage', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 7,
        environment: 'staging',
        service_name: 'debug-service',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const debugStage = chain!.stages.find(s => s.stage === 7);

      expect(debugStage).toBeDefined();
      expect(debugStage!.status).toBe('PASSED');
    });

    it('should set stage name to Debug for stage 7', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 7,
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const debugStage = chain!.stages.find(s => s.stage === 7);
      const metadata = JSON.parse(debugStage!.metadata);

      expect(metadata.stage_name).toBe('Debug');
    });

    it('should create artifact URL with correct format for debug stage', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 7,
        environment: 'development',
        service_name: 'test-service',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const debugStage = chain!.stages.find(s => s.stage === 7);

      expect(debugStage!.artifact_url).toContain('app.datadoghq.com');
      expect(debugStage!.artifact_url).toContain('service:test-service');
      expect(debugStage!.artifact_url).toContain('env:development');
    });
  });

  describe('linkDatadogStage - Multiple stages', () => {
    it('should link both Monitor and Debug stages', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      await linkDatadogStage({
        golden_thread_id,
        stage: 6,
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker
      });

      await linkDatadogStage({
        golden_thread_id,
        stage: 7,
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker
      });

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);
      const debugStage = chain!.stages.find(s => s.stage === 7);

      expect(monitorStage).toBeDefined();
      expect(debugStage).toBeDefined();
    });
  });

  describe('linkDatadogStage - Service name handling', () => {
    it('should handle service names with hyphens', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 6,
        environment: 'production',
        service_name: 'api-gateway-service',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);

      expect(monitorStage!.artifact_url).toContain('service:api-gateway-service');
    });

    it('should handle environment names with underscores', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 6,
        environment: 'pre_production',
        service_name: 'api',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const monitorStage = chain!.stages.find(s => s.stage === 6);

      expect(monitorStage!.artifact_url).toContain('pre_production');
    });
  });

  describe('linkDatadogStage - Status and actor validation', () => {
    it('should always set status to PASSED', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 6,
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const stage = chain!.stages.find(s => s.stage === 6);

      expect(stage!.status).toBe('PASSED');
    });

    it('should always set actor to datadog-connector', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const opts: DatadogStageOptions = {
        golden_thread_id,
        stage: 7,
        environment: 'production',
        service_name: 'api',
        golden_thread_linker: linker
      };

      await linkDatadogStage(opts);

      const chain = await linker.getChain(golden_thread_id);
      const stage = chain!.stages.find(s => s.stage === 7);

      expect(stage!.actor).toBe('datadog-connector');
    });
  });
});
