/** Slack notifications for Golden Thread deployment summaries. */
import { type GoldenThreadChain, STAGE_NAMES, type Stage } from './golden-thread-store.js';
import { log } from './logger.js';

/** A Slack message payload (Incoming Webhook / chat.postMessage compatible). */
export interface SlackMessage {
  /** Fallback/plain-text summary. */
  text: string;
  /** Optional Block Kit blocks for rich formatting. */
  blocks?: Record<string, unknown>[];
}

/** Result of attempting to deliver a Slack message. */
export interface SlackSendResult {
  /** True when Slack accepted the message. */
  ok: boolean;
  /** HTTP status code (0 when the request never completed). */
  status: number;
  /** Error description when delivery failed. */
  error?: string;
}

/**
 * Sends a formatted message to a Slack webhook URL.
 * Injected so tests can supply a mock instead of performing network calls.
 */
export type SlackSender = (webhookUrl: string, message: SlackMessage) => Promise<SlackSendResult>;

/** Outcome of {@link postGoldenThreadSummary}. */
export interface PostSummaryResult {
  /** True when a message was delivered. */
  sent: boolean;
  /** True when posting was intentionally skipped. */
  skipped: boolean;
  /** Explanation when skipped. */
  reason?: string;
  /** Underlying send result when a send was attempted. */
  result?: SlackSendResult;
}

/** Options for {@link postGoldenThreadSummary}. */
export interface PostGoldenThreadSummaryOptions {
  /** Chain to summarize. */
  chain: GoldenThreadChain;
  /** Webhook URL. Falls back to `SLACK_WEBHOOK_URL` from `env`. */
  webhookUrl?: string;
  /** Sender to use. Defaults to a fetch-based sender. */
  sender?: SlackSender;
  /** When true (default), only post if the deploy stage succeeded. */
  onlyOnSuccessfulDeploy?: boolean;
  /** Environment source for the webhook fallback. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/** Minimal fetch signature used by the default Slack sender. */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number }>;

/**
 * Determines whether a chain represents a successful deployment.
 * @param chain The Golden Thread chain
 * @returns True when the Deploy stage (5) is PASSED and not RED
 */
export function isDeploySuccessful(chain: GoldenThreadChain): boolean {
  const deploy = chain.stages.find(s => s.stage === 5);
  if (!deploy) return false;
  return deploy.status === 'PASSED' && deploy.deployment_status !== 'RED';
}

/** Returns a compact emoji indicator for a stage status. */
function statusIcon(status: string | undefined): string {
  if (status === 'PASSED') return ':white_check_mark:';
  if (status === 'FAILED') return ':x:';
  if (status === 'IN_PROGRESS') return ':hourglass_flowing_sand:';
  return ':white_circle:';
}

/**
 * Formats a Golden Thread chain into a Slack message summarizing all stages.
 * @param chain The chain to summarize
 * @returns Slack message with text fallback and Block Kit blocks
 */
export function formatGoldenThreadSummary(chain: GoldenThreadChain): SlackMessage {
  const lines: string[] = [];
  for (let stageNumber = 1; stageNumber <= 7; stageNumber++) {
    const stage = chain.stages.find(s => s.stage === stageNumber);
    const name = STAGE_NAMES[stageNumber as Stage];
    const status = stage?.status ?? 'PENDING';
    lines.push(`${statusIcon(stage?.status)} *${stageNumber}. ${name}*: ${status}`);
  }

  const deployed = isDeploySuccessful(chain);
  const headline = deployed
    ? ':rocket: Golden Thread — Deployment Successful'
    : ':warning: Golden Thread — Deployment Update';

  const text = `${headline}\nThread: ${chain.golden_thread_id}\n${lines.join('\n')}`;

  const blocks: Record<string, unknown>[] = [
    { type: 'header', text: { type: 'plain_text', text: deployed ? 'Deployment Successful' : 'Deployment Update' } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Thread:* \`${chain.golden_thread_id}\`` } },
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }
  ];

  return { text, blocks };
}

/**
 * Creates a fetch-based Slack sender.
 * @param fetchImpl Fetch implementation to use (defaults to global `fetch`)
 * @returns A {@link SlackSender} that POSTs JSON to the webhook URL
 */
export function createFetchSlackSender(fetchImpl?: FetchLike): SlackSender {
  const doFetch: FetchLike =
    fetchImpl ??
    ((input, init): Promise<{ ok: boolean; status: number }> =>
      // Global fetch returns a full Response; we only read `ok`/`status` here.
      fetch(input, init) as unknown as Promise<{ ok: boolean; status: number }>);

  return async (webhookUrl, message) => {
    try {
      const response = await doFetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });
      return {
        ok: response.ok,
        status: response.status,
        error: response.ok ? undefined : `Slack webhook returned HTTP ${response.status}`
      };
    } catch (error) {
      return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/**
 * Posts a Golden Thread summary to Slack, by default only on a successful deploy.
 * @param opts Chain, webhook, sender, and gating options
 * @returns Result describing whether the message was sent or skipped
 * @throws Error if posting is required but no webhook URL is configured
 */
export async function postGoldenThreadSummary(
  opts: PostGoldenThreadSummaryOptions
): Promise<PostSummaryResult> {
  const { chain, onlyOnSuccessfulDeploy = true } = opts;
  const env = opts.env ?? process.env;

  if (onlyOnSuccessfulDeploy && !isDeploySuccessful(chain)) {
    log.info('Skipping Slack summary: deploy not successful', { golden_thread_id: chain.golden_thread_id });
    return { sent: false, skipped: true, reason: 'Deploy stage not successful' };
  }

  const webhookUrl = opts.webhookUrl ?? env['SLACK_WEBHOOK_URL'];
  if (!webhookUrl || webhookUrl.trim().length === 0) {
    throw new Error('Slack webhook URL not configured (set SLACK_WEBHOOK_URL or pass webhookUrl)');
  }

  const sender = opts.sender ?? createFetchSlackSender();
  const message = formatGoldenThreadSummary(chain);
  const result = await sender(webhookUrl, message);

  if (!result.ok) {
    log.error('Slack summary delivery failed', new Error(result.error ?? 'unknown error'));
    return { sent: false, skipped: false, result };
  }

  log.success('Posted Golden Thread summary to Slack', { golden_thread_id: chain.golden_thread_id });
  return { sent: true, skipped: false, result };
}
