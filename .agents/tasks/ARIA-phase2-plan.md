# ARIA Phase 2 Plan — v0.3.3 Analytics

Status: implementation and verification in progress
Baseline: v0.3.2-beta.1, with 50/50 BrowserStack evidence complete

## Scope

1. Add a stable analytics store contract.
2. Ship persistent SQLite and PostgreSQL adapters.
3. Add 7/30/90-day trends, pass rate, duration, failure anomalies, and flaky-test ranking.
4. Add opt-in run persistence and HTML/JSON report commands.
5. Add Power BI push-row export.
6. Verify retention, query performance, anomaly fixtures, CLI compatibility, security, and ≥80% coverage.
7. Obtain VERA and LENS sign-off before v0.3.3 publication.

## Gates

- Typecheck and lint pass.
- Full Jest suite and Studio suite pass.
- Global coverage remains at least 80%.
- 10,000-row SQLite trend query completes in under 100ms in the CI test fixture.
- Synthetic known-anomaly fixtures achieve at least 85% precision/recall.
- PostgreSQL parameterization and schema are integration-tested; a live `DATABASE_URL` smoke is recorded when credentials exist.
- Power BI payload contract is tested; a live workspace export is recorded when credentials exist.
- Analytics remains off unless `--persist-analytics` is supplied.

## Evidence

Evidence and reviewer decisions will be stored under `.agents/tasks/` and `releases/` and linked from the v0.3.3 release notes.
