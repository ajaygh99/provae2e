import { buildProgram, generateCommand, type GenerateActionOptions } from '../../src/cli/run';
import { generateTestsFromSpec } from '../../src/generators/spec-test-generator';
import { fetchJiraTicketDescription, syncJiraTestStatus } from '../../src/core/jira-connector';
import { generateTestDataFromFile } from '../../src/core/test-data-factory';
import { fetchFigmaElements } from '../../src/core/figma-connector';

jest.mock('../../src/generators/spec-test-generator', () => ({
  generateTestsFromSpec: jest.fn()
}));
jest.mock('../../src/core/jira-connector', () => ({
  fetchJiraTicketDescription: jest.fn(),
  syncJiraTestStatus: jest.fn()
}));
jest.mock('../../src/core/test-data-factory', () => ({
  generateTestDataFromFile: jest.fn()
}));
jest.mock('../../src/core/figma-connector', () => ({
  fetchFigmaElements: jest.fn()
}));

const mockGenerate = generateTestsFromSpec as jest.MockedFunction<typeof generateTestsFromSpec>;
const mockFetchJira = fetchJiraTicketDescription as jest.MockedFunction<typeof fetchJiraTicketDescription>;
const mockSyncJira = syncJiraTestStatus as jest.MockedFunction<typeof syncJiraTestStatus>;
const mockGenerateData = generateTestDataFromFile as jest.MockedFunction<typeof generateTestDataFromFile>;
const mockFetchFigma = fetchFigmaElements as jest.MockedFunction<typeof fetchFigmaElements>;

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
    delete process.env['JIRA_OAUTH_ACCESS_TOKEN'];
    delete process.env['JIRA_ENVIRONMENTS'];
    delete process.env['FIGMA_API_TOKEN'];
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
      requestBody: undefined,
      figmaElements: undefined
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

  it('requires a spec, JIRA ticket, or complete Figma pair and keeps spec/JIRA exclusive', async () => {
    await generateCommand(options({ spec: undefined, jiraTicket: undefined }));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Figma file/node pair'));

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

  it('selects a named OAuth JIRA environment', async () => {
    process.env['JIRA_OAUTH_ACCESS_TOKEN'] = 'oauth-token';
    process.env['JIRA_ENVIRONMENTS'] = JSON.stringify({ qe: { baseUrl: 'https://qe.atlassian.net', cloudId: 'cloud-qe' } });
    mockFetchJira.mockResolvedValueOnce({ ok: true, ticketKey: 'PROJ-7', description: '- Search works' });
    mockGenerate.mockResolvedValueOnce({ ok: true, criteria: ['Search works'], files: ['search.spec.ts'] });
    await generateCommand(options({ spec: undefined, jiraTicket: 'PROJ-7', jiraEnv: 'qe' }));
    expect(mockFetchJira).toHaveBeenCalledWith({
      baseUrl: 'https://qe.atlassian.net', cloudId: 'cloud-qe', ticketKey: 'PROJ-7', accessToken: 'oauth-token'
    });
  });

  it('syncs generated files to the originating JIRA issue', async () => {
    process.env['JIRA_API_TOKEN'] = 'api-token';
    mockFetchJira.mockResolvedValueOnce({ ok: true, ticketKey: 'PROJ-8', description: '- Checkout works' });
    mockGenerate.mockResolvedValueOnce({ ok: true, criteria: ['Checkout works'], files: ['checkout.spec.ts'] });
    mockSyncJira.mockResolvedValueOnce({ ok: true, ticketKey: 'PROJ-8' });
    await generateCommand(options({ spec: undefined, jiraTicket: 'PROJ-8', jiraUrl: 'https://company.atlassian.net', jiraSync: true }));
    expect(mockSyncJira).toHaveBeenCalledWith(expect.objectContaining({
      ticketKey: 'PROJ-8', status: 'GENERATED', generatedFiles: ['checkout.spec.ts']
    }));
  });

  it('fails clearly for an unknown JIRA environment', async () => {
    process.env['JIRA_ENVIRONMENTS'] = JSON.stringify({ dev: { baseUrl: 'https://dev.atlassian.net' } });
    await generateCommand(options({ spec: undefined, jiraTicket: 'PROJ-9', jiraEnv: 'prod' }));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown JIRA environment'));
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

  it('supports standalone Figma browser generation and passes elements to Ollama', async () => {
    process.env['FIGMA_API_TOKEN'] = 'unit-test-token';
    const elements = [
      { name: 'Login Button', type: 'INSTANCE' },
      { name: 'Heading', type: 'TEXT', text: 'Welcome' }
    ];
    mockFetchFigma.mockResolvedValueOnce({ ok: true, fileKey: 'file123', nodeId: '1:2', elements });
    mockGenerate.mockResolvedValueOnce({ ok: true, criteria: ['Verify elements'], files: ['browser.spec.ts'] });

    await generateCommand(options({ spec: undefined, figmaFile: 'file123', figmaNode: '1:2' }));

    expect(mockFetchFigma).toHaveBeenCalledWith({ fileKey: 'file123', nodeId: '1:2', apiToken: 'unit-test-token' });
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
      specFile: undefined,
      specText: 'Acceptance Criteria\n- Verify the named Figma screen elements exist on the page',
      sourceLabel: 'Figma frame 1:2',
      figmaElements: elements
    }));
    expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining('unit-test-token'));
    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('unit-test-token'));
  });

  it('allows Figma to augment a local spec without replacing it', async () => {
    process.env['FIGMA_API_TOKEN'] = 'unit-test-token';
    mockFetchFigma.mockResolvedValueOnce({
      ok: true, fileKey: 'file123', nodeId: '1:2', elements: [{ name: 'Email Input', type: 'INSTANCE' }]
    });
    mockGenerate.mockResolvedValueOnce({ ok: true, criteria: ['Login'], files: ['browser.spec.ts'] });
    await generateCommand(options({ figmaFile: 'file123', figmaNode: '1:2' }));
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
      specFile: 'ticket.md', specText: undefined, figmaElements: [{ name: 'Email Input', type: 'INSTANCE' }]
    }));
  });

  it('requires a complete Figma pair, token, and browser type', async () => {
    await generateCommand(options({ figmaFile: 'file123' }));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('provided together'));

    process.exitCode = undefined;
    await generateCommand(options({ figmaFile: 'file123', figmaNode: '1:2', type: 'api' }));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('--type browser'));

    process.exitCode = undefined;
    await generateCommand(options({ figmaFile: 'file123', figmaNode: '1:2' }));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('FIGMA_API_TOKEN'));
  });

  it('reports Figma connector failures without generation or token leakage', async () => {
    process.env['FIGMA_API_TOKEN'] = 'unit-test-token';
    mockFetchFigma.mockResolvedValueOnce({ ok: false, error: 'Figma authentication failed (401). Check FIGMA_API_TOKEN permissions.' });
    await generateCommand(options({ figmaFile: 'file123', figmaNode: '1:2' }));
    expect(process.exitCode).toBe(1);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('unit-test-token'));
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
      '--jira-env',
      '--jira-cloud-id',
      '--jira-sync',
      '--figma-file',
      '--figma-node',
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
