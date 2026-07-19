import { buildProgram, generateCommand, type GenerateActionOptions } from '../../src/cli/run';
import { generateTestsFromSpec } from '../../src/generators/spec-test-generator';

jest.mock('../../src/generators/spec-test-generator', () => ({
  generateTestsFromSpec: jest.fn()
}));

const mockGenerate = generateTestsFromSpec as jest.MockedFunction<typeof generateTestsFromSpec>;

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
      type: 'browser',
      url: 'https://example.com',
      outputDir: './custom-output'
    });
    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('AI test generation complete'));
  });

  it('prints a concise error and sets exit code 1 on generation failure', async () => {
    mockGenerate.mockResolvedValueOnce({ ok: false, error: 'Spec file is empty: ticket.md' });

    await generateCommand(options());

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Spec file is empty'));
  });
});

describe('generate CLI registration', () => {
  it('exposes the documented required flags and output option', () => {
    const command = buildProgram().commands.find((candidate) => candidate.name() === 'generate');
    expect(command).toBeDefined();
    expect(command?.options.map((option) => option.long)).toEqual([
      '--spec',
      '--type',
      '--url',
      '--output'
    ]);
    expect(command?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual([
      '--spec',
      '--type',
      '--url'
    ]);
  });
});
