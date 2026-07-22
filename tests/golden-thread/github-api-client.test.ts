import { GitHubApiClient, type GitHubWorkflowRun, type GitHubDeployment } from '../../src/core/github-api-client.js';

describe('GitHubApiClient', () => {
  const mockOwner = 'testowner';
  const mockRepo = 'testrepo';
  const mockToken = 'gh_test_token_12345';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with owner, repo, and token', () => {
      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      expect(client).toBeDefined();
    });
  });

  describe('getWorkflowLogsUrl', () => {
    it('should generate correct workflow logs URL', () => {
      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const runId = 98765;
      const url = client.getWorkflowLogsUrl(runId);
      expect(url).toBe(`https://github.com/${mockOwner}/${mockRepo}/actions/runs/${runId}`);
    });

    it('should handle large run IDs', () => {
      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const runId = 999999999;
      const url = client.getWorkflowLogsUrl(runId);
      expect(url).toContain('999999999');
    });
  });

  describe('getCommitUrl', () => {
    it('should generate correct commit URL', () => {
      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const sha = 'abc123def456';
      const url = client.getCommitUrl(sha);
      expect(url).toBe(`https://github.com/${mockOwner}/${mockRepo}/commit/${sha}`);
    });

    it('should handle full commit SHA', () => {
      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const sha = 'abc123def456abc123def456abc123def456abc1';
      const url = client.getCommitUrl(sha);
      expect(url).toContain(sha);
    });
  });

  describe('getLatestWorkflowRunForCommit', () => {
    it('should return workflow run when found', async () => {
      const mockRun: GitHubWorkflowRun = {
        id: 12345,
        name: 'CI Pipeline',
        status: 'completed',
        conclusion: 'success',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:01:00Z',
        head_sha: 'abc123',
        html_url: 'https://github.com/test/repo/actions/runs/12345'
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ workflow_runs: [mockRun] })
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getLatestWorkflowRunForCommit('abc123');

      expect(result).toEqual(mockRun);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('head_sha=abc123'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `token ${mockToken}`
          })
        })
      );
    });

    it('should return null when no workflow runs found', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ workflow_runs: [] })
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getLatestWorkflowRunForCommit('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on API failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);

      await expect(client.getLatestWorkflowRunForCommit('abc123')).rejects.toThrow('GitHub API error');
    });

    it('should include authorization header with token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ workflow_runs: [] })
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      await client.getLatestWorkflowRunForCommit('abc123');

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe(`token ${mockToken}`);
    });
  });

  describe('getDeploymentsForCommit', () => {
    it('should return deployments when found', async () => {
      const mockDeployments: GitHubDeployment[] = [
        {
          id: 1,
          environment: 'production',
          state: 'success',
          creator: { login: 'deployer' },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:01:00Z',
          production_environment: true
        }
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDeployments
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getDeploymentsForCommit('abc123');

      expect(result).toEqual(mockDeployments);
    });

    it('should return empty array when no deployments found', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => null
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getDeploymentsForCommit('abc123');

      expect(result).toEqual([]);
    });

    it('should handle failed deployment state', async () => {
      const mockDeployments: GitHubDeployment[] = [
        {
          id: 2,
          environment: 'staging',
          state: 'failure',
          creator: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:01:00Z',
          production_environment: false
        }
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDeployments
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getDeploymentsForCommit('abc123');

      expect(result[0].state).toBe('failure');
    });

    it('should include pagination in request', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => []
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      await client.getDeploymentsForCommit('abc123');

      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(url).toContain('per_page=100');
    });
  });

  describe('getDeploymentDetails', () => {
    it('should return deployment details when found', async () => {
      const mockDeployment: GitHubDeployment = {
        id: 54321,
        environment: 'production',
        state: 'success',
        creator: { login: 'ci-user' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:01:00Z',
        production_environment: true
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDeployment
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getDeploymentDetails(54321);

      expect(result).toEqual(mockDeployment);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/deployments/54321'),
        expect.any(Object)
      );
    });

    it('should return null on API error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getDeploymentDetails(99999);

      expect(result).toBeNull();
    });

    it('should handle pending deployment state', async () => {
      const mockDeployment: GitHubDeployment = {
        id: 1,
        environment: 'staging',
        state: 'pending',
        creator: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:01:00Z',
        production_environment: false
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDeployment
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getDeploymentDetails(1);

      expect(result?.state).toBe('pending');
    });
  });

  describe('getCommit', () => {
    it('should return commit details when found', async () => {
      const mockCommitResponse = {
        sha: 'abc123',
        commit: {
          message: 'feat: add new feature'
        },
        author: { name: 'John Doe', email: 'john@example.com' },
        committer: { name: 'Jane Doe', email: 'jane@example.com' }
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockCommitResponse
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getCommit('abc123');

      expect(result).toBeDefined();
      expect(result?.sha).toBe('abc123');
      expect(result?.message).toBe('feat: add new feature');
    });

    it('should handle missing author/committer', async () => {
      const mockCommitResponse = {
        sha: 'abc123',
        commit: {
          message: 'chore: update dependencies'
        },
        author: null,
        committer: null
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockCommitResponse
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getCommit('abc123');

      expect(result?.author).toBeNull();
      expect(result?.committer).toBeNull();
    });

    it('should return null on API error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getCommit('nonexistent');

      expect(result).toBeNull();
    });

    it('should parse commit message correctly', async () => {
      const mockCommitResponse = {
        sha: 'def456',
        commit: {
          message: 'fix: resolve issue with multi-line\ndescription here'
        },
        author: null,
        committer: null
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockCommitResponse
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      const result = await client.getCommit('def456');

      expect(result?.message).toContain('fix: resolve issue with multi-line');
    });

    it('should include commit SHA in endpoint URL', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sha: 'xyz789',
          commit: { message: 'test' },
          author: null,
          committer: null
        })
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      await client.getCommit('xyz789');

      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(url).toContain('/commits/xyz789');
    });
  });

  describe('API request error handling', () => {
    it('should throw error with status code on failed request', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);

      await expect(client.getLatestWorkflowRunForCommit('abc123')).rejects.toThrow('500');
    });

    it('should use correct GitHub API base URL', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ workflow_runs: [] })
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      await client.getLatestWorkflowRunForCommit('abc123');

      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(url).toContain('https://api.github.com');
    });

    it('should use correct HTTP method for API calls', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ workflow_runs: [] })
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      await client.getLatestWorkflowRunForCommit('abc123');

      const method = (global.fetch as jest.Mock).mock.calls[0][1].method;
      expect(method).toBe('GET');
    });

    it('should set correct Accept header for GitHub API v3', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ workflow_runs: [] })
      }) as jest.Mock;

      const client = new GitHubApiClient(mockOwner, mockRepo, mockToken);
      await client.getLatestWorkflowRunForCommit('abc123');

      const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers;
      expect(headers.Accept).toBe('application/vnd.github.v3+json');
    });
  });
});
