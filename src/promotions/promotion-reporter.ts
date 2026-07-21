import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PromotionResult } from './env-chain-manager.js';

/** Writes a detailed JSON promotion report and returns its absolute path. */
export async function writePromotionReport(result: PromotionResult, outputPath: string): Promise<string> {
  const absolute = path.resolve(outputPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf-8' });
  return absolute;
}
