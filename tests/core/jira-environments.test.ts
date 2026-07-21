import { parseJiraEnvironments, resolveJiraEnvironment } from '../../src/core/jira-environments';

describe('JIRA environments', () => {
  const json = JSON.stringify({
    dev: { baseUrl: 'https://dev.atlassian.net/', cloudId: 'cloud-dev' },
    staging: { baseUrl: 'https://staging.atlassian.net' }
  });

  it('parses multiple named instances and normalizes trailing slashes', () => {
    expect(parseJiraEnvironments(json)).toEqual({
      dev: { baseUrl: 'https://dev.atlassian.net', cloudId: 'cloud-dev' },
      staging: { baseUrl: 'https://staging.atlassian.net', cloudId: undefined }
    });
  });

  it.each(['{bad', '[]', 'null'])('rejects invalid environment JSON %s', (value) => {
    expect(() => parseJiraEnvironments(value)).toThrow('JIRA_ENVIRONMENTS');
  });

  it.each([
    JSON.stringify({ dev: 'url' }),
    JSON.stringify({ dev: { baseUrl: 'not-url' } }),
    JSON.stringify({ dev: { baseUrl: 'https://user:pass@example.com' } }),
    JSON.stringify({ dev: { baseUrl: 'https://example.com', cloudId: '' } })
  ])('rejects malformed instance configuration %#', (value) => {
    expect(() => parseJiraEnvironments(value)).toThrow('environment "dev"');
  });

  it('resolves an existing environment', () => {
    expect(resolveJiraEnvironment(parseJiraEnvironments(json), 'dev').cloudId).toBe('cloud-dev');
  });

  it('lists available environments when a name is unknown', () => {
    expect(() => resolveJiraEnvironment(parseJiraEnvironments(json), 'prod')).toThrow('Available: dev, staging');
  });
});
