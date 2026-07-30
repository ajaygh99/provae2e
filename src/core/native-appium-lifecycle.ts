import type { AppiumFetch } from './native-appium-runner.js';

export type NativeLifecycleAction =
  | { type: 'install'; app: string }
  | { type: 'launch'; appId: string }
  | { type: 'foreground'; appId: string }
  | { type: 'terminate'; appId: string }
  | { type: 'reset'; appId: string }
  | { type: 'background'; seconds: number };

const APP_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function validateAppId(appId: string): string {
  if (!APP_ID_PATTERN.test(appId) || appId.length > 255) {
    throw new Error('Invalid native application ID');
  }
  return appId;
}

export function buildNativeLifecycleCommands(
  action: NativeLifecycleAction
): Array<{ script: string; args: Record<string, unknown> }> {
  switch (action.type) {
    case 'install':
      if (action.app.length === 0 || action.app.length > 4096 || /[\r\n]/.test(action.app)) {
        throw new Error('Native app reference must contain between 1 and 4096 safe characters');
      }
      return [{ script: 'mobile: installApp', args: { app: action.app } }];
    case 'launch':
    case 'foreground':
      return [{ script: 'mobile: activateApp', args: { appId: validateAppId(action.appId) } }];
    case 'terminate':
      return [{ script: 'mobile: terminateApp', args: { appId: validateAppId(action.appId) } }];
    case 'reset': {
      const appId = validateAppId(action.appId);
      return [
        { script: 'mobile: terminateApp', args: { appId } },
        { script: 'mobile: clearApp', args: { appId } },
        { script: 'mobile: activateApp', args: { appId } }
      ];
    }
    case 'background':
      if (!Number.isInteger(action.seconds) || action.seconds < 1 || action.seconds > 3600) {
        throw new Error('Background duration must be an integer between 1 and 3600 seconds');
      }
      return [{ script: 'mobile: backgroundApp', args: { seconds: action.seconds } }];
  }
}

export async function executeNativeLifecycle(
  appiumUrl: string,
  sessionId: string,
  action: NativeLifecycleAction,
  fetcher: AppiumFetch = fetch as AppiumFetch
): Promise<string[]> {
  const endpoint = `${appiumUrl.replace(/\/+$/, '')}/session/${encodeURIComponent(sessionId)}/execute/sync`;
  const completed: string[] = [];
  for (const command of buildNativeLifecycleCommands(action)) {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: command.script, args: [command.args] })
    });
    if (!response.ok) {
      throw new Error(`${command.script} failed with HTTP ${response.status}`);
    }
    completed.push(command.script);
  }
  return completed;
}
