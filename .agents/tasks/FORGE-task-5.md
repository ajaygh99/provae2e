Issue: #5 — Build HTML report with Allure
Branch: feature/issue-5
Files to create: src/reporters/allure-reporter.ts
Files to study first: src/core/logger.ts, src/runners/browser-runner.ts, src/runners/api-runner.ts, src/runners/mobile-runner.ts
Function signatures: see .agents/tasks/ARIA-plan-5.md (ReportEntry, AllureReportOptions, AllureReportResult, generateAllureReport)
Acceptance criteria: pass/fail counts, duration per test, screenshots on failure, trend if history exists, single static HTML file opened via file:// (no server); wired into src/cli/run.ts --report flag for all --type values
Done when: TypeScript compiles, ESLint passes, VERA tests green

FORGE: Done. Files: src/reporters/allure-reporter.ts, src/cli/run.ts (wired --report)
