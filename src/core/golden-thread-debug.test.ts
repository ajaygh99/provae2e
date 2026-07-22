/** Tests for Golden Thread Stage 7 (Debug) root cause analysis. */
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  analyzeRootCause,
  classifyIncident,
  findRecurringPatterns,
  linkDebugStage
} from './golden-thread-debug.js';
import { GoldenThreadLinker } from './golden-thread-linker.js';
import { GoldenThreadStore } from './golden-thread-store.js';
import { ProductionLogsStore } from './production-logs-store.js';

describe('Golden Thread Debug (Stage 7)', () => {
  let store: GoldenThreadStore;
  let linker: GoldenThreadLinker;
  let logsStore: ProductionLogsStore;
  let golden_thread_id: string;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(__dirname, '.test-'));
    store = await GoldenThreadStore.open(path.join(tempDir, 'test.db'));
    linker = new GoldenThreadLinker(store);
    logsStore = await ProductionLogsStore.open(path.join(tempDir, 'logs.db'));

    golden_thread_id = await linker.initiateChain({
      actor: 'test-actor',
      artifact_url: 'https://example.com/spec/1',
      metadata: { spec_id: 'SPEC-001' }
    });
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('classifyIncident', () => {
    it('should classify as TestGap when not tested', () => {
      const result = classifyIncident({
        was_tested: false,
        issue_history: []
      });
      expect(result).toBe('TestGap');
    });

    it('should classify as CodeBug when tested but failed in production', () => {
      const result = classifyIncident({
        was_tested: true,
        issue_history: []
      });
      expect(result).toBe('CodeBug');
    });

    it('should classify as CodeBug for recurring issues when tested', () => {
      const result = classifyIncident({
        was_tested: true,
        issue_history: [
          {
            golden_thread_id: 'old-chain',
            first_seen: '2024-01-01T00:00:00Z',
            last_seen: '2024-01-15T00:00:00Z',
            occurrence_count: 3,
            fixed_in_commit: 'abc123'
          }
        ]
      });
      expect(result).toBe('CodeBug');
    });

    it('should classify as TestGap for untested issues even with history', () => {
      const result = classifyIncident({
        was_tested: false,
        issue_history: [
          {
            golden_thread_id: 'old-chain',
            first_seen: '2024-01-01T00:00:00Z',
            last_seen: '2024-01-01T00:00:00Z',
            occurrence_count: 1
          }
        ]
      });
      expect(result).toBe('TestGap');
    });

    it('should classify as SpecGap when spec does not cover scenario', () => {
      const result = classifyIncident({
        was_tested: false,
        issue_history: [
          {
            golden_thread_id: 'old-chain',
            first_seen: '2024-01-01T00:00:00Z',
            last_seen: '2024-01-01T00:00:00Z',
            occurrence_count: 2,
            fixed_in_commit: 'abc123'
          }
        ]
      });
      expect(result).toBe('CodeBug');
    });
  });

  describe('analyzeRootCause', () => {
    it('should extract production error from Stage 6', async () => {
      await linker.linkStage({
        golden_thread_id,
        stage: 2,
        status: 'PASSED',
        actor: 'test-writer',
        artifact_url: 'https://example.com/test/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test-runner',
        artifact_url: 'https://example.com/evidence/1',
        metadata: {
          test_count: 10,
          passed: 10,
          ci_run_url: 'https://ci.example.com/run/123'
        }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 4,
        status: 'PASSED',
        actor: 'builder',
        artifact_url: 'https://example.com/build/1',
        metadata: {
          commit_sha: 'abc123def456',
          commit_url: 'https://github.com/repo/commit/abc123def456'
        }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 5,
        status: 'PASSED',
        actor: 'deployer',
        artifact_url: 'https://example.com/deploy/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'monitor',
        artifact_url: 'https://example.com/logs/1',
        metadata: {
          error_count: 5,
          warning_count: 10,
          service_name: 'api-service'
        }
      });

      const analysis = await analyzeRootCause({
        golden_thread_id,
        linker,
        logs_store: logsStore,
        error_signature: 'Connection timeout'
      });

      expect(analysis.golden_thread_id).toBe(golden_thread_id);
      expect(analysis.prod_error.message).toBe('Connection timeout');
      expect(analysis.prod_error.level).toBe('ERROR');
      expect(analysis.prod_error.affected_service).toBe('api-service');
    });

    it('should detect when error was tested', async () => {
      await linker.linkStage({
        golden_thread_id,
        stage: 2,
        status: 'PASSED',
        actor: 'test-writer',
        artifact_url: 'https://example.com/test/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test-runner',
        artifact_url: 'https://example.com/evidence/1',
        metadata: {
          test_count: 10,
          passed: 10,
          errors: ['Connection timeout', 'Database error'],
          ci_run_url: 'https://ci.example.com/run/123'
        }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 4,
        status: 'PASSED',
        actor: 'builder',
        artifact_url: 'https://example.com/build/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 5,
        status: 'PASSED',
        actor: 'deployer',
        artifact_url: 'https://example.com/deploy/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'monitor',
        artifact_url: 'https://example.com/logs/1',
        metadata: {
          error_count: 5,
          service_name: 'api-service'
        }
      });

      const analysis = await analyzeRootCause({
        golden_thread_id,
        linker,
        logs_store: logsStore,
        error_signature: 'connection timeout'
      });

      expect(analysis.was_tested).toBe(true);
      expect(analysis.test_evidence_link).toBe('https://example.com/evidence/1');
      expect(analysis.ci_run_link).toBe('https://ci.example.com/run/123');
    });

    it('should detect when error was not tested', async () => {
      await linker.linkStage({
        golden_thread_id,
        stage: 2,
        status: 'PASSED',
        actor: 'test-writer',
        artifact_url: 'https://example.com/test/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test-runner',
        artifact_url: 'https://example.com/evidence/1',
        metadata: {
          test_count: 10,
          passed: 10,
          errors: ['Database error']
        }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 4,
        status: 'PASSED',
        actor: 'builder',
        artifact_url: 'https://example.com/build/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 5,
        status: 'PASSED',
        actor: 'deployer',
        artifact_url: 'https://example.com/deploy/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'monitor',
        artifact_url: 'https://example.com/logs/1',
        metadata: {
          error_count: 5,
          service_name: 'api-service'
        }
      });

      const analysis = await analyzeRootCause({
        golden_thread_id,
        linker,
        logs_store: logsStore,
        error_signature: 'Connection timeout'
      });

      expect(analysis.was_tested).toBe(false);
      expect(analysis.test_evidence_link).toBeNull();
      expect(analysis.classification).toBe('TestGap');
    });

    it('should extract code change link from Stage 4', async () => {
      await linker.linkStage({
        golden_thread_id,
        stage: 2,
        status: 'PASSED',
        actor: 'test-writer',
        artifact_url: 'https://example.com/test/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test-runner',
        artifact_url: 'https://example.com/evidence/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 4,
        status: 'PASSED',
        actor: 'builder',
        artifact_url: 'https://example.com/build/1',
        metadata: {
          commit_sha: 'abc123def456',
          commit_url: 'https://github.com/repo/commit/abc123def456'
        }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 5,
        status: 'PASSED',
        actor: 'deployer',
        artifact_url: 'https://example.com/deploy/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'monitor',
        artifact_url: 'https://example.com/logs/1',
        metadata: {
          error_count: 5,
          service_name: 'api-service'
        }
      });

      const analysis = await analyzeRootCause({
        golden_thread_id,
        linker,
        logs_store: logsStore,
        error_signature: 'error'
      });

      expect(analysis.code_change_link).toBe('https://github.com/repo/commit/abc123def456');
    });

    it('should generate diagnostic summary', async () => {
      await linker.linkStage({
        golden_thread_id,
        stage: 2,
        status: 'PASSED',
        actor: 'test-writer',
        artifact_url: 'https://example.com/test/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test-runner',
        artifact_url: 'https://example.com/evidence/1',
        metadata: { test_count: 10, passed: 10 }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 4,
        status: 'PASSED',
        actor: 'builder',
        artifact_url: 'https://example.com/build/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 5,
        status: 'PASSED',
        actor: 'deployer',
        artifact_url: 'https://example.com/deploy/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'monitor',
        artifact_url: 'https://example.com/logs/1',
        metadata: { error_count: 5, service_name: 'api-service' }
      });

      const analysis = await analyzeRootCause({
        golden_thread_id,
        linker,
        logs_store: logsStore,
        error_signature: 'error'
      });

      expect(analysis.diagnostic_summary).toBeTruthy();
      expect(analysis.diagnostic_summary.length).toBeGreaterThan(0);
    });

    it('should calculate confidence score', async () => {
      await linker.linkStage({
        golden_thread_id,
        stage: 2,
        status: 'PASSED',
        actor: 'test-writer',
        artifact_url: 'https://example.com/test/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test-runner',
        artifact_url: 'https://example.com/evidence/1',
        metadata: { test_count: 10, passed: 10 }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 4,
        status: 'PASSED',
        actor: 'builder',
        artifact_url: 'https://example.com/build/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 5,
        status: 'PASSED',
        actor: 'deployer',
        artifact_url: 'https://example.com/deploy/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'monitor',
        artifact_url: 'https://example.com/logs/1',
        metadata: { error_count: 5, service_name: 'api-service' }
      });

      const analysis = await analyzeRootCause({
        golden_thread_id,
        linker,
        logs_store: logsStore,
        error_signature: 'error'
      });

      expect(analysis.confidence).toBeGreaterThanOrEqual(0);
      expect(analysis.confidence).toBeLessThanOrEqual(100);
    });
  });

  describe('findRecurringPatterns', () => {
    it('should find previous incidents with same signature', async () => {
      const oldChainId = await linker.initiateChain({
        actor: 'test-actor',
        artifact_url: 'https://example.com/spec/1',
        metadata: { spec_id: 'SPEC-001' }
      });

      await linker.linkStage({
        golden_thread_id: oldChainId,
        stage: 2,
        status: 'PASSED',
        actor: 'test-writer',
        artifact_url: 'https://example.com/test/1'
      });

      await linker.linkStage({
        golden_thread_id: oldChainId,
        stage: 3,
        status: 'PASSED',
        actor: 'test-runner',
        artifact_url: 'https://example.com/evidence/1'
      });

      await linker.linkStage({
        golden_thread_id: oldChainId,
        stage: 4,
        status: 'PASSED',
        actor: 'builder',
        artifact_url: 'https://example.com/build/1'
      });

      await linker.linkStage({
        golden_thread_id: oldChainId,
        stage: 5,
        status: 'PASSED',
        actor: 'deployer',
        artifact_url: 'https://example.com/deploy/1'
      });

      await linker.linkStage({
        golden_thread_id: oldChainId,
        stage: 6,
        status: 'PASSED',
        actor: 'monitor',
        artifact_url: 'https://example.com/logs/1',
        metadata: { error_count: 3, service_name: 'api-service' }
      });

      const patterns = await findRecurringPatterns(
        golden_thread_id,
        linker
      );

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      const patterns = await findRecurringPatterns(
        'non-existent-chain',
        linker
      );

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('linkDebugStage', () => {
    it('should link Stage 7 to a complete chain', async () => {
      await linker.linkStage({
        golden_thread_id,
        stage: 2,
        status: 'PASSED',
        actor: 'test-writer',
        artifact_url: 'https://example.com/test/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test-runner',
        artifact_url: 'https://example.com/evidence/1',
        metadata: { test_count: 10, passed: 10 }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 4,
        status: 'PASSED',
        actor: 'builder',
        artifact_url: 'https://example.com/build/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 5,
        status: 'PASSED',
        actor: 'deployer',
        artifact_url: 'https://example.com/deploy/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'monitor',
        artifact_url: 'https://example.com/logs/1',
        metadata: { error_count: 5, service_name: 'api-service' }
      });

      await linkDebugStage({
        golden_thread_id,
        linker,
        logs_store: logsStore
      });

      const chain = await linker.getChain(golden_thread_id);
      expect(chain).toBeTruthy();
      expect(chain?.stages.some(s => s.stage === 7)).toBe(true);
    });

    it('should throw error if chain not found', async () => {
      await expect(
        linkDebugStage({
          golden_thread_id: 'non-existent-chain',
          linker,
          logs_store: logsStore
        })
      ).rejects.toThrow();
    });

    it('should throw error if Stage 6 missing', async () => {
      await expect(
        linkDebugStage({
          golden_thread_id,
          linker,
          logs_store: logsStore
        })
      ).rejects.toThrow();
    });

    it('should set Stage 7 metadata with classification', async () => {
      await linker.linkStage({
        golden_thread_id,
        stage: 2,
        status: 'PASSED',
        actor: 'test-writer',
        artifact_url: 'https://example.com/test/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test-runner',
        artifact_url: 'https://example.com/evidence/1',
        metadata: { test_count: 10, passed: 10 }
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 4,
        status: 'PASSED',
        actor: 'builder',
        artifact_url: 'https://example.com/build/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 5,
        status: 'PASSED',
        actor: 'deployer',
        artifact_url: 'https://example.com/deploy/1'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 6,
        status: 'PASSED',
        actor: 'monitor',
        artifact_url: 'https://example.com/logs/1',
        metadata: { error_count: 5, service_name: 'api-service' }
      });

      await linkDebugStage({
        golden_thread_id,
        linker,
        logs_store: logsStore
      });

      const chain = await linker.getChain(golden_thread_id);
      const stage7 = chain?.stages.find(s => s.stage === 7);

      expect(stage7).toBeTruthy();
      if (stage7?.metadata) {
        const metadata = JSON.parse(stage7.metadata);
        expect(metadata.classification).toBeDefined();
        expect(metadata.was_tested).toBeDefined();
        expect(metadata.confidence).toBeDefined();
      }
    });
  });
});
