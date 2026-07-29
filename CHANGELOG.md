# Changelog

## 0.3.5-beta.1 — 2026-07-28

### Phase 4.1 Studio MVP

- Added local-first workspace discovery, source and visual test editing, schema
  validation, and browser execution.
- Added a loopback-only Studio API with shell-free CLI invocation, live output,
  cancellation, enforced timeouts, and bounded concurrency.
- Added recent results and contained evidence viewing for logs, screenshots,
  traces, and reports.
- Added complete UI states, keyboard focus management, reduced-motion support,
  responsive layouts, integration coverage, and a fast validation script.

### Phase 4 foundation readiness

- Added multi-OS Chromium, Firefox, and WebKit execution.
- Added safe OpenAPI path parameters, request validation, and readable Playwright test generation.
- Added 95%-confidence selector reuse with credential and PII rejection.
- Added human approval, rejection, rollback, listing, and clear workflows for selector repairs.
- Preserved Chromium defaults, deterministic fallback, and human control over permanent changes.

### Quality

- Added representative five-endpoint OpenAPI and selector-learning security evidence.
- Verified failure-evidence safety, analytics integrity, packaging, and production dependency security.

## 0.3.4-beta.1 — 2026-07-27

### Reliability and evidence

- Verified clean package installation and packed-CLI execution on Windows, Ubuntu, and macOS.
- Recorded 100 independent browser, API, and mobile-web smoke executions with a 0% observed failure rate.
- Added structured failure packages containing screenshots, Playwright traces, logs, metadata, selectors, and Allure-compatible results.
- Added trace-aware credential scanning and cleanup validation for intentional-failure artifacts.

### Analytics safety

- Added SQLite integrity validation and explicit analytics schema versioning.
- Verified a v0.3.3-compatible 1,500-row analytics database upgrades with matching before/after hashes and zero data loss.
- Verified 90-day retention, concurrent analytics reads, and sub-100ms trend queries.
- Corrupt analytics databases now fail closed with an actionable error instead of being overwritten.

### Known validation gap

- The current release commit requires a credentialed BrowserStack regression run before claiming current-code real-device validation. Historical v0.3.2 evidence remains 50/50 passed.

## 0.3.3-beta.1 — 2026-07-26

### Added

- Opt-in test-run analytics persistence with a 90-day default retention policy.
- Persistent SQLite storage and a parameterized PostgreSQL adapter selected by `DATABASE_URL`.
- 7/30/90-day trends, weighted duration metrics, failure/duration anomaly detection, and flaky-test ranking.
- `prova report --analytics` HTML/JSON reports.
- Indexed 10,000-row trend queries, synthetic anomaly-accuracy fixtures, and analytics operator documentation.

### Fixed

- GitHub prereleases are now marked as prereleases when the package version contains a prerelease suffix.

### Deferred

- Power BI export remains feature-flagged off and hidden from the CLI until v0.3.3.1 Phase 2.

## 0.3.2-beta.1 — 2026-07-26

Real-device testing beta release.

### Added

- Typed device-cloud provider abstraction with a BrowserStack W3C mobile-web connector.
- Opt-in `--device-cloud browserstack` execution with bounded concurrency and video capture.
- BrowserStack credential validation/redaction, device discovery, session cleanup, screenshots, video metadata, and log metadata.
- Machine-readable evidence output and strict verification of unique cloud sessions and complete artifacts.
- Credential-gated real-device smoke and 50-run iOS/Android evidence workflows.
- BrowserStack setup, CI, cost, artifact, and troubleshooting documentation.

### Quality and evidence

- 50 of 50 sequential real-device sessions passed on iPhone 14 and Google Pixel 7.
- Evidence contains 50 unique BrowserStack session IDs and 50 screenshots, video links, and log links.
- Real-device evidence workflow completed in 19m15s with one concurrent session.
- Local Playwright emulation remains the default and backward compatible.
- Full TypeScript, lint, test, coverage, Studio, smoke, audit, build, and LENS gates are required again by the release workflow.

All notable changes to PROVA are documented in this file.

## 0.3.1-beta.0 — 2026-07-25

Beta reliability and security release.

### Fixed

- Added comma-separated mobile-device execution and bounded `--workers` concurrency.
- Made `--scope` control browser/mobile verification depth.
- Preserved immutable per-run HTML reports and labeled Chrome Web Store listing limitations.
- Added Playwright installation and platform troubleshooting guidance.
- Replaced Studio's vulnerable routing dependency with a small same-origin client router.
- Corrected promotion-test reporting and legacy Jest 30 CLI options.

### Security and quality

- Migrated root tests to Jest 30 with SWC and native V8 coverage.
- Upgraded ESLint/type-aware tooling and patched vulnerable coverage transitive dependencies.
- Root and Studio npm audits report zero vulnerabilities.
- Root: 113 suites and 2,062 tests pass with coverage thresholds enforced.
- Studio: 6 files and 60 tests pass; typecheck, lint, and production build pass.

## 0.2.0 — 2026-07-21

Phase 2 Intelligence release of `@provae2e/cli`.

### Added

- JIRA OAuth2 integration, acceptance-criteria parsing, generated tests, status sync, and named instances.
- Local AI-assisted Playwright generation from specifications and multilingual acceptance criteria.
- Faker-backed, schema-aware test data with deterministic seeds and JSON, CSV, ENV, and SQL output.
- Figma ingestion, encrypted OAuth credential storage, and generated component tests.
- Ordered `dev → qe → staging` promotion gates with configurable blocking and JSON reports.
- k6 performance checks plus durable SQLite baselines, history, regression detection, and CSV reports.
- Strict CLI/API validation, configurable exponential retries, and nested REST/GraphQL schema validation.

### Quality

- 512 automated tests with enforced 80% global statement, branch, function, and line coverage.
- Phase 2 Faker and SQLite end-to-end verification.
- LENS automated review and protected-branch release gates.

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
