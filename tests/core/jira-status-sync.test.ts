import axios from 'axios';
import { fetchJiraTicketDescription, syncJiraTestStatus } from '../../src/core/jira-connector';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('JIRA OAuth API and status sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.isAxiosError.mockReturnValue(false);
  });

  it('routes OAuth issue reads through the Atlassian cloud gateway', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { fields: { description: '- Login works' } } });
    await fetchJiraTicketDescription({ baseUrl: 'https://site.atlassian.net', cloudId: 'cloud/one', ticketKey: 'APP-1', accessToken: 'oauth-token' });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.atlassian.com/ex/jira/cloud%2Fone/rest/api/3/issue/APP-1',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer oauth-token' }) })
    );
  });

  it('requires cloudId for OAuth access tokens', async () => {
    const result = await fetchJiraTicketDescription({ baseUrl: 'https://site.atlassian.net', ticketKey: 'APP-1', accessToken: 'oauth-token' });
    expect(result).toEqual({ ok: false, error: 'JIRA cloudId is required with OAuth2 access tokens' });
  });

  it('posts generated status and linked files as an ADF comment', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { id: '10' } });
    const result = await syncJiraTestStatus({
      baseUrl: 'https://site.atlassian.net', cloudId: 'cloud-1', ticketKey: 'app-9', accessToken: 'oauth-token',
      status: 'GENERATED', generatedFiles: ['browser-001.spec.ts'], details: '1 criterion generated.'
    });
    expect(result).toEqual({ ok: true, ticketKey: 'APP-9' });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue/APP-9/comment',
      expect.objectContaining({ body: expect.objectContaining({ type: 'doc' }) }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer oauth-token' }) })
    );
    expect(JSON.stringify(mockedAxios.post.mock.calls[0][1])).toContain('browser-001.spec.ts');
  });

  it.each(['PASSED', 'FAILED'] as const)('syncs %s test status', async (status) => {
    mockedAxios.post.mockResolvedValueOnce({ data: {} });
    await syncJiraTestStatus({ baseUrl: 'https://site.atlassian.net', ticketKey: 'APP-2', apiToken: 'token', status });
    expect(JSON.stringify(mockedAxios.post.mock.calls[0][1])).toContain(status);
  });

  it('validates sync inputs before calling JIRA', async () => {
    const badKey = await syncJiraTestStatus({ baseUrl: 'https://site.atlassian.net', ticketKey: 'bad', apiToken: 'token', status: 'FAILED' });
    const noAuth = await syncJiraTestStatus({ baseUrl: 'https://site.atlassian.net', ticketKey: 'APP-1', status: 'FAILED' });
    expect(badKey.ok).toBe(false);
    expect(noAuth.ok).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('returns safe errors without leaking OAuth tokens', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('failure oauth-secret'));
    const result = await syncJiraTestStatus({
      baseUrl: 'https://site.atlassian.net', cloudId: 'cloud-1', ticketKey: 'APP-1', accessToken: 'oauth-secret', status: 'FAILED'
    });
    expect(!result.ok && result.error).toContain('[REDACTED]');
    expect(!result.ok && result.error).not.toContain('oauth-secret');
  });
});
