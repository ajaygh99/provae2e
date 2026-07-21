import axios from 'axios';
import {
  buildJiraAuthorizationUrl,
  exchangeJiraAuthorizationCode,
  refreshJiraAccessToken
} from '../../src/core/jira-oauth';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const client = { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'https://app.example.com/oauth/callback' };

describe('JIRA OAuth2', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds an Atlassian authorization URL with required protections', () => {
    const url = new URL(buildJiraAuthorizationUrl(client, 'random-state'));
    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(url.searchParams.get('state')).toBe('random-state');
    expect(url.searchParams.get('scope')).toContain('offline_access');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('supports caller-selected scopes', () => {
    const url = new URL(buildJiraAuthorizationUrl(client, 'state', ['read:jira-work']));
    expect(url.searchParams.get('scope')).toBe('read:jira-work');
  });

  it.each([['', 'state', 'clientId'], ['client', '', 'state']])(
    'rejects missing authorization input', (clientId, state, message) => {
      expect(() => buildJiraAuthorizationUrl({ clientId, redirectUri: client.redirectUri }, state)).toThrow(message);
    }
  );

  it('exchanges an authorization code without returning the client secret', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'read:jira-work' } });
    await expect(exchangeJiraAuthorizationCode(client, 'code-1')).resolves.toEqual({
      accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600, scope: 'read:jira-work'
    });
    expect(mockedAxios.post).toHaveBeenCalledWith('https://auth.atlassian.com/oauth/token',
      expect.objectContaining({ grant_type: 'authorization_code', code: 'code-1' }), expect.any(Object));
  });

  it('refreshes OAuth tokens using rotating refresh-token flow', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 } });
    await expect(refreshJiraAccessToken(client, 'old-refresh')).resolves.toEqual({
      accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 7200, scope: undefined
    });
    expect(mockedAxios.post).toHaveBeenCalledWith('https://auth.atlassian.com/oauth/token',
      expect.objectContaining({ grant_type: 'refresh_token', refresh_token: 'old-refresh' }), expect.any(Object));
  });

  it.each([
    [{ ...client, clientId: '' }, 'clientId'],
    [{ ...client, clientSecret: '' }, 'clientSecret'],
    [{ ...client, redirectUri: 'ftp://bad' }, 'redirectUri']
  ])('rejects invalid client configuration', async (invalidClient, message) => {
    await expect(exchangeJiraAuthorizationCode(invalidClient, 'code')).rejects.toThrow(message);
  });

  it('rejects empty authorization and refresh tokens', async () => {
    await expect(exchangeJiraAuthorizationCode(client, ' ')).rejects.toThrow('authorization code');
    await expect(refreshJiraAccessToken(client, ' ')).rejects.toThrow('refresh token');
  });

  it.each([
    {},
    { access_token: 'access' },
    { access_token: 'access', expires_in: 0 }
  ])('rejects incomplete token response %#', async (data) => {
    mockedAxios.post.mockResolvedValueOnce({ data });
    await expect(exchangeJiraAuthorizationCode(client, 'code')).rejects.toThrow('incomplete');
  });
});
