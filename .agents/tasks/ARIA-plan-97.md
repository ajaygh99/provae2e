# ARIA Implementation Plan — Issue #97

**Issue:** Golden Thread: Test->Evidence Link (Stage 2-3)
**Branch:** feature/issue-97
**Story Points:** 5

## Overview
Implement evidence capture system for test execution (Stage 3 in 7-stage Golden Thread).
Capture screenshots, video, console logs, and network data during browser tests.
Link evidence artifacts to test executions via SQLite.

## Files to Create
1. `src/core/evidence-store.ts` — SQLite table + repository for evidence
2. `src/core/evidence-capture.ts` — Utilities to capture screenshots, video, logs, network
3. `tests/core/evidence-store.test.ts` — Unit tests for evidence store
4. `tests/core/evidence-capture.test.ts` — Unit tests for evidence capture

## Files to Modify
1. `src/runners/browser-runner.ts` — Integrate evidence capture into browser test execution
2. `src/core/golden-thread-store.ts` — No changes (evidence is Stage 3, separate table)

## Architecture

### Evidence Model
```typescript
interface Evidence {
  id: number;
  test_execution_id: string;       // FK to stage_logs.id for Test stage (Stage 2)
  type: 'screenshot' | 'video' | 'log' | 'network';
  artifact_url: string;            // Local file path or S3 URL
  captured_at: string;             // ISO8601 timestamp
  metadata: string;                // JSON: { step_id, duration, error_message, mime_type }
}
```

### Evidence Database Schema
```sql
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_execution_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('screenshot','video','log','network')),
  artifact_url TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  metadata TEXT NOT NULL
);
```

### Evidence Capture Flow
1. **Screenshots:** Auto-captured after each browser step (already done in browser-runner)
   - Stored in `./evidence/screenshots/` with timestamp
   - Metadata: { step_id, duration_ms }

2. **Video:** Full test execution recorded via Playwright
   - Stored in `./evidence/videos/` with UUID filename
   - Segmented by test step via metadata
   - Metadata: { total_duration_ms, steps: [{ id, start_ms, end_ms }] }

3. **Console Logs:** Captured via `page.on('console')` listener
   - Stored as JSON array in `./evidence/logs/console-TIMESTAMP.json`
   - Format: [{ level: 'log'|'error'|'warn'|'info', message, stack_trace?, timestamp }]

4. **Network Logs:** Captured via Playwright's network interception
   - Stored as HAR format in `./evidence/network/TIMESTAMP.har`
   - Metadata: { total_requests, total_size, total_duration_ms }

## Function Signatures

### evidence-store.ts
```typescript
export interface Evidence { /* ... */ }
export class EvidenceStore {
  static async open(filePath: string): Promise<EvidenceStore>;
  async recordEvidence(evidence: Omit<Evidence, 'id'>): Promise<number>;
  async getEvidenceForExecution(test_execution_id: string): Promise<Evidence[]>;
  async getEvidenceByType(type: Evidence['type'], test_execution_id?: string): Promise<Evidence[]>;
  async deleteEvidenceOlderThan(days: number): Promise<number>;
}
```

### evidence-capture.ts
```typescript
export interface ScreenshotOptions {
  page: Page;
  outputDir: string;
  stepId?: string;
}
export interface VideoOptions {
  launchOptions: LaunchOptions;
  outputDir: string;
}
export interface ConsoleLogCapture {
  level: string;
  message: string;
  stack_trace?: string;
  timestamp: string;
}
export interface NetworkCapture {
  har_url: string;
  metadata: { total_requests: number; total_size: number };
}

export class EvidenceCapture {
  static async captureScreenshot(options: ScreenshotOptions): Promise<{ path: string; metadata: Record<string, unknown> }>;
  static async startVideoRecording(options: VideoOptions): Promise<string>;
  static async stopVideoRecording(browser: Browser): Promise<string>;
  static setupConsoleLogCapture(page: Page, outputDir: string): Promise<void>;
  static async captureNetworkLogs(page: Page, outputDir: string): Promise<string>;
}
```

### Browser Runner Integration
- Modify `runBrowserTestOnce` to capture evidence at each step
- Return evidence artifacts in `BrowserRunResult`
- Handle evidence cleanup on error

## Acceptance Criteria
- [x] Evidence database table created with SQLite schema
- [x] EvidenceStore CRUD operations: record, retrieve by execution, by type
- [x] Screenshot capture with metadata (step_id, duration)
- [x] Console log capture via page listener
- [x] Network HAR export with request/response timing
- [x] Browser runner integration: auto-capture screenshots + console/network logs
- [x] Unit tests: ≥80% coverage
- [x] TypeScript strict mode, no `any` types
- [x] JSDoc on all public functions
- [x] Error handling on all async operations

## Done When
- TypeScript compiles with `npx tsc --noEmit` (zero errors)
- ESLint passes: `npm run lint`
- Tests pass: `npm test -- --testPathPattern=evidence` (100% pass)
- Tests cover new code: `npm test -- --coverage` (≥80%)
