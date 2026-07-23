# Issue #105: Golden Thread CLI Integration (qe-tool trace)

**Story Points:** 5
**Phase:** 3
**Status:** Planning

## Overview
Implement CLI commands to query and export Golden Thread traceability data for CI/CD pipelines.

## Acceptance Criteria
- [ ] `qe-tool trace --issue-key PROJ-123` → show full 7-stage chain for requirement
- [ ] `qe-tool trace --commit SHA` → show chain from code → production
- [ ] `qe-tool trace --test-id UUID` → show evidence and logs for test execution
- [ ] `qe-tool trace export --format pdf` → shareable report of full chain
- [ ] `qe-tool trace verify --sla` → check if chain meets SLA thresholds
- [ ] `qe-tool trace list --from DATE --to DATE` → export all chains in date range

## Technical Design

### Data Model (Existing)
- **Table:** `golden_thread_chains` (id, created_at)
- **Table:** `stage_logs` (7 fields: Spec→Debug, status, timestamp, metadata)
- **Store:** `GoldenThreadStore` (SQL.js in-memory + SQLite file)

### New Files to Create
1. **`src/cli/trace.ts`** — CLI command dispatcher
2. **`src/queries/trace-query.ts`** — Database queries
3. **`src/exporters/pdf-exporter.ts`** — Playwright HTML→PDF
4. **`src/validators/sla-validator.ts`** — SLA threshold checks
5. **`tests/cli/trace.test.ts`** — Command tests
6. **`tests/queries/trace-query.test.ts`** — Query tests

### Implementation Tasks

#### Task 1: Create Trace Query Engine
- Query by issue-key, commit SHA, test-id
- Join 7 stage tables
- Return full chain as structured JSON
- Handle missing/partial chains

#### Task 2: Build Trace CLI Command
- Parse `--issue-key`, `--commit`, `--test-id`, `--format`
- Call query engine
- Output: table (CLI) or JSON (CI/CD)
- Exit codes: 0=pass, 1=fail, 2=sla-breach

#### Task 3: Implement PDF Export
- Use Playwright to convert HTML table → PDF
- Include metadata: dates, actors, artifact URLs
- Output to `--output` or default `./trace-report.pdf`

#### Task 4: Add SLA Validator
- Define thresholds: stage-time, total-time
- Check deployment_status (GREEN/YELLOW/RED)
- Return exit code 2 on breach

#### Task 5: Implement List/Range Query
- Query by date range: `--from YYYY-MM-DD --to YYYY-MM-DD`
- Export all chains as CSV or JSON
- Pagination for large datasets

#### Task 6: Add Tests
- Unit tests: query engine (mocked DB)
- Integration tests: real SQLite
- CLI tests: all 6 sub-commands
- Coverage: min 80%

## Implementation Notes
- Use existing `GoldenThreadStore` API
- No external AI service calls in tests (RULE #9)
- TypeScript strict mode, zero `any`
- Follow PROVA file structure: `src/[domain]/[feature].ts`

## Success Criteria
1. All 6 acceptance criteria passing
2. Tests green locally: `npm test -- --runInBand`
3. TypeScript strict: `npm run typecheck`
4. Lint clean: `npm run lint`
5. Coverage ≥ 80%
6. No changes to shared files (package.json, src/index.ts, src/cli/run.ts)
7. PR opens with `Closes #105`

## Branch
`claude/issue-105` (already exists, dashboard script only)
