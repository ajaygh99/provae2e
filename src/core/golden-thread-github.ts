/** GitHub integration for Golden Thread Build/Deploy stages. */
import { GoldenThreadLinker } from './golden-thread-linker.js';

/** Options for linking GitHub build/deploy artifacts to a chain. */
export interface GitHubStageOptions {
  golden_thread_id: string;
  stage: 4 | 5; // Build (4) or Deploy (5)
  commit_hash: string;
  repo_owner: string;
  repo_name: string;
  golden_thread_linker: GoldenThreadLinker;
}

/**
 * Links a GitHub commit or deployment to a Golden Thread chain.
 * @param opts Options including commit hash and repo
 * @note Phase 4: Implement full GitHub API integration to fetch commit/PR/deployment details
 */
export async function linkGitHubStage(opts: GitHubStageOptions): Promise<void> {
  const { golden_thread_id, stage, commit_hash, repo_owner, repo_name, golden_thread_linker } = opts;

  const artifact_url = `https://github.com/${repo_owner}/${repo_name}/commit/${commit_hash}`;

  const stageName = stage === 4 ? 'Build' : 'Deploy';

  await golden_thread_linker.linkStage({
    golden_thread_id,
    stage,
    status: 'PASSED',
    actor: 'github-connector',
    artifact_url,
    metadata: {
      repo: `${repo_owner}/${repo_name}`,
      commit_hash,
      stage_name: stageName,
      note: 'Phase 4: Full GitHub API integration pending'
    }
  });
}
