import { normalizeCloudParallel } from '../../src/core/device-cloud-provider';
import type {
  CloudDevice,
  DeviceCloudConfig,
  DeviceCloudProvider,
  DeviceCloudTest,
  DeviceCloudTestResult,
  DeviceSession,
  DeviceSessionArtifacts
} from '../../src/core/device-cloud-provider';
import { BrowserStackConnector } from '../../src/core/browserstack-connector';
import type { AxiosInstance } from 'axios';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

class ContractProvider implements DeviceCloudProvider {
  readonly name = 'contract';
  readonly type = 'cloud' as const;
  config?: DeviceCloudConfig;

  async initialize(config: DeviceCloudConfig): Promise<void> {
    this.config = config;
  }

  async listDevices(): Promise<CloudDevice[]> {
    return [{
      id: 'ios-17-iphone-14',
      name: 'iPhone 14',
      osName: 'ios',
      osVersion: '17',
      deviceType: 'phone',
      realMobile: true
    }];
  }

  async createSession(device: CloudDevice): Promise<DeviceSession> {
    return {
      id: 'session-1',
      device,
      provider: this.name,
      startedAt: '2026-07-25T00:00:00.000Z'
    };
  }

  async executeTest(session: DeviceSession, test: DeviceCloudTest): Promise<DeviceCloudTestResult> {
    return {
      status: 'PASS',
      url: test.url,
      device: session.device.name,
      sessionId: session.id,
      durationMs: 1
    };
  }

  async getSessionArtifacts(): Promise<DeviceSessionArtifacts> {
    return { screenshotUrls: [], logs: [] };
  }

  async closeSession(): Promise<void> {
    return undefined;
  }
}

describe('DeviceCloudProvider contract', () => {
  it('supports an implementation without leaking provider-specific types', async () => {
    const provider: DeviceCloudProvider = new ContractProvider();
    await provider.initialize({ username: 'user', accessKey: 'secret' });
    const [device] = await provider.listDevices();
    const session = await provider.createSession(device);
    const result = await provider.executeTest(session, { url: 'https://example.com' });

    expect(result).toEqual(expect.objectContaining({
      status: 'PASS',
      device: 'iPhone 14',
      sessionId: 'session-1'
    }));
  });

  it.each([
    [undefined, 1],
    [1, 1],
    [4, 4],
    [25, 25]
  ])('normalizes concurrency %s to %s', (input, expected) => {
    expect(normalizeCloudParallel(input)).toBe(expected);
  });

  it.each([0, -1, 1.5, 26])('rejects unsafe concurrency %s', (input) => {
    expect(() => normalizeCloudParallel(input)).toThrow(
      'Device-cloud parallelism must be an integer between 1 and 25'
    );
  });
});

function client(overrides: Partial<AxiosInstance>): AxiosInstance {
  return {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
    ...overrides
  } as unknown as AxiosInstance;
}

describe('BrowserStackConnector', () => {
  const artifactDir = path.join(__dirname, '.tmp-browserstack-artifacts');

  afterEach(() => {
    if (existsSync(artifactDir)) {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });

  it('requires credentials and validates bounded parallelism', async () => {
    const connector = new BrowserStackConnector();
    await expect(connector.initialize({ username: '', accessKey: '' })).rejects.toThrow(
      'username and access key are required'
    );
    await expect(connector.initialize({
      username: 'user',
      accessKey: 'key',
      parallel: 26
    })).rejects.toThrow('integer between 1 and 25');
  });

  it('normalizes and de-duplicates real mobile devices', async () => {
    const api = client({
      get: jest.fn().mockResolvedValue({
        data: [
          { device: 'iPhone 14', os: 'ios', os_version: '17', real_mobile: true },
          { device: 'iPhone 14', os: 'ios', os_version: '17', real_mobile: 'true' },
          { device: 'Chrome', os: 'Windows', os_version: '11', real_mobile: false }
        ]
      })
    });
    const connector = new BrowserStackConnector({ api, hub: client({}) });
    await connector.initialize({ username: 'user', accessKey: 'key' });

    await expect(connector.listDevices()).resolves.toEqual([{
      id: 'ios-17-iphone-14',
      name: 'iPhone 14',
      osName: 'ios',
      osVersion: '17',
      deviceType: 'phone',
      realMobile: true
    }]);
  });

  it('creates, executes, captures, and closes a real-device WebDriver session', async () => {
    const post = jest.fn()
      .mockResolvedValueOnce({ data: { value: { sessionId: 'session-123' } } })
      .mockResolvedValueOnce({ data: { value: null } });
    const get = jest.fn()
      .mockResolvedValueOnce({ data: { value: 'Example title' } })
      .mockResolvedValueOnce({ data: { value: Buffer.from('png').toString('base64') } });
    const remove = jest.fn().mockResolvedValue({ data: {} });
    const hub = client({ post, get, delete: remove });
    const connector = new BrowserStackConnector({ api: client({}), hub });
    await connector.initialize({
      username: 'user',
      accessKey: 'key',
      artifactDir,
      projectName: 'PROVA tests',
      video: true
    });
    const device: CloudDevice = {
      id: 'android-14-pixel-7',
      name: 'Google Pixel 7',
      osName: 'android',
      osVersion: '14',
      deviceType: 'phone',
      realMobile: true
    };

    const session = await connector.createSession(device);
    const result = await connector.executeTest(session, { url: 'https://example.com' });
    await connector.closeSession(session.id);

    expect(session.id).toBe('session-123');
    expect(post).toHaveBeenNthCalledWith(
      1,
      '/session',
      expect.objectContaining({ capabilities: expect.any(Object) })
    );
    expect(result).toEqual(expect.objectContaining({
      status: 'PASS',
      title: 'Example title',
      sessionId: 'session-123'
    }));
    const screenshotPath = result.artifacts?.screenshotPaths?.[0];
    expect(screenshotPath).toBeDefined();
    expect(existsSync(screenshotPath as string)).toBe(true);
    expect(remove).toHaveBeenCalledWith('/session/session-123');
  });

  it('returns a sanitized failure without throwing from test execution', async () => {
    const hub = client({ post: jest.fn().mockRejectedValue(new Error('network secret details')) });
    const connector = new BrowserStackConnector({ api: client({}), hub });
    await connector.initialize({ username: 'user', accessKey: 'super-secret' });
    const device: CloudDevice = {
      id: 'ios',
      name: 'iPhone',
      osName: 'ios',
      osVersion: '17',
      deviceType: 'phone',
      realMobile: true
    };
    const result = await connector.executeTest({
      id: 'session',
      device,
      provider: 'browserstack',
      startedAt: new Date(0).toISOString()
    }, { url: 'https://example.com' });

    expect(result.status).toBe('FAIL');
    expect(result.error).not.toContain('super-secret');
  });
});
