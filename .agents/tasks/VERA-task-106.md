Issue: #106 — Golden Thread: Tests & Validation

Files FORGE will create:
- tests/golden-thread/fixtures/golden-thread-fixtures.ts

Test files to create:
- tests/golden-thread/golden-thread-integration.test.ts
- tests/golden-thread/golden-thread-validation.test.ts

Behaviors to test:
- Integration: full 7-stage chain via JIRA → linker → GitHub → Datadog (external APIs mocked);
  connector attribution; JIRA/GitHub metadata; parent linking; external-API failure paths.
- Validation: chain integrity (parent links, single null root, no orphans); idempotency
  (duplicate stage rejected, no duplicate record, unique trace IDs); data consistency
  (metadata JSON round-trip, schema enums); error cases (missing stage, non-existent chain,
  bad stage number, graceful no-match query); edge cases (unique IDs, no self-reference,
  acyclic parent chain); performance (100 chains, query < 500ms).

Coverage target: 80%+ of Golden Thread code.

VERA: 26/26 new tests pass. Full suite 1132/1132 green. Golden Thread core coverage —
store 97%, linker 100%, jira 100%, datadog 100%, github 95%, monitor 100%, trace-query 91.5%.
Global coverage gate (80%) holds. No implementation bugs found.
