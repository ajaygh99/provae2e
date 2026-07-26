import type { AnyPlugin } from './types/device-cloud-plugin.js';
import type { PluginConfig, PluginMetadata, PluginState } from './types/plugin.js';
import { pluginKey, validatePluginShape } from './types/plugin.js';

interface RegistryEntry {
  plugin: AnyPlugin;
  config?: PluginConfig;
  state: PluginState;
  error?: string;
}

export interface PluginRegistryOptions {
  lifecycleTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, action: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${action} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref();
    promise.then((value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

export class PluginRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly timeoutMs: number;

  constructor(options: PluginRegistryOptions = {}) {
    this.timeoutMs = options.lifecycleTimeoutMs ?? 10_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) throw new Error('lifecycleTimeoutMs must be positive');
  }

  register(plugin: AnyPlugin, config?: PluginConfig): void {
    validatePluginShape(plugin);
    const key = pluginKey(plugin.name);
    if (this.entries.has(key)) throw new Error(`Plugin already registered: ${key}`);
    this.entries.set(key, { plugin, state: 'registered', ...(config ? { config: Object.freeze({ ...config }) } : {}) });
  }

  unregister(name: string): boolean {
    const entry = this.entries.get(pluginKey(name));
    if (entry?.state === 'ready' || entry?.state === 'initializing') {
      throw new Error(`Cannot unregister active plugin: ${name}`);
    }
    return this.entries.delete(pluginKey(name));
  }

  configure(name: string, config: PluginConfig): void {
    const entry = this.entry(name);
    if (entry.state === 'initializing' || entry.state === 'ready') {
      throw new Error(`Cannot reconfigure active plugin: ${name}`);
    }
    entry.config = Object.freeze({ ...config });
  }

  get<T extends AnyPlugin = AnyPlugin>(name: string): T {
    return this.entry(name).plugin as T;
  }

  state(name: string): PluginState { return this.entry(name).state; }

  list(): Array<PluginMetadata & { state: PluginState }> {
    return [...this.entries.values()].map(({ plugin, state }) => ({
      name: plugin.name, version: plugin.version, type: plugin.type, state,
      ...(plugin.description ? { description: plugin.description } : {})
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async initialize(name: string): Promise<void> {
    const entry = this.entry(name);
    if (entry.state === 'ready') return;
    if (entry.state === 'closed') throw new Error(`Plugin is closed: ${name}`);
    entry.state = 'initializing';
    try {
      await withTimeout(entry.plugin.initialize(entry.config ?? Object.freeze({})), this.timeoutMs,
        `Plugin "${name}" initialization`);
      if (!await withTimeout(entry.plugin.validate(), this.timeoutMs, `Plugin "${name}" validation`)) {
        throw new Error(`Plugin validation failed: ${name}`);
      }
      entry.state = 'ready';
      delete entry.error;
    } catch (error) {
      entry.state = 'failed';
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async initializeAll(): Promise<void> {
    await Promise.all(this.list().map(({ name }) => this.initialize(name)));
  }

  async cleanup(name: string): Promise<void> {
    const entry = this.entry(name);
    if (entry.state === 'closed') return;
    await withTimeout(entry.plugin.cleanup(), this.timeoutMs, `Plugin "${name}" cleanup`);
    entry.state = 'closed';
  }

  async cleanupAll(): Promise<void> {
    const errors: Error[] = [];
    for (const { name } of this.list().reverse()) {
      try { await this.cleanup(name); } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (errors.length) throw new AggregateError(errors, `${errors.length} plugin cleanup operation(s) failed`);
  }

  private entry(name: string): RegistryEntry {
    const key = pluginKey(name);
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`Plugin not found: ${key}`);
    return entry;
  }
}
