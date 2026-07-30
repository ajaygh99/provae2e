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

type ReleaseStatus = 'passed' | 'failed' | 'blocked';

interface ReleaseNotification {
  release: string;
  environment: string;
  status: ReleaseStatus;
  summary: string;
  evidenceUrl: string;
  runId: string;
}

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/;
const STATUSES = new Set<ReleaseStatus>(['passed', 'failed', 'blocked']);

function parseNotification(input: Record<string, unknown>): ReleaseNotification {
  for (const field of ['release', 'environment', 'runId'] as const) {
    const value = input[field];
    if (typeof value !== 'string' || !SAFE_NAME.test(value)) {
      throw new Error(`Slack ${field} must be a safe 1 to 100 character identifier`);
    }
  }
  if (typeof input['status'] !== 'string' || !STATUSES.has(input['status'] as ReleaseStatus)) {
    throw new Error('Invalid Slack release status');
  }
  if (typeof input['summary'] !== 'string' || input['summary'].trim().length === 0 ||
      input['summary'].length > 2000) {
    throw new Error('Slack release summary must contain between 1 and 2000 characters');
  }
  if (typeof input['evidenceUrl'] !== 'string') {
    throw new Error('Slack evidence URL is required');
  }
  const evidence = new URL(input['evidenceUrl']);
  if (evidence.protocol !== 'https:' || evidence.username || evidence.password) {
    throw new Error('Slack evidence URL must be credential-free HTTPS');
  }
  return {
    release: input['release'] as string,
    environment: input['environment'] as string,
    status: input['status'] as ReleaseStatus,
    summary: input['summary'].trim(),
    evidenceUrl: evidence.toString(),
    runId: input['runId'] as string
  };
}

function webhook(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com' ||
      !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
      url.search || url.hash || url.username || url.password) {
    throw new Error('Slack webhook must be a credential-free hooks.slack.com services URL');
  }
  return url.toString();
}

export class SlackReleaseIntegration implements IntegrationAdapter {
  readonly manifest: IntegrationManifest = {
    contractVersion: 1,
    id: 'slack',
    owner: 'PROVA Platform',
    actions: ['notify-release'],
    secretRefs: { webhook: 'env:SLACK_RELEASE_WEBHOOK_URL' },
    timeoutMs: 10_000
  };

  constructor(private readonly fetcher: IntegrationFetch = fetch as IntegrationFetch) {}

  async initialize(): Promise<void> {}

  async health(): Promise<IntegrationHealth> {
    return {
      status: 'healthy',
      checkedAt: new Date().toISOString(),
      message: 'Slack adapter configured; webhook is verified on execution'
    };
  }

  async execute(
    action: IntegrationAction,
    input: Record<string, unknown>,
    context: IntegrationExecutionContext
  ): Promise<IntegrationExecutionResult> {
    if (action !== 'notify-release') throw new Error(`Unsupported Slack action: ${action}`);
    const notification = parseNotification(input);
    const endpoint = webhook(context.getSecret('webhook'));
    const icon = notification.status === 'passed' ? '✅' :
      notification.status === 'failed' ? '❌' : '⛔';
    const payload = {
      text: `${icon} PROVA release ${notification.release}: ${notification.status}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${icon} Release ${notification.release}* — ${notification.status.toUpperCase()}\n${notification.summary}`
          }
        },
        {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `Environment: ${notification.environment} | Run: ${notification.runId} | <${notification.evidenceUrl}|Evidence>`
          }]
        }
      ],
      metadata: {
        event_type: 'prova_release_result',
        event_payload: { run_id: notification.runId }
      }
    };
    const response = await this.fetcher(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: context.signal
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) {
      throw new Error('Slack response exceeds the 16 KiB limit');
    }
    if (!response.ok || raw.trim() !== 'ok') {
      throw new Error(`Slack notification failed with HTTP ${response.status}`);
    }
    return {
      status: 'success',
      action,
      externalId: notification.runId,
      url: notification.evidenceUrl,
      message: 'Slack release notification delivered'
    };
  }

  async dispose(): Promise<void> {}
}
