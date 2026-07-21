/**
 * JIRA Cloud REST API v3 connector for specification-driven test generation.
 */
import axios from 'axios';

/** Options accepted by {@link fetchJiraTicketDescription}. */
export interface JiraConnectorOptions {
  /** JIRA base URL, for example `https://company.atlassian.net`. */
  baseUrl: string;
  /** JIRA issue key, for example `PROJ-123`. */
  ticketKey: string;
  /** API token read by the CLI from `JIRA_API_TOKEN`. */
  apiToken?: string;
  /** OAuth2 access token. Preferred for new integrations. */
  accessToken?: string;
  /** Atlassian Cloud resource ID required for OAuth gateway requests. */
  cloudId?: string;
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
}

/** Successful or failed JIRA description fetch. */
export type JiraDescriptionResult =
  | { ok: true; ticketKey: string; description: string }
  | { ok: false; error: string };

/** Status values PROVA can synchronize to a linked JIRA issue. */
export type JiraTestStatus = 'GENERATED' | 'PASSED' | 'FAILED';

/** Options for posting a test-generation/execution status to JIRA. */
export interface JiraStatusSyncOptions extends JiraConnectorOptions {
  status: JiraTestStatus;
  details?: string;
  generatedFiles?: readonly string[];
}

/** Outcome of synchronizing a status comment to JIRA. */
export type JiraStatusSyncResult = { ok: true; ticketKey: string } | { ok: false; error: string };

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

interface JiraIssueResponse {
  fields?: {
    description?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toAdfNode(value: unknown): AdfNode | undefined {
  if (!isRecord(value)) return undefined;
  const content = Array.isArray(value['content'])
    ? value['content'].map(toAdfNode).filter((node): node is AdfNode => node !== undefined)
    : undefined;
  return {
    type: typeof value['type'] === 'string' ? value['type'] : undefined,
    text: typeof value['text'] === 'string' ? value['text'] : undefined,
    attrs: isRecord(value['attrs']) ? value['attrs'] : undefined,
    content
  };
}

function renderChildren(node: AdfNode): string {
  return (node.content ?? []).map(renderAdfNode).join('');
}

function renderListItem(node: AdfNode): string {
  return renderChildren(node).trim().replace(/\n+/g, ' ');
}

function renderAdfNode(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return node.text ?? '';
    case 'hardBreak':
      return '\n';
    case 'paragraph':
    case 'heading':
    case 'blockquote':
      return `${renderChildren(node).trim()}\n`;
    case 'bulletList':
      return `${(node.content ?? []).map((item) => `- ${renderListItem(item)}`).join('\n')}\n`;
    case 'orderedList':
      return `${(node.content ?? []).map((item, index) => `${index + 1}. ${renderListItem(item)}`).join('\n')}\n`;
    case 'mention':
    case 'status': {
      const label = node.attrs?.['text'] ?? node.attrs?.['displayName'];
      return typeof label === 'string' ? label : '';
    }
    case 'inlineCard': {
      const url = node.attrs?.['url'];
      return typeof url === 'string' ? url : '';
    }
    default:
      return renderChildren(node);
  }
}

/**
 * Converts a JIRA plain-text or Atlassian Document Format description to text.
 * ADF bullet and ordered lists retain Markdown-style markers so the shared
 * acceptance-criteria parser can recognize them.
 *
 * @param description - JIRA `fields.description` value.
 * @returns Plain text, or an empty string when no usable description exists.
 */
export function jiraDescriptionToText(description: unknown): string {
  if (typeof description === 'string') return description.trim();
  const root = toAdfNode(description);
  if (!root) return '';
  return renderAdfNode(root).replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeBaseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.href.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function redactToken(message: string, token: string): string {
  return message.split(token).join('[REDACTED]');
}

function authentication(options: JiraConnectorOptions): { token?: string; error?: string } {
  const token = options.accessToken?.trim() || options.apiToken?.trim();
  if (!token) return { error: 'JIRA_OAUTH_ACCESS_TOKEN or JIRA_API_TOKEN is required' };
  if (options.accessToken && !options.cloudId) return { error: 'JIRA cloudId is required with OAuth2 access tokens' };
  return { token };
}

function apiRoot(baseUrl: string, options: JiraConnectorOptions): string {
  return options.accessToken && options.cloudId
    ? `https://api.atlassian.com/ex/jira/${encodeURIComponent(options.cloudId)}`
    : baseUrl;
}

function safeError(error: unknown, ticketKey: string, token: string, operation: string): JiraStatusSyncResult {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401 || status === 403) return { ok: false, error: `JIRA authentication failed (${status}). Check OAuth/API token permissions.` };
    if (status === 404) return { ok: false, error: `JIRA ticket ${ticketKey} was not found (404)` };
  }
  const message = redactToken(error instanceof Error ? error.message : String(error), token);
  return { ok: false, error: `Unable to ${operation} JIRA ticket ${ticketKey}: ${message}` };
}

/**
 * Fetches a JIRA issue through REST API v3 and returns its description as text.
 * The token is used only in the Authorization header and is redacted from any
 * operational error returned to callers.
 *
 * @param options - JIRA URL, issue key, token, and optional timeout.
 * @returns Plain-text ticket description or a safe, actionable failure.
 */
export async function fetchJiraTicketDescription(options: JiraConnectorOptions): Promise<JiraDescriptionResult> {
  const ticketKey = options.ticketKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(ticketKey)) {
    return { ok: false, error: `Invalid JIRA ticket key "${options.ticketKey}" (expected format PROJ-123)` };
  }
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) {
    return { ok: false, error: `Invalid JIRA base URL "${options.baseUrl}": use an http:// or https:// URL` };
  }
  const auth = authentication(options);
  if (!auth.token) return { ok: false, error: auth.error ?? 'JIRA authentication is required' };

  try {
    const response = await axios.get<JiraIssueResponse>(
      `${apiRoot(baseUrl, options)}/rest/api/3/issue/${encodeURIComponent(ticketKey)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${auth.token}`
        },
        params: { fields: 'description' },
        timeout: options.timeoutMs ?? 30000
      }
    );
    const description = jiraDescriptionToText(response.data.fields?.description);
    if (!description) {
      return { ok: false, error: `JIRA ticket ${ticketKey} has no description` };
    }
    return { ok: true, ticketKey, description };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        return { ok: false, error: `JIRA authentication failed (${status}). Check OAuth/API token permissions.` };
      }
      if (status === 404) {
        return { ok: false, error: `JIRA ticket ${ticketKey} was not found (404)` };
      }
    }
    const message = redactToken(err instanceof Error ? err.message : String(err), auth.token);
    return { ok: false, error: `Unable to fetch JIRA ticket ${ticketKey}: ${message}` };
  }
}

/** Posts an ADF comment linking generated or executed tests back to their JIRA issue. */
export async function syncJiraTestStatus(options: JiraStatusSyncOptions): Promise<JiraStatusSyncResult> {
  const ticketKey = options.ticketKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(ticketKey)) return { ok: false, error: `Invalid JIRA ticket key "${options.ticketKey}" (expected format PROJ-123)` };
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) return { ok: false, error: `Invalid JIRA base URL "${options.baseUrl}": use an http:// or https:// URL` };
  const auth = authentication(options);
  if (!auth.token) return { ok: false, error: auth.error ?? 'JIRA authentication is required' };
  const fileText = options.generatedFiles?.length ? ` Files: ${options.generatedFiles.join(', ')}.` : '';
  const detailText = options.details?.trim() ? ` ${options.details.trim()}` : '';
  const text = `PROVA test status: ${options.status}.${fileText}${detailText}`;
  try {
    await axios.post(
      `${apiRoot(baseUrl, options)}/rest/api/3/issue/${encodeURIComponent(ticketKey)}/comment`,
      { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } },
      { headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, timeout: options.timeoutMs ?? 30000 }
    );
    return { ok: true, ticketKey };
  } catch (error) {
    return safeError(error, ticketKey, auth.token, 'sync status to');
  }
}
