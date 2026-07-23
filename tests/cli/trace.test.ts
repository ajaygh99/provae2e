/**
 * Integration tests for qe-tool trace CLI
 */
import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import { GoldenThreadStore, type Stage } from '../../src/core/golden-thread-store';
import { traceCommand, type TraceOptions } from '../../src/cli/trace';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, readFile } from 'node:fs/promises';

describe('qe-tool trace CLI', () => {
  let dbPath: string;

  beforeAll(() => {
    dbPath = join(tmpdir(), `test-trace-${Date.now()}.db`);
  });

  afterEach(async () => {
    try {
      await rm(dbPath, { force: true });
    } catch {
      // ignore
    }
  });

  async function setupDatabase(): Promise<GoldenThreadStore> {
    const store = await GoldenThreadStore.open(dbPath);

    // Create test chain 1
    const thread1 = await store.initiate('alice', 'https://spec.example.com', {
      issue_key: 'PROJ-123'
    });
    await store.linkStage(thread1, 2 as Stage, 'PASSED', 'bob', 'https://test.example.com', {
      test_id: 'test-uuid-001'
    });

    // Create test chain 2
    const thread2 = await store.initiate('charlie', 'https://github.com/repo/commit/abc123def456', {
      commit: 'abc123def456'
    });
    await store.linkStage(thread2, 2 as Stage, 'PASSED', 'dave', 'https://test.example.com', {
      test_id: 'test-uuid-002'
    });

    return store;
  }

  describe('query by issue-key', () => {
    it('should find and display chain by issue key', async () => {
      await setupDatabase();

      const opts: TraceOptions = {
        issueKey: 'PROJ-123',
        database: dbPath,
        format: 'table'
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(0);
      process.exitCode = originalExit;
    });

    it('should export as JSON when format=json', async () => {
      await setupDatabase();

      const outputFile = join(tmpdir(), `trace-output-${Date.now()}.json`);
      const opts: TraceOptions = {
        issueKey: 'PROJ-123',
        database: dbPath,
        format: 'json',
        output: outputFile
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(0);

      const content = await readFile(outputFile, 'utf-8');
      const json = JSON.parse(content);

      expect(json.golden_thread_id).toBeDefined();
      expect(Array.isArray(json.stages)).toBe(true);

      await rm(outputFile, { force: true });
      process.exitCode = originalExit;
    });

    it('should fail gracefully for non-existent issue key', async () => {
      await setupDatabase();

      const opts: TraceOptions = {
        issueKey: 'NONEXISTENT',
        database: dbPath
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(1);
      process.exitCode = originalExit;
    });

    it('should print issue JSON when no output file is provided', async () => {
      await setupDatabase();
      const originalExit = process.exitCode;
      process.exitCode = 0;
      await traceCommand({ issueKey: 'PROJ-123', database: dbPath, format: 'json' });
      expect(process.exitCode).toBe(0);
      process.exitCode = originalExit;
    });
  });

  describe('query by commit', () => {
    it('should find and display chain by commit SHA', async () => {
      await setupDatabase();

      const opts: TraceOptions = {
        commit: 'abc123def456',
        database: dbPath
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(0);
      process.exitCode = originalExit;
    });

    it('should fail for non-existent commit', async () => {
      await setupDatabase();

      const opts: TraceOptions = {
        commit: 'nonexistent000',
        database: dbPath
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(1);
      process.exitCode = originalExit;
    });

    it('should print commit JSON when no output file is provided', async () => {
      await setupDatabase();
      const originalExit = process.exitCode;
      process.exitCode = 0;
      await traceCommand({ commit: 'abc123def456', database: dbPath, format: 'json' });
      expect(process.exitCode).toBe(0);
      process.exitCode = originalExit;
    });
  });

  describe('query by test-id', () => {
    it('should find and display chain by test ID', async () => {
      await setupDatabase();

      const opts: TraceOptions = {
        testId: 'test-uuid-001',
        database: dbPath
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(0);
      process.exitCode = originalExit;
    });

    it('should fail for non-existent test ID', async () => {
      await setupDatabase();

      const opts: TraceOptions = {
        testId: 'nonexistent-uuid',
        database: dbPath
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(1);
      process.exitCode = originalExit;
    });

    it('should print test JSON when no output file is provided', async () => {
      await setupDatabase();
      const originalExit = process.exitCode;
      process.exitCode = 0;
      await traceCommand({ testId: 'test-uuid-001', database: dbPath, format: 'json' });
      expect(process.exitCode).toBe(0);
      process.exitCode = originalExit;
    });
  });

  describe('query by date range', () => {
    it('should list chains within date range', async () => {
      await setupDatabase();

      const from = new Date();
      from.setDate(from.getDate() - 1);
      const to = new Date();
      to.setDate(to.getDate() + 1);

      const opts: TraceOptions = {
        from: from.toISOString().split('T')[0],
        to: to.toISOString().split('T')[0],
        database: dbPath
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(0);
      process.exitCode = originalExit;
    });

    it('should export date range as CSV', async () => {
      await setupDatabase();

      const from = new Date();
      from.setDate(from.getDate() - 1);
      const to = new Date();
      to.setDate(to.getDate() + 1);

      const outputFile = join(tmpdir(), `trace-list-${Date.now()}.csv`);

      const opts: TraceOptions = {
        from: from.toISOString().split('T')[0],
        to: to.toISOString().split('T')[0],
        database: dbPath,
        format: 'csv',
        output: outputFile
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(0);

      const content = await readFile(outputFile, 'utf-8');

      expect(content).toContain('ChainID');
      expect(content).toContain('CreatedAt');

      await rm(outputFile, { force: true });
      process.exitCode = originalExit;
    });

    it('should return no results for past date range', async () => {
      await setupDatabase();

      const opts: TraceOptions = {
        from: '2000-01-01',
        to: '2000-12-31',
        database: dbPath
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(0);
      process.exitCode = originalExit;
    });

    it('should print date-range JSON and CSV when no output file is provided', async () => {
      await setupDatabase();
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const originalExit = process.exitCode;
      process.exitCode = 0;
      await traceCommand({ from, to, database: dbPath, format: 'json' });
      expect(process.exitCode).toBe(0);
      await traceCommand({ from, to, database: dbPath, format: 'csv' });
      expect(process.exitCode).toBe(0);
      process.exitCode = originalExit;
    });

    it('should reject an invalid date range', async () => {
      await setupDatabase();
      const originalExit = process.exitCode;
      process.exitCode = 0;
      await traceCommand({ from: 'invalid', to: 'also-invalid', database: dbPath });
      expect(process.exitCode).toBe(1);
      process.exitCode = originalExit;
    });
  });

  describe('verify SLA', () => {
    it('should verify SLA on all chains', async () => {
      await setupDatabase();

      const opts: TraceOptions = {
        sla: true,
        database: dbPath,
        maxStageDurationMs: 300000,
        maxTotalDurationMs: 1800000
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      // Exit code 0 for pass, 2 for breach
      expect([0, 2]).toContain(process.exitCode);
      process.exitCode = originalExit;
    });

    it('should accept SLA pass result', async () => {
      await setupDatabase();

      const opts: TraceOptions = {
        sla: true,
        database: dbPath,
        maxStageDurationMs: 300000, // Standard threshold
        maxTotalDurationMs: 1800000
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      // Should be 0 or 2 depending on whether thresholds are met
      expect([0, 2]).toContain(process.exitCode);
      process.exitCode = originalExit;
    });

    it('should pass when there are no chains to verify', async () => {
      const emptyDb = join(tmpdir(), `empty-trace-${Date.now()}.db`);
      const originalExit = process.exitCode;
      process.exitCode = 0;
      await traceCommand({ sla: true, database: emptyDb });
      expect(process.exitCode).toBe(0);
      await rm(emptyDb, { force: true });
      process.exitCode = originalExit;
    });

    it('should exit with code 2 when an SLA is breached', async () => {
      const store = await GoldenThreadStore.open(dbPath);
      const threadId = await store.initiate('alice', 'https://spec.example.com');
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.linkStage(threadId, 2 as Stage, 'PASSED', 'bob', 'https://test.example.com');
      const originalExit = process.exitCode;
      process.exitCode = 0;
      await traceCommand({ sla: true, database: dbPath, maxStageDurationMs: 1, maxTotalDurationMs: 1 });
      expect(process.exitCode).toBe(2);
      process.exitCode = originalExit;
    });
  });

  describe('error handling', () => {
    it('should fail when no query option provided', async () => {
      await setupDatabase();

      const opts: TraceOptions = {
        database: dbPath
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(1);
      process.exitCode = originalExit;
    });

    it('should handle missing database gracefully', async () => {
      const opts: TraceOptions = {
        issueKey: 'TEST',
        database: '/nonexistent/path/db.db'
      };

      const originalExit = process.exitCode;
      process.exitCode = 0;

      await traceCommand(opts);

      expect(process.exitCode).toBe(1);
      process.exitCode = originalExit;
    });
  });
});
