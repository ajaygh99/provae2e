/** Deterministic, token-free element discovery for adaptive selector healing. */
import type { Locator, Page } from '@playwright/test';
import type { SelectorDescriptor, SelectorTier } from './self-healing-selector.js';

export interface SelectorCandidateSummary {
  index: number;
  tag: string;
  text: string;
  testId?: string;
  id?: string;
  ariaLabel?: string;
  score: number;
}

export interface RankedSelectorCandidate {
  summary: SelectorCandidateSummary;
  descriptor: SelectorDescriptor;
  tier: SelectorTier;
  locator: Locator;
}

const CANDIDATE_SELECTOR = 'button,a,input,select,textarea,[role],[data-testid]';

function normalized(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Sørensen-Dice token similarity in the inclusive range 0..1. */
export function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalized(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalized(right).split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap++;
  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}

function descriptorText(descriptor: SelectorDescriptor, intentKey: string): string {
  const roleName = descriptor.role?.name instanceof RegExp
    ? descriptor.role.name.source
    : descriptor.role?.name ?? '';
  const text = descriptor.text instanceof RegExp ? descriptor.text.source : descriptor.text ?? '';
  return [intentKey, roleName, descriptor.testId, text, descriptor.css].filter(Boolean).join(' ');
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function uniqueDescriptor(
  page: Page,
  candidate: { text: string; testId?: string; id?: string }
): Promise<{ descriptor: SelectorDescriptor; tier: SelectorTier; locator: Locator } | undefined> {
  if (candidate.testId) {
    const locator = page.getByTestId(candidate.testId);
    if (await locator.count() === 1) return { descriptor: { testId: candidate.testId }, tier: 'data-testid', locator };
  }
  if (candidate.id) {
    const css = `[id="${escapeAttribute(candidate.id)}"]`;
    const locator = page.locator(css);
    if (await locator.count() === 1) return { descriptor: { css }, tier: 'css-selector', locator };
  }
  if (candidate.text) {
    const locator = page.getByText(candidate.text, { exact: true });
    if (await locator.count() === 1) return { descriptor: { text: candidate.text }, tier: 'text-content', locator };
  }
  return undefined;
}

/** Ranks a bounded set of interactive elements using local semantic fingerprints. */
export async function rankSelectorCandidates(
  page: Page,
  descriptor: SelectorDescriptor,
  intentKey: string,
  maximumCandidates = 100
): Promise<RankedSelectorCandidate[]> {
  const expected = descriptorText(descriptor, intentKey);
  const candidates = page.locator(CANDIDATE_SELECTOR);
  const count = Math.min(await candidates.count(), Math.max(1, maximumCandidates));
  const ranked: RankedSelectorCandidate[] = [];

  for (let index = 0; index < count; index++) {
    const element = candidates.nth(index);
    try {
      if (!(await element.isVisible())) continue;
      const tag = await element.evaluate(node => node.tagName.toLowerCase());
      const text = (await element.textContent() ?? '').trim().slice(0, 160);
      const testId = await element.getAttribute('data-testid') ?? undefined;
      const id = await element.getAttribute('id') ?? undefined;
      const ariaLabel = await element.getAttribute('aria-label') ?? undefined;
      const unique = await uniqueDescriptor(page, { text, testId, id });
      if (!unique) continue;
      const identity = [testId, id, ariaLabel, text, tag].filter(Boolean).join(' ');
      const score = Math.round(tokenSimilarity(expected, identity) * 1000) / 1000;
      ranked.push({
        summary: { index, tag, text, score, ...(testId ? { testId } : {}), ...(id ? { id } : {}), ...(ariaLabel ? { ariaLabel } : {}) },
        ...unique
      });
    } catch {
      // Detached or inaccessible candidates are expected during dynamic-page scans.
    }
  }
  return ranked.sort((left, right) => right.summary.score - left.summary.score);
}
