# ARIA Plan — Issue #107: Golden Thread CI/CD Pipeline Integration

## Goal
Integrate Golden Thread into CI/CD pipelines to auto-capture traceability at each
stage (test/evidence, build, deploy), gate deploys on test evidence, link failed
tests to production incidents, generate a deployment traceability report, and post a
Slack summary on successful deploys.

## Approach (unit-testable core modules, no live infra)
Reuse existing `GoldenThreadLinker`, `GoldenThreadStore`, `ProductionLogsStore`,
`GitHubApiClient`, and the existing HTML report style. External services are behind
injected senders/clients so tests run at $0.

## New files
- `src/core/golden-thread-cicd.ts`
  - `captureCicdContext(opts)` — read GitHub Actions env vars (SHA, branch, repo,
    run id, actor, workflow, event) + explicit overrides (coverage, deploy env,
    build status). (AC1, AC2)
  - `captureTestEvidenceStages` — link Test (2) + Evidence (3) from PROVA test
    results. (AC1)
  - `captureBuildStage` — link Build (4) from CI build status. (AC1)
  - `captureDeployStage` — link Deploy (5) with deployment info. (AC1)
  - `evaluatePipelineGate(chain)` — fail if Test/Evidence missing or not PASSED. (AC3)
  - `linkFailedTestToIncidents(opts)` — match failed test error to prod log
    incidents via ProductionLogsStore. (AC4)
- `src/core/golden-thread-slack.ts`
  - `formatGoldenThreadSummary(chain)` — Slack message (text + blocks).
  - `createFetchSlackSender(fetchImpl)` — default sender (webhook via env/opts).
  - `postGoldenThreadSummary(opts)` — post only on successful deploy. (AC6)
- `src/reporters/golden-thread-deploy-report.ts`
  - `generateDeploymentReport(chain, metadata, opts)` — HTML with embedded
    evidence. (AC5)
  - `writeDeploymentReport(...)` — persist report to disk. (AC5)

## Tests (mirrored under tests/golden-thread/)
- golden-thread-cicd.test.ts, golden-thread-slack.test.ts,
  golden-thread-deploy-report.test.ts — happy + error + boundary paths, mocked
  fetch / prod-logs. Target 80%+ on new code.

## Deferred
- CLI wiring (`qe-tool` subcommand) — issue centers on pipeline automation, not a
  new interactive command; core modules are the deliverable. Noted for follow-up.
