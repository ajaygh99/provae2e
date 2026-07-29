export type NativeDeviceFarmProvider = 'browserstack' | 'saucelabs';
export type SauceRegion = 'us-west-1' | 'us-east-4' | 'eu-central-1';

export interface NativeDeviceFarmOptions {
  provider: NativeDeviceFarmProvider;
  username: string;
  accessKey: string;
  app: string;
  project?: string;
  build?: string;
  name?: string;
  sauceRegion?: SauceRegion;
}

export interface NativeDeviceFarmRuntime {
  endpoint: string;
  authorization: string;
  app: string;
  capabilities: Record<string, unknown>;
}

function required(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512 || /[\r\n]/.test(trimmed)) {
    throw new Error(`${name} must contain between 1 and 512 safe characters`);
  }
  return trimmed;
}

function optional(value: string | undefined, name: string): string | undefined {
  return value === undefined ? undefined : required(value, name);
}

export function prepareNativeDeviceFarm(options: NativeDeviceFarmOptions): NativeDeviceFarmRuntime {
  const username = required(options.username, 'Device-farm username');
  const accessKey = required(options.accessKey, 'Device-farm access key');
  const project = optional(options.project, 'Project');
  const build = optional(options.build, 'Build');
  const name = optional(options.name, 'Session name');
  const authorization = `Basic ${Buffer.from(`${username}:${accessKey}`).toString('base64')}`;

  if (options.provider === 'browserstack') {
    if (!/^bs:\/\/[a-zA-Z0-9._-]+$/.test(options.app)) {
      throw new Error('BrowserStack native app must use a bounded bs:// reference');
    }
    return {
      endpoint: 'https://hub-cloud.browserstack.com/wd/hub',
      authorization,
      app: options.app,
      capabilities: {
        'bstack:options': {
          ...(project ? { projectName: project } : {}),
          ...(build ? { buildName: build } : {}),
          ...(name ? { sessionName: name } : {})
        }
      }
    };
  }

  if (!/^storage:filename=[a-zA-Z0-9._-]+$/.test(options.app)) {
    throw new Error('Sauce Labs native app must use storage:filename=<safe-name>');
  }
  const region = options.sauceRegion ?? 'us-west-1';
  const hosts: Record<SauceRegion, string> = {
    'us-west-1': 'ondemand.us-west-1.saucelabs.com',
    'us-east-4': 'ondemand.us-east-4.saucelabs.com',
    'eu-central-1': 'ondemand.eu-central-1.saucelabs.com'
  };
  return {
    endpoint: `https://${hosts[region]}/wd/hub`,
    authorization,
    app: options.app,
    capabilities: {
      'sauce:options': {
        ...(project ? { tags: [project] } : {}),
        ...(build ? { build } : {}),
        ...(name ? { name } : {})
      }
    }
  };
}

export function redactNativeDeviceFarmRuntime(runtime: NativeDeviceFarmRuntime): Omit<NativeDeviceFarmRuntime, 'authorization'> {
  return {
    endpoint: runtime.endpoint,
    app: runtime.app,
    capabilities: runtime.capabilities
  };
}
