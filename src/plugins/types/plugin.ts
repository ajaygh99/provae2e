export type PluginType = 'integration' | 'notification' | 'reporting' | 'device-cloud';
export type PluginState = 'registered' | 'initializing' | 'ready' | 'failed' | 'closed';
export type PluginConfig = Readonly<Record<string, unknown>>;

export interface PluginMetadata {
  name: string;
  version: string;
  type: PluginType;
  description?: string;
}

export interface Plugin {
  readonly name: string;
  readonly version: string;
  readonly type: PluginType;
  readonly description?: string;
  initialize(config: PluginConfig): Promise<void>;
  validate(): Promise<boolean>;
  cleanup(): Promise<void>;
}

export interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  durationMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface TestFailure extends TestResult {
  status: 'FAIL';
  error: string;
}

export interface PluginReport {
  format: string;
  generatedAt: string;
  data: unknown;
}

export interface PluginDevice {
  id: string;
  name: string;
  platform: 'ios' | 'android' | 'desktop';
  version: string;
}

export interface PluginDeviceSession {
  id: string;
  deviceId: string;
  createdAt: string;
}

export interface PluginTestCase {
  name: string;
  url: string;
  timeoutMs?: number;
}

export function pluginKey(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(normalized)) {
    throw new Error(`Invalid plugin name "${name}"`);
  }
  return normalized;
}

export function validatePluginShape(plugin: Plugin): void {
  pluginKey(plugin.name);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(plugin.version)) {
    throw new Error(`Invalid plugin version for "${plugin.name}"`);
  }
  if (!['integration', 'notification', 'reporting', 'device-cloud'].includes(plugin.type)) {
    throw new Error(`Invalid plugin type for "${plugin.name}"`);
  }
  for (const method of ['initialize', 'validate', 'cleanup'] as const) {
    if (typeof plugin[method] !== 'function') throw new Error(`Plugin "${plugin.name}" is missing ${method}()`);
  }
}
