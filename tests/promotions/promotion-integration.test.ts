import { createServer } from 'node:http';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runPromotionChain } from '../../src/promotions/env-chain-manager';

describe('promotion gate integration', () => {
  jest.setTimeout(30_000);

  it('runs Playwright against an isolated local source without contacting the target', async () => {
    let sourceRequests = 0;
    let targetRequests = 0;
    const source = createServer((_request, response) => {
      sourceRequests += 1;
      response.end('<title>Local promotion source</title>');
    });
    const target = createServer((_request, response) => {
      targetRequests += 1;
      response.end('<title>Target must not be touched</title>');
    });
    await Promise.all([
      new Promise<void>((resolve) => source.listen(0, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    ]);
    const sourceAddress = source.address();
    const targetAddress = target.address();
    if (!sourceAddress || typeof sourceAddress === 'string' || !targetAddress || typeof targetAddress === 'string') {
      throw new Error('Unable to allocate local promotion targets');
    }
    const testFile = path.join(process.cwd(), 'tests', 'promotions', `tmp-promotion-${process.pid}.spec.ts`);
    await writeFile(testFile, [
      "import { test, expect } from '@playwright/test';",
      "test('promotion source is healthy', async ({ page }) => {",
      "  await page.goto(process.env['PROVA_BASE_URL'] ?? '');",
      "  await expect(page).toHaveTitle('Local promotion source');",
      '});'
    ].join('\n'), 'utf-8');

    try {
      const result = await runPromotionChain({
        config: {
          environments: {
            dev: { url: `http://127.0.0.1:${sourceAddress.port}` },
            qe: { url: `http://127.0.0.1:${targetAddress.port}` }
          },
          chains: { release: ['dev', 'qe'] }
        },
        chain: 'release',
        source: 'dev',
        target: 'qe',
        testFile
      });
      expect(result).toEqual(expect.objectContaining({ status: 'PASS' }));
      expect(sourceRequests).toBeGreaterThan(0);
      expect(targetRequests).toBe(0);
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => source.close(() => resolve())),
        new Promise<void>((resolve) => target.close(() => resolve()))
      ]);
      await rm(testFile, { force: true });
    }
  });
});
