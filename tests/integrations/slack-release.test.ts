import { SlackReleaseIntegration } from '../../src/integrations/slack-release';
import type { IntegrationFetch } from '../../src/integrations/github-checks';
import type { IntegrationExecutionContext } from '../../src/integrations/integration-registry';

const input = {
  release: 'v0.3.5-beta.1',
  environment: 'staging',
  status: 'passed',
  summary: 'All release gates passed',
  evidenceUrl: 'https://github.com/ajaygh99/provae2e/actions/runs/309',
  runId: 'release-309'
};

function context(secret = 'https://hooks.slack.com/services/T1/B2/runtime-secret'): IntegrationExecutionContext {
  return { signal: new AbortController().signal, getSecret: () => secret };
}

describe('Slack release integration', () => {
  it('posts a bounded release notification with an idempotency marker', async () => {
    let request: { url: string; body?: string; signal?: AbortSignal } | undefined;
    const fetcher: IntegrationFetch = jest.fn(async (url, init) => {
      request = { url, body: init.body, signal: init.signal };
      return { ok: true, status: 200, text: async () => 'ok' };
    });
    const result = await new SlackReleaseIntegration(fetcher)
      .execute('notify-release', input, context());
    expect(result).toMatchObject({
      status: 'success', externalId: 'release-309', url: input.evidenceUrl
    });
    const payload = JSON.parse(request?.body ?? '{}');
    expect(payload.metadata.event_payload.run_id).toBe('release-309');
    expect(payload.blocks[1].elements[0].text).toContain('Evidence');
    expect(request?.signal).toBeDefined();
  });

  it('rejects non-Slack and credential-bearing webhook URLs', async () => {
    const integration = new SlackReleaseIntegration(jest.fn());
    await expect(integration.execute('notify-release', input, context(
      'https://example.test/services/T/B/S'
    ))).rejects.toThrow('hooks.slack.com');
    await expect(integration.execute('notify-release', input, context(
      'https://user:secret@hooks.slack.com/services/T/B/S'
    ))).rejects.toThrow('credential-free');
  });

  it('rejects unsafe release inputs before delivery', async () => {
    const fetcher: IntegrationFetch = jest.fn();
    const integration = new SlackReleaseIntegration(fetcher);
    await expect(integration.execute('notify-release', {
      ...input, runId: '../unsafe'
    }, context())).rejects.toThrow('runId');
    await expect(integration.execute('notify-release', {
      ...input, evidenceUrl: 'http://example.test/evidence'
    }, context())).rejects.toThrow('HTTPS');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds failures without returning webhook content', async () => {
    const fetcher: IntegrationFetch = jest.fn(async () => ({
      ok: false, status: 429, text: async () => 'runtime-secret rate limited'
    }));
    await expect(new SlackReleaseIntegration(fetcher).execute(
      'notify-release', input, context()
    )).rejects.toThrow('HTTP 429');
    await expect(new SlackReleaseIntegration(async () => ({
      ok: true, status: 200, text: async (): Promise<string> => 'x'.repeat(20_000)
    })).execute('notify-release', input, context())).rejects.toThrow('16 KiB');
  });
});
