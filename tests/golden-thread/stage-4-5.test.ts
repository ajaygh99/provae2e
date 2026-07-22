import { GoldenThreadStore, type Stage } from '../../src/core/golden-thread-store.js';
import { GoldenThreadLinker } from '../../src/core/golden-thread-linker.js';
import { linkGitHubBuildAndDeploy } from '../../src/core/golden-thread-github.js';
import { GitHubApiClient } from '../../src/core/github-api-client.js';
import { renderCommitTraceHtml, renderCommitTraceJson } from '../../src/reporters/golden-thread-commit-reporter.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

jest.setTimeout(30000);

describe('Golden Thread Stage 4-5: Build and Deploy', () => {
  let dbPath: string;
  let store: GoldenThreadStore;
  let linker: GoldenThreadLinker;

  beforeEach(async () => {
    const tmpDir = tmpdir();
    await mkdir(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, `test-${Date.now()}.sqlite`);
    store = await GoldenThreadStore.open(dbPath);
    linker = new GoldenThreadLinker(store);
  });

  afterEach(() => {
    if (store) {
      jest.restoreAllMocks();
    }
  });

  describe('GitHub API Client', () => {
    it('should construct with repo and token', () => {
      const client = new GitHubApiClient('owner', 'repo', 'token');
      expect(client).toBeDefined();
    });

    it('should generate workflow logs URL correctly', () => {
      const client = new GitHubApiClient('myowner', 'myrepo', 'token');
      const url = client.getWorkflowLogsUrl(12345);
      expect(url).toBe('https://github.com/myowner/myrepo/actions/runs/12345');
    });

    it('should generate commit URL correctly', () => {
      const client = new GitHubApiClient('myowner', 'myrepo', 'token');
      const url = client.getCommitUrl('abc123def456');
      expect(url).toBe('https://github.com/myowner/myrepo/commit/abc123def456');
    });
  });

  describe('GitHub Build and Deploy Linking', () => {
    it('should throw error when commit not found', async () => {
      const mockClient = jest.spyOn(GitHubApiClient.prototype, 'getCommit').mockResolvedValue(null);

      const promise = linkGitHubBuildAndDeploy({
        golden_thread_id: 'test-id',
        commit_sha: 'nonexistent',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_token: 'token',
        golden_thread_linker: linker
      });

      await expect(promise).rejects.toThrow('not found');
      mockClient.mockRestore();
    });

    it('should link successful workflow run as Stage 4', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123',
        metadata: { commit_sha: 'abc123' }
      });

      const mockGetCommit = jest.spyOn(GitHubApiClient.prototype, 'getCommit').mockResolvedValue({
        sha: 'abc123',
        message: 'Test commit',
        author: { name: 'Test', email: 'test@example.com', date: new Date().toISOString() },
        committer: { name: 'Test', email: 'test@example.com', date: new Date().toISOString() }
      });

      const mockGetWorkflow = jest.spyOn(GitHubApiClient.prototype, 'getLatestWorkflowRunForCommit').mockResolvedValue({
        id: 12345,
        name: 'CI',
        status: 'completed' as const,
        conclusion: 'success' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        head_sha: 'abc123',
        html_url: 'https://github.com/test/repo/actions/runs/12345'
      });

      const mockGetDeployments = jest.spyOn(GitHubApiClient.prototype, 'getDeploymentsForCommit').mockResolvedValue([]);

      await linkGitHubBuildAndDeploy({
        golden_thread_id,
        commit_sha: 'abc123',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_token: 'token',
        golden_thread_linker: linker
      });

      const chain = await linker.getChain(golden_thread_id);
      expect(chain).toBeDefined();
      expect(chain!.stages.length).toBeGreaterThanOrEqual(2);

      const buildStage = chain!.stages.find(s => s.stage === 4);
      expect(buildStage).toBeDefined();
      expect(buildStage!.status).toBe('PASSED');
      expect(buildStage!.deployment_status).toBe('GREEN');

      const metadata = JSON.parse(buildStage!.metadata);
      expect(metadata.github_run_id).toBe(12345);
      expect(metadata.workflow_name).toBe('CI');

      mockGetCommit.mockRestore();
      mockGetWorkflow.mockRestore();
      mockGetDeployments.mockRestore();
    });

    it('should link failed workflow run as Stage 4 with RED status', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123',
        metadata: { commit_sha: 'abc123' }
      });

      const mockGetCommit = jest.spyOn(GitHubApiClient.prototype, 'getCommit').mockResolvedValue({
        sha: 'abc123',
        message: 'Test commit',
        author: null,
        committer: null
      });

      const mockGetWorkflow = jest.spyOn(GitHubApiClient.prototype, 'getLatestWorkflowRunForCommit').mockResolvedValue({
        id: 12345,
        name: 'CI',
        status: 'completed' as const,
        conclusion: 'failure' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        head_sha: 'abc123',
        html_url: 'https://github.com/test/repo/actions/runs/12345'
      });

      const mockGetDeployments = jest.spyOn(GitHubApiClient.prototype, 'getDeploymentsForCommit').mockResolvedValue([]);

      await linkGitHubBuildAndDeploy({
        golden_thread_id,
        commit_sha: 'abc123',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_token: 'token',
        golden_thread_linker: linker
      });

      const chain = await linker.getChain(golden_thread_id);
      const buildStage = chain!.stages.find(s => s.stage === 4);
      expect(buildStage!.status).toBe('FAILED');
      expect(buildStage!.deployment_status).toBe('RED');

      mockGetCommit.mockRestore();
      mockGetWorkflow.mockRestore();
      mockGetDeployments.mockRestore();
    });

    it('should link production deployments as Stage 5', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123',
        metadata: { commit_sha: 'abc123' }
      });

      const mockGetCommit = jest.spyOn(GitHubApiClient.prototype, 'getCommit').mockResolvedValue({
        sha: 'abc123',
        message: 'Test commit',
        author: null,
        committer: null
      });

      const mockGetWorkflow = jest.spyOn(GitHubApiClient.prototype, 'getLatestWorkflowRunForCommit').mockResolvedValue(null);

      const mockGetDeployments = jest.spyOn(GitHubApiClient.prototype, 'getDeploymentsForCommit').mockResolvedValue([
        {
          id: 54321,
          environment: 'production',
          state: 'success' as const,
          creator: { login: 'deployer' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          production_environment: true
        }
      ]);

      await linkGitHubBuildAndDeploy({
        golden_thread_id,
        commit_sha: 'abc123',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_token: 'token',
        golden_thread_linker: linker
      });

      const chain = await linker.getChain(golden_thread_id);
      const deployStage = chain!.stages.find(s => s.stage === 5);
      expect(deployStage).toBeDefined();
      expect(deployStage!.status).toBe('PASSED');
      expect(deployStage!.deployment_status).toBe('GREEN');

      const metadata = JSON.parse(deployStage!.metadata);
      expect(metadata.environments).toEqual(['production']);
      expect(Array.isArray(metadata.deployments)).toBe(true);
      expect(metadata.deployments[0].environment).toBe('production');
      expect(metadata.deployments[0].deployed_by).toBe('deployer');
      expect(metadata.deployments[0].production_environment).toBe(true);

      const deployMeta = JSON.parse(deployStage!.deployment_metadata!);
      expect(deployMeta.environments).toEqual(['production']);
      expect(deployMeta.deployments[0].deployed_by).toBe('deployer');

      mockGetCommit.mockRestore();
      mockGetWorkflow.mockRestore();
      mockGetDeployments.mockRestore();
    });

    it('should handle multiple deployments to different environments', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123',
        metadata: { commit_sha: 'abc123' }
      });

      const mockGetCommit = jest.spyOn(GitHubApiClient.prototype, 'getCommit').mockResolvedValue({
        sha: 'abc123',
        message: 'Test commit',
        author: null,
        committer: null
      });

      const mockGetWorkflow = jest.spyOn(GitHubApiClient.prototype, 'getLatestWorkflowRunForCommit').mockResolvedValue(null);

      const mockGetDeployments = jest.spyOn(GitHubApiClient.prototype, 'getDeploymentsForCommit').mockResolvedValue([
        {
          id: 1,
          environment: 'staging',
          state: 'success' as const,
          creator: { login: 'ci' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          production_environment: false
        },
        {
          id: 2,
          environment: 'production',
          state: 'success' as const,
          creator: { login: 'ci' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          production_environment: true
        }
      ]);

      await linkGitHubBuildAndDeploy({
        golden_thread_id,
        commit_sha: 'abc123',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_token: 'token',
        golden_thread_linker: linker
      });

      const chain = await linker.getChain(golden_thread_id);
      const deployStages = chain!.stages.filter(s => s.stage === 5);
      expect(deployStages.length).toBe(1);

      const deployStage = deployStages[0];
      expect(deployStage).toBeDefined();
      const meta = JSON.parse(deployStage!.metadata);
      expect(meta.environments).toEqual(['staging', 'production']);
      expect(Array.isArray(meta.deployments)).toBe(true);
      expect(meta.deployments.length).toBe(2);

      const stagingDeploy = meta.deployments.find((d: Record<string, unknown>) => d.environment === 'staging');
      expect(stagingDeploy).toBeDefined();

      const prodDeploy = meta.deployments.find((d: Record<string, unknown>) => d.environment === 'production');
      expect(prodDeploy).toBeDefined();
      expect(prodDeploy!.production_environment).toBe(true);

      mockGetCommit.mockRestore();
      mockGetWorkflow.mockRestore();
      mockGetDeployments.mockRestore();
    });

    it('should map failed deployments to RED status', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123',
        metadata: { commit_sha: 'abc123' }
      });

      const mockGetCommit = jest.spyOn(GitHubApiClient.prototype, 'getCommit').mockResolvedValue({
        sha: 'abc123',
        message: 'Test commit',
        author: null,
        committer: null
      });

      const mockGetWorkflow = jest.spyOn(GitHubApiClient.prototype, 'getLatestWorkflowRunForCommit').mockResolvedValue(null);

      const mockGetDeployments = jest.spyOn(GitHubApiClient.prototype, 'getDeploymentsForCommit').mockResolvedValue([
        {
          id: 54321,
          environment: 'production',
          state: 'failure' as const,
          creator: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          production_environment: true
        }
      ]);

      await linkGitHubBuildAndDeploy({
        golden_thread_id,
        commit_sha: 'abc123',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_token: 'token',
        golden_thread_linker: linker
      });

      const chain = await linker.getChain(golden_thread_id);
      const deployStage = chain!.stages.find(s => s.stage === 5);
      expect(deployStage!.status).toBe('FAILED');
      expect(deployStage!.deployment_status).toBe('RED');

      mockGetCommit.mockRestore();
      mockGetWorkflow.mockRestore();
      mockGetDeployments.mockRestore();
    });

    it('should map pending deployments to YELLOW status', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123',
        metadata: { commit_sha: 'abc123' }
      });

      const mockGetCommit = jest.spyOn(GitHubApiClient.prototype, 'getCommit').mockResolvedValue({
        sha: 'abc123',
        message: 'Test commit',
        author: null,
        committer: null
      });

      const mockGetWorkflow = jest.spyOn(GitHubApiClient.prototype, 'getLatestWorkflowRunForCommit').mockResolvedValue(null);

      const mockGetDeployments = jest.spyOn(GitHubApiClient.prototype, 'getDeploymentsForCommit').mockResolvedValue([
        {
          id: 54321,
          environment: 'staging',
          state: 'pending' as const,
          creator: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          production_environment: false
        }
      ]);

      await linkGitHubBuildAndDeploy({
        golden_thread_id,
        commit_sha: 'abc123',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_token: 'token',
        golden_thread_linker: linker
      });

      const chain = await linker.getChain(golden_thread_id);
      const deployStage = chain!.stages.find(s => s.stage === 5);
      expect(deployStage!.deployment_status).toBe('YELLOW');

      mockGetCommit.mockRestore();
      mockGetWorkflow.mockRestore();
      mockGetDeployments.mockRestore();
    });
  });

  describe('Golden Thread Commit Reporter', () => {
    it('should render HTML report with commit info', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123',
        metadata: { commit_sha: 'abc123' }
      });

      const chain = await linker.getChain(golden_thread_id);
      expect(chain).toBeDefined();

      const html = renderCommitTraceHtml(chain!, 'abc123');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Golden Thread');
      expect(html).toContain('abc123');
      expect(html).toContain('7-Stage Traceability Chain');
    });

    it('should render JSON report with all chain data', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123',
        metadata: { commit_sha: 'abc123', test_data: 'value' }
      });

      const chain = await linker.getChain(golden_thread_id);
      expect(chain).toBeDefined();

      const json = renderCommitTraceJson(chain!, 'abc123');
      const parsed = JSON.parse(json);

      expect(parsed.commit_sha).toBe('abc123');
      expect(parsed.chain_id).toBe(golden_thread_id);
      expect(Array.isArray(parsed.stages)).toBe(true);
      expect(parsed.stages[0].stage).toBe(1);
      expect(parsed.stages[0].metadata).toEqual({ commit_sha: 'abc123', test_data: 'value' });
    });

    it('should include deployment status in HTML', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 4,
        status: 'PASSED',
        actor: 'github',
        artifact_url: 'https://github.com/test/repo/actions/runs/123',
        deployment_status: 'GREEN',
        deployment_metadata: JSON.stringify({ workflow_run_id: 123 })
      });

      const chain = await linker.getChain(golden_thread_id);
      const html = renderCommitTraceHtml(chain!, 'abc123');
      expect(html).toContain('DEPLOYED');
    });

    it('should include deployment metadata in JSON', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo/commit/abc123'
      });

      const deployMeta = {
        environment: 'production',
        timestamp: new Date().toISOString(),
        deployed_by: 'ci-pipeline'
      };

      await linker.linkStage({
        golden_thread_id,
        stage: 5,
        status: 'PASSED',
        actor: 'github',
        artifact_url: 'https://github.com/test/repo/deployments/456',
        deployment_status: 'GREEN',
        deployment_metadata: JSON.stringify(deployMeta)
      });

      const chain = await linker.getChain(golden_thread_id);
      const json = renderCommitTraceJson(chain!, 'abc123');
      const parsed = JSON.parse(json);

      const deployStage = parsed.stages.find((s: Record<string, unknown>) => s.stage === 5);
      expect(deployStage.deployment_metadata.environment).toBe('production');
      expect(deployStage.deployment_metadata.deployed_by).toBe('ci-pipeline');
    });
  });

  describe('Database Schema Migrations', () => {
    it('should have deployment_status column in stage_logs', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 2,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://example.com',
        deployment_status: 'GREEN'
      });

      const chain = await linker.getChain(golden_thread_id);
      const stage2 = chain!.stages.find(s => s.stage === 2);
      expect(stage2!.deployment_status).toBe('GREEN');
    });

    it('should have deployment_metadata column in stage_logs', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://github.com/test/repo'
      });

      const metadataObj = { key: 'value', nested: { data: 'here' } };
      await linker.linkStage({
        golden_thread_id,
        stage: 3,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://example.com',
        deployment_metadata: JSON.stringify(metadataObj)
      });

      const chain = await linker.getChain(golden_thread_id);
      const stage3 = chain!.stages.find(s => s.stage === 3);
      expect(stage3!.deployment_metadata).toBeDefined();
      expect(JSON.parse(stage3!.deployment_metadata!)).toEqual(metadataObj);
    });
  });

  describe('Chain Validation', () => {
    it('should validate complete 7-stage chain', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://example.com/spec'
      });

      for (let stageNum = 2; stageNum <= 7; stageNum++) {
        await linker.linkStage({
          golden_thread_id,
          stage: stageNum as Stage,
          status: 'PASSED',
          actor: 'test',
          artifact_url: `https://example.com/stage-${stageNum}`
        });
      }

      const validation = await linker.validateChain(golden_thread_id);
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should fail validation if stage is missing', async () => {
      const golden_thread_id = await linker.initiateChain({
        actor: 'test',
        artifact_url: 'https://example.com/spec'
      });

      await linker.linkStage({
        golden_thread_id,
        stage: 2,
        status: 'PASSED',
        actor: 'test',
        artifact_url: 'https://example.com/stage-2'
      });

      const validation = await linker.validateChain(golden_thread_id);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('Stage 3'))).toBe(true);
    });
  });
});
