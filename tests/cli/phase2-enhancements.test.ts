import { aiGenCommand, figmaCommand, perfCommand } from '../../src/cli/run';
import { generateAiSpec } from '../../src/generators/ai-spec-generator';
import { fetchFigmaElements } from '../../src/core/figma-connector';
import { generateFigmaTests } from '../../src/generators/figma-test-generator';
import { FigmaCredentialStore } from '../../src/storage/figma-credentials';
import { PerformanceStore } from '../../src/perf/performance-store';
import { runK6 } from '../../src/core/k6-runner';

jest.mock('../../src/generators/ai-spec-generator', () => ({ generateAiSpec: jest.fn() }));
jest.mock('../../src/core/figma-connector', () => ({ fetchFigmaElements: jest.fn() }));
jest.mock('../../src/generators/figma-test-generator', () => ({ generateFigmaTests: jest.fn() }));
jest.mock('../../src/storage/figma-credentials', () => ({ FigmaCredentialStore: { open: jest.fn() } }));
jest.mock('../../src/perf/performance-store', () => ({ PerformanceStore: { open: jest.fn() } }));
jest.mock('../../src/core/k6-runner', () => ({ runK6: jest.fn() }));

const mockAi = generateAiSpec as jest.MockedFunction<typeof generateAiSpec>;
const mockFetch = fetchFigmaElements as jest.MockedFunction<typeof fetchFigmaElements>;
const mockGenerateFigma = generateFigmaTests as jest.MockedFunction<typeof generateFigmaTests>;
const mockFigmaOpen = FigmaCredentialStore.open as jest.Mock;
const mockPerformanceOpen = PerformanceStore.open as jest.Mock;
const mockRunK6 = runK6 as jest.MockedFunction<typeof runK6>;

describe('Phase 2 CLI orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    delete process.env['PROVA_CREDENTIAL_KEY'];
    delete process.env['FIGMA_OAUTH_ACCESS_TOKEN'];
    delete process.env['FIGMA_OAUTH_REFRESH_TOKEN'];
    delete process.env['FIGMA_OAUTH_EXPIRES_AT'];
  });

  it('runs deterministic AI generation and validates language', async () => {
    mockAi.mockResolvedValue({ ok: true, file: 'login.spec.ts', scenarios: 1 });
    await aiGenCommand({ spec: 'login.md', output: 'out', url: 'https://example.com', lang: 'en', browsers: 'chromium' });
    expect(mockAi).toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    await aiGenCommand({ spec: 'login.md', output: 'out', url: 'https://example.com', lang: 'xx', browsers: 'chromium' });
    expect(process.exitCode).toBe(1);
  });

  it('stores encrypted Figma OAuth credentials', async () => {
    const store = { save: jest.fn().mockResolvedValue(undefined), close: jest.fn() };
    mockFigmaOpen.mockResolvedValue(store);
    process.env['PROVA_CREDENTIAL_KEY'] = 'long-enough-secret-key';
    process.env['FIGMA_OAUTH_ACCESS_TOKEN'] = 'oauth-token';
    await figmaCommand({ auth: true, output: 'out', database: 'credentials.sqlite' });
    expect(store.save).toHaveBeenCalledWith({ accessToken: 'oauth-token' }, 'default');
    expect(store.close).toHaveBeenCalled();
  });

  it('loads OAuth credentials, fetches Figma elements, and generates stubs', async () => {
    const store = {
      save: jest.fn(),
      loadValid: jest.fn(() => ({ accessToken: 'stored-oauth' })),
      close: jest.fn()
    };
    mockFigmaOpen.mockResolvedValue(store);
    mockFetch.mockResolvedValue({ ok: true, fileKey: 'File1', nodeId: '1:2', elements: [{ name: 'Button', type: 'INSTANCE' }] });
    mockGenerateFigma.mockResolvedValue(['button.spec.ts']);
    process.env['PROVA_CREDENTIAL_KEY'] = 'long-enough-secret-key';
    await figmaCommand({ auth: false, sync: 'File1', node: '1:2', output: 'out', database: 'credentials.sqlite' });
    expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'stored-oauth' }));
    expect(mockGenerateFigma).toHaveBeenCalled();
  });

  it('lists and removes named Figma credential profiles without exposing tokens', async () => {
    const store = {
      listProfiles: jest.fn(() => ['default', 'team-a']),
      delete: jest.fn().mockResolvedValue(true),
      close: jest.fn()
    };
    mockFigmaOpen.mockResolvedValue(store);
    process.env['PROVA_CREDENTIAL_KEY'] = 'long-enough-secret-key';
    await figmaCommand({
      auth: false, listProfiles: true, profile: 'default',
      output: 'out', database: 'credentials.sqlite'
    });
    expect(store.listProfiles).toHaveBeenCalled();
    await figmaCommand({
      auth: false, logout: true, profile: 'team-a',
      output: 'out', database: 'credentials.sqlite'
    });
    expect(store.delete).toHaveBeenCalledWith('team-a');
    expect(store.close).toHaveBeenCalledTimes(2);
  });

  function perfStore(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      setBaseline: jest.fn().mockResolvedValue(undefined), addRun: jest.fn().mockResolvedValue(undefined),
      getBaseline: jest.fn(() => ({
        url: 'https://example.com', vus: 1, durationSeconds: 1, p50ResponseTimeMs: 50,
        p95ResponseTimeMs: 100, p99ResponseTimeMs: 150, errorRate: 0, requestsPerSecond: 10,
        status: 'PASS', timestamp: '2026-07-21T00:00:00.000Z'
      })),
      listRuns: jest.fn(() => []), close: jest.fn(), ...overrides
    };
  }

  it('sets and checks SQLite performance baselines with mocked k6', async () => {
    const store = perfStore();
    mockPerformanceOpen.mockResolvedValue(store);
    mockRunK6.mockResolvedValue({ ok: true, metrics: {
      p50ResponseTimeMs: 50, p95ResponseTimeMs: 100, p99ResponseTimeMs: 150,
      errorRate: 0, requestsPerSecond: 10
    } });
    const base = { url: 'https://example.com', vus: '1', duration: '1', updateBaseline: false,
      database: 'performance.sqlite', threshold: '10', days: '7', method: 'GET' };
    await perfCommand({ ...base, action: 'set' });
    expect(store.setBaseline).toHaveBeenCalled();
    await perfCommand({ ...base, action: 'check' });
    expect(store.addRun).toHaveBeenCalledTimes(2);
  });

  it('exports SQLite history reports without running k6', async () => {
    const store = perfStore();
    mockPerformanceOpen.mockResolvedValue(store);
    await perfCommand({ vus: '1', duration: '1', updateBaseline: false, action: 'report',
      database: 'performance.sqlite', threshold: '10', days: '7', method: 'GET' });
    expect(store.listRuns).toHaveBeenCalled();
    expect(mockRunK6).not.toHaveBeenCalled();
  });

  it('exports JSON reports and can fail CI on a degrading trend', async () => {
    const runs = [100, 110, 121].map((p95ResponseTimeMs, index) => ({
      url: 'https://example.com', vus: 1, durationSeconds: 1, p50ResponseTimeMs: 50,
      p95ResponseTimeMs, p99ResponseTimeMs: 150, errorRate: 0, requestsPerSecond: 10,
      status: 'PASS' as const, timestamp: `2026-07-2${index + 1}T00:00:00.000Z`
    }));
    const store = perfStore({ listRuns: jest.fn(() => runs) });
    mockPerformanceOpen.mockResolvedValue(store);
    await perfCommand({
      vus: '1', duration: '1', updateBaseline: false, action: 'report',
      database: 'performance.sqlite', days: '7', format: 'json', failOnTrend: true
    });
    expect(process.exitCode).toBe(1);
    expect(mockRunK6).not.toHaveBeenCalled();
    process.exitCode = undefined;
  });
});
