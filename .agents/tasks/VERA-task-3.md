Issue: #3 — [FEATURE] Implement API testing runner — Playwright network + supertest
Files FORGE will create: src/runners/api-runner.ts
Test file to create: tests/api/api-runner.test.ts (overwrite placeholder)

Behaviors to test:
- Happy path: GET request against a local server route returns PASS with status/duration/summary
- Happy path: POST, PUT, DELETE all dispatch correctly and PASS
- Error path: status code mismatch → FAIL with descriptive error, does not throw
- Error path: response time exceeding maxResponseTimeMs → FAIL
- Error path: unreachable host / connection failure → FAIL without throwing
- Boundary: schema validation passes when body matches schema
- Boundary: schema validation fails on missing field and on wrong field type
- GraphQL: successful query → PASS, `data` validated against schema
- GraphQL: response containing top-level `errors` → FAIL
- Integration: uses a real local http.Server + Playwright APIRequestContext (no external network)

Coverage target: 80% minimum on src/runners/api-runner.ts
Done when: All tests pass, coverage meets target

VERA: Done. 14/14 tests pass in api-runner.test.ts (20/20 across the full suite). Coverage: 94.93% stmts / 90.9% branch / 100% funcs / 94.93% lines on src/runners/api-runner.ts
