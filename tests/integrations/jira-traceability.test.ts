import { JiraTraceabilityIntegration } from '../../src/integrations/jira-traceability';
import type { IntegrationFetch } from '../../src/integrations/github-checks';
import type { IntegrationExecutionContext } from '../../src/integrations/integration-registry';

const context: IntegrationExecutionContext = {
  signal: new AbortController().signal,
  getSecret: () => 'jira-runtime-secret'
};

describe('Jira traceability integration', () => {
  it('ingests bounded requirement text from ADF', async () => {
    const fetcher: IntegrationFetch = jest.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({
        key: 'PROVA-36',
        fields: {
          summary: 'Checkout requirement',
          description: {
            type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Must pay' }] }]
          }
        }
      })
    }));
    const result = await new JiraTraceabilityIntegration(
      'https://prova.atlassian.net', fetcher
    ).execute('ingest-requirement', { issueKey: 'prova-36' }, context);
    expect(result).toMatchObject({ externalId: 'PROVA-36', status: 'success' });
    expect(JSON.parse(result.message ?? '{}')).toEqual({
      summary: 'Checkout requirement', description: 'Must pay'
    });
  });

  it('posts result evidence using runtime Bearer authentication', async () => {
    let request: { authorization: string; body?: string; signal?: AbortSignal } | undefined;
    const fetcher: IntegrationFetch = jest.fn(async (_url, init) => {
      request = {
        authorization: init.headers.authorization,
        body: init.body,
        signal: init.signal
      };
      return { ok: true, status: 201, text: async () => '{}' };
    });
    await new JiraTraceabilityIntegration('https://prova.atlassian.net/', fetcher)
      .execute('sync-result', {
        issueKey: 'PROVA-36',
        status: 'PASSED',
        summary: 'Native validation passed',
        evidenceUrl: 'https://github.com/ajaygh99/provae2e/actions/runs/36'
      }, context);
    expect(request?.authorization).toBe('Bearer jira-runtime-secret');
    expect(request?.signal).toBe(context.signal);
    expect(request?.body).toContain('Evidence: https://github.com/');
  });

  it('reuses an existing run-labelled defect idempotently', async () => {
    const fetcher: IntegrationFetch = jest.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ issues: [{ key: 'PROVA-99' }] })
    }));
    const result = await new JiraTraceabilityIntegration(
      'https://prova.atlassian.net', fetcher
    ).execute('create-defect', {
      project: 'PROVA',
      runId: 'run-36',
      summary: 'Checkout failed',
      description: 'Payment button did not respond',
      evidenceUrl: 'https://example.test/evidence/36'
    }, context);
    expect(result).toMatchObject({
      externalId: 'PROVA-99', message: 'Existing Jira defect reused'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('creates a defect when no idempotency match exists', async () => {
    const responses = [
      { issues: [] },
      { key: 'PROVA-100' }
    ];
    const fetcher: IntegrationFetch = jest.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify(responses.shift())
    }));
    const result = await new JiraTraceabilityIntegration(
      'https://prova.atlassian.net', fetcher
    ).execute('create-defect', {
      project: 'PROVA', runId: 'run-37', summary: 'Failure',
      description: 'Observed deterministic failure',
      evidenceUrl: 'https://example.test/evidence/37'
    }, context);
    expect(result.externalId).toBe('PROVA-100');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects unsafe inputs and bounds provider failures', async () => {
    expect(() => new JiraTraceabilityIntegration('http://prova.atlassian.net'))
      .toThrow('HTTPS');
    const fetcher: IntegrationFetch = jest.fn(async () => ({
      ok: false, status: 403, text: async () => 'jira-runtime-secret denied'
    }));
    const integration = new JiraTraceabilityIntegration('https://prova.atlassian.net', fetcher);
    await expect(integration.execute('ingest-requirement', {
      issueKey: '../unsafe'
    }, context)).rejects.toThrow('issue key');
    await expect(integration.execute('ingest-requirement', {
      issueKey: 'PROVA-36'
    }, context)).rejects.toThrow('HTTP 403');
  });
});
