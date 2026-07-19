import { runCommand, type RunActionOptions } from '../../src/cli/run';
import { runBrowserTest } from '../../src/runners/browser-runner';
import { runApiTest } from '../../src/runners/api-runner';
import { runMobileTest } from '../../src/runners/mobile-runner';
import { generateAllureReport } from '../../src/reporters/allure-reporter';

jest.mock('../../src/runners/browser-runner', () => ({ runBrowserTest: jest.fn() }));
jest.mock('../../src/runners/api-runner', () => ({ runApiTest: jest.fn() }));
jest.mock('../../src/runners/mobile-runner', () => ({
  runMobileTest: jest.fn(),
  resolveDeviceKey: jest.fn((device: string) =>
    ['iphone14', 'iphonese', 'pixel7', 'galaxys21', 'ipad'].includes(
      device.toLowerCase().replace(/\s+/g, '')
    ) || device === 'iPhone 14 Pro'
      ? device
      : undefined
  ),
  // validate.ts imports SUPPORTED_DEVICES from this module - keep in sync with mobile-runner.ts's aliases.
  SUPPORTED_DEVICES: ['iphone14', 'iphonese', 'pixel7', 'galaxys21', 'ipad']
}));
jest.mock('../../src/reporters/allure-reporter', () => {
  const actual = jest.requireActual('../../src/reporters/allure-reporter');
  return { ...actual, generateAllureReport: jest.fn() };
});
jest.mock('../../src/core/ai-summary', () => ({ printAiSummary: jest.fn() }));

const mockRunBrowserTest = runBrowserTest as jest.MockedFunction<typeof runBrowserTest>;
const mockRunApiTest = runApiTest as jest.MockedFunction<typeof runApiTest>;
const mockRunMobileTest = runMobileTest as jest.MockedFunction<typeof runMobileTest>;
const mockGenerateAllureReport = generateAllureReport as jest.MockedFunction<typeof generateAllureReport>;

function baseOptions(overrides: Partial<RunActionOptions> = {}): RunActionOptions {
  return {
    url: 'https://example.com',
    type: 'browser',
    device: 'iPhone14',
    workers: '3',
    env: 'qe',
    scope: 'full',
    method: 'GET',
    expectStatus: '200',
    report: false,
    ai: false,
    premium: false,
    ...overrides
  };
}

describe('runCommand — --type all', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;

    mockRunBrowserTest.mockResolvedValue({
      status: 'PASS',
      url: 'https://example.com',
      title: 'Example',
      durationMs: 10
    });
    mockRunApiTest.mockResolvedValue({
      status: 'PASS',
      url: 'https://example.com',
      method: 'GET',
      statusCode: 200,
      durationMs: 20
    });
    mockRunMobileTest.mockResolvedValue({
      status: 'PASS',
      url: 'https://example.com',
      device: 'iPhone 14',
      title: 'Example',
      durationMs: 30
    });
    mockGenerateAllureReport.mockResolvedValue({
      reportPath: '/tmp/report/index.html',
      historyPath: '/tmp/report/history.json',
      summary: { total: 3, passed: 3, failed: 0 }
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('runs browser, api, and mobile together and leaves exit code unset when all pass', async () => {
    await runCommand(baseOptions({ type: 'all' }));

    expect(mockRunBrowserTest).toHaveBeenCalledTimes(1);
    expect(mockRunApiTest).toHaveBeenCalledTimes(1);
    expect(mockRunMobileTest).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('includes all three results in a single combined report when --report is set', async () => {
    await runCommand(baseOptions({ type: 'all', report: true }));

    expect(mockGenerateAllureReport).toHaveBeenCalledTimes(1);
    const runsArg = mockGenerateAllureReport.mock.calls[0][0].runs;
    expect(runsArg).toHaveLength(3);
  });

  it('sets exit code 1 when any single leg of --type all fails', async () => {
    mockRunApiTest.mockResolvedValue({
      status: 'FAIL',
      url: 'https://example.com',
      method: 'GET',
      durationMs: 5,
      error: 'boom'
    });

    await runCommand(baseOptions({ type: 'all' }));

    expect(process.exitCode).toBe(1);
  });

  it('only runs the browser runner for --type browser (not api/mobile)', async () => {
    await runCommand(baseOptions({ type: 'browser' }));

    expect(mockRunBrowserTest).toHaveBeenCalledTimes(1);
    expect(mockRunApiTest).not.toHaveBeenCalled();
    expect(mockRunMobileTest).not.toHaveBeenCalled();
  });
});

describe('runCommand — unknown --type', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('rejects an unknown --type with exit code 1 and runs no runner', async () => {
    await runCommand(baseOptions({ type: 'bogus' }));

    expect(process.exitCode).toBe(1);
    expect(mockRunBrowserTest).not.toHaveBeenCalled();
    expect(mockRunApiTest).not.toHaveBeenCalled();
    expect(mockRunMobileTest).not.toHaveBeenCalled();
  });

  it('rejects invalid input (e.g. bad --url) with exit code 1 before running any runner', async () => {
    await runCommand(baseOptions({ type: 'browser', url: 'not-a-url' }));

    expect(process.exitCode).toBe(1);
    expect(mockRunBrowserTest).not.toHaveBeenCalled();
  });
});
