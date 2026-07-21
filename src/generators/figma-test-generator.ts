/** Deterministic Playwright component stubs from extracted Figma elements. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FigmaElement } from '../core/figma-connector.js';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'component';
}

/** Generates one runnable Playwright stub per meaningful Figma element. */
export async function generateFigmaTests(elements: readonly FigmaElement[], outputDir: string): Promise<string[]> {
  if (!elements.length) throw new Error('At least one Figma element is required');
  await mkdir(outputDir, { recursive: true });
  const files: string[] = [];
  for (const [index, element] of elements.entries()) {
    const testId = slug(element.name);
    const file = path.resolve(outputDir, `${String(index + 1).padStart(3, '0')}-${testId}.spec.ts`);
    const interactive = /(button|link|checkbox|dropdown)/i.test(element.name);
    const input = /(input|field)/i.test(element.name);
    const actions = input
      ? ["  await component.fill('TODO test value');"]
      : interactive ? ['  await component.click();'] : [];
    const source = [
      "import { test, expect } from '@playwright/test';", '',
      `test(${JSON.stringify(`${element.name} interaction`)}, async ({ page }) => {`,
      '  // TODO: navigate to the screen containing this Figma component.',
      `  const component = page.getByTestId(${JSON.stringify(testId)});`,
      '  await expect(component).toBeVisible();', ...actions,
      '  // TODO: assert the expected product behavior after interaction.',
      '});', ''
    ].join('\n');
    await writeFile(file, source, { encoding: 'utf-8', flag: 'wx' });
    files.push(file);
  }
  return files;
}
