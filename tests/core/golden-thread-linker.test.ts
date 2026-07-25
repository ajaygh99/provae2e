import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { GoldenThreadStore } from '../../src/core/golden-thread-store.js';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

jest.setTimeout(60000);

const testDbDir = path.join(process.cwd(), '.test-golden-thread-linker');
let testDbPath: string;
let store: GoldenThreadStore;
let linker: GoldenThreadLinker;

beforeEach(async () => {
  await mkdir(testDbDir, { recursive: true });
  testDbPath = path.join(testDbDir, `test-${Date.now()}.sqlite`);
  store = await GoldenThreadStore.open(testDbPath);
  linker = new GoldenThreadLinker(store);
});

afterEach(async () => {
  try {
    await rm(testDbDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('GoldenThreadLinker', () => {
  it('initiateChain returns a valid golden_thread_id', async () => {
    const id = await linker.initiateChain({
      actor: 'test-user',
      artifact_url: 'http://example.com'
    });

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('initiateChain with metadata stores metadata', async () => {
    const metadata = { issue_key: 'PROJ-123', priority: 'high' };
    const id = await linker.initiateChain({
      actor: 'user',
      artifact_url: 'http://spec-url',
      metadata
    });

    const chain = await linker.getChain(id);
    expect(chain?.stages[0].metadata).toBe(JSON.stringify(metadata));
  });

  it('linkStage adds stage to chain', async () => {
    const threadId = await linker.initiateChain({
      actor: 'user',
      artifact_url: 'http://spec-url'
    });

    await linker.linkStage({
      golden_thread_id: threadId,
      stage: 2,
      status: 'PASSED',
      actor: 'test-runner',
      artifact_url: 'http://test-url'
    });

    const chain = await linker.getChain(threadId);
    expect(chain?.stages).toHaveLength(2);
    expect(chain?.stages[1].stage).toBe(2);
  });

  it('getChain returns complete chain with all stages', async () => {
    const threadId = await linker.initiateChain({
      actor: 'user',
      artifact_url: 'http://spec-url'
    });

    for (let i = 2; i <= 7; i++) {
      await linker.linkStage({
        golden_thread_id: threadId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stage: i as any,
        status: 'PASSED',
        actor: 'system',
        artifact_url: `http://stage-${i}-url`
      });
    }

    const chain = await linker.getChain(threadId);
    expect(chain?.stages).toHaveLength(7);
    expect(chain?.golden_thread_id).toBe(threadId);
  });

  it('validateChain returns valid for complete chain', async () => {
    const threadId = await linker.initiateChain({
      actor: 'user',
      artifact_url: 'http://spec-url'
    });

    for (let i = 2; i <= 7; i++) {
      await linker.linkStage({
        golden_thread_id: threadId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stage: i as any,
        status: 'PASSED',
        actor: 'system',
        artifact_url: `http://stage-${i}-url`
      });
    }

    const result = await linker.validateChain(threadId);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validateChain detects incomplete chain', async () => {
    const threadId = await linker.initiateChain({
      actor: 'user',
      artifact_url: 'http://spec-url'
    });

    const result = await linker.validateChain(threadId);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('listChains returns all chain IDs', async () => {
    const id1 = await linker.initiateChain({
      actor: 'user',
      artifact_url: 'http://spec-1'
    });

    const id2 = await linker.initiateChain({
      actor: 'user',
      artifact_url: 'http://spec-2'
    });

    const chains = await linker.listChains();
    expect(chains).toContain(id1);
    expect(chains).toContain(id2);
  });

  it('linkStage validates parent_id linking', async () => {
    const threadId = await linker.initiateChain({
      actor: 'user',
      artifact_url: 'http://spec-url'
    });

    await linker.linkStage({
      golden_thread_id: threadId,
      stage: 2,
      status: 'PASSED',
      actor: 'user',
      artifact_url: 'http://test-url'
    });

    const chain = await linker.getChain(threadId);
    const stage2 = chain?.stages.find(s => s.stage === 2);
    const stage1 = chain?.stages.find(s => s.stage === 1);

    expect(stage2?.parent_id).toBe(String(stage1?.id));
  });

  it('linkStage can track different statuses', async () => {
    const threadId = await linker.initiateChain({
      actor: 'user',
      artifact_url: 'http://spec-url'
    });

    await linker.linkStage({
      golden_thread_id: threadId,
      stage: 2,
      status: 'IN_PROGRESS',
      actor: 'user',
      artifact_url: 'http://test-url'
    });

    await linker.linkStage({
      golden_thread_id: threadId,
      stage: 3,
      status: 'FAILED',
      actor: 'user',
      artifact_url: 'http://evidence-url'
    });

    const chain = await linker.getChain(threadId);
    expect(chain?.stages.find(s => s.stage === 2)?.status).toBe('IN_PROGRESS');
    expect(chain?.stages.find(s => s.stage === 3)?.status).toBe('FAILED');
  });

  it('getChain returns null for non-existent chain', async () => {
    const chain = await linker.getChain('non-existent-id');
    expect(chain).toBeNull();
  });
});
