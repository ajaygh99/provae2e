import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateAiSpec } from '../../src/generators/ai-spec-generator';
import { parseGherkin } from '../../src/parsers/gherkin-parser';
import { stepToPlaywright } from '../../src/mappers/step-to-playwright';

describe('parseGherkin', () => {
  it.each([
    ['en', 'Feature: Login\nScenario: Valid\nGiven user is on login page\nWhen user clicks "Sign In"\nThen user should see "Dashboard"'],
    ['es', 'Característica: Acceso\nEscenario: Válido\nDado usuario listo\nCuando continúa\nEntonces termina'],
    ['fr', 'Fonctionnalité: Accès\nScénario: Valide\nÉtant donné utilisateur prêt\nQuand il continue\nAlors terminé']
  ] as const)('parses %s scenarios', (language, source) => {
    const result = parseGherkin(source, language);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].steps).toHaveLength(3);
  });

  it('parses bullets, ignores comments, and joins continuation lines', () => {
    const result = parseGherkin('# ignore\n- first assertion\ncontinued detail\n* second assertion');
    expect(result.scenarios[0].steps.map((step) => step.text)).toEqual(['first assertion continued detail', 'second assertion']);
  });

  it('rejects empty specifications', () => expect(() => parseGherkin('# only comment')).toThrow('No Given'));
});

describe('stepToPlaywright', () => {
  it.each([
    [{ kind: 'given', text: 'user is on "https://example.com/login"' }, 'page.goto'],
    [{ kind: 'when', text: 'user enters "ajay@example.com" in "Email"' }, '.fill('],
    [{ kind: 'when', text: 'user clicks "Sign In" button' }, 'getByRole'],
    [{ kind: 'then', text: 'URL should contain "/dashboard"' }, 'toHaveURL'],
    [{ kind: 'then', text: 'user should see "Welcome"' }, 'toBeVisible'],
    [{ kind: 'when', text: 'wait 3 seconds' }, '3000']
  ] as const)('maps common step %#', (step, expected) => {
    expect(stepToPlaywright(step, 'https://example.com').join('\n')).toContain(expected);
  });

  it('returns a TODO for product-specific steps', () => {
    expect(stepToPlaywright({ kind: 'and', text: 'does something unique' }, 'https://example.com')[0]).toContain('TODO');
  });
});

describe('generateAiSpec', () => {
  it('writes valid Playwright TypeScript with browser tags', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-ai-gen-'));
    const spec = path.join(directory, 'spec.md');
    const output = path.join(directory, 'output');
    await writeFile(spec, 'Feature: Login\nScenario: Valid credentials\nGiven user is on login page\nWhen user clicks "Sign In"\nThen user should see "Dashboard"');
    const result = await generateAiSpec({ specFile: spec, outputDir: output, url: 'https://example.com' });
    expect(result.ok).toBe(true);
    const source = await readFile(result.ok ? result.file : '', 'utf-8');
    expect(source).toContain("from '@playwright/test'");
    expect(source).toContain('@chromium');
    expect(source).toContain('getByRole');
  });

  it('returns errors for invalid URLs, browsers, and overwrite attempts', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'prova-ai-gen-'));
    const spec = path.join(directory, 'spec.md');
    await writeFile(spec, '- page should see "Ready"');
    await expect(generateAiSpec({ specFile: spec, outputDir: directory, url: 'ftp://bad' }))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining('HTTP') });
    await expect(generateAiSpec({ specFile: spec, outputDir: directory, url: 'https://example.com', browsers: ['netscape'] }))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining('Browsers') });
    const first = await generateAiSpec({ specFile: spec, outputDir: directory, url: 'https://example.com' });
    expect(first.ok).toBe(true);
    await expect(generateAiSpec({ specFile: spec, outputDir: directory, url: 'https://example.com' }))
      .resolves.toMatchObject({ ok: false });
  });
});
