import type { Plugin, PluginDevice, PluginDeviceSession, PluginTestCase, TestResult } from './plugin.js';

export interface DeviceCloudPlugin extends Plugin {
  readonly type: 'device-cloud';
  listDevices(): Promise<PluginDevice[]>;
  createSession(device: PluginDevice): Promise<PluginDeviceSession>;
  executeTest(session: PluginDeviceSession, test: PluginTestCase): Promise<TestResult>;
}

export type AnyPlugin = import('./integration-plugin.js').IntegrationPlugin
  | import('./integration-plugin.js').NotificationPlugin
  | import('./reporting-plugin.js').ReportingPlugin
  | DeviceCloudPlugin;
