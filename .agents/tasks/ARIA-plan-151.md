# ARIA Implementation Plan — Issue #151
# Golden Thread: Dashboard & Reporting

**Issue:** #151 — Golden Thread: Dashboard & Reporting
**Objective:** Create interactive Studio dashboard showing 7-stage Golden Thread for each test/deployment.

## Context
The Golden Thread infrastructure (stages 1-7, store, alerts, monitor) is already in place. This task adds the **dashboard UI layer** and **reporting/metrics** capabilities.

### Existing Architecture to Leverage
- `GoldenThreadStore` (SQLite): stores all 7 stages, statuses, timestamps, artifacts, metadata
- `GoldenThreadChain` type: complete chain with all stages + timestamps
- Status colors: PASSED → green, FAILED → red, PENDING/IN_PROGRESS → yellow
- `StageLog` has: stage, status, timestamp, actor, artifact_url, metadata, deployment_status

## Feature Breakdown

### 1. Dashboard Metrics Service (`src/reporters/dashboard-metrics.ts`)
Calculates aggregated metrics from a collection of chains.

**Functions:**
- `calculateStageDurations(chains)` → `Map<Stage, AvgDurationMs[]>`
- `calculateStagePassRate(chains)` → `Map<Stage, PercentPassing>`
- `getCommonFailureStages(chains)` → `Stage[]` (sorted by frequency)
- `getMetricsSummary(chains)` → `{ totalChains, passRate, avgChainTime, commonFailures }`

**Tests:**
- Happy path: multiple chains with mixed statuses
- Edge case: empty chain list
- Edge case: all stages pending
- Boundary: single-stage chain

### 2. Dashboard Data Aggregator (`src/reporters/dashboard-aggregator.ts`)
Filters and prepares chains for dashboard display.

**Functions:**
- `filterChains(chains, filters)` → filtered chains (by date, environment, team, project)
- `enrichChainWithDuration(chain)` → chain + duration per stage + total duration
- `toChainSummary(chain)` → minimal structure for UI (id, status, duration, environment, etc.)

**Tests:**
- Date range filtering (inclusive bounds)
- Environment filtering
- Multiple simultaneous filters
- No matching filters returns empty
- Enrich calculates durations correctly

### 3. Dashboard HTML Generator (`src/reporters/dashboard-generator.ts`)
Creates interactive, responsive HTML dashboard with 7 stages in grid layout.

**Features:**
- Responsive 7-column grid (1 per stage) for wide screens, stacked on mobile
- Status icons per stage (✓ green, ✗ red, ⏳ yellow, ⊗ pending)
- Drill-down: click stage → modal/panel with artifacts, logs, metadata
- Timeline view: horizontal flow with duration labels
- Metrics sidebar: top KPIs, failure chart, common issues
- Filter UI: date picker, environment dropdown, search

**Functions:**
- `generateDashboardHtml(chains, metrics, filterState)` → HTML string
- `generateModalContent(stage)` → modal HTML for details
- `generateTimelineView(chain)` → horizontal timeline HTML

**Tests:**
- All 7 stages render with correct colors
- Drill-down content available (verify modal structure)
- Timeline durations displayed
- Metrics rendered (KPI tiles, charts)
- Responsive: grid collapses on mobile

### 4. PDF Export Service (`src/reporters/dashboard-pdf-export.ts`)
Generates shareable PDF with full chain evidence using Playwright.

**Functions:**
- `generatePdfReport(chain, options)` → PDF buffer
- `renderHtmlToPdf(htmlContent)` → PDF bytes using Playwright

**Tests:**
- PDF generated successfully
- PDF contains all 7 stages
- PDF includes metadata, timestamps
- Error handling: no Playwright browser

### 5. Dashboard CLI Command (`src/cli/dashboard.ts`)
New CLI command to generate and serve dashboard.

**Command:**
```bash
qe-tool dashboard [--output ./report.html] [--pdf ./report.pdf] [--serve :8080]
  [--date-start 2025-01-01] [--date-end 2025-12-31]
  [--environment prod|staging|dev]
  [--team DevTeam]
  [--project my-project]
```

**Tests:**
- Generate HTML to file
- Generate PDF to file
- Serve on port (verify HTTP response)
- Filter flags work together

### 6. Dashboard Page Type Definition (`src/core/dashboard-types.ts`)
Shared types for dashboard.

```typescript
export interface DashboardMetrics {
  totalChains: number;
  overallPassRate: number;
  avgChainDuration: number;
  stagePassRates: Map<Stage, number>;
  stageDurations: Map<Stage, number>;
  commonFailures: { stage: Stage; count: number }[];
}

export interface DashboardFilter {
  dateStart?: Date;
  dateEnd?: Date;
  environment?: string;
  team?: string;
  project?: string;
}

export interface ChainSummary {
  id: string;
  status: 'PASS' | 'FAIL' | 'PENDING';
  duration: number;
  environment: string;
  timestamp: string;
  stages: { stage: Stage; status: StageStatus; duration: number }[];
}
```

## Implementation Order (FORGE)

1. **Core types** → `dashboard-types.ts` (no dependencies)
2. **Metrics service** → `dashboard-metrics.ts` (depends on types)
3. **Aggregator** → `dashboard-aggregator.ts` (depends on metrics + types)
4. **HTML generator** → `dashboard-generator.ts` (depends on aggregator + types)
5. **PDF export** → `dashboard-pdf-export.ts` (depends on types, uses Playwright)
6. **CLI command** → `dashboard.ts` (depends on all above)
7. **Tests** (VERA): one per module + integration test for full flow

## Acceptance Criteria Checklist

- [ ] Dashboard shows all 7 stages in visual grid layout with status icons
- [ ] Green: stage passed, Yellow: warning/pending, Red: failure
- [ ] Click stage → drill-down modal with artifacts, logs, timestamps
- [ ] Timeline view shows stages horizontally with duration per stage
- [ ] PDF export includes full chain evidence (artifacts, metadata)
- [ ] Metrics displayed: avg time/stage, % passing, common failure stages
- [ ] Filters work: date range, environment, team, project
- [ ] CLI command `qe-tool dashboard --output report.html --pdf report.pdf --serve :8080`
- [ ] TypeScript strict mode, no `any` types
- [ ] 80%+ coverage of all new code
- [ ] README updated if dashboard flags added to CLI

## Done When
- FORGE: All code written, TypeScript passes, ESLint clean
- VERA: All tests pass (100% of new paths), coverage ≥ 80%
- FORGE appends completion message with file list
