import axios from 'axios';
import {
  fetchJiraTicketDescription,
  jiraDescriptionToText
} from '../../src/core/jira-connector';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function axiosFailure(status: number, message = `Request failed with status ${status}`): Error & {
  isAxiosError: boolean;
  response: { status: number };
} {
  return Object.assign(new Error(message), { isAxiosError: true, response: { status } });
}

describe('jiraDescriptionToText', () => {
  it('returns a trimmed plain-text description unchanged', () => {
    expect(jiraDescriptionToText('  - Criterion one\n- Criterion two  ')).toBe('- Criterion one\n- Criterion two');
  });

  it('converts ADF paragraphs, bullet lists, ordered lists, and hard breaks to parser-friendly text', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Acceptance Criteria' }]
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Login succeeds' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Error is visible' }] }] }
          ]
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open page' }, { type: 'hardBreak' }, { type: 'text', text: 'Submit form' }] }]
            }
          ]
        }
      ]
    };

    expect(jiraDescriptionToText(adf)).toBe(
      'Acceptance Criteria\n- Login succeeds\n- Error is visible\n1. Open page Submit form'
    );
  });

  it('renders common inline ADF nodes and safely ignores malformed values', () => {
    const adf = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { displayName: 'Ada' } },
          { type: 'text', text: ' marked this ' },
          { type: 'status', attrs: { text: 'Done' } },
          { type: 'text', text: ' at ' },
          { type: 'inlineCard', attrs: { url: 'https://example.com/ticket' } },
          { type: 'unsupported', content: [{ type: 'text', text: ' safely' }] }
        ]
      }]
    };

    expect(jiraDescriptionToText(adf)).toBe('Ada marked this Done at https://example.com/ticket safely');
    expect(jiraDescriptionToText(null)).toBe('');
    expect(jiraDescriptionToText([])).toBe('');
  });
});

describe('fetchJiraTicketDescription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): error is never => Boolean((error as { isAxiosError?: boolean })?.isAxiosError)
    );
  });

  it('fetches a ticket through REST API v3 and returns its plain description', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { fields: { description: '- User can sign in' } } });

    const result = await fetchJiraTicketDescription({
      baseUrl: 'https://company.atlassian.net/',
      ticketKey: 'proj-123',
      apiToken: 'unit-test-token',
      timeoutMs: 5000
    });

    expect(result).toEqual({ ok: true, ticketKey: 'PROJ-123', description: '- User can sign in' });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://company.atlassian.net/rest/api/3/issue/PROJ-123',
      {
        headers: { Accept: 'application/json', Authorization: 'Bearer unit-test-token' },
        params: { fields: 'description' },
        timeout: 5000
      }
    );
  });

  it('returns an ADF description as parser-friendly plain text', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        fields: {
          description: {
            type: 'doc',
            version: 1,
            content: [{
              type: 'bulletList',
              content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'API returns 200' }] }] }]
            }]
          }
        }
      }
    });

    const result = await fetchJiraTicketDescription({
      baseUrl: 'https://company.atlassian.net',
      ticketKey: 'PROJ-9',
      apiToken: 'unit-test-token'
    });

    expect(result).toEqual({ ok: true, ticketKey: 'PROJ-9', description: '- API returns 200' });
  });

  it.each([401, 403])('returns a safe authentication error for HTTP %s', async (status) => {
    mockedAxios.get.mockRejectedValueOnce(axiosFailure(status));
    const result = await fetchJiraTicketDescription({
      baseUrl: 'https://company.atlassian.net',
      ticketKey: 'PROJ-1',
      apiToken: 'unit-test-token'
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(`authentication failed (${status})`);
    expect(!result.ok && result.error).not.toContain('unit-test-token');
  });

  it('returns a not-found error for HTTP 404', async () => {
    mockedAxios.get.mockRejectedValueOnce(axiosFailure(404));
    const result = await fetchJiraTicketDescription({
      baseUrl: 'https://company.atlassian.net',
      ticketKey: 'PROJ-404',
      apiToken: 'unit-test-token'
    });
    expect(result).toEqual({ ok: false, error: 'JIRA ticket PROJ-404 was not found (404)' });
  });

  it('returns a clear error when the ticket has no description', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { fields: { description: null } } });
    const result = await fetchJiraTicketDescription({
      baseUrl: 'https://company.atlassian.net',
      ticketKey: 'PROJ-2',
      apiToken: 'unit-test-token'
    });
    expect(result).toEqual({ ok: false, error: 'JIRA ticket PROJ-2 has no description' });
  });

  it('handles network errors and redacts the token', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('connect failed with unit-test-token'));
    const result = await fetchJiraTicketDescription({
      baseUrl: 'https://company.atlassian.net',
      ticketKey: 'PROJ-3',
      apiToken: 'unit-test-token'
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('Unable to fetch JIRA ticket PROJ-3');
    expect(!result.ok && result.error).toContain('[REDACTED]');
    expect(!result.ok && result.error).not.toContain('unit-test-token');
  });

  it('rejects invalid ticket keys, base URLs, and missing tokens before making a request', async () => {
    const badKey = await fetchJiraTicketDescription({ baseUrl: 'https://company.atlassian.net', ticketKey: 'bad', apiToken: 'x' });
    const badUrl = await fetchJiraTicketDescription({ baseUrl: 'not-a-url', ticketKey: 'PROJ-1', apiToken: 'x' });
    const credentialUrl = await fetchJiraTicketDescription({ baseUrl: 'https://user:password@company.atlassian.net', ticketKey: 'PROJ-1', apiToken: 'x' });
    const noToken = await fetchJiraTicketDescription({ baseUrl: 'https://company.atlassian.net', ticketKey: 'PROJ-1', apiToken: ' ' });
    expect(!badKey.ok && badKey.error).toContain('Invalid JIRA ticket key');
    expect(!badUrl.ok && badUrl.error).toContain('Invalid JIRA base URL');
    expect(!credentialUrl.ok && credentialUrl.error).toContain('Invalid JIRA base URL');
    expect(!noToken.ok && noToken.error).toContain('JIRA_API_TOKEN');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
