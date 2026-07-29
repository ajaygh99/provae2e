import {
  createAppiumNetworkController,
  withNativeNetworkProfile
} from '../../src/core/native-appium-network';
import type { AppiumFetch } from '../../src/core/native-appium-runner';

describe('native Appium network simulation', () => {
  it('maps offline to disabled connectivity', async () => {
    const payloads: unknown[] = [];
    const fetcher: AppiumFetch = jest.fn(async (_input, init) => {
      payloads.push(JSON.parse(init?.body ?? '{}'));
      return { ok: true, status: 200, json: async () => ({}) };
    });
    await createAppiumNetworkController('http://localhost:4723/', 'session/28', fetcher)
      .setProfile('offline');
    expect(payloads).toEqual([{
      script: 'mobile: setConnectivity',
      args: [{ wifi: false, data: false, airplaneMode: true }]
    }]);
  });

  it.each(['edge', 'lte', 'full'] as const)('sets connectivity and fixed speed for %s', async (profile) => {
    const payloads: Array<{ script: string; args: Array<{ args?: string[] }> }> = [];
    const fetcher: AppiumFetch = jest.fn(async (_input, init) => {
      payloads.push(JSON.parse(init?.body ?? '{}'));
      return { ok: true, status: 200, json: async () => ({}) };
    });
    await createAppiumNetworkController('http://localhost:4723', 'session', fetcher).setProfile(profile);
    expect(payloads.map((payload) => payload.script)).toEqual([
      'mobile: setConnectivity', 'mobile: shell'
    ]);
    expect(payloads[1]?.args[0]?.args).toEqual(['speed', profile]);
  });

  it('restores full connectivity after success and failure', async () => {
    const profiles: string[] = [];
    const controller = { setProfile: jest.fn(async (profile: string) => { profiles.push(profile); }) };
    await expect(withNativeNetworkProfile(controller, 'edge', async () => 'done')).resolves.toBe('done');
    expect(profiles).toEqual(['edge', 'full']);
    profiles.length = 0;
    await expect(withNativeNetworkProfile(controller, 'offline', async () => {
      throw new Error('test failed');
    })).rejects.toThrow('test failed');
    expect(profiles).toEqual(['offline', 'full']);
  });

  it('surfaces restoration failure when the operation passed', async () => {
    const controller = {
      setProfile: jest.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('adb unavailable'))
    };
    await expect(withNativeNetworkProfile(controller, 'lte', async () => 'done'))
      .rejects.toThrow('Failed to restore native network');
  });
});
