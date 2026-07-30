import { GitHubChecksIntegration, type IntegrationFetch } from '../../src/integrations/github-checks';
import type { IntegrationExecutionContext } from '../../src/integrations/integration-registry';

const input = {
  owner: 'ajaygh99',
  repository: 'provae2e',
  sha: 'abcdef1234567',
  name: 'PROVA validation',
  status: 'completed',
  conclusion: 'success',
  evidenceUrl: 'https://github.com/ajaygh99/provae2e/actions/runs/123',
  summary: 'All deterministic gates passed'
};

function context(signal = new AbortController().signal): IntegrationExecutionContext {
  return { signal, getSecret: () => 'github_pat_runtime_secret' };
}

describe('GitHub checks integration', () => {
  it('creates a check-run with Bearer auth and evidence', async () => {
    let request: { url: string; method: string; authorization: string; body?: string } | undefined;
    const fetcher: IntegrationFetch = jest.fn(async (url, init) => {
      request = {
        url, method: init.method, authorization: init.headers.authorization, body: init.body
      };
      return {
        ok: true, status: 201,
        text: async () => JSON.stringify({ id: 307, html_url: 'https://github.com/checks/307' })
      };
    });
    const result = await new GitHubChecksIntegration(fetcher)
      .execute('publish-check', input, context());
    expect(result).toMatchObject({
      status: 'success', externalId: '307', url: 'https://github.com/checks/307'
    });
    expect(request).toMatchObject({
      url: 'https://api.github.com/repos/ajaygh99/provae2e/check-runs',
      method: 'POST',
      authorization: 'Bearer github_pat_runtime_secret'
    });
    expect(JSON.parse(request?.body ?? '{}').details_url).toBe(input.evidenceUrl);
  });

  it('updates an external check ID for retry-safe evidence linking', async () => {
    const fetcher: IntegrationFetch = jest.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ id: 307, html_url: 'https://github.com/checks/307' })
    }));
    await new GitHubChecksIntegration(fetcher).execute(
      'link-evidence', { ...input, checkRunId: 307 }, context()
    );
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/check-runs/307'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('rejects unsafe and inconsistent inputs before network access', async () => {
    const fetcher: IntegrationFetch = jest.fn();
    const integration = new GitHubChecksIntegration(fetcher);
    await expect(integration.execute('publish-check', {
      ...input, owner: '../unsafe'
    }, context())).rejects.toThrow('safe slugs');
    await expect(integration.execute('publish-check', {
      ...input, status: 'queued', conclusion: 'success'
    }, context())).rejects.toThrow('Only completed');
    await expect(integration.execute('link-evidence', input, context()))
      .rejects.toThrow('check run ID');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds provider errors without exposing the token', async () => {
    const fetcher: IntegrationFetch = jest.fn(async () => ({
      ok: false, status: 403, text: async () => 'token rejected'
    }));
    await expect(new GitHubChecksIntegration(fetcher).execute(
      'publish-check', input, context()
    )).rejects.toThrow('HTTP 403');
    await expect(new GitHubChecksIntegration(async () => ({
      ok: true, status: 200, text: async (): Promise<string> => 'x'.repeat(300_000)
    })).execute('publish-check', input, context())).rejects.toThrow('256 KiB');
  });

  it('passes the registry abort signal to fetch', async () => {
    const controller = new AbortController();
    const fetcher: IntegrationFetch = jest.fn(async (_url, init) => {
      expect(init.signal).toBe(controller.signal);
      return {
        ok: true, status: 201,
        text: async () => JSON.stringify({ id: 1, html_url: 'https://github.com/checks/1' })
      };
    });
    await new GitHubChecksIntegration(fetcher).execute('publish-check', input, context(controller.signal));
  });
});
