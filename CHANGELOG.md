# Changelog

All notable changes to PROVA are documented in this file.

## 0.1.0 — 2026-07-19

First public MVP release of `@provae2e/cli`.

### Added

- Headless Chromium testing with page-load checks and screenshots.
- Mobile browser testing through Playwright device emulation.
- REST and GraphQL API testing with status, response-time, and schema assertions.
- Five-tier self-healing selectors using ARIA roles, test IDs, text, visual position, and CSS fallbacks.
- Allure-style HTML reports with pass/fail summaries, failure screenshots, and run trends.
- Optional local Ollama summaries through the `--ai` flag.
- Combined browser, API, and mobile execution through `--type all`.
- Drop-in GitHub Actions workflow template for running PROVA in CI.

### Quality and release safeguards

- Strict TypeScript, lint, full-suite tests, and an enforced 80% coverage gate.
- Manual npm release workflow gated by an approval file for the exact release version.
- CLI input validation and resilient runner cleanup for predictable failure results.
