# ARIA Plan — Issue #106: Golden Thread — Tests & Validation

**Branch:** `feature/issue-106-golden-thread-tests`
**Epic:** golden-thread (Phase 3)

## Context
The Golden Thread 7-stage traceability framework (Spec→Test→Evidence→Build→Deploy→Monitor→Debug)
already ships with unit tests for the store, linker, JIRA, Datadog, monitor, alerts, and reporters.
Issue #106 asks for a **comprehensive test suite** that closes the gaps: a full end-to-end chain
built through the real integration entry points with external APIs mocked, plus a validation suite
covering chain integrity, idempotency, data consistency, error paths, edge cases, and a perf budget.

## Existing coverage (do not duplicate)
- `tests/core/golden-thread-store.test.ts` — store CRUD, validateChain basics
- `tests/core/golden-thread-linker.test.ts` — linker delegation
- `tests/core/golden-thread-jira.test.ts` — JIRA error paths (no success-path mock)
- `tests/golden-thread/golden-thread-datadog.test.ts` — Datadog stages 6/7
- `tests/golden-thread/{monitor,alerts}.test.ts`, reporter tests

## Gaps this issue fills
1. **Integration** — full 7-stage chain assembled via `initiateFromJira` → linker (2,3) →
   `linkGitHubBuildAndDeploy` (4,5) → `linkDatadogStage` (6,7), with JIRA + GitHub APIs mocked.
2. **Chain integrity** — every stage links to its parent; stage 1 is the only root (no orphans).
3. **Idempotency** — the `UNIQUE(golden_thread_id, stage)` constraint rejects a re-linked stage
   and the chain is not duplicated.
4. **Data consistency** — metadata round-trips as valid JSON; stage/status/deployment_status stay
   inside their schema enums.
5. **Error cases** — missing stage, non-existent chain, invalid stage number, GitHub commit-not-found,
   JIRA fetch failure.
6. **Edge cases** — unique trace IDs across many initiations (no duplicate IDs), acyclic parent
   links (no circular references), null root parent.
7. **Performance** — 100 chains queried in < 500 ms.

## Delegation
- **FORGE-task-106.md** — test fixtures + helper builders (no production code changes expected).
- **VERA-task-106.md** — integration + validation suites, 80%+ Golden Thread coverage, all green.

## Done when
`npx tsc --noEmit` clean, `npm run lint` clean, new suites green, coverage gate (80%) holds.
