import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildProgram } from '../../src/cli/run';
import { securityCommand, type SecurityActionOptions } from '../../src/cli/security';

function options(directory: string, overrides: Partial<SecurityActionOptions> = {}): SecurityActionOptions {
  return {
    report: path.join(directory, 'zap.json'),
    target: 'staging',
    database: path.join(directory, 'zap.sqlite'),
    format: 'json',
    minimumRisk: 'MEDIUM',
    maximumFindings: '0',
    allFindings: true,
    ...overrides
  };
}

function zapReport(riskCode = '3'): string {
  return JSON.stringify({
    site: [{
      alerts: [{
        pluginid: '40012',
        alert: 'Cross Site Scripting',
        riskcode: riskCode,
        cweid: '79',
        instances: [{ uri: 'https://example.test/search?q=secret', param: 'q', evidence: 'token=secret' }]
      }]
    }]
  });
}

describe('securityCommand', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    process.exitCode = undefined;
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = undefined;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('writes a redacted JSON report and fails when policy is violated', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-security-cli-'));
    await writeFile(path.join(directory, 'zap.json'), zapReport());
    const output = path.join(directory, 'reports', 'security.json');
    await securityCommand(options(directory, { output }));
    const artifact = await readFile(output, 'utf8');
    expect(process.exitCode).toBe(1);
    expect(artifact).toContain('"passed": false');
    expect(artifact).toContain('q=%5BREDACTED%5D');
    expect(artifact).not.toContain('token=secret');
  });

  it('applies YAML rules and passes a filtered report', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-security-rules-'));
    await writeFile(path.join(directory, 'zap.json'), zapReport());
    const rules = path.join(directory, 'rules.yaml');
    await writeFile(rules, 'rules:\n  - alert_id: "40012"\n    action: ignore\n    reason: Test fixture\n');
    await securityCommand(options(directory, { rules, format: 'markdown' }));
    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Status: **PASS**'));
  });

  it.each([
    [{ format: 'html' }, '--format'],
    [{ minimumRisk: 'urgent' }, '--minimum-risk'],
    [{ maximumFindings: '-1' }, '--maximum-findings'],
    [{ maximumHigh: '1.5' }, '--maximum-high']
  ])('rejects invalid policy input %j', async (override, expected) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-security-invalid-'));
    await securityCommand(options(directory, override));
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining(expected));
  });
});

describe('security CLI registration', () => {
  it('exposes bounded report, persistence, policy, and output options', () => {
    const command = buildProgram().commands.find(candidate => candidate.name() === 'security');
    expect(command?.options.map(option => option.long)).toEqual([
      '--report', '--target', '--database', '--rules', '--format', '--output', '--minimum-risk',
      '--maximum-findings', '--maximum-info', '--maximum-low', '--maximum-medium', '--maximum-high',
      '--maximum-critical', '--all-findings'
    ]);
    expect(command?.options.filter(option => option.mandatory).map(option => option.long)).toEqual([
      '--report', '--target'
    ]);
  });
});
