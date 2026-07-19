import { writeFile } from 'node:fs/promises';
import { buildProgram, dataCommand } from '../../src/cli/run';
import { generateTestDataFromFile } from '../../src/core/test-data-factory';

jest.mock('node:fs/promises', () => ({ writeFile: jest.fn() }));
jest.mock('../../src/core/test-data-factory', () => ({ generateTestDataFromFile: jest.fn() }));

const mockGenerateData = generateTestDataFromFile as jest.MockedFunction<typeof generateTestDataFromFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

describe('dataCommand', () => {
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

  it('prints one generated record to stdout by default', async () => {
    mockGenerateData.mockResolvedValueOnce({ ok: true, data: { email: 'user@example.com' } });
    await dataCommand({ schema: 'user.json', count: '1' });
    expect(mockGenerateData).toHaveBeenCalledWith('user.json', { count: 1 });
    expect(stdoutSpy).toHaveBeenCalledWith('{\n  "email": "user@example.com"\n}\n');
  });

  it('writes multiple records to the requested output file', async () => {
    mockGenerateData.mockResolvedValueOnce({ ok: true, data: [{ id: 1 }, { id: 1 }] });
    await dataCommand({ schema: 'user.json', count: '2', output: 'fixtures/users.json' });
    expect(mockWriteFile).toHaveBeenCalledWith('fixtures/users.json', expect.stringContaining('"id": 1'), { encoding: 'utf-8' });
    expect(process.exitCode).toBeUndefined();
  });

  it('fails cleanly for invalid counts, schema failures, and write failures', async () => {
    await dataCommand({ schema: 'user.json', count: '0' });
    expect(process.exitCode).toBe(1);
    expect(mockGenerateData).not.toHaveBeenCalled();

    process.exitCode = undefined;
    mockGenerateData.mockResolvedValueOnce({ ok: false, error: 'Schema file is not valid JSON: user.json' });
    await dataCommand({ schema: 'user.json', count: '1' });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    mockGenerateData.mockResolvedValueOnce({ ok: true, data: { id: 1 } });
    mockWriteFile.mockRejectedValueOnce(new Error('permission denied'));
    await dataCommand({ schema: 'user.json', count: '1', output: 'blocked.json' });
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
  });
});

describe('data CLI registration', () => {
  it('exposes schema, count, and output flags', () => {
    const command = buildProgram().commands.find((candidate) => candidate.name() === 'data');
    expect(command?.options.map((option) => option.long)).toEqual(['--schema', '--count', '--output']);
    expect(command?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual(['--schema']);
  });
});
