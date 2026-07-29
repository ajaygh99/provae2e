import { LineCounter, parseDocument } from 'yaml';
import type {
  StudioDiagnostic,
  StudioTestFormat
} from './studio-api-contract.js';

export const STUDIO_STEP_ACTIONS = ['navigate', 'click', 'fill', 'assert', 'wait'] as const;
export type StudioStepAction = typeof STUDIO_STEP_ACTIONS[number];

export interface StudioStepDefinition {
  id?: string;
  action: StudioStepAction;
  selector?: string;
  value?: string;
  expected?: string;
  timeoutMs?: number;
}

export interface StudioTestDefinition {
  name: string;
  url: string;
  browser?: 'chromium' | 'firefox' | 'webkit' | 'all';
  steps: StudioStepDefinition[];
}

export interface StudioValidationResult {
  definition?: StudioTestDefinition;
  diagnostics: readonly StudioDiagnostic[];
}

/** Parses JSON/YAML and applies the Phase 4.1 Studio test-definition schema. */
export function validateStudioDocument(
  content: string,
  format: StudioTestFormat
): StudioValidationResult {
  const parsed = format === 'json' ? parseJson(content) : parseYaml(content);
  if (parsed.diagnostics.length > 0) return parsed;
  return validateDefinition(parsed.value);
}

function parseJson(content: string): { value?: unknown; diagnostics: StudioDiagnostic[] } {
  try {
    return { value: JSON.parse(content) as unknown, diagnostics: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON.';
    const position = /position (\d+)/.exec(message);
    const location = position ? offsetToLocation(content, Number(position[1])) : undefined;
    return {
      diagnostics: [{
        path: '$',
        message,
        line: location?.line,
        column: location?.column
      }]
    };
  }
}

function parseYaml(content: string): { value?: unknown; diagnostics: StudioDiagnostic[] } {
  const lineCounter = new LineCounter();
  const document = parseDocument(content, { lineCounter, prettyErrors: true });
  if (document.errors.length > 0) {
    return {
      diagnostics: document.errors.map(error => ({
        path: '$',
        message: error.message,
        line: error.linePos?.[0]?.line,
        column: error.linePos?.[0]?.col
      }))
    };
  }
  return { value: document.toJS() as unknown, diagnostics: [] };
}

function validateDefinition(value: unknown): StudioValidationResult {
  const diagnostics: StudioDiagnostic[] = [];
  if (!isRecord(value)) {
    return { diagnostics: [{ path: '$', message: 'Test definition must be an object.' }] };
  }

  if (!isNonEmptyString(value['name'])) {
    diagnostics.push({ path: '$.name', message: 'name is required.' });
  }
  if (!isNonEmptyString(value['url']) || !isHttpUrl(value['url'])) {
    diagnostics.push({ path: '$.url', message: 'url must be an absolute http:// or https:// URL.' });
  }
  if (
    value['browser'] !== undefined &&
    !['chromium', 'firefox', 'webkit', 'all'].includes(String(value['browser']))
  ) {
    diagnostics.push({ path: '$.browser', message: 'browser must be chromium, firefox, webkit, or all.' });
  }
  if (!Array.isArray(value['steps']) || value['steps'].length === 0) {
    diagnostics.push({ path: '$.steps', message: 'steps must contain at least one test step.' });
  } else if (value['steps'].length > 500) {
    diagnostics.push({ path: '$.steps', message: 'steps cannot contain more than 500 entries.' });
  } else {
    value['steps'].forEach((step, index) => validateStep(step, index, diagnostics));
  }

  if (diagnostics.length > 0) return { diagnostics };
  return { definition: value as unknown as StudioTestDefinition, diagnostics };
}

function validateStep(value: unknown, index: number, diagnostics: StudioDiagnostic[]): void {
  const stepPath = `$.steps[${index}]`;
  if (!isRecord(value)) {
    diagnostics.push({ path: stepPath, message: 'step must be an object.' });
    return;
  }
  const action = value['action'];
  if (typeof action !== 'string' || !(STUDIO_STEP_ACTIONS as readonly string[]).includes(action)) {
    diagnostics.push({ path: `${stepPath}.action`, message: `action must be ${STUDIO_STEP_ACTIONS.join(', ')}.` });
    return;
  }
  if (['click', 'fill', 'assert'].includes(action) && !isNonEmptyString(value['selector'])) {
    diagnostics.push({ path: `${stepPath}.selector`, message: `selector is required for ${action}.` });
  }
  if (action === 'fill' && !isNonEmptyString(value['value'])) {
    diagnostics.push({ path: `${stepPath}.value`, message: 'value is required for fill.' });
  }
  if (action === 'assert' && !isNonEmptyString(value['expected'])) {
    diagnostics.push({ path: `${stepPath}.expected`, message: 'expected is required for assert.' });
  }
  if (
    value['timeoutMs'] !== undefined &&
    (typeof value['timeoutMs'] !== 'number' ||
      !Number.isInteger(value['timeoutMs']) ||
      value['timeoutMs'] < 0 ||
      value['timeoutMs'] > 900_000)
  ) {
    diagnostics.push({ path: `${stepPath}.timeoutMs`, message: 'timeoutMs must be an integer from 0 to 900000.' });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function offsetToLocation(content: string, offset: number): { line: number; column: number } {
  const before = content.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

