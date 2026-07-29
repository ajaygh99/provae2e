/** Deterministic Playwright component stubs from extracted Figma elements. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FigmaElement } from '../core/figma-connector.js';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'component';
}

export interface FigmaTestGenerationOptions {
  baseUrl?: string;
  overwrite?: boolean;
}

/** Generates one deterministic, directly runnable Playwright test per meaningful Figma element. */
export async function generateFigmaTests(
  elements: readonly FigmaElement[],
  outputDir: string,
  options: FigmaTestGenerationOptions = {}
): Promise<string[]> {
  if (!elements.length) throw new Error('At least one Figma element is required');
  if (elements.length > 500) throw new Error('Figma test generation supports at most 500 elements');
  if (options.baseUrl) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Figma test baseUrl must use http:// or https://');
    }
  }
  await mkdir(outputDir, { recursive: true });
  const files: string[] = [];
  for (const [index, element] of elements.entries()) {
    const testId = slug(element.name);
    const file = path.resolve(outputDir, `${String(index + 1).padStart(3, '0')}-${testId}.spec.ts`);
    const interactive = /(button|link|checkbox|dropdown)/i.test(element.name);
    const input = /(input|field|textbox|search)/i.test(element.name);
    const actions = input
      ? ["  await component.fill('TODO test value');"]
      : interactive ? ['  await component.click();'] : [];
    const locator = locatorFor(element, testId);
    const configuredUrl = options.baseUrl
      ? JSON.stringify(options.baseUrl)
      : "process.env['PROVA_BASE_URL']";
    const source = [
      "import { test, expect } from '@playwright/test';", '',
      `test(${JSON.stringify(`${element.name} interaction`)}, async ({ page }) => {`,
      `  const targetUrl = ${configuredUrl};`,
      "  test.skip(!targetUrl, 'Set PROVA_BASE_URL or generate with a baseUrl.');",
      '  await page.goto(targetUrl);',
      `  const component = ${locator};`,
      '  await expect(component).toBeVisible();', ...actions,
      '});', ''
    ].join('\n');
    await writeIdempotently(file, source, options.overwrite ?? false);
    files.push(file);
  }
  return files;
}

function locatorFor(element: FigmaElement, testId: string): string {
  const name = JSON.stringify(element.name);
  if (/button/i.test(element.name)) return `page.getByRole('button', { name: ${name}, exact: true })`;
  if (/link/i.test(element.name)) return `page.getByRole('link', { name: ${name}, exact: true })`;
  if (/checkbox/i.test(element.name)) return `page.getByRole('checkbox', { name: ${name}, exact: true })`;
  if (/(input|field|textbox|search)/i.test(element.name)) return `page.getByLabel(${name}, { exact: true })`;
  if (element.text) return `page.getByText(${JSON.stringify(element.text)}, { exact: true })`;
  return `page.getByTestId(${JSON.stringify(testId)})`;
}

async function writeIdempotently(file: string, source: string, overwrite: boolean): Promise<void> {
  try {
    await writeFile(file, source, { encoding: 'utf-8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const current = await readFile(file, 'utf8');
    if (current === source) return;
    if (!overwrite) {
      throw new Error(`Refusing to overwrite changed generated test: ${path.basename(file)}`);
    }
    await writeFile(file, source, 'utf8');
  }
}
