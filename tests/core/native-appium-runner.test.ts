import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  resolveAndroidApp,
  runNativeAppiumSession,
  type AppiumFetch
} from '../../src/core/native-appium-runner';

describe('native Appium runner', () => {
  async function apk(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-appium-'));
    const file = path.join(directory, 'fixture.apk');
    await writeFile(file, 'apk');
    return file;
  }

  it('accepts a bounded local APK and resolves its canonical path', async () => {
    const file = await apk();
    await expect(resolveAndroidApp(file)).resolves.toBe(await import('node:fs/promises').then((fs) => fs.realpath(file)));
  });

  it('rejects non-APK files and insecure remote URLs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'prova-appium-'));
    const file = path.join(directory, 'fixture.ipa');
    await writeFile(file, 'ipa');
    await expect(resolveAndroidApp(file)).rejects.toThrow('.apk');
    await expect(resolveAndroidApp('http://example.test/app.apk')).rejects.toThrow('https');
  });

  it('creates a W3C Android session and always deletes it', async () => {
    const file = await apk();
    const calls: Array<{ input: string; method?: string; body?: string }> = [];
    const fetcher: AppiumFetch = jest.fn(async (input, init) => {
      calls.push({ input, method: init?.method, body: init?.body });
      return {
        ok: true,
        status: 200,
        json: async () => ({ value: { sessionId: 'session-23' } })
      };
    });

    const result = await runNativeAppiumSession({
      app: file,
      deviceName: 'Pixel_7_API_35',
      platformVersion: '15'
    }, fetcher);

    expect(result).toMatchObject({ status: 'PASS', platform: 'android', sessionId: 'session-23' });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.input).toBe('http://127.0.0.1:4723/session');
    expect(JSON.parse(calls[0]?.body ?? '{}').capabilities.alwaysMatch).toMatchObject({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Pixel_7_API_35',
      'appium:platformVersion': '15'
    });
    expect(calls[1]).toMatchObject({
      input: 'http://127.0.0.1:4723/session/session-23',
      method: 'DELETE'
    });
  });

  it('returns a structured failure without attempting cleanup when creation fails', async () => {
    const file = await apk();
    const fetcher: AppiumFetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ value: { error: 'session not created' } })
    }));

    await expect(runNativeAppiumSession({
      app: file,
      deviceName: 'emulator'
    }, fetcher)).resolves.toMatchObject({
      status: 'FAIL',
      error: 'Appium session creation failed with HTTP 500'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('redacts credentials from failures and returned app evidence', async () => {
    const result = await runNativeAppiumSession({
      app: 'https://user:secret@example.test/app.apk?access_key=top-secret',
      deviceName: 'emulator'
    });

    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('top-secret');
  });
});
