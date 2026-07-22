/** GitHub integration for Golden Thread Build/Deploy stages. */
import { GoldenThreadLinker } from './golden-thread-linker.js';
import { GitHubApiClient } from './github-api-client.js';
import type { StageStatus, DeploymentStatus } from './golden-thread-store.js';
import { log } from './logger.js';

/** Options for linking GitHub build/deploy artifacts to a chain. */
export interface GitHubBuildDeployOptions {
  golden_thread_id: string;
  commit_sha: string;
  repo_owner: string;
  repo_name: string;
  github_token: string;
  golden_thread_linker: GoldenThreadLinker;
}

/** Maps GitHub workflow conclusion to deployment status. */
function mapWorkflowToDeploymentStatus(conclusion: string | null): DeploymentStatus {
  if (conclusion === 'success') return 'GREEN';
  if (conclusion === 'failure' || conclusion === 'timed_out') return 'RED';
  return 'YELLOW';
}

/** Maps GitHub workflow status to PROVA stage status. */
function mapWorkflowToStageStatus(status: string, conclusion: string | null): StageStatus {
  if (status === 'completed') {
    return conclusion === 'success' || conclusion === 'neutral' ? 'PASSED' : 'FAILED';
  }
  return status === 'queued' ? 'PENDING' : 'IN_PROGRESS';
}

/**
 * Links GitHub build and deployment stages to a Golden Thread chain.
 * Fetches workflow run status (Stage 4) and deployments (Stage 5).
 * @param opts Options including commit SHA, repo, and GitHub token
 * @throws Error if commit not found or API call fails
 */
export async function linkGitHubBuildAndDeploy(opts: GitHubBuildDeployOptions): Promise<void> {
  const { golden_thread_id, commit_sha, repo_owner, repo_name, github_token, golden_thread_linker } = opts;

  const client = new GitHubApiClient(repo_owner, repo_name, github_token);

  const commit = await client.getCommit(commit_sha);
  if (!commit) {
    throw new Error(`Commit ${commit_sha} not found in ${repo_owner}/${repo_name}`);
  }

  log.info('Linking GitHub build and deploy stages', {
    golden_thread_id,
    commit_sha,
    repo: `${repo_owner}/${repo_name}`
  });

  const workflowRun = await client.getLatestWorkflowRunForCommit(commit_sha);
  const deployments = await client.getDeploymentsForCommit(commit_sha);

  if (workflowRun) {
    const buildStatus = mapWorkflowToStageStatus(workflowRun.status, workflowRun.conclusion);
    const deploymentStatus = mapWorkflowToDeploymentStatus(workflowRun.conclusion);
    const buildMetadata = {
      repo: `${repo_owner}/${repo_name}`,
      commit_sha,
      github_run_id: workflowRun.id,
      workflow_name: workflowRun.name,
      status: workflowRun.status,
      conclusion: workflowRun.conclusion,
      created_at: workflowRun.created_at,
      updated_at: workflowRun.updated_at,
      logs_url: client.getWorkflowLogsUrl(workflowRun.id)
    };

    await golden_thread_linker.linkStage({
      golden_thread_id,
      stage: 4,
      status: buildStatus,
      actor: 'github-connector',
      artifact_url: buildMetadata.logs_url,
      metadata: buildMetadata,
      deployment_status: deploymentStatus,
      deployment_metadata: JSON.stringify({
        workflow_run_id: workflowRun.id,
        build_logs_url: buildMetadata.logs_url,
        test_pass_rate: buildStatus === 'PASSED' ? 100 : 0
      })
    });
  }

  if (deployments.length > 0) {
    const allDeployments = deployments.map(d => ({
      environment: d.environment,
      deployment_id: d.id,
      state: d.state,
      created_at: d.created_at,
      updated_at: d.updated_at,
      deployed_by: d.creator?.login || 'github-actions',
      production_environment: d.production_environment
    }));

    const primaryDeployment = deployments[0];
    const hasAnySuccess = deployments.some(d => d.state === 'success');
    const hasAnyFailure = deployments.some(d => d.state === 'failure' || d.state === 'error');
    const deploymentStatus = hasAnyFailure ? 'RED' : hasAnySuccess ? 'GREEN' : 'YELLOW';
    const stageStatus = hasAnySuccess && !hasAnyFailure ? 'PASSED' : hasAnyFailure ? 'FAILED' : 'PENDING';

    const deploymentMetadata = {
      repo: `${repo_owner}/${repo_name}`,
      commit_sha,
      environments: allDeployments.map(d => d.environment),
      deployments: allDeployments
    };

    await golden_thread_linker.linkStage({
      golden_thread_id,
      stage: 5,
      status: stageStatus,
      actor: 'github-connector',
      artifact_url: `https://github.com/${repo_owner}/${repo_name}/deployments/${primaryDeployment.id}`,
      metadata: deploymentMetadata,
      deployment_status: deploymentStatus,
      deployment_metadata: JSON.stringify({
        environments: allDeployments.map(d => d.environment),
        deployments: allDeployments
      })
    });
  }
}
