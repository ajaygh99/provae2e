Issue: #1 — [FEATURE] Implement browser runner — Playwright headless
Branch: feature/issue-1

## Acceptance Criteria (from Issue)
- `qe-tool run --url https://example.com` runs Playwright headless
- Visits the URL, takes screenshot, asserts page title
- Output: PASS/FAIL + duration + screenshot path
- Tests: src/runners/browser-runner.test.ts (80%+ coverage)

## Plan
1. Create `src/runners/browser-runner.ts`:
   - Export `runBrowserTest(options: BrowserRunnerOptions): Promise<BrowserRunResult>`
   - `BrowserRunnerOptions`: `{ url: string; screenshotDir?: string }`
   - `BrowserRunResult`: `{ status: 'PASS' | 'FAIL'; url: string; title?: string; durationMs: number; screenshotPath?: string; error?: string }`
   - Uses `chromium.launch({ headless: true })` from `@playwright/test`
   - Opens a new page, navigates to `options.url`, waits for load
   - Takes a screenshot to `screenshotDir` (default `./screenshots`), named from a timestamp + sanitized URL
   - Captures `page.title()` — PASS requires a non-empty title
   - Always closes browser/context in a `finally` block, even on error
   - Wraps navigation/screenshot in try/catch → on error, returns `status: 'FAIL'` with `error` message instead of throwing
   - Logs via `log.info`/`log.success`/`log.error` from `../core/logger.js`
   - Full JSDoc with `@param`/`@returns` per AGENTS.md hard rules; zero `any`

2. Wire into `src/cli/run.ts`:
   - `run` command's `--type browser` (and `all`, once other runners exist — for now just `browser`) branch calls `runBrowserTest({ url: opts.url })`
   - Logs PASS/FAIL, duration, screenshot path via `log`
   - Exits process with code 1 on FAIL (`process.exitCode = 1`) so CI can detect failure, without throwing

3. Tests — replace placeholder `tests/browser/browser-runner.test.ts`:
   - Happy path: run against a local static HTML file (served via `file://` or a tiny inline `http.createServer`) with a known `<title>`, assert `status === 'PASS'`, title matches, screenshot file exists on disk, `durationMs >= 0`
   - Error path: invalid/unreachable URL → assert `status === 'FAIL'` and `error` is populated, no throw
   - Boundary: custom `screenshotDir` is respected and created if missing
   - No network dependency on real external sites (avoids flaky/offline CI) — use a local `http` server fixture instead of `https://example.com`
   - Coverage target 80%+ of `browser-runner.ts`

## Files to create
- src/runners/browser-runner.ts
- tests/browser/browser-runner.test.ts (overwrite placeholder)

## Files to study first
- src/core/logger.ts (logging patterns)
- src/cli/run.ts (CLI wiring point)
- tsconfig.json / eslint.config.mjs (strict mode, no `any`, no `console.log`)

## Done when
- TypeScript compiles (`npm run typecheck`)
- ESLint passes (`npm run lint`)
- `npm test` green, 80%+ coverage on new file
- qa/run-results.md updated
- PR opened against main referencing Closes #1
