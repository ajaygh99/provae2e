import { jiraDescriptionToText } from '../core/jira-connector.js';
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
import type { IntegrationFetch } from './github-checks.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,19}-[1-9][0-9]{0,9}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,19}$/;
const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

function requiredString(
  input: Record<string, unknown>,
  key: string,
  maximum: number
): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`Jira ${key} must contain between 1 and ${maximum} characters`);
  }
  return value.trim();
}

function issueKey(input: Record<string, unknown>): string {
  const key = requiredString(input, 'issueKey', 32).toUpperCase();
  if (!ISSUE_KEY.test(key)) throw new Error('Invalid Jira issue key');
  return key;
}

function evidenceUrl(input: Record<string, unknown>): string {
  const value = requiredString(input, 'evidenceUrl', 2048);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Jira evidence URL must be credential-free HTTPS');
  }
  return url.toString();
}

function adf(text: string): object {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  };
}

export class JiraTraceabilityIntegration implements IntegrationAdapter {
  readonly manifest: IntegrationManifest;

  constructor(
    baseUrl: string,
    private readonly fetcher: IntegrationFetch = fetch as IntegrationFetch
  ) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Jira base URL must be credential-free HTTPS');
    }
    this.manifest = {
      contractVersion: 1,
      id: 'jira',
      owner: 'PROVA Platform',
      actions: ['ingest-requirement', 'sync-result', 'create-defect'],
      secretRefs: { token: 'env:JIRA_ACCESS_TOKEN' },
      endpoint: url.toString().replace(/\/$/, ''),
      timeoutMs: 15_000
    };
  }

  async initialize(): Promise<void> {}

  async health(): Promise<IntegrationHealth> {
    return {
      status: 'healthy',
      checkedAt: new Date().toISOString(),
      message: 'Jira adapter configured; authentication is verified on execution'
    };
  }

  async execute(
    action: IntegrationAction,
    input: Record<string, unknown>,
    context: IntegrationExecutionContext
  ): Promise<IntegrationExecutionResult> {
    const token = context.getSecret('token');
    const headers = {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    };
    if (action === 'ingest-requirement') {
      const key = issueKey(input);
      const payload = await this.request(
        `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description`,
        'GET', headers, context.signal
      ) as { key?: unknown; fields?: { summary?: unknown; description?: unknown } };
      const summary = payload.fields?.summary;
      const description = jiraDescriptionToText(payload.fields?.description);
      if (typeof summary !== 'string' || summary.length > 500 || !description ||
          description.length > 50_000) {
        throw new Error('Jira requirement response is malformed or exceeds bounds');
      }
      return {
        status: 'success',
        action,
        externalId: key,
        url: `${this.manifest.endpoint}/browse/${encodeURIComponent(key)}`,
        message: JSON.stringify({ summary, description })
      };
    }
    if (action === 'sync-result') {
      const key = issueKey(input);
      const status = requiredString(input, 'status', 16).toUpperCase();
      if (!['PASSED', 'FAILED', 'GENERATED'].includes(status)) {
        throw new Error('Invalid Jira result status');
      }
      const summary = requiredString(input, 'summary', 2000);
      const evidence = evidenceUrl(input);
      await this.request(
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
        'POST', headers, context.signal,
        { body: adf(`PROVA ${status}: ${summary}\nEvidence: ${evidence}`) }
      );
      return {
        status: 'success', action, externalId: key,
        url: `${this.manifest.endpoint}/browse/${encodeURIComponent(key)}`,
        message: 'Jira result traceability updated'
      };
    }
    if (action === 'create-defect') {
      return this.createDefect(input, headers, context.signal);
    }
    throw new Error(`Unsupported Jira action: ${action}`);
  }

  async dispose(): Promise<void> {}

  private async createDefect(
    input: Record<string, unknown>,
    headers: Record<string, string>,
    signal: AbortSignal
  ): Promise<IntegrationExecutionResult> {
    const project = requiredString(input, 'project', 20).toUpperCase();
    if (!PROJECT_KEY.test(project)) throw new Error('Invalid Jira project key');
    const runId = requiredString(input, 'runId', 100);
    if (!RUN_ID.test(runId)) throw new Error('Invalid Jira defect run ID');
    const summary = requiredString(input, 'summary', 255);
    const description = requiredString(input, 'description', 20_000);
    const evidence = evidenceUrl(input);
    const label = `prova-run-${runId}`;
    const jql = `project = "${project}" AND labels = "${label}" ORDER BY created DESC`;
    const search = await this.request(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=1&fields=key`,
      'GET', headers, signal
    ) as { issues?: Array<{ key?: unknown }> };
    const existing = search.issues?.[0]?.key;
    if (typeof existing === 'string' && ISSUE_KEY.test(existing)) {
      return {
        status: 'success', action: 'create-defect', externalId: existing,
        url: `${this.manifest.endpoint}/browse/${encodeURIComponent(existing)}`,
        message: 'Existing Jira defect reused'
      };
    }
    const created = await this.request('/rest/api/3/issue', 'POST', headers, signal, {
      fields: {
        project: { key: project },
        issuetype: { name: 'Bug' },
        summary,
        description: adf(`${description}\nEvidence: ${evidence}`),
        labels: ['prova', label]
      }
    }) as { key?: unknown };
    if (typeof created.key !== 'string' || !ISSUE_KEY.test(created.key)) {
      throw new Error('Jira defect response is malformed');
    }
    return {
      status: 'success', action: 'create-defect', externalId: created.key,
      url: `${this.manifest.endpoint}/browse/${encodeURIComponent(created.key)}`,
      message: 'Jira defect created'
    };
  }

  private async request(
    path: string,
    method: string,
    headers: Record<string, string>,
    signal: AbortSignal,
    body?: object
  ): Promise<unknown> {
    const response = await this.fetcher(`${this.manifest.endpoint}${path}`, {
      method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 512 * 1024) {
      throw new Error('Jira response exceeds the 512 KiB limit');
    }
    if (!response.ok) throw new Error(`Jira request failed with HTTP ${response.status}`);
    return raw ? JSON.parse(raw) : {};
  }
}
