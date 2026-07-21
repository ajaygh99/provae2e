import { execFile } from 'node:child_process';
import type { PromotionConfig } from '../../src/promotions/env-config-loader';
import type { PromotionExecutor } from '../../src/promotions/env-chain-manager';
import { runPromotionChain, systemPromotionExecutor } from '../../src/promotions/env-chain-manager';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
const mockExecFile = execFile as unknown as jest.Mock;

const config: PromotionConfig = {
  environments: {
    dev: { url: 'https://dev.example.com' },
    qe: { url: 'https://qe.example.com' },
    staging: { url: 'https://staging.example.com' }
  },
  chains: { release: ['dev', 'qe', 'staging'] }
};

describe('runPromotionChain', () => {
  beforeEach(() => { process.exitCode = undefined; });

  it('runs every environment in order and passes', async () => {
    const visited: string[] = [];
    const executor: PromotionExecutor = { run: async (_file, name) => { visited.push(name); return { passed: true }; } };
    const result = await runPromotionChain({ config, chain: 'release', testFile: 'smoke.spec.ts', executor });
    expect(visited).toEqual(['dev', 'qe', 'staging']);
    expect(result.status).toBe('PASS');
    expect(result.steps).toHaveLength(3);
  });

  it.each([0, 1, 2])('blocks downstream environments after failure at index %s', async (failedIndex) => {
    let index = 0;
    const executor: PromotionExecutor = { run: async () => ({ passed: index++ !== failedIndex, error: 'failed' }) };
    const result = await runPromotionChain({ config, chain: 'release', testFile: 'smoke.spec.ts', executor });
    expect(result.status).toBe('FAIL');
    expect(result.steps).toHaveLength(failedIndex + 1);
  });

  it('can collect all failures when blocking is disabled programmatically', async () => {
    const executor: PromotionExecutor = { run: async () => ({ passed: false, error: 'failed' }) };
    const result = await runPromotionChain({ config, chain: 'release', testFile: 'smoke.spec.ts', blockOnFail: false, executor });
    expect(result.status).toBe('FAIL');
    expect(result.steps).toHaveLength(3);
  });

  it('converts executor exceptions into a failed gate', async () => {
    const executor: PromotionExecutor = { run: async () => { throw new Error('runner crashed'); } };
    const result = await runPromotionChain({ config, chain: 'release', testFile: 'smoke.spec.ts', executor });
    expect(result.steps[0]).toMatchObject({ passed: false, error: 'runner crashed' });
  });

  it('redacts secrets returned by an injected executor and from the summary', async () => {
    process.env['DEV_SECRET'] = 'hidden-value';
    const secretConfig: PromotionConfig = {
      environments: { dev: { url: 'https://dev.example.com', variables: { TOKEN: 'DEV_SECRET' } }, qe: { url: 'https://qe.example.com' } },
      chains: { release: ['dev', 'qe'] }
    };
    const executor: PromotionExecutor = { run: async () => ({ passed: false, error: 'failure hidden-value' }) };
    const result = await runPromotionChain({ config: secretConfig, chain: 'release', source: 'dev', target: 'qe', testFile: 'smoke.spec.ts', executor });
    expect(JSON.stringify(result)).not.toContain('hidden-value');
    expect(result.steps[0].error).toBe('failure [REDACTED]');
    delete process.env['DEV_SECRET'];
  });

  it('rejects an unknown chain', async () => {
    await expect(runPromotionChain({ config, chain: 'missing', testFile: 'smoke.spec.ts' }))
      .rejects.toThrow('Unknown promotion chain "missing"');
  });

  it('rejects an empty test path', async () => {
    await expect(runPromotionChain({ config, chain: 'release', testFile: '  ' }))
      .rejects.toThrow('Promotion test file is required');
  });

  it('records chain, test file, timestamp, duration, and environment', async () => {
    const executor: PromotionExecutor = { run: async () => ({ passed: true }) };
    const result = await runPromotionChain({ config, chain: 'release', testFile: 'suite.spec.ts', executor });
    expect(result).toMatchObject({ status: 'PASS', chain: 'release', testFile: 'suite.spec.ts' });
    expect(new Date(result.startedAt).toString()).not.toBe('Invalid Date');
    expect(result.steps[0]).toEqual(expect.objectContaining({ environment: 'dev', durationMs: expect.any(Number) }));
  });

  it.each([
    ['dev', 'staging', 'must be adjacent and ordered'],
    ['staging', 'qe', 'must be adjacent and ordered'],
    ['dev', 'dev', 'must be adjacent and ordered'],
    ['unknown', 'qe', 'Unknown source environment'],
    ['dev', 'unknown', 'Unknown target environment']
  ])('rejects invalid transition %s -> %s', async (source, target, message) => {
    const executor: PromotionExecutor = { run: jest.fn() };
    await expect(runPromotionChain({ config, chain: 'release', source, target, testFile: 'smoke.spec.ts', executor }))
      .rejects.toThrow(message);
    expect(executor.run).not.toHaveBeenCalled();
  });

  it.each([['dev', 'qe'], ['qe', 'staging']])('accepts adjacent transition %s -> %s', async (source, target) => {
    const executor: PromotionExecutor = { run: async () => ({ passed: true }) };
    const result = await runPromotionChain({ config, chain: 'release', source, target, testFile: 'smoke.spec.ts', executor });
    expect(result).toMatchObject({ status: 'PASS', source, target });
    expect(result.steps.map((step) => step.environment)).toEqual([source]);
  });

  it('rejects a transition when only one endpoint is supplied', async () => {
    await expect(runPromotionChain({ config, chain: 'release', source: 'dev', testFile: 'smoke.spec.ts' }))
      .rejects.toThrow('Both promotion source and target are required');
  });

  it('enforces configured coverage and reports threshold failures', async () => {
    const thresholdConfig: PromotionConfig = {
      ...config,
      environments: { ...config.environments, dev: { ...config.environments.dev, minimumCoverage: 80 } }
    };
    const executor: PromotionExecutor = { run: async () => ({ passed: true }) };
    const missing = await runPromotionChain({ config: thresholdConfig, chain: 'release', source: 'dev', target: 'qe', testFile: 'smoke.spec.ts', executor });
    expect(missing.steps[0]).toMatchObject({ passed: false, error: 'Coverage is required (minimum 80%)' });
    const low = await runPromotionChain({ config: thresholdConfig, chain: 'release', source: 'dev', target: 'qe', testFile: 'smoke.spec.ts', coveragePercent: 79, executor });
    expect(low.steps[0]).toMatchObject({ passed: false, error: 'Coverage 79% is below required 80%' });
    const pass = await runPromotionChain({ config: thresholdConfig, chain: 'release', source: 'dev', target: 'qe', testFile: 'smoke.spec.ts', coveragePercent: 80, executor });
    expect(pass.status).toBe('PASS');
  });

  it('rejects invalid coverage percentages before execution', async () => {
    await expect(runPromotionChain({ config, chain: 'release', testFile: 'smoke.spec.ts', coveragePercent: 101 }))
      .rejects.toThrow('Coverage percent must be between 0 and 100');
  });
});

describe('systemPromotionExecutor', () => {
  beforeEach(() => mockExecFile.mockReset());

  it('passes target URL, test data, and resolved credentials to Playwright', async () => {
    process.env['SOURCE_SECRET'] = 'secret-value';
    mockExecFile.mockImplementation((_exe, _args, _options, callback) => callback(null, '', ''));
    const promise = systemPromotionExecutor.run('smoke.spec.ts', 'qe', {
      url: 'https://qe.example.com', testData: './qe.json', variables: { API_TOKEN: 'SOURCE_SECRET' }
    });
    await expect(promise).resolves.toEqual({ passed: true });
    const options = mockExecFile.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env).toMatchObject({ PROVA_BASE_URL: 'https://qe.example.com', PROVA_TEST_DATA: './qe.json', API_TOKEN: 'secret-value' });
    delete process.env['SOURCE_SECRET'];
  });

  it('fails safely when a required credential is missing', async () => {
    delete process.env['MISSING_SECRET'];
    await expect(systemPromotionExecutor.run('smoke.spec.ts', 'qe', {
      url: 'https://qe.example.com', variables: { API_TOKEN: 'MISSING_SECRET' }
    })).resolves.toEqual({ passed: false, error: 'Required credential environment variable "MISSING_SECRET" is not set' });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'stdout failure', 'qe: stdout failure'],
    ['stderr failure', 'stdout failure', 'qe: stderr failure'],
    ['', '', 'qe: process failed']
  ])('returns useful subprocess failures', async (stderr, stdout, expected) => {
    mockExecFile.mockImplementation((_exe, _args, _options, callback) => callback(new Error('process failed'), stdout, stderr));
    await expect(systemPromotionExecutor.run('smoke.spec.ts', 'qe', { url: 'https://qe.example.com' }))
      .resolves.toEqual({ passed: false, error: expected });
  });

  it('redacts credential values from subprocess output', async () => {
    process.env['SOURCE_SECRET'] = 'super-secret-value';
    mockExecFile.mockImplementation((_exe, _args, _options, callback) => callback(new Error('failed'), '', 'token=super-secret-value'));
    const result = await systemPromotionExecutor.run('smoke.spec.ts', 'qe', {
      url: 'https://qe.example.com', variables: { API_TOKEN: 'SOURCE_SECRET' }
    });
    expect(result.error).toBe('qe: token=[REDACTED]');
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
    delete process.env['SOURCE_SECRET'];
  });
});
