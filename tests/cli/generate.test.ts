import { buildProgram, generateCommand, type GenerateActionOptions } from '../../src/cli/run';
import { generateTestsFromSpec } from '../../src/generators/spec-test-generator';
import { fetchJiraTicketDescription } from '../../src/core/jira-connector';
import { generateTestDataFromFile } from '../../src/core/test-data-factory';

jest.mock('../../src/generators/spec-test-generator', () => ({
  generateTestsFromSpec: jest.fn()
}));
jest.mock('../../src/core/jira-connector', () => ({
  fetchJiraTicketDescription: jest.fn()
}));
jest.mock('../../src/core/test-data-factory', () => ({
  generateTestDataFromFile: jest.fn()
}));

const mockGenerate = generateTestsFromSpec as jest.MockedFunction<typeof generateTestsFromSpec>;
const mockFetchJira = fetchJiraTicketDescription as jest.MockedFunction<typeof fetchJiraTicketDescription>;
const mockGenerateData = generateTestDataFromFile as jest.MockedFunction<typeof generateTestDataFromFile>;

function options(overrides: Partial<GenerateActionOptions> = {}): GenerateActionOptions {
  return {
    spec: 'ticket.md',
    type: 'browser',
    url: 'https://example.com',
    output: './generated-tests',
    ...overrides
  };
}

describe('generateCommand', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    delete process.env['JIRA_API_TOKEN'];
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = undefined;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('passes CLI options to the generator and reports generated files', async () => {
    mockGenerate.mockResolvedValueOnce({
      ok: true,
      criteria: ['Login works'],
      files: ['/tmp/generated/browser-001-login-works.spec.ts']
    });

    await generateCommand(options({ type: 'browser', output: './custom-output' }));

    expect(mockGenerate).toHaveBeenCalledWith({
      specFile: 'ticket.md',
      specText: undefined,
      sourceLabel: undefined,
      type: 'browser',
      url: 'https://example.com',
      outputDir: './custom-output',
      requestBody: undefined
    });
    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('AI test generation complete'));
  });

  it('prints a concise error and sets exit code 1 on generation failure', async () => {
    mockGenerate.mockResolvedValueOnce({ ok: false, error: 'Spec is empty: ticket.md' });

    await generateCommand(options());

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Spec is empty'));
  });

  it('fetches JIRA text with the environment token and feeds it to the shared generator', async () => {
    process.env['JIRA_API_TOKEN'] = 'unit-test-token';
    mockFetchJira.mockResolvedValueOnce({
      ok: true,
      ticketKey: 'PROJ-123',
      description: '- User can sign in'
    });
    mockGenerate.mockResolvedValueOnce({
      ok: true,
      criteria: ['User can sign in'],
      files: ['/tmp/generated/browser-001-user-can-sign-in.spec.ts']
    });

    await generateCommand(options({ spec: undefined, jiraTicket: 'PROJ-123', jiraUrl: 'https://company.atlassian.net' }));

    expect(mockFetchJira).toHaveBeenCalledWith({
      baseUrl: 'https://company.atlassian.net',
      ticketKey: 'PROJ-123',
      apiToken: 'unit-test-token'
    });
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
      specFile: undefined,
      specText: '- User can sign in',
      sourceLabel: 'JIRA ticket PROJ-123'
    }));
    expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining('unit-test-token'));
    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('unit-test-token'));
  });

  it('requires exactly one of --spec and --jira-ticket', async () => {
    await generateCommand(options({ spec: undefined, jiraTicket: undefined }));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('exactly one source'));

    process.exitCode = undefined;
    await generateCommand(options({ spec: 'ticket.md', jiraTicket: 'PROJ-1', jiraUrl: 'https://company.atlassian.net' }));
    expect(process.exitCode).toBe(1);
    expect(mockFetchJira).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('requires --jira-url and JIRA_API_TOKEN for a JIRA source', async () => {
    await generateCommand(options({ spec: undefined, jiraTicket: 'PROJ-1', jiraUrl: undefined }));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('--jira-url'));

    process.exitCode = undefined;
    await generateCommand(options({ spec: undefined, jiraTicket: 'PROJ-1', jiraUrl: 'https://company.atlassian.net' }));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('JIRA_API_TOKEN'));
  });

  it('reports connector failures without calling Ollama generation or leaking the token', async () => {
    process.env['JIRA_API_TOKEN'] = 'unit-test-token';
    mockFetchJira.mockResolvedValueOnce({
      ok: false,
      error: 'JIRA authentication failed (401). Check JIRA_API_TOKEN permissions.'
    });

    await generateCommand(options({ spec: undefined, jiraTicket: 'PROJ-1', jiraUrl: 'https://company.atlassian.net' }));

    expect(process.exitCode).toBe(1);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('unit-test-token'));
  });

  it('populates an API generation request body from --schema', async () => {
    mockGenerateData.mockResolvedValueOnce({ ok: true, data: { email: 'user@example.com' } });
    mockGenerate.mockResolvedValueOnce({ ok: true, criteria: ['Create user'], files: ['api.spec.ts'] });
    await generateCommand(options({ type: 'api', schema: 'user-schema.json' }));
    expect(mockGenerateData).toHaveBeenCalledWith('user-schema.json');
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { email: 'user@example.com' } }));
  });

  it('rejects --schema for browser generation and reports factory failures', async () => {
    await generateCommand(options({ type: 'browser', schema: 'user-schema.json' }));
    expect(process.exitCode).toBe(1);
    expect(mockGenerateData).not.toHaveBeenCalled();

    process.exitCode = undefined;
    mockGenerateData.mockResolvedValueOnce({ ok: false, error: 'Schema file is not valid JSON: broken.json' });
    await generateCommand(options({ type: 'api', schema: 'broken.json' }));
    expect(process.exitCode).toBe(1);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe('generate CLI registration', () => {
  it('exposes the documented required flags and output option', () => {
    const command = buildProgram().commands.find((candidate) => candidate.name() === 'generate');
    expect(command).toBeDefined();
    expect(command?.options.map((option) => option.long)).toEqual([
      '--spec',
      '--jira-ticket',
      '--jira-url',
      '--type',
      '--url',
      '--output',
      '--schema'
    ]);
    expect(command?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual([
      '--type',
      '--url'
    ]);
  });
});
