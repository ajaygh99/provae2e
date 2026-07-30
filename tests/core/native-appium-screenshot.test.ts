import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  approveNativeScreenshotBaseline,
  captureNativeScreenshot,
  compareNativeScreenshot
} from '../../src/core/native-appium-screenshot';
import type { AppiumFetch } from '../../src/core/native-appium-runner';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3
]);

describe('native Appium screenshots', () => {
  it('captures bounded PNG evidence atomically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'prova-native-shot-'));
    const fetcher: AppiumFetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => ({ value: PNG.toString('base64') })
    }));
    const evidence = await captureNativeScreenshot(
      'http://localhost:4723/', 'session/29', root, 'login-screen', fetcher
    );
    expect(evidence.bytes).toBe(PNG.length);
    expect(await readFile(evidence.path)).toEqual(PNG);
    expect(evidence.sha256).toHaveLength(64);
  });

  it('rejects invalid names, non-PNG responses, and provider failures', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'prova-native-shot-'));
    const invalid: AppiumFetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => ({ value: Buffer.from('not png').toString('base64') })
    }));
    await expect(captureNativeScreenshot('http://localhost', 's', root, '../escape', invalid))
      .rejects.toThrow();
    await expect(captureNativeScreenshot('http://localhost', 's', root, 'safe', invalid))
      .rejects.toThrow('PNG');
    const failed: AppiumFetch = jest.fn(async () => ({
      ok: false, status: 500, json: async () => ({})
    }));
    await expect(captureNativeScreenshot('http://localhost', 's', root, 'safe', failed))
      .rejects.toThrow('HTTP 500');
  });

  it('compares digests and updates baselines only with explicit approval', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'prova-native-shot-'));
    const evidence = path.join(root, 'evidence.png');
    const baseline = path.join(root, 'baseline.png');
    await writeFile(evidence, PNG);
    await expect(approveNativeScreenshotBaseline(evidence, baseline, false))
      .rejects.toThrow('explicit approval');
    await approveNativeScreenshotBaseline(evidence, baseline, true);
    await expect(compareNativeScreenshot(evidence, baseline)).resolves.toMatchObject({ matched: true });
    await writeFile(baseline, Buffer.concat([PNG, Buffer.from([9])]));
    await expect(compareNativeScreenshot(evidence, baseline)).resolves.toMatchObject({ matched: false });
  });
});
