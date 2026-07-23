/**
 * Golden Thread validation tests — chain integrity, idempotency, data
 * consistency, error handling, structural edge cases, and a query performance
 * budget. Complements the connector-level unit suites with cross-cutting
 * guarantees the traceability framework must uphold.
 */
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { GoldenThreadStore, STAGE_NAMES, type Stage, type StageStatus } from '../../src/core/golden-thread-store.js';
import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { TraceQueryEngine } from '../../src/queries/trace-query.js';
import { buildPartialChain, FIXTURE_ISSUE_KEY } from './fixtures/golden-thread-fixtures.js';

jest.setTimeout(60000);

const VALID_STATUSES: readonly StageStatus[] = ['PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED'];
const VALID_DEPLOYMENT_STATUSES = ['GREEN', 'YELLOW', 'RED'];

const testDbDir = path.join(process.cwd(), '.test-golden-thread-validation');
let testDbPath: string;
let store: GoldenThreadStore;
let linker: GoldenThreadLinker;

beforeEach(async () => {
  await mkdir(testDbDir, { recursive: true });
  testDbPath = path.join(testDbDir, `test-${Date.now()}-${Math.round(performance.now())}.sqlite`);
  store = await GoldenThreadStore.open(testDbPath);
  linker = new GoldenThreadLinker(store);
});

afterEach(async () => {
  try {
    await rm(testDbDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors.
  }
});

/** Links stages 2..7 onto an existing chain. */
async function completeChain(goldenThreadId: string): Promise<void> {
  for (let stage = 2; stage <= 7; stage++) {
    await linker.linkStage({
      golden_thread_id: goldenThreadId,
      stage: stage as Stage,
      status: 'PASSED',
      actor: 'system',
      artifact_url: `https://prova.example.com/stage-${stage}`,
      metadata: { stage }
    });
  }
}

describe('Golden Thread — chain integrity', () => {
  it('links every non-root stage to its immediate predecessor', async () => {
    const id = await linker.initiateChain({ actor: 'jira-connector', artifact_url: 'https://spec' });
    await completeChain(id);

    const chain = await linker.getChain(id);
    const stages = chain?.stages ?? [];
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].parent_id).toBe(String(stages[i - 1].id));
    }
  });

  it('has exactly one root stage with a null parent (no orphans)', async () => {
    const id = await linker.initiateChain({ actor: 'jira-connector', artifact_url: 'https://spec' });
    await completeChain(id);

    const chain = await linker.getChain(id);
    const roots = (chain?.stages ?? []).filter(s => s.parent_id === null);
    expect(roots).toHaveLength(1);
    expect(roots[0].stage).toBe(1);
  });

  it('reports an integrity error when a middle stage is absent', async () => {
    const id = await buildPartialChain(linker, 3);
    // Skip stage 4, jump to what would be an orphaned stage is impossible via the
    // API, so the chain simply stays incomplete — validation must catch it.
    const result = await linker.validateChain(id);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Stage 4'))).toBe(true);
  });
});

describe('Golden Thread — idempotency', () => {
  it('rejects a duplicate stage link and does not duplicate the record', async () => {
    const id = await linker.initiateChain({ actor: 'jira-connector', artifact_url: 'https://spec' });
    await linker.linkStage({
      golden_thread_id: id,
      stage: 2,
      status: 'PASSED',
      actor: 'runner',
      artifact_url: 'https://test'
    });

    await expect(
      linker.linkStage({
        golden_thread_id: id,
        stage: 2,
        status: 'PASSED',
        actor: 'runner',
        artifact_url: 'https://test-again'
      })
    ).rejects.toThrow();

    const chain = await linker.getChain(id);
    const stageTwos = (chain?.stages ?? []).filter(s => s.stage === 2);
    expect(stageTwos).toHaveLength(1);
    expect(stageTwos[0].artifact_url).toBe('https://test');
  });

  it('re-initiating never reuses a golden_thread_id', async () => {
    const first = await linker.initiateChain({ actor: 'a', artifact_url: 'https://s1' });
    const second = await linker.initiateChain({ actor: 'a', artifact_url: 'https://s1' });
    expect(first).not.toBe(second);
  });
});

describe('Golden Thread — data consistency', () => {
  it('round-trips metadata as valid JSON', async () => {
    const metadata = { issue_key: FIXTURE_ISSUE_KEY, nested: { count: 3 }, flag: true };
    const id = await linker.initiateChain({ actor: 'jira-connector', artifact_url: 'https://spec', metadata });

    const chain = await linker.getChain(id);
    const parsed = JSON.parse(chain?.stages[0].metadata ?? '{}');
    expect(parsed).toEqual(metadata);
  });

  it('keeps every stage within the documented schema enums', async () => {
    const id = await linker.initiateChain({ actor: 'jira-connector', artifact_url: 'https://spec' });
    await completeChain(id);

    const chain = await linker.getChain(id);
    for (const stage of chain?.stages ?? []) {
      expect(stage.stage).toBeGreaterThanOrEqual(1);
      expect(stage.stage).toBeLessThanOrEqual(7);
      expect(VALID_STATUSES).toContain(stage.status);
      expect(Object.prototype.hasOwnProperty.call(STAGE_NAMES, stage.stage)).toBe(true);
      if (stage.deployment_status !== undefined && stage.deployment_status !== null) {
        expect(VALID_DEPLOYMENT_STATUSES).toContain(stage.deployment_status);
      }
      expect(() => JSON.parse(stage.metadata)).not.toThrow();
    }
  });
});

describe('Golden Thread — error cases', () => {
  it('detects a missing stage during validation', async () => {
    const id = await linker.initiateChain({ actor: 'a', artifact_url: 'https://spec' });
    const result = await linker.validateChain(id);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns null when getting a non-existent chain', async () => {
    expect(await linker.getChain('does-not-exist')).toBeNull();
  });

  it('reports not-found when validating a non-existent chain', async () => {
    const result = await linker.validateChain('does-not-exist');
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not found/i);
  });

  it('rejects linking to a non-existent chain', async () => {
    await expect(
      linker.linkStage({ golden_thread_id: 'nope', stage: 2, status: 'PASSED', actor: 'a', artifact_url: 'https://x' })
    ).rejects.toThrow();
  });

  it('rejects out-of-range stage numbers', async () => {
    const id = await linker.initiateChain({ actor: 'a', artifact_url: 'https://spec' });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linker.linkStage({ golden_thread_id: id, stage: 8 as any, status: 'PASSED', actor: 'a', artifact_url: 'https://x' })
    ).rejects.toThrow();
  });

  it('handles a query with no matches gracefully instead of throwing', async () => {
    const engine = new TraceQueryEngine(store);
    const result = await engine.queryByIssueKey('UNKNOWN-999');
    expect(result.totalCount).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('Golden Thread — structural edge cases', () => {
  it('generates unique trace IDs across many initiations (no duplicates)', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(await linker.initiateChain({ actor: 'a', artifact_url: `https://spec-${i}` }));
    }
    expect(ids.size).toBe(50);
  });

  it('never produces a stage whose parent is itself (no self-reference)', async () => {
    const id = await linker.initiateChain({ actor: 'a', artifact_url: 'https://spec' });
    await completeChain(id);

    const chain = await linker.getChain(id);
    for (const stage of chain?.stages ?? []) {
      expect(stage.parent_id).not.toBe(String(stage.id));
    }
  });

  it('produces an acyclic parent chain that terminates at the root', async () => {
    const id = await linker.initiateChain({ actor: 'a', artifact_url: 'https://spec' });
    await completeChain(id);

    const chain = await linker.getChain(id);
    const byId = new Map((chain?.stages ?? []).map(s => [String(s.id), s]));
    for (const stage of chain?.stages ?? []) {
      const visited = new Set<string>();
      let cursor: string | null = stage.parent_id;
      while (cursor !== null) {
        expect(visited.has(cursor)).toBe(false); // no cycle
        visited.add(cursor);
        cursor = byId.get(cursor)?.parent_id ?? null;
      }
    }
  });
});

describe('Golden Thread — performance', () => {
  it('queries across 100 chains in under 500ms', async () => {
    for (let i = 0; i < 100; i++) {
      await linker.initiateChain({
        actor: 'jira-connector',
        artifact_url: `https://jira.example.com/browse/PERF-${i}`,
        metadata: { issue_key: `PERF-${i}` }
      });
    }

    const engine = new TraceQueryEngine(store);
    const start = performance.now();
    const result = await engine.queryByIssueKey('PERF-99');
    const elapsed = performance.now() - start;

    expect(result.totalCount).toBe(1);
    expect(elapsed).toBeLessThan(500);
  });
});
