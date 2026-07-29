import {
  buildNativeLifecycleCommands,
  executeNativeLifecycle
} from '../../src/core/native-appium-lifecycle';
import type { AppiumFetch } from '../../src/core/native-appium-runner';

describe('native Appium lifecycle', () => {
  it('maps install, launch, foreground, terminate, and background actions', () => {
    expect(buildNativeLifecycleCommands({ type: 'install', app: 'C:\\apps\\prova.apk' })[0]?.script)
      .toBe('mobile: installApp');
    expect(buildNativeLifecycleCommands({ type: 'launch', appId: 'com.prova.demo' })[0]?.script)
      .toBe('mobile: activateApp');
    expect(buildNativeLifecycleCommands({ type: 'foreground', appId: 'com.prova.demo' })[0]?.script)
      .toBe('mobile: activateApp');
    expect(buildNativeLifecycleCommands({ type: 'terminate', appId: 'com.prova.demo' })[0]?.script)
      .toBe('mobile: terminateApp');
    expect(buildNativeLifecycleCommands({ type: 'background', seconds: 10 })[0]?.args)
      .toEqual({ seconds: 10 });
  });

  it('builds reset as terminate, clear, and activate', () => {
    expect(buildNativeLifecycleCommands({ type: 'reset', appId: 'com.prova.demo' })
      .map((command) => command.script)).toEqual([
      'mobile: terminateApp', 'mobile: clearApp', 'mobile: activateApp'
    ]);
  });

  it('rejects invalid app IDs, unsafe app references, and durations', () => {
    expect(() => buildNativeLifecycleCommands({ type: 'launch', appId: '../unsafe' }))
      .toThrow('application ID');
    expect(() => buildNativeLifecycleCommands({ type: 'install', app: 'bad\nvalue' }))
      .toThrow('safe characters');
    expect(() => buildNativeLifecycleCommands({ type: 'background', seconds: 0 }))
      .toThrow('between 1 and 3600');
  });

  it('executes lifecycle commands in order', async () => {
    const scripts: string[] = [];
    const fetcher: AppiumFetch = jest.fn(async (_input, init) => {
      scripts.push((JSON.parse(init?.body ?? '{}') as { script: string }).script);
      return { ok: true, status: 200, json: async () => ({}) };
    });
    await expect(executeNativeLifecycle('http://localhost:4723/', 'session/30', {
      type: 'reset', appId: 'com.prova.demo'
    }, fetcher)).resolves.toEqual([
      'mobile: terminateApp', 'mobile: clearApp', 'mobile: activateApp'
    ]);
    expect(scripts).toEqual([
      'mobile: terminateApp', 'mobile: clearApp', 'mobile: activateApp'
    ]);
  });

  it('stops immediately when a lifecycle step fails', async () => {
    const fetcher: AppiumFetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(executeNativeLifecycle('http://localhost:4723', 'session', {
      type: 'reset', appId: 'com.prova.demo'
    }, fetcher)).rejects.toThrow('mobile: clearApp failed');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
