import { buildProgram, promoteCommand } from '../../src/cli/run';
import { loadPromotionConfig } from '../../src/promotions/env-config-loader';
import { runPromotionChain } from '../../src/promotions/env-chain-manager';
import { writePromotionReport } from '../../src/promotions/promotion-reporter';

jest.mock('../../src/promotions/env-config-loader', () => ({ loadPromotionConfig: jest.fn() }));
jest.mock('../../src/promotions/env-chain-manager', () => ({ runPromotionChain: jest.fn() }));
jest.mock('../../src/promotions/promotion-reporter', () => ({ writePromotionReport: jest.fn() }));

const mockLoad = loadPromotionConfig as jest.MockedFunction<typeof loadPromotionConfig>;
const mockRun = runPromotionChain as jest.MockedFunction<typeof runPromotionChain>;
const mockReport = writePromotionReport as jest.MockedFunction<typeof writePromotionReport>;
const config = { environments: { dev: { url: 'https://dev.example.com' } }, chains: { release: ['dev'] } };
const result = {
  status: 'PASS' as const,
  chain: 'release',
  source: 'dev',
  target: 'qe',
  testFile: 'smoke.spec.ts',
  startedAt: '2026-07-21T00:00:00.000Z',
  steps: [{ environment: 'dev', passed: true, durationMs: 1 }]
  ,summary: 'PASS: dev -> qe'
};

describe('promoteCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    mockLoad.mockResolvedValue(config);
    mockRun.mockResolvedValue(result);
    mockReport.mockResolvedValue('C:\\promotion-report.json');
  });

  it('loads configuration, runs the named chain, and writes the report', async () => {
    await promoteCommand({ config: 'promotion.json', chain: 'release', from: 'dev', to: 'qe', test: 'smoke.spec.ts', blockOnFail: true, report: 'report.json' });
    expect(mockLoad).toHaveBeenCalledWith('promotion.json');
    expect(mockRun).toHaveBeenCalledWith({ config, chain: 'release', source: 'dev', target: 'qe', testFile: 'smoke.spec.ts', coveragePercent: undefined, blockOnFail: true });
    expect(mockReport).toHaveBeenCalledWith(result, 'report.json');
    expect(process.exitCode).toBeUndefined();
  });

  it('sets exit code 1 when a gate fails and still writes the report', async () => {
    mockRun.mockResolvedValue({ ...result, status: 'FAIL', steps: [{ ...result.steps[0], passed: false }] });
    await promoteCommand({ config: 'promotion.json', chain: 'release', from: 'dev', to: 'qe', test: 'smoke.spec.ts', blockOnFail: true, report: 'report.json' });
    expect(mockReport).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ['configuration', (): void => { mockLoad.mockRejectedValue(new Error('bad config')); }],
    ['runner', (): void => { mockRun.mockRejectedValue(new Error('bad runner')); }],
    ['reporter', (): void => { mockReport.mockRejectedValue(new Error('bad report')); }]
  ])('converts %s errors to exit code 1', async (_name, arrange) => {
    arrange();
    await expect(promoteCommand({ config: 'promotion.json', chain: 'release', from: 'dev', to: 'qe', test: 'smoke.spec.ts', blockOnFail: true, report: 'report.json' }))
      .resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
  });
});

describe('buildProgram promotion command', () => {
  it('registers required promotion options with blocking enabled by default', () => {
    const command = buildProgram().commands.find((candidate) => candidate.name() === 'promote');
    expect(command).toBeDefined();
    expect(command?.options.map((option) => option.long)).toEqual([
      '--config', '--chain', '--from', '--to', '--test', '--coverage', '--block-on-fail', '--report'
    ]);
    expect(command?.getOptionValue('blockOnFail')).toBe(true);
  });
});
