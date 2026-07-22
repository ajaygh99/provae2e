# Implementation Plan: Issue #149 — Golden Thread: Spec->Test Link (Stage 1-2)

## Issue Summary
Link test requirements from JIRA/Spec to PROVA test cases created in Studio. This is the first stage of the Golden Thread, connecting acceptance criteria to test implementation.

## Acceptance Criteria
- [x] JIRA connector reads AC (Acceptance Criteria) from issue description
- [x] Parse AC markdown -> extract test scenarios
- [x] Studio API: accept_criteria_id parameter when creating tests
- [x] Two-way sync: test metadata includes parent JIRA issue
- [x] Dashboard: show test coverage % for each requirement
- [x] Validation: warn if requirement has no tests

## Files to Create
1. `src/core/spec-link-store.ts` — SQLite-backed spec_link table for linking requirements to tests
2. `src/core/spec-linker.ts` — Core logic for parsing AC, creating links, calculating coverage %
3. `src/cli/sync.ts` — CLI command: `qe-tool sync --jira-key PROJ-123`
4. `tests/spec-linker.test.ts` — Full test coverage for spec-linker and spec-link-store

## Files to Study/Modify
- `src/core/jira-connector.ts` — Already fetches AC from JIRA, extend with sync metadata
- `src/generators/spec-test-generator.ts` — AC extraction logic already exists, will reuse
- `src/core/golden-thread-store.ts` — Understand SQLite pattern
- `src/cli/run.ts` — Add sync command to CLI

## Technical Approach

### spec-link-store.ts
- SQLite schema:
  - `spec_links`: spec_id, test_id, jira_issue_key, requirement_text, confidence_score
  - `requirements`: id, jira_issue_key, requirement_text, requirement_order
  - `requirement_tests`: requirement_id, test_id, test_name, test_status, last_run
- Methods:
  - `open()` — Create/open database with schema
  - `createRequirement()` — Parse AC from JIRA, store requirement
  - `linkTestToRequirement()` — Associate test with requirement
  - `getRequirementCoverage()` — Calculate coverage % for each requirement
  - `validateCoverage()` — Return warnings for uncovered requirements
  - `getSpecLink()` — Retrieve all links for a JIRA issue

### spec-linker.ts
- `parseAcceptanceCriteria()` — Already exists in spec-test-generator, will reuse pattern
- `createSpecLinks()` — Main API:
  - Takes JIRA issue key and description
  - Extracts AC using existing logic
  - Stores in spec_link_store
  - Returns { requirements: [...], coverage_pct: ... }
- `extendTestMetadata()` — Transform test metadata:
  - Input: { test_id, test_name, ... }
  - Output: { ..., jira_issue_key, requirement_text, coverage_pct }
- `validateSpecLinks()` — Check for uncovered requirements:
  - Returns warnings for each uncovered requirement
  - Includes suggestion to create tests

### CLI sync command (sync.ts)
- `qe-tool sync --jira-key PROJ-123 [--database <path>]`
- Flow:
  1. Fetch JIRA issue description
  2. Parse AC into requirements
  3. Store in spec_link_store
  4. Query test results from test runner (if available)
  5. Link tests to requirements
  6. Return coverage report
- Output: Summary table showing requirement -> test coverage

### Integration points
- Extend `JiraConnectorOptions` to include `spec_link_database` path
- CLI `run` command: Accept `--accept-criteria-id` parameter for test metadata
- Future: Dashboard can query spec_link_store for coverage visualization

## Acceptance Criteria Implementation

### JIRA connector reads AC
- Already done: `fetchJiraTicketDescription()` returns full description
- New: Parse AC from description using existing `extractAcceptanceCriteria()` logic

### Parse AC markdown -> extract test scenarios
- Reuse: `extractAcceptanceCriteria()` from spec-test-generator.ts
- Handles: Bullets, numbered lists, Given/When/Then patterns

### Studio API: accept_criteria_id parameter
- New: `extendTestMetadata()` function adds jira_issue_key, requirement_text, coverage_pct
- Called: When creating/updating tests in Studio

### Two-way sync: test metadata includes parent JIRA issue
- New: requirement_tests table tracks test -> requirement mapping
- `linkTestToRequirement()` creates bidirectional link
- `getSpecLink()` retrieves complete link graph

### Dashboard: show test coverage % for each requirement
- New: `getRequirementCoverage()` returns {requirement_text, linked_tests: [...], coverage_pct}
- Future: Dashboard queries this for visualization

### Validation: warn if requirement has no tests
- New: `validateSpecLinks()` returns {requirement_text, has_tests: false} for each uncovered
- CLI: Printed as warnings in sync output

## Done When
- TypeScript compiles with zero errors
- ESLint passes with zero errors
- All tests pass with 80%+ coverage
- spec_link_store schema created and tested
- spec_linker core logic working
- CLI sync command integrated into run.ts
- JIRA description -> AC extraction -> spec_link storage flow complete
