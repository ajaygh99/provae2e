import { PluginRegistry } from '../../src/plugins/registry';
import type { IntegrationPlugin } from '../../src/plugins/types/integration-plugin';

function plugin(overrides: Partial<IntegrationPlugin> = {}): IntegrationPlugin {
  return {
    name: 'github', version: '1.0.0', type: 'integration', description: 'GitHub',
    initialize: jest.fn(async () => undefined),
    validate: jest.fn(async () => true),
    cleanup: jest.fn(async () => undefined),
    sendTestResults: jest.fn(async () => undefined),
    createIssue: jest.fn(async () => 'GH-1'),
    ...overrides
  };
}

describe('PluginRegistry', () => {
  test('registers, configures, initializes, lists, and cleans a plugin', async () => {
    const registry = new PluginRegistry();
    const github = plugin();
    registry.register(github);
    registry.configure('GitHub', { token: 'secret' });
    await registry.initialize('github');
    expect(registry.state('github')).toBe('ready');
    expect(registry.get('github')).toBe(github);
    expect(registry.list()).toEqual([
      expect.objectContaining({ name: 'github', type: 'integration', state: 'ready' })
    ]);
    expect(github.initialize).toHaveBeenCalledWith({ token: 'secret' });
    await registry.cleanupAll();
    expect(registry.state('github')).toBe('closed');
  });

  test('rejects duplicates, malformed metadata, and active mutation', async () => {
    const registry = new PluginRegistry();
    registry.register(plugin());
    expect(() => registry.register(plugin())).toThrow('already registered');
    expect(() => registry.register(plugin({ name: '../escape' }))).toThrow('Invalid plugin name');
    expect(() => registry.register(plugin({ version: 'latest' }))).toThrow('Invalid plugin version');
    await registry.initialize('github');
    expect(() => registry.configure('github', {})).toThrow('Cannot reconfigure active');
    expect(() => registry.unregister('github')).toThrow('Cannot unregister active');
    expect(() => registry.get('missing')).toThrow('Plugin not found');
  });

  test('contains validation failures without affecting another plugin', async () => {
    const registry = new PluginRegistry();
    registry.register(plugin({ name: 'github', validate: jest.fn(async () => false) }));
    registry.register(plugin({ name: 'gitlab' }));
    await expect(registry.initialize('github')).rejects.toThrow('validation failed');
    expect(registry.state('github')).toBe('failed');
    await registry.initialize('gitlab');
    expect(registry.state('gitlab')).toBe('ready');
  });

  test('bounds lifecycle execution and aggregates cleanup failures', async () => {
    const registry = new PluginRegistry({ lifecycleTimeoutMs: 5 });
    registry.register(plugin({ initialize: jest.fn(() => new Promise(() => undefined)) }));
    await expect(registry.initialize('github')).rejects.toThrow('timed out');

    const cleanupRegistry = new PluginRegistry();
    cleanupRegistry.register(plugin({ cleanup: jest.fn(async () => { throw new Error('cleanup failed'); }) }));
    await expect(cleanupRegistry.cleanupAll()).rejects.toThrow('1 plugin cleanup operation');
  });

  test('initializes all plugins concurrently and unregisters inactive plugins', async () => {
    const registry = new PluginRegistry();
    registry.register(plugin({ name: 'github' }));
    registry.register(plugin({ name: 'gitlab' }));
    await registry.initializeAll();
    expect(registry.list().every(({ state }) => state === 'ready')).toBe(true);

    const inactive = new PluginRegistry();
    inactive.register(plugin());
    expect(inactive.unregister('github')).toBe(true);
    expect(inactive.unregister('github')).toBe(false);
  });
});
