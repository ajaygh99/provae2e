import { EvidenceStore } from '../../src/core/evidence-store.js';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

jest.setTimeout(30000);

const testDbDir = path.join(process.cwd(), '.test-evidence');
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

describe('EvidenceStore', () => {
  it('open creates new database', async () => {
    const store = await EvidenceStore.open(testDbPath);
    expect(store).toBeDefined();
  });

  it('open loads existing database', async () => {
    const store1 = await EvidenceStore.open(testDbPath);
    const id = await store1.recordEvidence({
      test_execution_id: 'exec-1',
      type: 'screenshot',
      artifact_url: '/path/to/screenshot.png',
      captured_at: new Date().toISOString(),
      metadata: JSON.stringify({ step_id: 'step-1' })
    });
    expect(id).toBeGreaterThan(0);

    const store2 = await EvidenceStore.open(testDbPath);
    const evidence = await store2.getEvidenceForExecution('exec-1');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].id).toBe(id);
  });

  it('recordEvidence stores screenshot', async () => {
    const store = await EvidenceStore.open(testDbPath);
    const now = new Date().toISOString();
    const id = await store.recordEvidence({
      test_execution_id: 'test-exec-1',
      type: 'screenshot',
      artifact_url: '/evidence/screenshots/screenshot-1.png',
      captured_at: now,
      metadata: JSON.stringify({ step_id: 'click-button', duration_ms: 150 })
    });

    expect(id).toBeGreaterThan(0);

    const evidence = await store.getEvidenceForExecution('test-exec-1');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe('screenshot');
    expect(evidence[0].artifact_url).toBe('/evidence/screenshots/screenshot-1.png');
  });

  it('recordEvidence stores multiple types', async () => {
    const store = await EvidenceStore.open(testDbPath);
    const now = new Date().toISOString();

    await store.recordEvidence({
      test_execution_id: 'test-exec-2',
      type: 'screenshot',
      artifact_url: '/screenshots/ss.png',
      captured_at: now,
      metadata: JSON.stringify({})
    });

    await store.recordEvidence({
      test_execution_id: 'test-exec-2',
      type: 'log',
      artifact_url: '/logs/console.json',
      captured_at: now,
      metadata: JSON.stringify({ count: 5 })
    });

    const evidence = await store.getEvidenceForExecution('test-exec-2');
    expect(evidence).toHaveLength(2);
    expect(evidence.map(e => e.type)).toEqual(expect.arrayContaining(['screenshot', 'log']));
  });

  it('getEvidenceByType filters by type', async () => {
    const store = await EvidenceStore.open(testDbPath);
    const now = new Date().toISOString();

    await store.recordEvidence({
      test_execution_id: 'exec-3',
      type: 'screenshot',
      artifact_url: '/ss.png',
      captured_at: now,
      metadata: JSON.stringify({})
    });

    await store.recordEvidence({
      test_execution_id: 'exec-3',
      type: 'network',
      artifact_url: '/network.har',
      captured_at: now,
      metadata: JSON.stringify({})
    });

    const screenshots = await store.getEvidenceByType('screenshot');
    expect(screenshots).toHaveLength(1);
    expect(screenshots[0].type).toBe('screenshot');

    const networks = await store.getEvidenceByType('network');
    expect(networks).toHaveLength(1);
    expect(networks[0].type).toBe('network');
  });

  it('getEvidenceByType filters by type and execution', async () => {
    const store = await EvidenceStore.open(testDbPath);
    const now = new Date().toISOString();

    await store.recordEvidence({
      test_execution_id: 'exec-4a',
      type: 'screenshot',
      artifact_url: '/ss1.png',
      captured_at: now,
      metadata: JSON.stringify({})
    });

    await store.recordEvidence({
      test_execution_id: 'exec-4b',
      type: 'screenshot',
      artifact_url: '/ss2.png',
      captured_at: now,
      metadata: JSON.stringify({})
    });

    const screenshots4a = await store.getEvidenceByType('screenshot', 'exec-4a');
    expect(screenshots4a).toHaveLength(1);
    expect(screenshots4a[0].artifact_url).toBe('/ss1.png');

    const screenshots4b = await store.getEvidenceByType('screenshot', 'exec-4b');
    expect(screenshots4b).toHaveLength(1);
    expect(screenshots4b[0].artifact_url).toBe('/ss2.png');
  });

  it('getEvidenceForExecution returns empty for missing execution', async () => {
    const store = await EvidenceStore.open(testDbPath);
    const evidence = await store.getEvidenceForExecution('non-existent');
    expect(evidence).toEqual([]);
  });

  it('getEvidenceByType returns empty for missing type', async () => {
    const store = await EvidenceStore.open(testDbPath);
    const evidence = await store.getEvidenceByType('log');
    expect(evidence).toEqual([]);
  });

  it('deleteEvidenceOlderThan removes old records', async () => {
    const store = await EvidenceStore.open(testDbPath);
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Record old evidence
    await store.recordEvidence({
      test_execution_id: 'old-exec',
      type: 'screenshot',
      artifact_url: '/old.png',
      captured_at: twoWeeksAgo,
      metadata: JSON.stringify({})
    });

    // Record recent evidence
    await store.recordEvidence({
      test_execution_id: 'recent-exec',
      type: 'screenshot',
      artifact_url: '/recent.png',
      captured_at: oneWeekAgo,
      metadata: JSON.stringify({})
    });

    const allBefore = await store.getEvidenceByType('screenshot');
    expect(allBefore).toHaveLength(2);

    // Delete evidence older than 10 days
    const deleted = await store.deleteEvidenceOlderThan(10);
    expect(deleted).toBe(1);

    const allAfter = await store.getEvidenceByType('screenshot');
    expect(allAfter).toHaveLength(1);
    expect(allAfter[0].artifact_url).toBe('/recent.png');
  });

  it('evidence metadata is stored as JSON string', async () => {
    const store = await EvidenceStore.open(testDbPath);
    const metadata = { step_id: 'click', duration_ms: 200, error: null };
    const now = new Date().toISOString();

    await store.recordEvidence({
      test_execution_id: 'exec-5',
      type: 'screenshot',
      artifact_url: '/ss.png',
      captured_at: now,
      metadata: JSON.stringify(metadata)
    });

    const evidence = await store.getEvidenceForExecution('exec-5');
    const parsedMetadata = JSON.parse(evidence[0].metadata);
    expect(parsedMetadata).toEqual(metadata);
  });

  it('evidence ordered by captured_at ascending', async () => {
    const store = await EvidenceStore.open(testDbPath);
    const t1 = new Date('2026-01-01T10:00:00Z').toISOString();
    const t2 = new Date('2026-01-01T10:01:00Z').toISOString();
    const t3 = new Date('2026-01-01T10:02:00Z').toISOString();

    // Insert in reverse order
    await store.recordEvidence({
      test_execution_id: 'exec-6',
      type: 'screenshot',
      artifact_url: '/ss3.png',
      captured_at: t3,
      metadata: JSON.stringify({})
    });

    await store.recordEvidence({
      test_execution_id: 'exec-6',
      type: 'screenshot',
      artifact_url: '/ss1.png',
      captured_at: t1,
      metadata: JSON.stringify({})
    });

    await store.recordEvidence({
      test_execution_id: 'exec-6',
      type: 'screenshot',
      artifact_url: '/ss2.png',
      captured_at: t2,
      metadata: JSON.stringify({})
    });

    const evidence = await store.getEvidenceForExecution('exec-6');
    expect(evidence.map(e => e.artifact_url)).toEqual(['/ss1.png', '/ss2.png', '/ss3.png']);
  });
});
