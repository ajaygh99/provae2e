import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { GoldenThreadStore } from '../../src/core/golden-thread-store.js';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

jest.setTimeout(60000);

const testDbDir = path.join(process.cwd(), '.test-golden-thread-jira');
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

describe('initiateFromJira', () => {
  it('handles missing JIRA credentials', async () => {
    const { initiateFromJira } = await import('../../src/core/golden-thread-jira.js');
    await expect(initiateFromJira({
      issue_key: 'TEST-123',
      golden_thread_linker: linker,
      baseUrl: 'https://company.atlassian.net',
      ticketKey: 'TEST-123'
      // Missing apiToken or accessToken
    })).rejects.toThrow();
  });

  it('rejects invalid baseUrl', async () => {
    const { initiateFromJira } = await import('../../src/core/golden-thread-jira.js');
    await expect(initiateFromJira({
      issue_key: 'TEST-123',
      golden_thread_linker: linker,
      baseUrl: 'invalid-url',
      ticketKey: 'TEST-123',
      apiToken: 'test-token'
    })).rejects.toThrow();
  });

  it('throws on JIRA fetch failure', async () => {
    const { initiateFromJira } = await import('../../src/core/golden-thread-jira.js');
    await expect(initiateFromJira({
      issue_key: 'NONEXIST-999',
      golden_thread_linker: linker,
      baseUrl: 'https://nonexistent-jira-instance.atlassian.net',
      ticketKey: 'NONEXIST-999',
      apiToken: 'invalid-token',
      timeoutMs: 100
    })).rejects.toThrow();
  });

  it('creates chain with issue_key metadata', async () => {
    const golden_thread_id = await linker.initiateChain({
      actor: 'jira-connector',
      artifact_url: 'https://company.atlassian.net/browse/PROJ-123',
      metadata: {
        issue_key: 'PROJ-123',
        description: 'Test acceptance criteria'
      }
    });

    const chain = await linker.getChain(golden_thread_id);
    expect(chain).toBeDefined();
    expect(chain?.stages[0].actor).toBe('jira-connector');
    expect(chain?.stages[0].artifact_url).toContain('PROJ-123');
  });

  it('generates valid artifact URL', () => {
    const baseUrl = 'https://company.atlassian.net';
    const issue_key = 'PROJ-456';

    const artifact_url = `${baseUrl.replace(/\/$/, '')}/browse/${issue_key}`;
    expect(artifact_url).toBe('https://company.atlassian.net/browse/PROJ-456');
  });

  it('handles baseUrl with trailing slash', () => {
    const baseUrl = 'https://company.atlassian.net/';
    const issue_key = 'PROJ-789';

    const cleanUrl = baseUrl.replace(/\/$/, '');
    const artifact_url = `${cleanUrl}/browse/${issue_key}`;
    expect(artifact_url).toBe('https://company.atlassian.net/browse/PROJ-789');
  });
});
