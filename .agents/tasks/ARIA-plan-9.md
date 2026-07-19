# ARIA Plan — Issue #9: Self-healing selectors (5-tier fallback)

## Issue summary
Add a `resolveSelector()` utility implementing a 5-tier fallback chain for
locating elements with Playwright, then wire it into `browser-runner.ts` and
`mobile-runner.ts` as an optional, reusable selector-resolution step.

## Current architecture notes
- `src/runners/browser-runner.ts` and `src/runners/mobile-runner.ts` currently
  only navigate, capture a screenshot, and assert a non-empty `<title>` — they
  don't interact with any page element yet. Integration will be additive: an
  optional `selector` option that, when provided, resolves an element after
  navigation and before the screenshot, reporting which tier succeeded.
- Logging goes exclusively through `src/core/logger.ts` (`log.info/success/warn/error/debug`).
  No `console.log`.
- Every runner option/result is a documented interface; functions never throw —
  failures are reported via a `FAIL` result object.
- Imports use `.js` extension suffix on relative paths (compiled as CommonJS,
  stripped by a jest `moduleNameMapper`) — follow the same convention.
- Tests are real (no mocks): spin up a local `http.Server` and drive a real
  headless Playwright browser/page, per `tests/browser/browser-runner.test.ts`.
  Test files live under `tests/<domain>/*.test.ts` (the issue's suggested path
  `src/core/self-healing-selector.test.ts` doesn't match this repo's actual
  convention — using `tests/core/self-healing-selector.test.ts` instead, in
  line with `browser`, `mobile`, `api`, `reporters`).

## Design — `src/core/self-healing-selector.ts`

### `SelectorDescriptor`
Optional config per tier (only tiers with config are attempted):
```ts
interface SelectorDescriptor {
  role?: { role: string; name?: string | RegExp };  // Tier 1 — page.getByRole
  testId?: string;                                   // Tier 2 — page.getByTestId
  text?: string | RegExp;                             // Tier 3 — page.getByText
  position?: {                                        // Tier 4 — visual position hash
    scope?: string;      // CSS selector to search within, defaults to 'body *'
    x: number; y: number; width: number; height: number;
    tolerance?: number;  // px deviation allowed, defaults to 5
  };
  css?: string;                                       // Tier 5 — page.locator (raw CSS)
}
```

### `resolveSelector(page, descriptor)`
- Attempts tiers 1→5 in fixed order, skipping any tier missing from the
  descriptor.
- A tier "succeeds" when its Locator resolves to at least one element
  (`locator.count() > 0`); tier 4 additionally requires finding a candidate
  element within `scope` whose bounding box matches within `tolerance` px on
  each dimension (computed via `boundingBox()` — this is the "visual position
  hash").
- Catches per-tier errors (e.g. an invalid CSS selector) and falls through
  rather than throwing.
- Returns `{ locator, tier }` where `tier` is one of `'aria-role' |
  'data-testid' | 'text-content' | 'visual-position' | 'css-selector'`, for
  the caller to log.
- Throws `SelectorResolutionError` only if every configured tier fails (or no
  tier was configured) — callers (the runners) catch this and report a `FAIL`
  result, consistent with "runner functions never throw" convention.

## Files to create
- `src/core/self-healing-selector.ts` — the utility described above.
- `tests/core/self-healing-selector.test.ts` — covers each tier succeeding
  independently, fallthrough across tiers (e.g. tier 1 configured-but-absent →
  tier 2 succeeds), and the all-tiers-fail error path. 80%+ coverage.

## Files to modify
- `src/runners/browser-runner.ts` — add optional `selector?: SelectorDescriptor`
  to `BrowserRunnerOptions` and optional `selectorTier?: SelectorTier` to
  `BrowserRunResult`. When `selector` is provided, resolve it after `page.goto`
  and before the screenshot; on failure, return `FAIL` with the resolution
  error message.
- `src/runners/mobile-runner.ts` — identical integration, mirroring the
  existing browser/mobile symmetry.
- `tests/browser/browser-runner.test.ts` / `tests/mobile/mobile-runner.test.ts`
  — add cases for: selector resolves (asserts `selectorTier`), selector fails
  to resolve (asserts `FAIL` + error message).

## Done when
- `npx tsc --noEmit` — zero errors.
- `npm run lint` — zero warnings.
- `npm test` — all green, 80%+ coverage on new code.
- `qa/run-results.md` updated.
- Branch `feature/issue-9` pushed, PR opened against `main` referencing
  `Closes #9`.
