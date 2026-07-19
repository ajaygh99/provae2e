Issue: #5 — [FEATURE] Build HTML report with Allure
Branch: feature/issue-5

## Context

- `src/cli/run.ts` already has a `--report` boolean flag defined but not wired up.
- The three runners (`browser-runner.ts`, `api-runner.ts`, `mobile-runner.ts`) each
  return a `{ status: 'PASS'|'FAIL', durationMs, ...extra }` result object. There is
  no shared "test result" type across them today — each runner defines its own.
- `allure-playwright` is listed in package.json and present in node_modules, but it
  is a Playwright **Test-runner reporter** (hooks into `@playwright/test`'s test
  lifecycle to emit `allure-results/*.json`). This CLI does not use the
  `@playwright/test` test runner — the runners call `chromium`/`request` directly
  as plain async functions. So `allure-playwright` cannot be wired in as a reporter
  in the conventional sense; there are no Playwright Test `test()` cases to attach
  to.
- There is also no `allure-commandline` (Java-based) dependency available to turn
  raw allure-results into an HTML report, and installing a JVM-dependent tool
  in a headless nightly run / GitHub Actions matrix is out of scope for the MVP
  and risks acceptance criterion "no server required" (Allure's default multi-file
  HTML report requires being served over HTTP due to browser file:// XHR
  restrictions — only `--single-file` mode avoids that, which still requires the
  Java CLI to produce).
- Decision: implement `src/reporters/allure-reporter.ts` as a self-contained
  reporter that consumes the runners' result objects directly (no dependency on
  the Playwright Test lifecycle or a Java CLI) and emits ONE static, self-contained
  HTML file (screenshots inlined as base64 data URIs) that opens directly via
  `file://` with no server. This satisfies every acceptance criterion in the Issue
  using only what's already installed. `allure-playwright` stays a declared
  dependency for future work (Phase 2, if we adopt the full `@playwright/test`
  runner) but is not imported by this feature.
- Run history for the "trend" criterion is persisted as a small local JSON file
  (`.prova/run-history.json`) that the reporter appends to on every `--report` run
  and reads back to render a trend section.

## Files to create
- `src/reporters/allure-reporter.ts` — the reporter module
- `tests/reporters/allure-reporter.test.ts` — tests (80%+ coverage)

## Files to modify
- `src/cli/run.ts` — wire `--report` into all three `--type` branches (and the
  fallback branch), regardless of test type, per the Issue's technical context
- `README.md` — document the `--report` flag output location, if not already covered

## Files to study first
- `src/core/logger.ts` — logging conventions (`log.info/success/error`, no console.log)
- `src/runners/browser-runner.ts`, `src/runners/api-runner.ts`, `src/runners/mobile-runner.ts` — result shapes to normalize into one `ReportEntry` type
- `tests/browser/browser-runner.test.ts` — test conventions (local http server fixture, `.tmp-*` cleanup in `afterAll`)

## Function signatures (planned)

```ts
// src/reporters/allure-reporter.ts

export type ReportRunType = 'browser' | 'api' | 'mobile';

export interface ReportEntry {
  type: ReportRunType;
  status: 'PASS' | 'FAIL';
  url: string;
  durationMs: number;
  name?: string;          // human label, defaults to `${type} ${url}`
  screenshotPath?: string; // read + inlined as base64 if present on disk
  error?: string;
}

export interface AllureReportOptions {
  outputDir?: string;       // default './allure-report'
  historyFile?: string;     // default './.prova/run-history.json'
  historyLimit?: number;    // default 10 — how many past runs to show in trend
}

export interface AllureReportResult {
  reportPath: string;       // absolute path to the generated index.html
  passed: number;
  failed: number;
  total: number;
}

export async function generateAllureReport(
  entries: ReportEntry[],
  options?: AllureReportOptions
): Promise<AllureReportResult>
```

## Acceptance criteria (from Issue)
- `qe-tool run --report` generates an Allure-style HTML report after any run (browser/api/mobile)
- Report includes: pass/fail counts, duration per test, screenshots on failure, trend if run history exists
- Report opens locally via a generated static HTML file, no server required
- Tests: `src/reporters/allure-reporter.test.ts` (80%+ coverage) — placed at
  `tests/reporters/allure-reporter.test.ts` to match this repo's existing
  `tests/<domain>/<feature>.test.ts` convention (see browser/api/mobile tests).

## Done when
- TypeScript compiles (`npm run typecheck`)
- ESLint passes (`npm run lint`)
- All tests green (`npm test`), 80%+ coverage on the new reporter file
- `run.ts` calls the reporter after every runner invocation when `--report` is passed
- `qa/run-results.md` updated with outcome
