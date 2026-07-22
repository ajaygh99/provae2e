# ARIA Implementation Plan — Issue #99

**Issue:** Golden Thread: Production Logs Integration (Stage 6)
**Branch:** feature/issue-99
**Story Points:** 5

## Context
Stage 6 (Monitor) of the Golden Thread 7-stage traceability framework needs production logs integration.
This connects deployed code (via commit SHA) to runtime behavior in production.

## Acceptance Criteria (from Issue #99)
- [ ] Datadog connector: authenticate, query by tags (service, environment, version)
- [ ] CloudWatch logs: read by log group, filter by deployment version
- [ ] Log ingestion: store recent 30d in SQLite (sample 10% to save space)
- [ ] Link: log entries tagged with deployed_commit_sha
- [ ] Query API: get logs for a given deployment/stage in full 7-chain
- [ ] Dashboard: side-by-side test evidence + prod logs
- [ ] Alerts: if prod logs show errors not seen in test evidence

## Technical Architecture

### New Files to Create

#### 1. `src/core/production-logs-store.ts`
- Extend GoldenThreadStore schema with `production_logs` table
- Schema: { id, source (datadog|cloudwatch|elk), level, message, timestamp, tags, deployment_sha }
- Methods:
  - `ingestLogs(entries: LogEntry[]): Promise<void>` - with 30d rolling window + sampling
  - `queryLogsByDeployment(deploymentSha: string, stage: Stage): Promise<LogEntry[]>`
  - `cleanupOldLogs(days: number): Promise<void>` - auto-delete logs > 30d
- Sampling logic:
  - Keep 100% of ERROR and WARNING level logs
  - Keep 10% of INFO level logs
  - Keep 0% of DEBUG level logs

#### 2. `src/core/production-logs-model.ts`
- LogEntry interface: { id?, source, level (ERROR|WARNING|INFO|DEBUG), message, timestamp, tags, deployment_sha }
- LogLevel type
- LogSource type

#### 3. `src/core/production-logs-datadog.ts`
- `DatadogConnector` class
  - Constructor: accepts API key, base URL (default: app.datadoghq.com)
  - `queryLogs(query: string): Promise<LogEntry[]>` - fetch logs from Datadog API
  - `queryByDeploymentSha(sha: string, service: string, environment: string): Promise<LogEntry[]>`
  - Parse Datadog API response and convert to LogEntry format
- Error handling for auth failures, rate limits

#### 4. `src/core/production-logs-cloudwatch.ts`
- `CloudWatchConnector` class
  - Constructor: accepts AWS region, credentials (via env or SDK)
  - `queryLogs(logGroupName: string, deploymentSha: string): Promise<LogEntry[]>`
  - Fetch logs from CloudWatch Logs API
  - Parse and convert to LogEntry format
- Error handling for auth failures, resource not found

#### 5. `src/core/production-logs-elk.ts`
- `ElasticsearchConnector` class
  - Constructor: accepts Elasticsearch URL and optional auth
  - `queryLogs(indexPattern: string, deploymentSha: string): Promise<LogEntry[]>`
  - Query Elasticsearch via REST API
  - Parse and convert to LogEntry format
- Error handling for connection failures

#### 6. `src/core/golden-thread-monitor.ts`
- Main integration point for Stage 6 (Monitor)
- `linkProductionLogsStage(opts: MonitorStageOptions): Promise<void>`
  - Take golden_thread_id, deployment_sha, environment, service_name
  - Query logs for that deployment
  - Ingest into store
  - Link Stage 6 to the chain with log summary in metadata
  - metadata includes: log_count, error_count, warning_count, sample_rate_applied, sources

#### 7. `src/core/golden-thread-alerts.ts`
- Alert detection for Stage 6->Stage 3 mismatch
- `detectUnseenErrors(golden_thread_id: string): Promise<Alert[]>`
  - Compare Stage 3 (Evidence) error reports vs Stage 6 (Monitor) production logs
  - Identify ERROR/WARNING logs that weren't captured in test evidence
  - Return list of alerts with: error_id, message, timestamp, stage6_found, stage3_missing

## Testing Plan

### Test Files to Create

#### 1. `tests/core/production-logs-store.test.ts`
- Test log ingestion with sampling:
  - 100% errors and warnings stored
  - 10% sampling of info logs
  - 0% debug logs
- Test 30-day rolling window cleanup
- Test query by deployment SHA
- Test multiple sources in one store
- Coverage target: 85%+

#### 2. `tests/golden-thread/production-logs-datadog.test.ts`
- Mock Datadog API responses
- Test successful log fetch by deployment SHA
- Test error handling (auth failure, rate limit, invalid query)
- Test log format conversion
- Test query string generation
- Coverage target: 90%+

#### 3. `tests/golden-thread/production-logs-cloudwatch.test.ts`
- Mock CloudWatch Logs API responses
- Test successful log fetch by log group and SHA
- Test error handling (invalid region, permission denied)
- Test log format conversion
- Coverage target: 90%+

#### 4. `tests/golden-thread/production-logs-elk.test.ts`
- Mock Elasticsearch REST API responses
- Test successful log fetch by index pattern
- Test error handling (connection failure, invalid query syntax)
- Test log format conversion
- Coverage target: 90%+

#### 5. `tests/golden-thread/golden-thread-monitor.test.ts`
- Test Stage 6 linking with logs
- Test that logs are ingested and linked
- Test metadata includes correct counts and sources
- Test artifact_url points to log dashboard
- Coverage target: 85%+

#### 6. `tests/golden-thread/golden-thread-alerts.test.ts`
- Test error mismatch detection:
  - Errors in prod logs but not in test evidence
  - Warnings in logs but not tracked in evidence
- Test alert generation
- Test empty alert list when no mismatches
- Coverage target: 80%+

## Implementation Order

1. **Phase 1 - Data Model & Store** (1 hour)
   - production-logs-model.ts
   - Extend production-logs-store.ts with SQLite schema + sampling logic
   - Tests: production-logs-store.test.ts

2. **Phase 2 - Connectors** (2 hours)
   - production-logs-datadog.ts
   - production-logs-cloudwatch.ts
   - production-logs-elk.ts
   - Tests: *-datadog.test.ts, *-cloudwatch.test.ts, *-elk.test.ts

3. **Phase 3 - Golden Thread Integration** (1 hour)
   - golden-thread-monitor.ts (Stage 6 linking)
   - Update golden-thread-datadog.ts to call monitor integration
   - Tests: golden-thread-monitor.test.ts

4. **Phase 4 - Alert Detection** (30 min)
   - golden-thread-alerts.ts (error mismatch detection)
   - Tests: golden-thread-alerts.test.ts

5. **Phase 5 - Integration & Verification** (30 min)
   - Update golden-thread-linker.ts to expose alert API
   - Verify all tests pass with 80%+ coverage
   - Update CLAUDE.md documentation

## Files to Study First
- src/core/golden-thread-store.ts (understand schema patterns)
- src/core/golden-thread-linker.ts (understand linking API)
- tests/golden-thread/golden-thread-datadog.test.ts (understand test patterns)
- src/core/evidence-capture.ts (understand Stage 3 evidence model)

## Success Criteria
- TypeScript compiles with zero errors (strict mode)
- ESLint passes with zero warnings
- All tests pass (100% green)
- Coverage >= 80% on new code
- All 7 acceptance criteria met
- No console.log in production code
- All public functions have JSDoc comments
- Error handling on all async operations

## Delegation
- **FORGE**: Implementation of all files above
- **VERA**: Test coverage and validation

---
**Status:** Plan created. FORGE and VERA assigned.
