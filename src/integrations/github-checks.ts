import type {
  IntegrationAction,
  IntegrationExecutionResult,
  IntegrationHealth,
  IntegrationManifest
} from './integration-contract.js';
import type {
  IntegrationAdapter,
  IntegrationExecutionContext
} from './integration-registry.js';

type CheckStatus = 'queued' | 'in_progress' | 'completed';
type CheckConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required';

interface GitHubCheckInput {
  owner: string;
  repository: string;
  sha: string;
  name: string;
  status: CheckStatus;
  conclusion?: CheckConclusion;
  evidenceUrl: string;
  summary: string;
  checkRunId?: number;
}

export type IntegrationFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const SAFE_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
const SHA = /^[a-fA-F0-9]{7,40}$/;
const STATUSES = new Set<CheckStatus>(['queued', 'in_progress', 'completed']);
const CONCLUSIONS = new Set<CheckConclusion>([
  'success', 'failure', 'neutral', 'cancelled', 'timed_out', 'action_required'
]);

function parseInput(input: Record<string, unknown>): GitHubCheckInput {
  const candidate = input as Partial<GitHubCheckInput>;
  if (typeof candidate.owner !== 'string' || !SAFE_SLUG.test(candidate.owner) ||
      typeof candidate.repository !== 'string' || !SAFE_SLUG.test(candidate.repository)) {
    throw new Error('GitHub owner and repository must be safe slugs');
  }
  if (typeof candidate.sha !== 'string' || !SHA.test(candidate.sha)) {
    throw new Error('GitHub check SHA must contain 7 to 40 hexadecimal characters');
  }
  if (typeof candidate.name !== 'string' || candidate.name.length < 1 || candidate.name.length > 100) {
    throw new Error('GitHub check name must contain between 1 and 100 characters');
  }
  if (!candidate.status || !STATUSES.has(candidate.status)) {
    throw new Error('Invalid GitHub check status');
  }
  if (candidate.status === 'completed' && (!candidate.conclusion || !CONCLUSIONS.has(candidate.conclusion))) {
    throw new Error('Completed GitHub checks require a valid conclusion');
  }
  if (candidate.status !== 'completed' && candidate.conclusion !== undefined) {
    throw new Error('Only completed GitHub checks may include a conclusion');
  }
  if (typeof candidate.evidenceUrl !== 'string') {
    throw new Error('GitHub evidence URL is required');
  }
  const evidence = new URL(candidate.evidenceUrl);
  if (evidence.protocol !== 'https:' || evidence.username || evidence.password) {
    throw new Error('GitHub evidence URL must be credential-free HTTPS');
  }
  if (typeof candidate.summary !== 'string' || candidate.summary.length < 1 ||
      candidate.summary.length > 10_000) {
    throw new Error('GitHub check summary must contain between 1 and 10000 characters');
  }
  if (candidate.checkRunId !== undefined &&
      (!Number.isSafeInteger(candidate.checkRunId) || candidate.checkRunId <= 0)) {
    throw new Error('GitHub check run ID must be a positive safe integer');
  }
  return candidate as GitHubCheckInput;
}

export class GitHubChecksIntegration implements IntegrationAdapter {
  readonly manifest: IntegrationManifest = {
    contractVersion: 1,
    id: 'github',
    owner: 'PROVA Platform',
    actions: ['publish-check', 'link-evidence'],
    secretRefs: { token: 'env:GITHUB_TOKEN' },
    endpoint: 'https://api.github.com',
    timeoutMs: 15_000
  };

  constructor(private readonly fetcher: IntegrationFetch = fetch as IntegrationFetch) {}

  async initialize(): Promise<void> {}

  async health(): Promise<IntegrationHealth> {
    return {
      status: 'healthy',
      checkedAt: new Date().toISOString(),
      message: 'GitHub adapter configured; authentication is verified on execution'
    };
  }

  async execute(
    action: IntegrationAction,
    input: Record<string, unknown>,
    context: IntegrationExecutionContext
  ): Promise<IntegrationExecutionResult> {
    if (action !== 'publish-check' && action !== 'link-evidence') {
      throw new Error(`Unsupported GitHub action: ${action}`);
    }
    const check = parseInput(input);
    if (action === 'link-evidence' && check.checkRunId === undefined) {
      throw new Error('link-evidence requires an existing GitHub check run ID');
    }
    const token = context.getSecret('token');
    const updating = check.checkRunId !== undefined;
    const endpoint = updating
      ? `/repos/${check.owner}/${check.repository}/check-runs/${check.checkRunId}`
      : `/repos/${check.owner}/${check.repository}/check-runs`;
    const payload = {
      name: check.name,
      head_sha: check.sha,
      status: check.status,
      ...(check.conclusion ? { conclusion: check.conclusion } : {}),
      details_url: check.evidenceUrl,
      output: { title: check.name, summary: check.summary }
    };
    const response = await this.fetcher(`https://api.github.com${endpoint}`, {
      method: updating ? 'PATCH' : 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28'
      },
      body: JSON.stringify(payload),
      signal: context.signal
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) {
      throw new Error('GitHub check response exceeds the 256 KiB limit');
    }
    if (!response.ok) {
      throw new Error(`GitHub check request failed with HTTP ${response.status}`);
    }
    const result = JSON.parse(raw) as { id?: unknown; html_url?: unknown };
    if (!Number.isSafeInteger(result.id) || typeof result.html_url !== 'string') {
      throw new Error('GitHub check response is malformed');
    }
    return {
      status: 'success',
      action,
      externalId: String(result.id),
      url: result.html_url,
      message: updating ? 'GitHub check updated' : 'GitHub check created'
    };
  }

  async dispose(): Promise<void> {}
}
