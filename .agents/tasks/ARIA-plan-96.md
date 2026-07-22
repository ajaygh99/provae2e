# ARIA Plan for Issue #96 — Golden Thread: 7-Stage Traceability Framework

## Issue Summary
Implement the 7-stage Golden Thread traceability framework connecting business requirements to production logs. The framework tracks a requirement's journey through 7 stages: Spec → Test → Evidence → Build → Deploy → Monitor → Debug.

## Acceptance Criteria Analysis
- [x] Traceability data model in SQLite (stage_log table)
- [x] Metadata capture at each stage (timestamp, status, actor, artifact IDs)
- [x] Chain validation: each stage links to previous
- [x] Golden Thread report generation (7-stage chain visualization)
- [x] Integration with JIRA (read requirements), GitHub (read build/deploy), Datadog (read logs)
- [x] CLI: qe-tool trace --issue-key PROJ-123 shows full 7-stage chain

## Architecture Analysis

### Current Patterns in Codebase
- **Database pattern:** sql.js (SQLite) wrapper class with open(), persist(), query methods (see PerformanceStore)
- **CLI pattern:** Commander.js with command() and action() handlers
- **Export pattern:** Public APIs in src/index.ts
- **Logging pattern:** Structured logger in src/core/logger.ts
- **Connectors:** JIRA connector (src/core/jira-connector.ts), Figma connector (src/core/figma-connector.ts)

### Solution Design

#### 1. Golden Thread Data Store (`src/core/golden-thread-store.ts`)
- SQLite-based store following PerformanceStore pattern
- Schema: stage_log table with fields
  - golden_thread_id (UUID, primary key for chain)
  - stage (1-7: Spec, Test, Evidence, Build, Deploy, Monitor, Debug)
  - status (PENDING, IN_PROGRESS, PASSED, FAILED)
  - timestamp (ISO 8601)
  - actor (string: user, service, bot)
  - artifact_url (string: link to JIRA, GitHub, Datadog, etc.)
  - parent_id (UUID: links to previous stage)
  - metadata (JSON: stage-specific extra data)

#### 2. Golden Thread Linker (`src/core/golden-thread-linker.ts`)
- Create new chain: initiate() → generates UUID, logs Spec stage
- Link stage: linkStage() → validates parent, logs new stage
- Validate chain: validateChain() → ensure all 7 stages present, all linked
- Get chain: getChain() → retrieves full 7-stage record

#### 3. Integrations (`src/core/`)
- golden-thread-jira.ts: fetch issue description, map to Spec stage
- golden-thread-github.ts: fetch commit/PR info, map to Build stage
- golden-thread-datadog.ts: fetch logs, map to Monitor/Debug stages
- For MVP: JIRA integration only; GitHub/Datadog stubs present but marked as "not yet implemented"

#### 4. Report Generator (`src/reporters/golden-thread-reporter.ts`)
- HTML template with 7 vertical stages, clickable links to artifacts
- CSS: responsive, dark/light mode support
- JSON export option for programmatic use

#### 5. CLI Command (`src/cli/run.ts` - extend existing)
- New command: `qe-tool trace --issue-key PROJ-123 [options]`
- Options:
  - --database <file>: SQLite database path (default: ./prova-golden-thread.sqlite)
  - --output <file.html>: HTML report destination
  - --json: Output JSON instead of HTML
  - --update: Refresh all stages from integrations

#### 6. Public Exports (`src/index.ts`)
- Export GoldenThreadStore, GoldenThreadLinker, HTML report generator
- Export types: GoldenThreadChain, StageLog, etc.

## Implementation Order (FORGE)

1. **golden-thread-store.ts** — SQLite schema, crud methods
2. **golden-thread-linker.ts** — chain creation/linking/validation logic
3. **golden-thread-jira.ts** — JIRA integration (fetch issue → Spec stage)
4. **golden-thread-github.ts** — GitHub stub (placeholder for Phase 4)
5. **golden-thread-datadog.ts** — Datadog stub (placeholder for Phase 4)
6. **golden-thread-reporter.ts** — HTML/JSON report generation
7. **cli/run.ts** — add `trace` command
8. **src/index.ts** — export public API

## Test Plan (VERA)

### Coverage Targets: 80%+ per file

**golden-thread-store.test.ts**
- Happy path: open(), insert stage, retrieve chain
- Error paths: invalid stage number, broken parent_id link, database corruption
- Boundary: max 7 stages, UUID validation, timestamp parsing

**golden-thread-linker.test.ts**
- Happy path: initiate → linkStage 1-7 sequentially
- Error paths: link stage out of order, skip stages, duplicate stage
- Validation: validateChain() detects missing/unlinked stages

**golden-thread-jira.test.ts**
- Happy path: fetch issue, map to Spec stage
- Error paths: invalid JIRA key, network timeout, missing issue
- Mock: use nock/http-mocks for HTTP calls

**golden-thread-reporter.test.ts**
- Happy path: complete 7-stage chain → valid HTML
- Error paths: incomplete chain, null/undefined stages
- Output: verify HTML structure, links present, metadata rendered

**integration test (cli)**
- Full flow: trace a test issue end-to-end
- Verify database created, all stages logged, report generated

## Done Criteria
- TypeScript strict mode: zero errors
- ESLint: zero warnings
- All tests pass, 80%+ coverage
- CLI --help present and accurate
- No hardcoded secrets
- Branch: feature/issue-96

## Estimated Effort
8 story points = ~3-4 hours (FORGE) + ~2 hours (VERA)
