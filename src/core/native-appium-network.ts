import type { AppiumFetch } from './native-appium-runner.js';

export type NativeNetworkProfile = 'offline' | 'edge' | 'lte' | 'full';

export interface NativeNetworkController {
  setProfile(profile: NativeNetworkProfile): Promise<void>;
}

async function executeMobile(
  endpoint: string,
  script: string,
  args: Record<string, unknown>,
  fetcher: AppiumFetch
): Promise<void> {
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ script, args: [args] })
  });
  if (!response.ok) {
    throw new Error(`${script} failed with HTTP ${response.status}`);
  }
}

export function createAppiumNetworkController(
  appiumUrl: string,
  sessionId: string,
  fetcher: AppiumFetch = fetch as AppiumFetch
): NativeNetworkController {
  const endpoint = `${appiumUrl.replace(/\/+$/, '')}/session/${encodeURIComponent(sessionId)}/execute/sync`;
  return {
    async setProfile(profile): Promise<void> {
      if (profile === 'offline') {
        await executeMobile(endpoint, 'mobile: setConnectivity', {
          wifi: false, data: false, airplaneMode: true
        }, fetcher);
        return;
      }
      await executeMobile(endpoint, 'mobile: setConnectivity', {
        wifi: true, data: true, airplaneMode: false
      }, fetcher);
      await executeMobile(endpoint, 'mobile: shell', {
        command: 'network',
        args: ['speed', profile]
      }, fetcher);
    }
  };
}

/** Runs work under a network profile and restores full connectivity afterward. */
export async function withNativeNetworkProfile<T>(
  controller: NativeNetworkController,
  profile: NativeNetworkProfile,
  operation: () => Promise<T>
): Promise<T> {
  await controller.setProfile(profile);
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await controller.setProfile('full');
    } catch (restoreError) {
      if (operationError === undefined) {
        throw new Error(`Failed to restore native network: ${
          restoreError instanceof Error ? restoreError.message : String(restoreError)
        }`);
      }
    }
  }
}
