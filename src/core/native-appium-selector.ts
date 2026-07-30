import type { AppiumFetch } from './native-appium-runner.js';

export type NativeSelectorStrategy =
  | 'accessibility id'
  | 'id'
  | '-android uiautomator'
  | '-ios predicate string'
  | 'xpath';

export interface NativeSelectorCandidate {
  strategy: NativeSelectorStrategy;
  value: string;
}

export interface NativeElementMatch {
  elementId: string;
  strategy: NativeSelectorStrategy;
  candidateIndex: number;
}

const MAX_SELECTOR_LENGTH = 2048;
const ELEMENT_KEYS = ['element-6066-11e4-a52e-4f735466cecf', 'ELEMENT'] as const;

export function validateNativeSelectors(candidates: NativeSelectorCandidate[]): NativeSelectorCandidate[] {
  if (candidates.length === 0 || candidates.length > 5) {
    throw new Error('Native selector chain must contain between 1 and 5 candidates');
  }
  const seen = new Set<NativeSelectorStrategy>();
  for (const candidate of candidates) {
    if (candidate.value.trim().length === 0 || candidate.value.length > MAX_SELECTOR_LENGTH) {
      throw new Error('Native selector values must contain 1 to 2048 characters');
    }
    if (seen.has(candidate.strategy)) {
      throw new Error(`Duplicate native selector strategy: ${candidate.strategy}`);
    }
    if (candidate.strategy === 'xpath' && !candidate.value.startsWith('//')) {
      throw new Error('Native XPath selectors must be relative descendant expressions');
    }
    seen.add(candidate.strategy);
  }
  if (candidates[0]?.strategy !== 'accessibility id') {
    throw new Error('Native selector fallback must start with accessibility id');
  }
  return candidates.map((candidate) => ({ ...candidate, value: candidate.value.trim() }));
}

export async function findNativeElement(
  appiumUrl: string,
  sessionId: string,
  candidates: NativeSelectorCandidate[],
  fetcher: AppiumFetch = fetch as AppiumFetch
): Promise<NativeElementMatch> {
  const validated = validateNativeSelectors(candidates);
  const endpoint = `${appiumUrl.replace(/\/+$/, '')}/session/${encodeURIComponent(sessionId)}/element`;

  for (let index = 0; index < validated.length; index += 1) {
    const candidate = validated[index] as NativeSelectorCandidate;
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ using: candidate.strategy, value: candidate.value })
    });
    if (!response.ok) {
      continue;
    }
    const payload = await response.json() as { value?: Record<string, unknown> };
    const elementId = ELEMENT_KEYS
      .map((key) => payload.value?.[key])
      .find((value): value is string => typeof value === 'string' && value.length > 0);
    if (elementId) {
      return { elementId, strategy: candidate.strategy, candidateIndex: index };
    }
  }
  throw new Error('Unable to resolve native element with configured selector chain');
}
