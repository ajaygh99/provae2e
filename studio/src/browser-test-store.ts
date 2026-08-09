import type { CapturedSelector } from './components/ElementSelectorTool';

export interface StudioBrowserTest {
  id: string;
  name: string;
  targetUrl: string;
  selector: CapturedSelector;
  savedAt: string;
}

export interface StudioExecutionResult {
  testId: string;
  testName: string;
  status: 'PASS' | 'FAIL';
  details: string;
  executedAt: string;
}

const TEST_KEY = 'prova.studio.browser-test';
const RESULT_KEY = 'prova.studio.execution-result';

export function saveBrowserTest(test: StudioBrowserTest): void {
  localStorage.setItem(TEST_KEY, JSON.stringify(test));
}

export function loadBrowserTest(): StudioBrowserTest | undefined {
  const value = localStorage.getItem(TEST_KEY);
  return value ? JSON.parse(value) as StudioBrowserTest : undefined;
}

export function saveExecutionResult(result: StudioExecutionResult): void {
  localStorage.setItem(RESULT_KEY, JSON.stringify(result));
}

export function loadExecutionResult(): StudioExecutionResult | undefined {
  const value = localStorage.getItem(RESULT_KEY);
  return value ? JSON.parse(value) as StudioExecutionResult : undefined;
}
