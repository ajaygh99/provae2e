/**
 * AI-assisted Playwright test generation from plain-text or Markdown specs.
 */
import axios from 'axios';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ENDPOINT = 'http://localhost:11434/api/generate';
const DEFAULT_MODEL = 'llama3.1:8b';

/** Test styles supported by spec generation. */
export type GeneratedTestType = 'browser' | 'api';

/** Options accepted by {@link generateTestsFromSpec}. */
export interface GenerateTestsOptions {
  /** Plain-text or Markdown specification file. Mutually exclusive with `specText`. */
  specFile?: string;
  /** Already-loaded specification text, for example from JIRA. Mutually exclusive with `specFile`. */
  specText?: string;
  /** Human-readable source label used in empty-spec errors. */
  sourceLabel?: string;
  /** Kind of Playwright test to generate. */
  type: GeneratedTestType;
  /** Target URL embedded into every generated test. */
  url: string;
  /** Destination directory. Defaults to `./generated-tests`. */
  outputDir?: string;
  /** Ollama generation endpoint. */
  endpoint?: string;
  /** Local Ollama model. */
  model?: string;
  /** Per-criterion Ollama timeout in milliseconds. */
  timeoutMs?: number;
}

/** Successful or failed generation outcome. */
export type GenerateTestsResult =
  | { ok: true; criteria: string[]; files: string[] }
  | { ok: false; error: string };

interface OllamaGenerateResponse {
  response?: string;
}

/** Removes common Markdown list markers while retaining the criterion text. */
function stripListMarker(line: string): { text: string; listed: boolean } {
  const checkbox = line.match(/^[-*+]\s+\[[ xX]\]\s+(.+)$/);
  if (checkbox) {
    return { text: checkbox[1].trim(), listed: true };
  }
  const bullet = line.match(/^[-*+]\s+(.+)$/);
  if (bullet) {
    return { text: bullet[1].trim(), listed: true };
  }
  const numbered = line.match(/^\d+[.)]\s+(.+)$/);
  if (numbered) {
    return { text: numbered[1].trim(), listed: true };
  }
  return { text: line, listed: false };
}

/**
 * Extracts pragmatic acceptance criteria from Markdown/plain text.
 * Given/When/Then blocks are grouped as one scenario; bullets and numbered
 * items are treated as individual criteria. Plain lines under an
 * `Acceptance Criteria` heading are also accepted.
 *
 * @param spec - Raw specification text.
 * @returns De-duplicated acceptance criteria in source order.
 */
export function extractAcceptanceCriteria(spec: string): string[] {
  const criteria: string[] = [];
  let scenario: string[] = [];
  let inAcceptanceSection = false;

  const add = (criterion: string): void => {
    const normalized = criterion.replace(/\s+/g, ' ').trim();
    if (normalized && !criteria.includes(normalized)) {
      criteria.push(normalized);
    }
  };
  const flushScenario = (): void => {
    if (scenario.length > 0) {
      add(scenario.join(' '));
      scenario = [];
    }
  };

  for (const rawLine of spec.split(/\r?\n/)) {
    const trimmed = rawLine.trim().replace(/^>\s?/, '');
    if (!trimmed) {
      flushScenario();
      continue;
    }

    const headingText = trimmed.replace(/^#{1,6}\s*/, '').replace(/:$/, '').trim();
    if (/^acceptance criteria$/i.test(headingText)) {
      flushScenario();
      inAcceptanceSection = true;
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      flushScenario();
      inAcceptanceSection = false;
      continue;
    }

    const { text, listed } = stripListMarker(trimmed);
    if (/^(given|when|then|and|but)\b/i.test(text)) {
      if (/^given\b/i.test(text)) {
        flushScenario();
      }
      scenario.push(text);
      continue;
    }

    flushScenario();
    if (listed || inAcceptanceSection) {
      add(text);
    }
  }
  flushScenario();
  return criteria;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || 'criterion';
}

function buildPrompt(criterion: string, type: GeneratedTestType, url: string): string {
  const guidance = type === 'browser'
    ? 'Use page.goto and user-visible Playwright locators such as getByRole or getByText.'
    : 'Use Playwright request/APIRequestContext and assert the HTTP response status and relevant response data.';
  return [
    'You are a senior quality engineer generating one runnable Playwright TypeScript test.',
    `Test type: ${type}. Target URL: ${url}`,
    `Acceptance criterion: ${criterion}`,
    guidance,
    "Import test and expect from '@playwright/test'.",
    'Return only TypeScript source code. Do not use Markdown fences or explanatory prose.',
    'Keep uncertain product-specific selectors or payload values as clearly named constants with safe example values.'
  ].join('\n');
}

function cleanGeneratedSource(response: string): string {
  const trimmed = response.trim();
  const fenced = trimmed.match(/^```(?:typescript|ts)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

function validateGeneratedSource(source: string): string | undefined {
  if (!source) {
    return 'Ollama returned an empty response';
  }
  if (!source.includes('@playwright/test') || !/\btest\s*\(/.test(source) || !/\bexpect\s*\(/.test(source)) {
    return 'Ollama response was not a runnable Playwright test skeleton';
  }
  return undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a spec, generates one Playwright test per acceptance criterion through
 * local Ollama, and writes the validated TypeScript files to disk.
 * All operational failures are returned as `{ ok: false }`; none are thrown.
 *
 * @param options - Spec path, test type, target URL, output, and Ollama overrides.
 * @returns Generated criteria/files or a clear failure message.
 */
export async function generateTestsFromSpec(options: GenerateTestsOptions): Promise<GenerateTestsResult> {
  try {
    if (options.type !== 'browser' && options.type !== 'api') {
      return { ok: false, error: `Invalid generation type "${String(options.type)}": use browser or api` };
    }
    if (!isHttpUrl(options.url)) {
      return { ok: false, error: `Invalid target URL "${options.url}": use an absolute http:// or https:// URL` };
    }

    if (Boolean(options.specFile) === Boolean(options.specText)) {
      return { ok: false, error: 'Provide exactly one specification source: specFile or specText' };
    }
    let spec: string;
    if (options.specText !== undefined) {
      spec = options.specText;
    } else if (options.specFile !== undefined) {
      spec = await readFile(options.specFile, 'utf-8');
    } else {
      return { ok: false, error: 'Provide exactly one specification source: specFile or specText' };
    }
    if (!spec.trim()) {
      return { ok: false, error: `Spec is empty: ${options.sourceLabel ?? options.specFile ?? 'provided text'}` };
    }
    const criteria = extractAcceptanceCriteria(spec);
    if (criteria.length === 0) {
      return {
        ok: false,
        error: 'No acceptance criteria found. Use Given/When/Then, bullets, numbered criteria, or an Acceptance Criteria section.'
      };
    }

    const outputDir = path.resolve(options.outputDir ?? './generated-tests');
    const plannedFiles = criteria.map((criterion, index) =>
      path.join(outputDir, `${options.type}-${String(index + 1).padStart(3, '0')}-${slugify(criterion)}.spec.ts`)
    );
    for (const filePath of plannedFiles) {
      if (await fileExists(filePath)) {
        return { ok: false, error: `Refusing to overwrite existing generated test: ${filePath}` };
      }
    }

    const sources: string[] = [];
    for (let index = 0; index < criteria.length; index++) {
      const response = await axios.post<OllamaGenerateResponse>(
        options.endpoint ?? DEFAULT_ENDPOINT,
        {
          model: options.model ?? DEFAULT_MODEL,
          prompt: buildPrompt(criteria[index], options.type, options.url),
          stream: false
        },
        { timeout: options.timeoutMs ?? 30000 }
      );
      const source = cleanGeneratedSource(response.data.response ?? '');
      const validationError = validateGeneratedSource(source);
      if (validationError) {
        return { ok: false, error: `Criterion ${index + 1}: ${validationError}` };
      }
      sources.push(source + '\n');
    }

    await mkdir(outputDir, { recursive: true });
    for (let index = 0; index < plannedFiles.length; index++) {
      await writeFile(plannedFiles[index], sources[index], { encoding: 'utf-8', flag: 'wx' });
    }
    return { ok: true, criteria, files: plannedFiles };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Test generation failed: ${message}` };
  }
}
