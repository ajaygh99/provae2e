# QA Run Results
# Cowork writes here after each CI run.
# Format updated by qa-summary skill.

## Latest Run
Status: PASS — Issue #5 Allure-style HTML reporter implemented and tested locally by ARIA/FORGE/VERA
Last updated: 2026-07-19

Details:
- typecheck: PASS (`npm run typecheck`)
- lint: PASS (`npm run lint`)
- unit tests: PASS — 40/40 across all suites (`npm test`); 10/10 in allure-reporter.test.ts
- src/reporters/allure-reporter.ts coverage: 100% stmts, 85% branch, 100% funcs, 100% lines
- src/runners/mobile-runner.ts coverage: 100% stmts, 88.88% branch, 100% funcs, 100% lines (unchanged)
- src/runners/api-runner.ts coverage: 94.93% stmts, 90.9% branch, 100% funcs, 94.93% lines (unchanged)
- src/runners/browser-runner.ts coverage: 100% stmts, 80% branch, 100% funcs, 100% lines (unchanged)
- Design note: `allure-playwright` is a `@playwright/test` reporter and this CLI does not run
  tests through the `@playwright/test` runner (it calls chromium/request directly), and there's
  no `allure-commandline` (Java) available to render `allure-results/*.json` into HTML anyway —
  the Java CLI's default report also needs to be served over HTTP, which conflicts with the
  Issue's "no server required" criterion. So `src/reporters/allure-reporter.ts` builds a
  self-contained Allure-style HTML report directly from the runners' result objects: one static
  `index.html` per `--report` run with pass/fail counts, per-test duration, base64-inlined
  screenshots, and a trend section backed by `.prova/run-history.json`. See ARIA-plan-5.md.
- `--report` wired into all three `--type` branches (browser/api/mobile) in `src/cli/run.ts`
- Manual CLI smoke test: `node dist/cli/run.js run --url https://example.com --type browser --report` → PASS, `allure-report/index.html` generated with inlined screenshot and history entry written to `.prova/run-history.json`

## History
| Date | PR | Browser | API | Mobile | Report | LENS | Status |
|------|----|---------|-----|--------|--------|------|--------|
| 2026-07-19 | feature/issue-1 | PASS | - | - | - | pending | Awaiting PR/CI |
| 2026-07-19 | feature/issue-3 | PASS | PASS | - | - | pending | Awaiting PR/CI |
| 2026-07-19 | feature/issue-4 | PASS | PASS | PASS | - | pending | Awaiting PR/CI |
| 2026-07-19 | feature/issue-5 | PASS | PASS | PASS | PASS | pending | Awaiting PR/CI |
