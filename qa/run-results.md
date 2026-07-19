# QA Run Results
# Cowork writes here after each CI run.
# Format updated by qa-summary skill.

## Latest Run
Status: PASS — Issue #5 Allure-style HTML reporter implemented and tested locally by ARIA/FORGE/VERA
Last updated: 2026-07-19

Details:
- typecheck: PASS (`npm run typecheck`)
- lint: PASS (`npm run lint`)
- unit tests: PASS — 47/47 across all suites (`npm test`); 16/16 in allure-reporter.test.ts
- src/reporters/allure-reporter.ts coverage: 100% stmts, 96.15% branch, 100% funcs, 100% lines
- src/runners/mobile-runner.ts coverage: 100% stmts, 88.88% branch, 100% funcs, 100% lines (unchanged)
- src/runners/api-runner.ts coverage: 94.93% stmts, 90.9% branch, 100% funcs, 94.93% lines (unchanged)
- src/runners/browser-runner.ts coverage: 100% stmts, 80% branch, 100% funcs, 100% lines (unchanged)
- Report generator produces a self-contained static HTML file (`allure-report/index.html`) — pass/fail counts, per-test duration, failure screenshots inlined, and a trend chart backed by `allure-report/history.json` (last 20 runs). No server required to view it.
- Wired into `qe-tool run --report` for `--type browser|api|mobile`; not yet wired for `--type all` since that runner isn't implemented yet.
- Manual CLI smoke test (browser + report): `node dist/cli/run.js run --url https://example.com --type browser --report` → PASS, report + history written
- Manual CLI smoke test (api FAIL + report): `node dist/cli/run.js run --url https://httpbin.org/status/500 --type api --report` → FAIL (exit 1), report updated, trend showed 2 runs
- Manual CLI smoke test (mobile): `node dist/cli/run.js run --url https://example.com --type mobile --device iPhone14` → PASS, screenshot written
- Manual CLI smoke test (REST GET): `node dist/cli/run.js run --url https://jsonplaceholder.typicode.com/todos/1 --type api` → PASS, status 200
- Manual CLI smoke test (REST POST): `node dist/cli/run.js run --url https://jsonplaceholder.typicode.com/posts --type api --method POST --body '{"title":"foo","body":"bar","userId":1}' --expect-status 201` → PASS, status 201

## History
| Date | PR | Browser | API | Mobile | LENS | Status |
|------|----|---------|-----|--------|------|--------|
| 2026-07-19 | feature/issue-1 | PASS | - | - | pending | Awaiting PR/CI |
| 2026-07-19 | feature/issue-3 | PASS | PASS | - | pending | Awaiting PR/CI |
| 2026-07-19 | feature/issue-4 | PASS | PASS | PASS | pending | Awaiting PR/CI |
| 2026-07-19 | feature/issue-5 | PASS | PASS | PASS | pending | Awaiting PR/CI |
