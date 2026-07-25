import { GoldenThreadStore, STAGE_NAMES } from '../../src/core/golden-thread-store.js';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

jest.setTimeout(60000);

const testDbDir = path.join(process.cwd(), '.test-golden-thread');
let testDbPath: string;

beforeEach(async () => {
  await mkdir(testDbDir, { recursive: true });
  testDbPath = path.join(testDbDir, `test-${Date.now()}.sqlite`);
});

afterEach(async () => {
  try {
    await rm(testDbDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('GoldenThreadStore', () => {
  it('open creates new database', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    expect(store).toBeDefined();
  });

  it('open loads existing database', async () => {
    const store1 = await GoldenThreadStore.open(testDbPath);
    const threadId = await store1.initiate('test-user', 'http://example.com/spec');

    const store2 = await GoldenThreadStore.open(testDbPath);
    const chain = await store2.getChain(threadId);
    expect(chain?.golden_thread_id).toBe(threadId);
  });

  it('initiate creates Spec stage with UUID', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    const threadId = await store.initiate('jira-connector', 'https://jira.example.com/browse/PROJ-123', {
      issue_key: 'PROJ-123'
    });

    expect(threadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const chain = await store.getChain(threadId);
    expect(chain?.stages).toHaveLength(1);
    expect(chain?.stages[0].stage).toBe(1);
    expect(chain?.stages[0].status).toBe('PASSED');
    expect(chain?.stages[0].actor).toBe('jira-connector');
  });

  it('linkStage adds stage with correct parent_id', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    const threadId = await store.initiate('user', 'http://spec-url');

    await store.linkStage(threadId, 2, 'PASSED', 'test-runner', 'http://test-url');

    const chain = await store.getChain(threadId);
    const stage2 = chain?.stages.find(s => s.stage === 2);
    expect(stage2?.status).toBe('PASSED');
    expect(stage2?.parent_id).toBe(String(chain?.stages[0].id));
  });

  it('linkStage rejects invalid stage numbers', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    const threadId = await store.initiate('user', 'http://spec-url');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(store.linkStage(threadId, 0 as any, 'PASSED', 'actor', 'url')).rejects.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(store.linkStage(threadId, 8 as any, 'PASSED', 'actor', 'url')).rejects.toThrow();
  });

  it('linkStage rejects non-existent chain', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    await expect(store.linkStage('non-existent-id', 2, 'PASSED', 'actor', 'url')).rejects.toThrow();
  });

  it('getChain returns null for missing chain', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    const chain = await store.getChain('non-existent-id');
    expect(chain).toBeNull();
  });

  it('validateChain detects missing stages', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    const threadId = await store.initiate('user', 'http://spec-url');

    const result = await store.validateChain(threadId);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validateChain passes for complete 7-stage chain', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    const threadId = await store.initiate('user', 'http://spec-url');

    for (let i = 2; i <= 7; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await store.linkStage(threadId, i as any, 'PASSED', 'user', `http://stage-${i}-url`);
    }

    const result = await store.validateChain(threadId);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('listChains returns all chain IDs', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    const id1 = await store.initiate('user', 'http://spec-1');
    const id2 = await store.initiate('user', 'http://spec-2');

    const chains = await store.listChains();
    expect(chains).toContain(id1);
    expect(chains).toContain(id2);
    expect(chains.length).toBeGreaterThanOrEqual(2);
  });

  it('stage metadata is stored and retrieved as JSON', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    const metadata = { custom_field: 'value', count: 42 };
    const threadId = await store.initiate('user', 'http://spec-url', metadata);

    const chain = await store.getChain(threadId);
    const stage = chain?.stages[0];
    expect(stage?.metadata).toBe(JSON.stringify(metadata));
  });

  it('STAGE_NAMES contains all 7 stages', () => {
    expect(Object.keys(STAGE_NAMES)).toHaveLength(7);
    expect(STAGE_NAMES[1]).toBe('Spec');
    expect(STAGE_NAMES[7]).toBe('Debug');
  });

  it('chain preserves timestamp order', async () => {
    const store = await GoldenThreadStore.open(testDbPath);
    const threadId = await store.initiate('user', 'http://spec-url');

    for (let i = 2; i <= 7; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await store.linkStage(threadId, i as any, 'PASSED', 'user', `http://stage-${i}`);
    }

    const chain = await store.getChain(threadId);
    const timestamps = chain?.stages.map(s => new Date(s.timestamp).getTime()) || [];

    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });
});
