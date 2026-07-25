# CODEX Cross-Check Final Report

Generated: 2026-07-25
Release candidate: `0.3.1-beta.0`

## Independent-review findings

### Studio TypeScript errors

- Original claim: five or more compilation errors.
- Cross-check: not reproducible in the release worktree.
- Root cause/status: the current Studio dependency and TypeScript configuration
  are aligned.
- Validation: Studio typecheck, lint, and production build pass.

### Promotion test failures

- Original claim: 41 failing tests.
- Cross-check: not reproducible.
- Actual result: 53 promotion tests pass across four suites.
- Note: running only promotion tests through `test:ci` fails the repository-wide
  80% coverage threshold because all non-promotion source files are intentionally
  excluded from that targeted run. This is a coverage-command artifact, not a
  promotion test failure.

### Browser and mobile setup documentation

- Original claim: Playwright troubleshooting instructions were missing.
- Cross-check: verified.
- Fix: README now documents browser installation, Linux dependencies, mobile
  emulation, API-only operation, concurrency, Chrome Web Store limitations, and
  support diagnostics.
- Validation: browser, API, and mobile smoke tests pass.

### Security vulnerabilities

- Original claim: 32 high-severity vulnerabilities.
- Cross-check: verified in development-tool dependency paths; zero critical
  vulnerabilities and no demonstrated production-runtime vulnerability.
- Root cause: vulnerable legacy glob/coverage paths reached through Jest and
  ESLint, plus vulnerable Studio routing releases.
- Fix: Jest 30 + SWC + V8 coverage, scoped patched coverage overrides, ESLint
  upgrades, and replacement of the vulnerable Studio routing dependency.
- Validation: root and Studio audits report zero vulnerabilities.

## Additional Beta fixes

- CLI and package version aligned at `0.3.1-beta.0`.
- Comma-separated mobile devices are supported.
- `--workers` controls real bounded concurrency.
- `--scope` controls verification depth.
- Reports retain immutable per-run archives.
- Chrome Web Store results explicitly state that they verify listings only.

## Release assessment

The independent review was partially accurate: the documentation and security
findings were genuine, while the Studio and promotion failure counts were not
reproducible in the release worktree.

Release recommendation: publish `0.3.1-beta.0` with npm dist-tag `beta` after
the complete root and Studio release gates pass.
