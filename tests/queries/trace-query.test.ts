/**
 * Unit tests for TraceQueryEngine
 */
import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import { GoldenThreadStore, type Stage } from '../../src/core/golden-thread-store';
import { TraceQueryEngine } from '../../src/queries/trace-query';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

describe('TraceQueryEngine', () => {
  let store: GoldenThreadStore;
  let engine: TraceQueryEngine;
  const dbPath = join(tmpdir(), `test-golden-thread-${Date.now()}.db`);

  beforeAll(async () => {
    store = await GoldenThreadStore.open(dbPath);
    engine = new TraceQueryEngine(store);
  });

  afterEach(async () => {
    // Cleanup after each test
    try {
      await rm(dbPath, { force: true });
      store = await GoldenThreadStore.open(dbPath);
      engine = new TraceQueryEngine(store);
    } catch {
      // ignore
    }
  });

  describe('queryByIssueKey', () => {
    it('should find chains by issue key in metadata', async () => {
      // Create chain with issue key
      const threadId = await store.initiate('alice', 'https://spec.example.com', {
        issue_key: 'PROJ-123'
      });

      // Query by issue key
      const result = await engine.queryByIssueKey('PROJ-123');

      expect(result.chains).toHaveLength(1);
      expect(result.chains[0].golden_thread_id).toBe(threadId);
      expect(result.totalCount).toBe(1);
    });

    it('should return empty result for non-existent issue key', async () => {
      const result = await engine.queryByIssueKey('NONEXISTENT-999');

      expect(result.chains).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should find chains with issue key in any stage', async () => {
      const threadId = await store.initiate('alice', 'https://spec.example.com', {});

      // Add stage with issue key
      await store.linkStage(threadId, 2 as Stage, 'PASSED', 'bob', 'https://test.example.com', {
        issue_key: 'PROJ-456'
      });

      const result = await engine.queryByIssueKey('PROJ-456');

      expect(result.chains).toHaveLength(1);
      expect(result.chains[0].golden_thread_id).toBe(threadId);
    });
  });

  describe('queryByCommit', () => {
    it('should find chains by commit SHA in metadata', async () => {
      const threadId = await store.initiate('alice', 'https://spec.example.com', {
        commit: 'abc123def456'
      });

      const result = await engine.queryByCommit('abc123def456');

      expect(result.chains).toHaveLength(1);
      expect(result.chains[0].golden_thread_id).toBe(threadId);
    });

    it('should find chains by commit SHA in artifact URL', async () => {
      const threadId = await store.initiate('alice', 'https://github.com/repo/commit/abc123def456');

      const result = await engine.queryByCommit('abc123def456');

      expect(result.chains).toHaveLength(1);
      expect(result.chains[0].golden_thread_id).toBe(threadId);
    });

    it('should return empty result for non-existent commit', async () => {
      const result = await engine.queryByCommit('nonexistent000000');

      expect(result.chains).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('queryByTestId', () => {
    it('should find chains by test ID in metadata', async () => {
      const threadId = await store.initiate('alice', 'https://spec.example.com', {
        test_id: 'uuid-1234-5678'
      });

      const result = await engine.queryByTestId('uuid-1234-5678');

      expect(result.chains).toHaveLength(1);
      expect(result.chains[0].golden_thread_id).toBe(threadId);
    });

    it('should return empty result for non-existent test ID', async () => {
      const result = await engine.queryByTestId('nonexistent-uuid');

      expect(result.chains).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('queryByDateRange', () => {
    it('should find chains within date range', async () => {
      const threadId = await store.initiate('alice', 'https://spec.example.com');

      const from = new Date();
      from.setDate(from.getDate() - 1);
      const to = new Date();
      to.setDate(to.getDate() + 1);

      const result = await engine.queryByDateRange(
        from.toISOString().split('T')[0],
        to.toISOString().split('T')[0]
      );

      expect(result.chains.length).toBeGreaterThanOrEqual(1);
      expect(result.chains.some(c => c.golden_thread_id === threadId)).toBe(true);
    });

    it('should return empty for past date range', async () => {
      await store.initiate('alice', 'https://spec.example.com');

      const result = await engine.queryByDateRange('2000-01-01', '2000-12-31');

      expect(result.chains).toHaveLength(0);
    });

    it('should reject invalid date format', async () => {
      const result = await engine.queryByDateRange('invalid', 'dates');

      expect(result.chains).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('formatAsTable', () => {
    it('should format chain as readable table', async () => {
      const threadId = await store.initiate('alice', 'https://spec.example.com');

      const chain = await store.getChain(threadId);
      if (!chain) throw new Error('Chain not found');

      const table = engine.formatAsTable(chain);

      expect(table).toContain('Golden Thread');
      expect(table).toContain(threadId);
      expect(table).toContain('Spec');
      expect(table).toContain('PASSED');
    });
  });

  describe('validateSLA', () => {
    it('should pass for compliant chain', async () => {
      const threadId = await store.initiate('alice', 'https://spec.example.com');

      const chain = await store.getChain(threadId);
      if (!chain) throw new Error('Chain not found');

      const result = engine.validateSLA(chain, {
        maxStageDurationMs: 300000,
        maxTotalDurationMs: 1800000,
        deploymentStatus: 'YELLOW'
      });

      expect(result.valid).toBe(true);
      expect(result.breaches).toHaveLength(0);
    });

    it('should fail for stage duration breach', async () => {
      const threadId = await store.initiate('alice', 'https://spec.example.com');

      // Add a second stage to create duration between stages
      await store.linkStage(threadId, 2 as Stage, 'PASSED', 'bob', 'https://test.example.com');

      const chain = await store.getChain(threadId);
      if (!chain) throw new Error('Chain not found');

      const result = engine.validateSLA(chain, {
        maxStageDurationMs: 0, // 0ms threshold (impossible to meet)
        maxTotalDurationMs: 1800000,
        deploymentStatus: 'YELLOW'
      });

      expect(result.valid).toBe(false);
    });

    it('should flag RED deployment status', async () => {
      const threadId = await store.initiate('alice', 'https://spec.example.com');

      // Add stage with RED deployment status
      await store.linkStage(
        threadId,
        2 as Stage,
        'PASSED',
        'bob',
        'https://test.example.com',
        {},
        'RED'
      );

      const chain = await store.getChain(threadId);
      if (!chain) throw new Error('Chain not found');

      const result = engine.validateSLA(chain, {
        maxStageDurationMs: 300000,
        maxTotalDurationMs: 1800000,
        deploymentStatus: 'RED'
      });

      expect(result.breaches.some(b => b.includes('RED'))).toBe(true);
    });
  });

  describe('exportAsJson', () => {
    it('should export chain as structured JSON', async () => {
      const threadId = await store.initiate('alice', 'https://spec.example.com', {
        issue_key: 'TEST-001'
      });

      const chain = await store.getChain(threadId);
      if (!chain) throw new Error('Chain not found');

      const json = engine.exportAsJson(chain);

      expect(json.golden_thread_id).toBe(threadId);
      expect(json.created_at).toBeDefined();
      expect(Array.isArray(json.stages)).toBe(true);
      const stages = json.stages as Array<{ stage_name: string }>;
      expect(stages[0].stage_name).toBe('Spec');
    });

    it('should parse metadata in JSON export', async () => {
      const threadId = await store.initiate('alice', 'https://spec.example.com', {
        issue_key: 'TEST-001',
        custom_field: 'value'
      });

      const chain = await store.getChain(threadId);
      if (!chain) throw new Error('Chain not found');

      const json = engine.exportAsJson(chain);
      const stages = json.stages as Array<{ metadata: Record<string, unknown> }>;
      const metadata = stages[0].metadata;

      expect((metadata as Record<string, unknown>).issue_key).toBe('TEST-001');
      expect((metadata as Record<string, unknown>).custom_field).toBe('value');
    });
  });
});
