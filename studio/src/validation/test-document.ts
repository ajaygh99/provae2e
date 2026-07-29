import { LineCounter, parseDocument } from 'yaml';
import type { StudioTestFile } from '../api/studio-api';

export interface EditorDiagnostic {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

const actions = ['navigate', 'click', 'fill', 'assert', 'wait'] as const;

/** Fast client-side validation. The service repeats validation before every save. */
export function validateTestDocument(content: string, format: StudioTestFile['format']): EditorDiagnostic[] {
  const parsed = parseContent(content, format);
  if (parsed.diagnostics.length > 0) return parsed.diagnostics;
  if (!isRecord(parsed.value)) {
    return [{ path: '$', message: 'Test definition must be an object.' }];
  }

  const diagnostics: EditorDiagnostic[] = [];
  if (!isText(parsed.value.name)) diagnostics.push({ path: '$.name', message: 'name is required.' });
  if (!isText(parsed.value.url) || !isHttpUrl(parsed.value.url)) {
    diagnostics.push({ path: '$.url', message: 'url must be an absolute http:// or https:// URL.' });
  }
  if (!Array.isArray(parsed.value.steps) || parsed.value.steps.length === 0) {
    diagnostics.push({ path: '$.steps', message: 'steps must contain at least one test step.' });
  } else {
    parsed.value.steps.forEach((step, index) => validateStep(step, index, diagnostics));
  }
  return diagnostics;
}

function parseContent(
  content: string,
  format: StudioTestFile['format']
): { value?: unknown; diagnostics: EditorDiagnostic[] } {
  if (format === 'json') {
    try {
      return { value: JSON.parse(content) as unknown, diagnostics: [] };
    } catch (error) {
      return {
        diagnostics: [{
          path: '$',
          message: `Invalid JSON: ${error instanceof Error ? error.message : 'syntax error'}`
        }]
      };
    }
  }

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

function validateStep(value: unknown, index: number, diagnostics: EditorDiagnostic[]): void {
  const path = `$.steps[${index}]`;
  if (!isRecord(value)) {
    diagnostics.push({ path, message: 'step must be an object.' });
    return;
  }
  if (typeof value.action !== 'string' || !(actions as readonly string[]).includes(value.action)) {
    diagnostics.push({ path: `${path}.action`, message: `action must be ${actions.join(', ')}.` });
    return;
  }
  if (['click', 'fill', 'assert'].includes(value.action) && !isText(value.selector)) {
    diagnostics.push({ path: `${path}.selector`, message: `selector is required for ${value.action}.` });
  }
  if (value.action === 'fill' && !isText(value.value)) {
    diagnostics.push({ path: `${path}.value`, message: 'value is required for fill.' });
  }
  if (value.action === 'assert' && !isText(value.expected)) {
    diagnostics.push({ path: `${path}.expected`, message: 'expected is required for assert.' });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
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
