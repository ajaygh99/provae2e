# ARIA Implementation Plan - Issue #150
Golden Thread: Production Monitoring & Root Cause (Stage 7 - Debug)

## Issue Summary
Link production issues back through the 7-stage Golden Thread chain to identify root cause: spec gap, test gap, code bug, or deployment issue. Implement the Stage 7 (Debug) analysis engine with root cause classification, historical pattern detection, and one-click JIRA escalation.

## Architecture Overview
The Golden Thread system already has:
- Stages 1-6: Spec → Test → Evidence → Build → Deploy → Monitor
- GoldenThreadStore: SQLite backend for all 7 stages
- GoldenThreadLinker: High-level chain operations
- Alerts: Production vs test mismatch detection
- ProductionLogsStore: Log ingestion and querying

Stage 7 needs to:
- Trace production errors backwards through the chain
- Answer 4 key diagnostic questions
- Classify root cause (Test Gap, Code Bug, Spec Gap, Deployment Issue)
- Detect recurring patterns across incidents
- Generate comprehensive debug report
- Escalate to JIRA with full context

## Files to Create

### 1. `src/core/golden-thread-debug.ts`
Main Stage 7 implementation. Exports:
- `RootCauseAnalysis` interface with all diagnostic results
- `DebugClassification` type: TestGap | CodeBug | SpecGap | DeploymentIssue
- `linkDebugStage(opts: DebugStageOptions): Promise<void>` - primary entry point
- `analyzeRootCause(opts: RootCauseOptions): Promise<RootCauseAnalysis>` - core logic
- `classifyIncident(analysis: RootCauseAnalysis): DebugClassification` - classification engine
- `detectRecurringPatterns(golden_thread_id, linker, store): Promise<Pattern[]>` - historical analysis

### 2. `src/core/golden-thread-debug-jira.ts`
JIRA escalation helper. Exports:
- `escalateToBugTicket(analysis: RootCauseAnalysis, opts: JiraEscalationOptions): Promise<string>` - returns JIRA ticket key
- Creates ticket with full 7-stage evidence chain, reproducible steps, classification

### 3. `src/reporters/golden-thread-debug-reporter.ts`
HTML report generation for Stage 7. Exports:
- `generateDebugReport(chain: GoldenThreadChain, analysis: RootCauseAnalysis, opts: DebugReportOptions): string` - comprehensive HTML
- Includes interactive 7-stage visualization, diagnostic Q&A, classification result, historical patterns

## Test File
`src/core/golden-thread-debug.test.ts`
- Test root cause analysis (happy path: test gap, code bug, spec gap, deployment issue)
- Test classification logic for each category
- Test pattern detection across multiple chains
- Test JIRA escalation
- Test report generation

## Implementation Steps

### Step 1: Define Types & Interfaces
Create `golden-thread-debug.ts` with:
- `RootCauseAnalysis` interface with fields:
  - `was_tested: boolean` - whether prod error scenario has test
  - `test_evidence_link: string | null` - link to Stage 2/3
  - `ci_run_link: string | null` - link to CI execution
  - `code_change_link: string | null` - diff between deployments
  - `issue_history: PreviousIncident[]` - past occurrences
  - `diagnostic_summary: string` - human-readable analysis
- `DebugClassification` type and rules

### Step 2: Implement Root Cause Analysis
Logic flow:
1. Get chain and all 7 stages
2. Extract production error from Stage 6 logs
3. Search Stage 3 (Evidence) for matching test execution
4. If not found in test evidence:
   - Check Stage 4 (Build) for commit introducing the code path
   - Check Stage 5 (Deploy) for deployment timing
   - Classify as Test Gap or Code Bug based on evidence
5. If found in Stage 2/3 but prod still fails:
   - Classify as Code Bug (test passed but prod fails)
   - Check Stage 4 for git blame to identify commit
6. If test never existed:
   - Classify as Test Gap
7. If deployment timing suggests infrastructure:
   - Classify as Deployment Issue
8. If spec doesn't cover this scenario:
   - Classify as Spec Gap

### Step 3: Implement Historical Pattern Detection
Query all previous chains with same/similar error signature:
- Find previous occurrences in database
- Track escalation history (when was it fixed?)
- Identify recurring patterns
- Flag if this is a regression

### Step 4: Implement JIRA Escalation
In `golden-thread-debug-jira.ts`:
- Create JIRA bug ticket with:
  - Classification as label
  - 7-stage evidence chain as description
  - Links to all artifacts (prod logs, test evidence, build, deploy)
  - Reproducible steps extracted from Stage 3 test
  - Root cause summary

### Step 5: Implement Debug Report Generator
In `golden-thread-debug-reporter.ts`:
- Extend existing reporter to show Stage 7
- Add interactive Q&A section (was it tested? was test passing? etc.)
- Show classification result
- Display historical pattern graph
- Include screenshot collage from test evidence
- Add one-click "Escalate to JIRA" button

## Acceptance Criteria
- [ ] `linkDebugStage()` fully links Stage 7 to a chain
- [ ] Root cause analysis answers all 4 diagnostic questions
- [ ] Classification engine correctly identifies all 4 root cause types
- [ ] Historical pattern detection finds recurring issues
- [ ] JIRA escalation creates ticket with full 7-stage context
- [ ] Debug report renders all diagnostic data in HTML
- [ ] Tests: 80%+ coverage, all paths exercised
- [ ] TypeScript strict mode, no `any` types
- [ ] All async operations have error handling
- [ ] README updated if new CLI command added

## Interfaces Summary

```typescript
// Root cause analysis result
export interface RootCauseAnalysis {
  golden_thread_id: string;
  prod_error: ProductionError;
  was_tested: boolean;
  test_evidence_link: string | null;
  ci_run_link: string | null;
  code_change_link: string | null;
  issue_history: PreviousIncident[];
  classification: DebugClassification;
  diagnostic_summary: string;
  confidence: number; // 0-100
}

// Root cause classification
export type DebugClassification = 'TestGap' | 'CodeBug' | 'SpecGap' | 'DeploymentIssue';

// Previous incident tracking
export interface PreviousIncident {
  golden_thread_id: string;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  fixed_in_commit?: string;
}

// Linking Stage 7 to chain
export interface DebugStageOptions {
  golden_thread_id: string;
  golden_thread_linker: GoldenThreadLinker;
  logs_store: ProductionLogsStore;
  github_opts?: GithubConnectorOptions;
  jira_opts?: JiraConnectorOptions;
}

// JIRA escalation
export interface JiraEscalationOptions extends JiraConnectorOptions {
  golden_thread_linker: GoldenThreadLinker;
  project_key: string;
}
```

## Done When
- `npm run typecheck` passes with zero errors
- `npm run lint` passes with zero warnings
- `npm test -- --testPathPattern=golden-thread-debug` passes 100%
- Coverage report shows 80%+ for new code
- Feature branch ready for FORGE + VERA review
