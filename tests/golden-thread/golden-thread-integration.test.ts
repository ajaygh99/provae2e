/**
 * Golden Thread integration tests — full 7-stage chain assembled through the
 * real connector entry points (JIRA, linker, GitHub, Datadog) with external
 * APIs mocked. Verifies the chain is complete, correctly parented, and carries
 * the metadata each connector is responsible for.
 */
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

jest.mock('../../src/core/jira-connector.js');
jest.mock('../../src/core/github-api-client.js');

import { GoldenThreadStore } from '../../src/core/golden-thread-store.js';
import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { initiateFromJira } from '../../src/core/golden-thread-jira.js';
import { linkGitHubBuildAndDeploy } from '../../src/core/golden-thread-github.js';
import { linkDatadogStage } from '../../src/core/golden-thread-datadog.js';
import { fetchJiraTicketDescription } from '../../src/core/jira-connector.js';
import { GitHubApiClient } from '../../src/core/github-api-client.js';
import {
  FIXTURE_COMMIT_SHA,
  FIXTURE_ISSUE_KEY,
  MOCK_JIRA_SUCCESS,
  MOCK_JIRA_FAILURE,
  createGitHubClientStub,
  linkTestAndEvidenceStages
} from './fixtures/golden-thread-fixtures.js';

jest.setTimeout(60000);

const mockFetchJira = fetchJiraTicketDescription as jest.MockedFunction<typeof fetchJiraTicketDescription>;
const MockedGitHubApiClient = GitHubApiClient as jest.MockedClass<typeof GitHubApiClient>;

const testDbDir = path.join(process.cwd(), '.test-golden-thread-integration');
let store: GoldenThreadStore;
let linker: GoldenThreadLinker;

beforeEach(async () => {
  await mkdir(testDbDir, { recursive: true });
  store = await GoldenThreadStore.open(path.join(testDbDir, `test-${Date.now()}-${Math.round(performance.now())}.sqlite`));
  linker = new GoldenThreadLinker(store);
  mockFetchJira.mockResolvedValue(MOCK_JIRA_SUCCESS);
  // Every `new GitHubApiClient(...)` returns a stub with successful defaults.
  MockedGitHubApiClient.mockImplementation(
    // Cast: stub implements only the methods the integration exercises.
    () => createGitHubClientStub() as unknown as GitHubApiClient
  );
});

afterEach(async () => {
  jest.clearAllMocks();
  try {
    await rm(testDbDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors.
  }
});

/** Assembles all seven stages through the real connectors. */
async function buildFullChain(): Promise<string> {
  const goldenThreadId = await initiateFromJira({
    issue_key: FIXTURE_ISSUE_KEY,
    golden_thread_linker: linker,
    baseUrl: 'https://acme.atlassian.net',
    ticketKey: FIXTURE_ISSUE_KEY,
    apiToken: 'test-token'
  });
  await linkTestAndEvidenceStages(linker, goldenThreadId);
  await linkGitHubBuildAndDeploy({
    golden_thread_id: goldenThreadId,
    commit_sha: FIXTURE_COMMIT_SHA,
    repo_owner: 'acme',
    repo_name: 'widget',
    github_token: 'gh-token',
    golden_thread_linker: linker
  });
  await linkDatadogStage({
    golden_thread_id: goldenThreadId,
    stage: 6,
    environment: 'production',
    service_name: 'widget-api',
    golden_thread_linker: linker
  });
  await linkDatadogStage({
    golden_thread_id: goldenThreadId,
    stage: 7,
    environment: 'production',
    service_name: 'widget-api',
    golden_thread_linker: linker
  });
  return goldenThreadId;
}

describe('Golden Thread integration — full 7-stage chain', () => {
  it('assembles all seven stages through every connector', async () => {
    const id = await buildFullChain();
    const chain = await linker.getChain(id);

    expect(chain).not.toBeNull();
    expect(chain?.stages).toHaveLength(7);
    expect(chain?.stages.map(s => s.stage)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('produces a chain that passes validation', async () => {
    const id = await buildFullChain();
    const result = await linker.validateChain(id);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('attributes each stage to the connector that produced it', async () => {
    const id = await buildFullChain();
    const chain = await linker.getChain(id);
    const actorByStage = new Map(chain?.stages.map(s => [s.stage, s.actor]));

    expect(actorByStage.get(1)).toBe('jira-connector');
    expect(actorByStage.get(4)).toBe('github-connector');
    expect(actorByStage.get(5)).toBe('github-connector');
    expect(actorByStage.get(6)).toBe('datadog-connector');
    expect(actorByStage.get(7)).toBe('datadog-connector');
  });

  it('carries the JIRA issue key into the Spec stage metadata', async () => {
    const id = await buildFullChain();
    const chain = await linker.getChain(id);
    const spec = chain?.stages.find(s => s.stage === 1);
    const metadata = JSON.parse(spec?.metadata ?? '{}');

    expect(metadata.issue_key).toBe(FIXTURE_ISSUE_KEY);
    expect(spec?.artifact_url).toContain(FIXTURE_ISSUE_KEY);
  });

  it('records the GitHub build run id and deployment environment', async () => {
    const id = await buildFullChain();
    const chain = await linker.getChain(id);
    const build = chain?.stages.find(s => s.stage === 4);
    const deploy = chain?.stages.find(s => s.stage === 5);
    const buildMeta = JSON.parse(build?.metadata ?? '{}');
    const deployMeta = JSON.parse(deploy?.metadata ?? '{}');

    expect(build?.deployment_status).toBe('GREEN');
    expect(buildMeta.commit_sha).toBe(FIXTURE_COMMIT_SHA);
    expect(buildMeta.github_run_id).toBe(987654321);
    expect(deploy?.status).toBe('PASSED');
    expect(deployMeta.environments).toContain('production');
  });

  it('links every non-root stage to its immediate predecessor', async () => {
    const id = await buildFullChain();
    const chain = await linker.getChain(id);
    const stages = chain?.stages ?? [];

    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].parent_id).toBe(String(stages[i - 1].id));
    }
    expect(stages[0].parent_id).toBeNull();
  });
});

describe('Golden Thread integration — external API failures', () => {
  it('rejects when the JIRA issue cannot be fetched', async () => {
    mockFetchJira.mockResolvedValue(MOCK_JIRA_FAILURE);

    await expect(
      initiateFromJira({
        issue_key: 'MISSING-1',
        golden_thread_linker: linker,
        baseUrl: 'https://acme.atlassian.net',
        ticketKey: 'MISSING-1',
        apiToken: 'test-token'
      })
    ).rejects.toThrow(/MISSING-1/);
  });

  it('rejects when the GitHub commit does not exist', async () => {
    MockedGitHubApiClient.mockImplementation(
      // Cast: stub implements only the methods the integration exercises.
      () => createGitHubClientStub({ commit: null }) as unknown as GitHubApiClient
    );
    const id = await initiateFromJira({
      issue_key: FIXTURE_ISSUE_KEY,
      golden_thread_linker: linker,
      baseUrl: 'https://acme.atlassian.net',
      ticketKey: FIXTURE_ISSUE_KEY,
      apiToken: 'test-token'
    });

    await expect(
      linkGitHubBuildAndDeploy({
        golden_thread_id: id,
        commit_sha: 'deadbeef',
        repo_owner: 'acme',
        repo_name: 'widget',
        github_token: 'gh-token',
        golden_thread_linker: linker
      })
    ).rejects.toThrow(/not found/);
  });

  it('skips build/deploy stages when GitHub returns no workflow run or deployments', async () => {
    MockedGitHubApiClient.mockImplementation(
      // Cast: stub implements only the methods the integration exercises.
      () => createGitHubClientStub({ workflowRun: null, deployments: [] }) as unknown as GitHubApiClient
    );
    const id = await initiateFromJira({
      issue_key: FIXTURE_ISSUE_KEY,
      golden_thread_linker: linker,
      baseUrl: 'https://acme.atlassian.net',
      ticketKey: FIXTURE_ISSUE_KEY,
      apiToken: 'test-token'
    });
    await linkTestAndEvidenceStages(linker, id);

    await linkGitHubBuildAndDeploy({
      golden_thread_id: id,
      commit_sha: FIXTURE_COMMIT_SHA,
      repo_owner: 'acme',
      repo_name: 'widget',
      github_token: 'gh-token',
      golden_thread_linker: linker
    });

    const chain = await linker.getChain(id);
    expect(chain?.stages.find(s => s.stage === 4)).toBeUndefined();
    expect(chain?.stages.find(s => s.stage === 5)).toBeUndefined();
  });
});
