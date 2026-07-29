import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppiumFetch } from './native-appium-runner.js';

const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface NativeScreenshotEvidence {
  path: string;
  sha256: string;
  bytes: number;
}

function safeName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) {
    throw new Error('Screenshot name must be a safe 1 to 128 character identifier');
  }
  return name;
}

function decodePng(base64: string): Buffer {
  if (base64.length === 0 || base64.length > Math.ceil(MAX_SCREENSHOT_BYTES * 4 / 3) + 4) {
    throw new Error('Appium screenshot exceeds the 25 MiB limit');
  }
  const image = Buffer.from(base64, 'base64');
  if (image.length === 0 || image.length > MAX_SCREENSHOT_BYTES || !image.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error('Appium screenshot must be a bounded PNG');
  }
  return image;
}

async function atomicWrite(filePath: string, contents: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: 'wx' });
    await rename(temporary, filePath);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function digest(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

export async function captureNativeScreenshot(
  appiumUrl: string,
  sessionId: string,
  evidenceRoot: string,
  name: string,
  fetcher: AppiumFetch = fetch as AppiumFetch
): Promise<NativeScreenshotEvidence> {
  const response = await fetcher(
    `${appiumUrl.replace(/\/+$/, '')}/session/${encodeURIComponent(sessionId)}/screenshot`,
    { method: 'GET' }
  );
  if (!response.ok) {
    throw new Error(`Native screenshot failed with HTTP ${response.status}`);
  }
  const payload = await response.json() as { value?: unknown };
  if (typeof payload.value !== 'string') {
    throw new Error('Appium screenshot response is missing base64 PNG data');
  }
  const image = decodePng(payload.value);
  const filePath = path.resolve(evidenceRoot, `${safeName(name)}.png`);
  await atomicWrite(filePath, image);
  return { path: filePath, sha256: digest(image), bytes: image.length };
}

export async function compareNativeScreenshot(
  evidencePath: string,
  baselinePath: string
): Promise<{ matched: boolean; evidenceSha256: string; baselineSha256: string }> {
  const [evidence, baseline] = await Promise.all([readFile(evidencePath), readFile(baselinePath)]);
  const evidenceSha256 = digest(decodePng(evidence.toString('base64')));
  const baselineSha256 = digest(decodePng(baseline.toString('base64')));
  return { matched: evidenceSha256 === baselineSha256, evidenceSha256, baselineSha256 };
}

/** Baseline mutation is a separate, explicit approval operation. */
export async function approveNativeScreenshotBaseline(
  evidencePath: string,
  baselinePath: string,
  approved: boolean
): Promise<void> {
  if (!approved) {
    throw new Error('Native screenshot baseline update requires explicit approval');
  }
  const evidence = await readFile(evidencePath);
  decodePng(evidence.toString('base64'));
  await atomicWrite(path.resolve(baselinePath), evidence);
}
