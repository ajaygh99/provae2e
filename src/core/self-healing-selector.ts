/**
 * Self-healing selector resolution — 5-tier fallback.
 * Tries increasingly fragile strategies in order, falling through to the next
 * tier automatically when one finds no match, so tests keep passing through
 * markup churn instead of breaking on the first renamed CSS class.
 *
 * Tier order (most stable → least stable):
 *   1. ARIA role/label   — page.getByRole
 *   2. data-testid       — page.getByTestId
 *   3. text content      — page.getByText
 *   4. visual position   — bounding-box match within a scoped region
 *   5. raw CSS selector  — page.locator, last resort
 */
import type { Locator, Page } from '@playwright/test';
import { log } from './logger.js';
import type { HealingMemoryStore } from './healing-memory.js';
import { rankSelectorCandidates, type SelectorCandidateSummary } from './adaptive-selector.js';

/** Identifies which tier a selector was ultimately resolved through. */
export type SelectorTier =
  | 'aria-role'
  | 'data-testid'
  | 'text-content'
  | 'visual-position'
  | 'css-selector';

/** Tier 1 config — matches {@link Page.getByRole}. */
export interface RoleSelector {
  /** ARIA role to match, e.g. `'button'`, `'link'`. */
  role: Parameters<Page['getByRole']>[0];
  /** Accessible name to further constrain the match. */
  name?: string | RegExp;
}

/** Tier 4 config — matches an element by its rendered bounding box. */
export interface PositionSelector {
  /** CSS selector scoping candidate elements. Defaults to `'body *'`. */
  scope?: string;
  /** Expected bounding box, in CSS pixels relative to the viewport. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Max allowed deviation per dimension, in pixels. Defaults to 5. */
  tolerance?: number;
}

/** Per-tier configuration accepted by {@link resolveSelector}. Only configured tiers are attempted, in fixed order. */
export interface SelectorDescriptor {
  /** Tier 1 — ARIA role/label. */
  role?: RoleSelector;
  /** Tier 2 — data-testid attribute. */
  testId?: string;
  /** Tier 3 — visible text content. */
  text?: string | RegExp;
  /** Tier 4 — visual position hash (bounding-box match). */
  position?: PositionSelector;
  /** Tier 5 — raw CSS selector, last resort. */
  css?: string;
}

/** A successfully resolved selector and the tier that found it. */
export interface ResolvedSelector {
  /** Playwright Locator pointing at the resolved element. */
  locator: Locator;
  /** The tier that succeeded. */
  tier: SelectorTier;
}

export interface SelectorLearningOptions {
  store: HealingMemoryStore;
  pageKey: string;
  intentKey: string;
  minimumConfidence?: number;
  /** Opt-in bounded local discovery after configured selectors fail. */
  discovery?: {
    enabled: boolean;
    minimumConfidence?: number;
    minimumScoreGap?: number;
    maximumCandidates?: number;
    resolveAmbiguity?: (
      intentKey: string,
      candidates: SelectorCandidateSummary[]
    ) => Promise<number | undefined>;
  };
}

/** Thrown by {@link resolveSelector} when no configured tier — or no tier at all — resolves to an element. */
export class SelectorResolutionError extends Error {
  constructor(descriptor: SelectorDescriptor) {
    super(`Unable to resolve selector using any of the 5 fallback tiers: ${JSON.stringify(descriptor)}`);
    this.name = 'SelectorResolutionError';
  }
}

const DEFAULT_POSITION_TOLERANCE = 5;
const DEFAULT_POSITION_SCOPE = 'body *';

/** Finds the first element within `scope` whose bounding box matches `position` within tolerance. */
async function resolveByPosition(page: Page, position: PositionSelector): Promise<Locator | undefined> {
  const scope = position.scope ?? DEFAULT_POSITION_SCOPE;
  const tolerance = position.tolerance ?? DEFAULT_POSITION_TOLERANCE;
  const candidates = page.locator(scope);
  const count = await candidates.count();

  let match: Locator | undefined;
  for (let i = 0; i < count; i++) {
    const candidate = candidates.nth(i);
    let box: Awaited<ReturnType<Locator['boundingBox']>>;
    try {
      box = await candidate.boundingBox();
    } catch (error) {
      log.debug('Position candidate detached, continuing', {
        index: i,
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    if (!box) {
      continue;
    }
    const matches =
      Math.abs(box.x - position.x) <= tolerance &&
      Math.abs(box.y - position.y) <= tolerance &&
      Math.abs(box.width - position.width) <= tolerance &&
      Math.abs(box.height - position.height) <= tolerance;
    if (matches) {
      if (match) {
        log.debug('Position selector was ambiguous', { scope });
        return undefined;
      }
      match = candidate;
    }
  }
  return match;
}

interface TierAttempt {
  tier: SelectorTier;
  resolve: () => Promise<Locator | undefined>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidPosition(position: PositionSelector): boolean {
  const values = [position.x, position.y, position.width, position.height];
  return values.every(Number.isFinite)
    && position.width > 0
    && position.height > 0
    && (position.tolerance === undefined || (Number.isFinite(position.tolerance) && position.tolerance >= 0))
    && (position.scope === undefined || isNonEmptyString(position.scope));
}

function buildAttempts(page: Page, descriptor: SelectorDescriptor): TierAttempt[] {
  const attempts: TierAttempt[] = [];

  if (descriptor.role && isNonEmptyString(descriptor.role.role)) {
    const { role, name } = descriptor.role;
    attempts.push({
      tier: 'aria-role',
      resolve: async () => page.getByRole(role, name !== undefined ? { name } : undefined)
    });
  }
  if (isNonEmptyString(descriptor.testId)) {
    const testId = descriptor.testId;
    attempts.push({ tier: 'data-testid', resolve: async () => page.getByTestId(testId) });
  }
  if (descriptor.text instanceof RegExp || isNonEmptyString(descriptor.text)) {
    const text = descriptor.text;
    attempts.push({ tier: 'text-content', resolve: async () => page.getByText(text) });
  }
  if (descriptor.position && isValidPosition(descriptor.position)) {
    const position = descriptor.position;
    attempts.push({ tier: 'visual-position', resolve: async () => resolveByPosition(page, position) });
  }
  if (isNonEmptyString(descriptor.css)) {
    const css = descriptor.css;
    attempts.push({ tier: 'css-selector', resolve: async () => page.locator(css) });
  }

  return attempts;
}

/**
 * Resolves a selector against a page by trying each configured tier in order,
 * falling through to the next tier when one finds no matching element.
 *
 * @param page - The Playwright page to search.
 * @param descriptor - Per-tier configuration; only configured tiers are attempted.
 * @returns The resolved Locator and the tier that found it.
 * @throws {SelectorResolutionError} When every configured tier fails to resolve an element.
 */
export async function resolveSelector(
  page: Page,
  descriptor: SelectorDescriptor,
  learning?: SelectorLearningOptions
): Promise<ResolvedSelector> {
  const recommendation = learning?.store.recommend(
    learning.pageKey,
    learning.intentKey,
    learning.minimumConfidence
  );
  const learnedAttempts = recommendation
    ? buildAttempts(page, recommendation.descriptor).filter(attempt => attempt.tier === recommendation.tier)
    : [];
  const attempts = [...learnedAttempts, ...buildAttempts(page, descriptor)];
  let learnedFailureRecorded = false;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const attempt = attempts[attemptIndex];
    try {
      const locator = await attempt.resolve();
      if (!locator) {
        continue;
      }
      const count = await locator.count();
      if (count === 1) {
        log.debug('Selector resolved', { tier: attempt.tier });
        if (learning) {
          const usedLearnedAttempt = Boolean(recommendation) && attemptIndex < learnedAttempts.length;
          await learning.store.recordSuccess(
            learning.pageKey,
            learning.intentKey,
            usedLearnedAttempt && recommendation ? recommendation.descriptor : descriptor,
            attempt.tier
          );
        }
        return { locator, tier: attempt.tier };
      }
      if (count > 1) {
        log.debug('Selector tier was ambiguous, falling through', { tier: attempt.tier, count });
      }
    } catch (err) {
      log.debug('Selector tier threw, falling through', { tier: attempt.tier, error: err instanceof Error ? err.message : String(err) });
    }
    if (recommendation && learning && attemptIndex < learnedAttempts.length && !learnedFailureRecorded) {
      await learning.store.recordFailure(recommendation.id);
      learnedFailureRecorded = true;
    }
  }

  if (learning?.discovery?.enabled) {
    const ranked = await rankSelectorCandidates(
      page,
      descriptor,
      learning.intentKey,
      learning.discovery.maximumCandidates
    );
    const best = ranked[0];
    const runnerUp = ranked[1];
    const threshold = learning.discovery.minimumConfidence ?? 0.9;
    const gap = learning.discovery.minimumScoreGap ?? 0.08;
    let selected = best && best.summary.score >= threshold
      && (!runnerUp || best.summary.score - runnerUp.summary.score >= gap)
      ? best
      : undefined;
    if (!selected && ranked.length && learning.discovery.resolveAmbiguity) {
      const chosenIndex = await learning.discovery.resolveAmbiguity(
        learning.intentKey,
        ranked.slice(0, 5).map(candidate => candidate.summary)
      );
      selected = ranked.find(candidate => candidate.summary.index === chosenIndex);
    }
    if (selected) {
      await learning.store.recordSuccess(
        learning.pageKey,
        learning.intentKey,
        selected.descriptor,
        selected.tier
      );
      log.debug('Selector discovered adaptively', { tier: selected.tier, score: selected.summary.score });
      return { locator: selected.locator, tier: selected.tier };
    }
  }

  throw new SelectorResolutionError(descriptor);
}
