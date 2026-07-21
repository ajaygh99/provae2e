/** Deterministic Playwright generation from multilingual acceptance criteria. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseGherkin, type AcceptanceLanguage } from '../parsers/gherkin-parser.js';
import { stepToPlaywright } from '../mappers/step-to-playwright.js';

export interface AiSpecOptions {
  specFile: string;
  outputDir: string;
  url: string;
  language?: AcceptanceLanguage;
  browsers?: string[];
}
export type AiSpecResult = { ok: true; file: string; scenarios: number } | { ok: false; error: string };

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'generated';
}

/** Generates a reviewed deterministic Playwright skeleton without an external AI call. */
export async function generateAiSpec(options: AiSpecOptions): Promise<AiSpecResult> {
  try {
    const url = new URL(options.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('URL must use HTTP or HTTPS');
    const feature = parseGherkin(await readFile(options.specFile, 'utf-8'), options.language ?? 'en');
    const browsers = options.browsers ?? ['chromium', 'firefox', 'webkit'];
    if (browsers.some((browser) => !['chromium', 'firefox', 'webkit'].includes(browser))) {
      throw new Error('Browsers must be chromium, firefox, or webkit');
    }
    const lines = [
      "import { test, expect } from '@playwright/test';", '',
      `test.describe(${JSON.stringify(feature.name)}, { tag: ${JSON.stringify(browsers.map((browser) => `@${browser}`))} }, () => {`
    ];
    for (const scenario of feature.scenarios) {
      lines.push(`  test(${JSON.stringify(scenario.name)}, async ({ page }) => {`);
      for (const step of scenario.steps) {
        lines.push(`    // ${step.kind}: ${step.text}`, ...stepToPlaywright(step, options.url).map((line) => `    ${line}`));
      }
      lines.push('  });');
    }
    lines.push('});', '');
    await mkdir(options.outputDir, { recursive: true });
    const file = path.resolve(options.outputDir, `${safeName(feature.name)}.spec.ts`);
    await writeFile(file, lines.join('\n'), { encoding: 'utf-8', flag: 'wx' });
    return { ok: true, file, scenarios: feature.scenarios.length };
  } catch (error) {
    return { ok: false, error: `AI spec generation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
