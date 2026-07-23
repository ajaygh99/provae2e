/**
 * Shared fixtures for Golden Thread test suites.
 *
 * Provides mock external-API payloads (JIRA, GitHub) and helper builders that
 * assemble chains through the real linker so integration and validation suites
 * exercise identical, realistic data.
 */
import type {
  GitHubCommit,
  GitHubDeployment,
  GitHubWorkflowRun
} from '../../../src/core/github-api-client.js';
import type { JiraDescriptionResult } from '../../../src/core/jira-connector.js';
import type { GoldenThreadLinker } from '../../../src/core/golden-thread-linker.js';
import type { Stage } from '../../../src/core/golden-thread-store.js';

/** Commit SHA reused across GitHub-backed fixtures. */
export const FIXTURE_COMMIT_SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

/** JIRA issue key reused across fixtures. */
export const FIXTURE_ISSUE_KEY = 'PROJ-123';

/** Successful JIRA description lookup for the Spec stage. */
export const MOCK_JIRA_SUCCESS: JiraDescriptionResult = {
  ok: true,
  ticketKey: FIXTURE_ISSUE_KEY,
  description: 'As a user I want traceable releases so that audits are trivial.'
};

/** Failed JIRA description lookup. */
export const MOCK_JIRA_FAILURE: JiraDescriptionResult = {
  ok: false,
  error: 'JIRA issue not found'
};

/** GitHub commit returned for the fixture SHA. */
export const MOCK_COMMIT: GitHubCommit = {
  sha: FIXTURE_COMMIT_SHA,
  message: 'feat: add golden thread traceability',
  author: { name: 'Ajay', email: 'ajay@example.com', date: '2026-07-23T09:00:00.000Z' },
  committer: { name: 'Ajay', email: 'ajay@example.com', date: '2026-07-23T09:00:00.000Z' }
};

/** Successful CI workflow run for the fixture SHA (Build stage). */
export const MOCK_WORKFLOW_RUN: GitHubWorkflowRun = {
  id: 987654321,
  name: 'CI',
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-07-23T09:05:00.000Z',
  updated_at: '2026-07-23T09:10:00.000Z',
  head_sha: FIXTURE_COMMIT_SHA,
  html_url: `https://github.com/acme/widget/actions/runs/987654321`
};

/** Successful production deployment for the fixture SHA (Deploy stage). */
export const MOCK_DEPLOYMENTS: GitHubDeployment[] = [
  {
    id: 555,
    environment: 'production',
    state: 'success',
    creator: { login: 'ajaygh99' },
    created_at: '2026-07-23T09:12:00.000Z',
    updated_at: '2026-07-23T09:15:00.000Z',
    production_environment: true
  }
];

/**
 * Minimal object shaped like {@link GitHubApiClient} for the methods the
 * Golden Thread GitHub integration actually calls. Cast to the client type at
 * the mock boundary in each suite.
 */
export interface GitHubClientStub {
  getCommit: jest.Mock<Promise<GitHubCommit | null>, [string]>;
  getLatestWorkflowRunForCommit: jest.Mock<Promise<GitHubWorkflowRun | null>, [string]>;
  getDeploymentsForCommit: jest.Mock<Promise<GitHubDeployment[]>, [string]>;
  getWorkflowLogsUrl: jest.Mock<string, [number]>;
}

/**
 * Builds a GitHub client stub whose responses can be overridden per test.
 * @param overrides Partial responses to override the successful defaults
 * @returns A stub exposing the four methods the integration uses
 */
export function createGitHubClientStub(overrides: {
  commit?: GitHubCommit | null;
  workflowRun?: GitHubWorkflowRun | null;
  deployments?: GitHubDeployment[];
} = {}): GitHubClientStub {
  return {
    getCommit: jest.fn().mockResolvedValue(
      overrides.commit === undefined ? MOCK_COMMIT : overrides.commit
    ),
    getLatestWorkflowRunForCommit: jest.fn().mockResolvedValue(
      overrides.workflowRun === undefined ? MOCK_WORKFLOW_RUN : overrides.workflowRun
    ),
    getDeploymentsForCommit: jest.fn().mockResolvedValue(
      overrides.deployments === undefined ? MOCK_DEPLOYMENTS : overrides.deployments
    ),
    getWorkflowLogsUrl: jest.fn(
      (runId: number) => `https://github.com/acme/widget/actions/runs/${runId}`
    )
  };
}

/**
 * Links the Test (2) and Evidence (3) stages that have no external connector.
 * @param linker The linker to append stages to
 * @param goldenThreadId The chain to extend
 */
export async function linkTestAndEvidenceStages(
  linker: GoldenThreadLinker,
  goldenThreadId: string
): Promise<void> {
  await linker.linkStage({
    golden_thread_id: goldenThreadId,
    stage: 2,
    status: 'PASSED',
    actor: 'prova-runner',
    artifact_url: 'https://prova.example.com/tests/run-42',
    metadata: { test_id: 'run-42', total: 12, passed: 12 }
  });
  await linker.linkStage({
    golden_thread_id: goldenThreadId,
    stage: 3,
    status: 'PASSED',
    actor: 'prova-runner',
    artifact_url: 'https://prova.example.com/evidence/run-42',
    metadata: { screenshots: 3, video: true }
  });
}

/**
 * Builds a chain missing the requested stages by linking only the others in order.
 * Stages must remain contiguous from 1 because linking enforces parent order.
 * @param linker The linker to build with
 * @param upToStage Highest stage to link (1-7)
 * @returns The golden_thread_id of the partial chain
 */
export async function buildPartialChain(
  linker: GoldenThreadLinker,
  upToStage: Stage
): Promise<string> {
  const goldenThreadId = await linker.initiateChain({
    actor: 'jira-connector',
    artifact_url: `https://jira.example.com/browse/${FIXTURE_ISSUE_KEY}`,
    metadata: { issue_key: FIXTURE_ISSUE_KEY }
  });
  for (let stage = 2; stage <= upToStage; stage++) {
    await linker.linkStage({
      golden_thread_id: goldenThreadId,
      stage: stage as Stage,
      status: 'PASSED',
      actor: 'system',
      artifact_url: `https://prova.example.com/stage-${stage}`,
      metadata: { stage }
    });
  }
  return goldenThreadId;
}
