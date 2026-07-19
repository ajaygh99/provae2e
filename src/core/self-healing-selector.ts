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

  for (let i = 0; i < count; i++) {
    const candidate = candidates.nth(i);
    const box = await candidate.boundingBox();
    if (!box) {
      continue;
    }
    const matches =
      Math.abs(box.x - position.x) <= tolerance &&
      Math.abs(box.y - position.y) <= tolerance &&
      Math.abs(box.width - position.width) <= tolerance &&
      Math.abs(box.height - position.height) <= tolerance;
    if (matches) {
      return candidate;
    }
  }
  return undefined;
}

interface TierAttempt {
  tier: SelectorTier;
  resolve: () => Promise<Locator | undefined>;
}

function buildAttempts(page: Page, descriptor: SelectorDescriptor): TierAttempt[] {
  const attempts: TierAttempt[] = [];

  if (descriptor.role) {
    const { role, name } = descriptor.role;
    attempts.push({
      tier: 'aria-role',
      resolve: async () => page.getByRole(role, name !== undefined ? { name } : undefined)
    });
  }
  if (descriptor.testId !== undefined) {
    // Type narrowing from the guard check doesn't carry through the closure boundary
    attempts.push({ tier: 'data-testid', resolve: async () => page.getByTestId(descriptor.testId as string) });
  }
  if (descriptor.text !== undefined) {
    // Type narrowing from the guard check doesn't carry through the closure boundary
    attempts.push({ tier: 'text-content', resolve: async () => page.getByText(descriptor.text as string | RegExp) });
  }
  if (descriptor.position) {
    // Type narrowing from the guard check doesn't carry through the closure boundary
    attempts.push({ tier: 'visual-position', resolve: async () => resolveByPosition(page, descriptor.position as PositionSelector) });
  }
  if (descriptor.css !== undefined) {
    // Type narrowing from the guard check doesn't carry through the closure boundary
    attempts.push({ tier: 'css-selector', resolve: async () => page.locator(descriptor.css as string) });
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
export async function resolveSelector(page: Page, descriptor: SelectorDescriptor): Promise<ResolvedSelector> {
  const attempts = buildAttempts(page, descriptor);

  for (const attempt of attempts) {
    try {
      const locator = await attempt.resolve();
      if (!locator) {
        continue;
      }
      const count = await locator.count();
      if (count > 0) {
        log.debug('Selector resolved', { tier: attempt.tier });
        return { locator, tier: attempt.tier };
      }
    } catch (err) {
      log.debug('Selector tier threw, falling through', { tier: attempt.tier, error: err instanceof Error ? err.message : String(err) });
    }
  }

  throw new SelectorResolutionError(descriptor);
}
