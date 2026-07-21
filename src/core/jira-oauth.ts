import axios from 'axios';

const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';

/** OAuth2 application settings for Atlassian authorization-code flow. */
export interface JiraOAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Tokens returned by Atlassian OAuth2. */
export interface JiraOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

function validateClient(client: JiraOAuthClient): void {
  if (!client.clientId.trim()) throw new Error('JIRA OAuth clientId is required');
  if (!client.clientSecret.trim()) throw new Error('JIRA OAuth clientSecret is required');
  try {
    const redirect = new URL(client.redirectUri);
    if (redirect.protocol !== 'http:' && redirect.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('JIRA OAuth redirectUri must be an absolute HTTP(S) URL');
  }
}

/** Builds Atlassian's user-consent URL with state protection and offline access. */
export function buildJiraAuthorizationUrl(
  client: Pick<JiraOAuthClient, 'clientId' | 'redirectUri'>,
  state: string,
  scopes: readonly string[] = ['read:jira-work', 'write:jira-work', 'offline_access']
): string {
  if (!client.clientId.trim()) throw new Error('JIRA OAuth clientId is required');
  if (!state.trim()) throw new Error('JIRA OAuth state is required');
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    audience: 'api.atlassian.com', client_id: client.clientId, scope: scopes.join(' '),
    redirect_uri: client.redirectUri, state, response_type: 'code', prompt: 'consent'
  }).toString();
  return url.toString();
}

function toTokens(data: TokenResponse): JiraOAuthTokens {
  const expiresIn = data.expires_in;
  if (!data.access_token || !Number.isInteger(expiresIn) || expiresIn === undefined || expiresIn <= 0) {
    throw new Error('JIRA OAuth token response was incomplete');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn,
    scope: data.scope
  };
}

/** Exchanges an OAuth authorization code for access and refresh tokens. */
export async function exchangeJiraAuthorizationCode(client: JiraOAuthClient, code: string): Promise<JiraOAuthTokens> {
  validateClient(client);
  if (!code.trim()) throw new Error('JIRA OAuth authorization code is required');
  const response = await axios.post<TokenResponse>(TOKEN_URL, {
    grant_type: 'authorization_code', client_id: client.clientId, client_secret: client.clientSecret,
    code, redirect_uri: client.redirectUri
  }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
  return toTokens(response.data);
}

/** Uses a rotating refresh token to obtain a new Atlassian access token. */
export async function refreshJiraAccessToken(client: JiraOAuthClient, refreshToken: string): Promise<JiraOAuthTokens> {
  validateClient(client);
  if (!refreshToken.trim()) throw new Error('JIRA OAuth refresh token is required');
  const response = await axios.post<TokenResponse>(TOKEN_URL, {
    grant_type: 'refresh_token', client_id: client.clientId, client_secret: client.clientSecret,
    refresh_token: refreshToken
  }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
  return toTokens(response.data);
}
