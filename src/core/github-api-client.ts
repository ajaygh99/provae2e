/** Low-level GitHub API client for workflow runs and deployments. */

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | null;
  created_at: string;
  updated_at: string;
  head_sha: string;
  html_url: string;
}

export interface GitHubDeployment {
  id: number;
  environment: string;
  state: 'success' | 'failure' | 'pending' | 'error' | 'inactive';
  creator: { login: string } | null;
  created_at: string;
  updated_at: string;
  production_environment: boolean;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: { name: string; email: string; date: string } | null;
  committer: { name: string; email: string; date: string } | null;
}

/** GitHub API client for fetching build and deployment information. */
export class GitHubApiClient {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string
  ) {}

  /**
   * Fetches the latest workflow run for a given commit SHA.
   * @param commit_sha Git commit SHA
   * @returns Latest workflow run or null if not found
   */
  async getLatestWorkflowRunForCommit(commit_sha: string): Promise<GitHubWorkflowRun | null> {
    const response = await this.apiRequest(
      `/repos/${this.owner}/${this.repo}/actions/runs?head_sha=${commit_sha}&per_page=1`
    ) as Record<string, unknown>;
    const runs = response.workflow_runs as GitHubWorkflowRun[];
    return runs.length > 0 ? runs[0] : null;
  }

  /**
   * Fetches all deployments for a given commit SHA.
   * @param commit_sha Git commit SHA
   * @returns Array of deployments for the commit
   */
  async getDeploymentsForCommit(commit_sha: string): Promise<GitHubDeployment[]> {
    const response = await this.apiRequest(
      `/repos/${this.owner}/${this.repo}/deployments?sha=${commit_sha}&per_page=100`
    );
    return (response as GitHubDeployment[]) || [];
  }

  /**
   * Fetches details for a specific deployment.
   * @param deployment_id Deployment ID
   * @returns Deployment details or null if not found
   */
  async getDeploymentDetails(deployment_id: number): Promise<GitHubDeployment | null> {
    try {
      const response = await this.apiRequest(
        `/repos/${this.owner}/${this.repo}/deployments/${deployment_id}`
      );
      return response as GitHubDeployment;
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetches a specific commit's details.
   * @param commit_sha Git commit SHA
   * @returns Commit details or null if not found
   */
  async getCommit(commit_sha: string): Promise<GitHubCommit | null> {
    try {
      const response = await this.apiRequest(
        `/repos/${this.owner}/${this.repo}/commits/${commit_sha}`
      );
      return {
        sha: (response as Record<string, unknown>).sha as string,
        message: ((response as Record<string, unknown>).commit as Record<string, unknown>)?.message as string,
        author: (response as Record<string, unknown>).author,
        committer: (response as Record<string, unknown>).committer
      } as GitHubCommit;
    } catch (error) {
      return null;
    }
  }

  /**
   * Gets the workflow run logs URL for a specific run.
   * @param run_id Workflow run ID
   * @returns URL to the workflow run logs
   */
  getWorkflowLogsUrl(run_id: number): string {
    return `https://github.com/${this.owner}/${this.repo}/actions/runs/${run_id}`;
  }

  /**
   * Commits from a commit SHA.
   * @param commit_sha Git commit SHA
   * @returns Commit URL
   */
  getCommitUrl(commit_sha: string): string {
    return `https://github.com/${this.owner}/${this.repo}/commit/${commit_sha}`;
  }

  private async apiRequest(endpoint: string): Promise<unknown> {
    const url = `https://api.github.com${endpoint}`;
    const httpResponse = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `token ${this.token}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });

    if (!httpResponse.ok) {
      throw new Error(
        `GitHub API error: ${httpResponse.status} ${httpResponse.statusText}`
      );
    }

    return httpResponse.json();
  }
}
