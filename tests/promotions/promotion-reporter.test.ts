import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writePromotionReport } from '../../src/promotions/promotion-reporter';

describe('writePromotionReport', () => {
  it('creates parent directories and writes a detailed JSON report', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-report-'));
    const output = path.join(directory, 'nested', 'promotion.json');
    const result = {
      status: 'PASS' as const,
      chain: 'release',
      source: 'dev',
      target: 'qe',
      testFile: 'smoke.spec.ts',
      startedAt: '2026-07-21T00:00:00.000Z',
      steps: [{ environment: 'dev', passed: true, durationMs: 5 }],
      summary: 'PASS: dev -> qe'
    };
    await expect(writePromotionReport(result, output)).resolves.toBe(path.resolve(output));
    expect(JSON.parse(await readFile(output, 'utf-8'))).toEqual(result);
  });
});
