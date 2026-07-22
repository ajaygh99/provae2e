#requires -version 5.0
<#
.SYNOPSIS
    PROVA Phase 3 - Nights 2 & 3 Enterprise Backlog Issues Creator (PowerShell)

.DESCRIPTION
    Creates 80 PROVA enterprise backlog issues on GitHub using the 'gh' CLI.
    - Night 2: Golden Thread (20) + Sentinel (20) = 40 issues
    - Night 3: Appium (12) + OWASP ZAP (8) + Knowledge Graph (20) = 40 issues

    Designed to run via Windows Task Scheduler nightly after Studio issues seed.
    First five Golden Thread issues are queued with agent-implement label.

.PARAMETER DryRun
    Show what would be created without actually creating issues

.PARAMETER ReportPath
    Path to write progress report (default: daily/phase3-enterprise-issues-seed.md)

.PARAMETER NightFilter
    Run only a specific night: "night2", "night3", or "both" (default: both)

.EXAMPLE
    .\create-phase3-enterprise-issues.ps1 -DryRun
    .\create-phase3-enterprise-issues.ps1 -NightFilter night2
    .\create-phase3-enterprise-issues.ps1 -ReportPath "sprint/phase3-progress.md"

.NOTES
    Requires: GitHub CLI (gh) with authentication configured
    Environment: Windows PowerShell 5.0+
    Author: PROVA Automation
    Date: 2026-07-22

    Idempotent: Safe to rerun. Skips exact title matches. Only first 5 Golden
    Thread issues get agent-implement label to avoid queuing all 80 at once.
#>

param(
    [switch]$DryRun,
    [string]$ReportPath = "daily/phase3-enterprise-issues-seed.md",
    [ValidateSet("night2", "night3", "both")]
    [string]$NightFilter = "both"
)

$ErrorActionPreference = "Continue"
$RepoSlug = "ajaygh99/provae2e"
$stopOnError = $false

# ============================================================================
# NIGHT 2: GOLDEN THREAD ISSUES (20 issues)
# ============================================================================

$goldenThreadIssues = @(
    @{
        num = 41
        title = "Golden Thread: 7-Stage Traceability Framework"
        category = "Golden Thread"
        storyPoints = 8
        description = @"
## Description
Implement the 7-stage Golden Thread traceability framework connecting business requirements to production logs.

Stages: Spec -> Test -> Evidence -> Build -> Deploy -> Monitor -> Debug

## Acceptance Criteria
- [ ] Traceability data model in SQLite (stage_log table)
- [ ] Metadata capture at each stage (timestamp, status, actor, artifact IDs)
- [ ] Chain validation: each stage links to previous
- [ ] Golden Thread report generation (7-stage chain visualization)
- [ ] Integration with JIRA (read requirements), GitHub (read build/deploy), Datadog (read logs)
- [ ] CLI: qe-tool trace --issue-key PROJ-123 shows full 7-stage chain

## Technical Details
- Use SQLite schema: id, stage (1-7), status, timestamp, artifact_url, parent_id
- Golden Thread ID: UUID generated at Spec stage, flows through all 7
- Report format: HTML with clickable links to each stage's artifacts
- Fail fast if any stage breaks the chain
"@
    },
    @{
        num = 42
        title = "Golden Thread: Spec->Test Link (Stage 1-2)"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Link test requirements from JIRA/Spec to PROVA test cases created in Studio.

## Acceptance Criteria
- [ ] JIRA connector reads AC (Acceptance Criteria) from issue description
- [ ] Parse AC markdown -> extract test scenarios
- [ ] Studio API: accept_criteria_id parameter when creating tests
- [ ] Two-way sync: test metadata includes parent JIRA issue
- [ ] Dashboard: show test coverage % for each requirement
- [ ] Validation: warn if requirement has no tests

## Technical Details
- AC parser: regex for "As a... When... Then..." patterns
- Test metadata extends: { jira_issue_key, requirement_text, coverage_pct }
- Sync runs on-demand via CLI: qe-tool sync --jira-key PROJ-123
- SQLite: spec_link table (spec_id, test_id, confidence_score)
"@
    },
    @{
        num = 43
        title = "Golden Thread: Test->Evidence Link (Stage 2-3)"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Capture test execution evidence (screenshots, videos, logs, assertions) and link to test case.

## Acceptance Criteria
- [ ] Playwright integration: auto-capture screenshots + video at each step
- [ ] Assertion results logged: expected vs actual, pass/fail
- [ ] Browser console logs captured during execution
- [ ] Network logs captured (request/response headers, timing)
- [ ] Evidence metadata: { timestamp, step_id, duration, error_message }
- [ ] Storage: S3/local file path reference in SQLite evidence table
- [ ] Report: evidence gallery in test results UI

## Technical Details
- Evidence model: { id, test_execution_id, type (screenshot|video|log|network), artifact_url, captured_at }
- Video: full execution recorded, segmented by test step
- Network: HAR file format for Playwright Network
- Console logs: JSON array of { level, message, stack_trace }
"@
    },
    @{
        num = 44
        title = "Golden Thread: Build->Deploy Link (Stage 4-5)"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Link GitHub build artifacts (code commit, test pass, build status) to deployment evidence.

## Acceptance Criteria
- [ ] GitHub Actions integration: read workflow run status, build logs
- [ ] Link commit SHA -> build run -> deployment
- [ ] Deployment metadata: { environment, timestamp, deployed_by, rollback_info }
- [ ] Status: GREEN (deployed), YELLOW (warnings), RED (failed/rolled back)
- [ ] Traceability report shows code -> tests -> build -> deployed artifact
- [ ] CLI: qe-tool trace --commit SHA shows full chain from code to production

## Technical Details
- GitHub API: Webhooks on push -> Actions run complete -> Deployment API
- Deployment table: { id, commit_sha, github_run_id, environment, status, deployed_at }
- Rollback: linked back to original deployment (parent_id)
- Chain validation: fail if commit not found OR build failed OR deployment pending
"@
    },
    @{
        num = 45
        title = "Golden Thread: Production Logs Integration (Stage 6)"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Ingest production logs (Datadog, CloudWatch, ELK) and link to deployed code via commit SHA.

## Acceptance Criteria
- [ ] Datadog connector: authenticate, query by tags (service, environment, version)
- [ ] CloudWatch logs: read by log group, filter by deployment version
- [ ] Log ingestion: store recent 30d in SQLite (sample 10% to save space)
- [ ] Link: log entries tagged with deployed_commit_sha
- [ ] Query API: get logs for a given deployment/stage in full 7-chain
- [ ] Dashboard: side-by-side test evidence + prod logs
- [ ] Alerts: if prod logs show errors not seen in test evidence

## Technical Details
- Datadog API: Query endpoint with filters (tag:deployed_version:{sha})
- Log model: { id, source (datadog|cloudwatch|elk), level, message, timestamp, tags }
- Sampling: keep 100% error/warning, 10% info, 0% debug to save disk
- Historical: rolling 30d window (oldest logs auto-deleted weekly)
"@
    },
    @{
        num = 46
        title = "Golden Thread: Production Monitoring & Root Cause (Stage 7)"
        category = "Golden Thread"
        storyPoints = 8
        description = @"
## Description
Link production issues back through the 7-stage chain to identify root cause: spec gap, test gap, code bug, or deployment issue.

## Acceptance Criteria
- [ ] Root cause analysis: trace prod error -> test evidence -> spec requirement
- [ ] Question: "Was this scenario tested?" - yes/no with evidence link
- [ ] Question: "Was the test actually passing in CI?" - show CI run link
- [ ] Question: "Did code change introduce this?" - show commit diff vs test coverage
- [ ] Question: "Is this a new issue in production or a known skip?" - show history
- [ ] Report: golden thread report with pass/fail at each stage
- [ ] Classification: Test Gap, Code Bug, Spec Gap, or Deployment Issue
- [ ] One-click escalation: create JIRA bug with full 7-stage evidence link

## Technical Details
- Analysis flow: start with prod error -> find matching test execution (or absence) -> link to spec
- Classification logic: rules engine (if test passed but prod fails -> Code Bug, etc.)
- Historical: link to previous incidents to detect patterns
- Export: HTML report with navigable 7-stage chain, screenshot collage, log excerpts
"@
    },
    @{
        num = 47
        title = "Golden Thread: Dashboard & Reporting"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Create Studio dashboard showing 7-stage Golden Thread for each test/deployment.

## Acceptance Criteria
- [ ] Dashboard widget: "Full Chain Status" showing 7 stages with icons
- [ ] Green: stage passed/complete, Yellow: warning, Red: failure/missing
- [ ] Drill-down: click each stage to see artifacts (test results, logs, build info, etc.)
- [ ] Timeline view: horizontal 7-stage chain with duration per stage
- [ ] Traceability report PDF: shareable document with full chain evidence
- [ ] Metrics: avg time per stage, % stages passing, common failure stages
- [ ] Filters: by date range, environment, team, project

## Technical Details
- Dashboard component: 7-column layout (1 per stage)
- Real-time updates: WebSocket subscribe to stage completion events
- Artifact preview: inline screenshots, log snippets, build output
- PDF export: uses Playwright to render and capture HTML report
"@
    },
    @{
        num = 48
        title = "Golden Thread: Alerts & SLA Monitoring"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Set SLA thresholds per stage (e.g., test execution < 5min, deploy < 10min) and alert on violations.

## Acceptance Criteria
- [ ] SLA config: per-stage thresholds (time, error rate)
- [ ] Alerts: Slack/email when SLA breached
- [ ] Dashboard: SLA compliance % over time
- [ ] Incident: auto-create JIRA ticket on SLA miss with root cause classification
- [ ] Retroactive: analyze past 30d to identify chronic violators
- [ ] Exclusions: mark outliers as "spike" to exclude from SLA calc

## Technical Details
- Config in YAML: stages[].sla = { max_duration: 300s, max_errors: 0, warn_threshold: 80% }
- Monitoring job: runs every 5min, queries SQLite for completed stages
- Alert payload: stage, actual value, threshold, links to evidence
- SLA table: { id, stage, period, threshold, breached_count, compliance_pct }
"@
    },
    @{
        num = 49
        title = "Golden Thread: Multi-Environment Support"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Extend Golden Thread to track same test/code across dev->qe->staging->production with environment-specific logs.

## Acceptance Criteria
- [ ] Environment config: dev, qe, staging, production (names configurable)
- [ ] Test runs: capture environment tag at execution start
- [ ] Code traceability: link same commit SHA across envs
- [ ] Logs: aggregate by environment (separate Datadog tags per env)
- [ ] Comparison: side-by-side results across 3+ environments
- [ ] Gates: require green on staging before promoting to production
- [ ] Validation: warn if code in prod != code in staging

## Technical Details
- Schema extension: all tables gain environment_id FK
- Deployment gates: promotion rules (staging green before prod deploy)
- Log aggregation: query all env-specific Datadog dashboards in parallel
- Report: multi-env timeline showing progression through envs
"@
    },
    @{
        num = 50
        title = "Golden Thread: Auto-Root-Cause Analysis (ML/AI)"
        category = "Golden Thread"
        storyPoints = 8
        description = @"
## Description
Use AI (Claude API or local Ollama) to analyze full 7-stage chain and suggest root cause.

## Acceptance Criteria
- [ ] AI prompt: fed full context (spec, test code, test result, prod logs, error)
- [ ] Output: "Most likely root cause: [Test Gap | Code Bug | Spec Gap | Deployment]"
- [ ] Confidence score: 0.7-1.0 with reasoning
- [ ] Suggestions: "Try adding test for scenario X" or "Check if fix Y deployed"
- [ ] Learning: feedback loop (mark AI suggestions right/wrong, fine-tune)
- [ ] Fallback: graceful degradation if AI service unavailable

## Technical Details
- Prompt template: ~2KB context (spec excerpt, test code snippet, error logs)
- Model: claude-3-5-sonnet or local ollama:qwen (if AI flag set to --local)
- API: wrap ANTHROPIC_API_KEY or --ollama-url
- Cache: deduplicate identical chains to avoid re-analysis
"@
    },
    @{
        num = 51
        title = "Golden Thread: Time-Travel Debugging"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Jump to any point in the 7-stage chain and replay events, logs, screenshots to debug historical incidents.

## Acceptance Criteria
- [ ] Time picker: select any past test execution
- [ ] Playback: step through execution with sync'd test video + logs
- [ ] Scrubber: timeline with stages marked, seek to any stage
- [ ] Video: side-by-side test video + browser console logs + network tab
- [ ] Snapshot: freeze any point in time to export for investigation
- [ ] Comparison: pick 2 historical runs, diff side-by-side
- [ ] Retention: keep 90d of evidence (video, screenshots, logs)

## Technical Details
- Video index: keyframes per test step, fast seek in Playwright MP4
- Log sync: timestamp-based alignment (test event @ 2:34 correlates to log @ 2:34)
- Storage: video streamed from S3, screenshots inlined (small previews), logs in DB
- Diff: visual regression detection (Pixelmatch) on screenshots
"@
    },
    @{
        num = 52
        title = "Golden Thread: Contract Testing Integration"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Link API contract tests (OpenAPI/Pact) to e2e tests and prod API contracts to detect breaking changes.

## Acceptance Criteria
- [ ] Contract registry: OpenAPI spec version, Pact JSON provider/consumer
- [ ] Link: e2e test request -> contract definition
- [ ] Validation: each API call in test matches contract (schema, status codes)
- [ ] Breaking changes: detect when prod API violates published contract
- [ ] Alert: notify team when contract drift detected
- [ ] Report: "X% of requests comply with published contract"

## Technical Details
- Contract sources: GitHub (OpenAPI YAML), Pact Broker (Pact JSON)
- Validation: json-schema validate request/response bodies
- Event: on test step with API call, validate against contract
- Drift detection: periodic curl of prod endpoints, compare against schema
"@
    },
    @{
        num = 53
        title = "Golden Thread: Trace ID Propagation (Distributed Tracing)"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Generate a unique trace ID at test start, propagate through HTTP headers, and correlate prod logs by trace ID.

## Acceptance Criteria
- [ ] Trace ID generation: UUID4 at test start, stored in test execution record
- [ ] Header injection: X-Trace-ID: {uuid} on all HTTP requests
- [ ] App integration: app logs must include X-Trace-ID in all output
- [ ] Correlation: query prod logs by trace ID -> see full request path
- [ ] Report: timeline of all microservices involved in a single test
- [ ] Latency: breakdown time spent per microservice
- [ ] Integration: works with Datadog APM (auto-import X-Trace-ID)

## Technical Details
- Playwright integration: request interceptor adds X-Trace-ID header
- Log schema: all logs must include trace_id field (enforced by app instrumentation)
- Query: Datadog -> filter by resource.trace_id = ${traceId}
- Export: Jaeger-compatible JSON (spans, trace tree) for offline analysis
"@
    },
    @{
        num = 54
        title = "Golden Thread: Regression Detection (Trend Analysis)"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Detect performance/stability regressions by comparing current test run against historical baseline.

## Acceptance Criteria
- [ ] Baseline: 30-day rolling average of test duration, error rate, resource usage
- [ ] Regression: alert if current run > baseline + 2 std dev (unusual)
- [ ] Report: "3.2s slower than baseline (2% slower than 7d avg)"
- [ ] Root cause hints: "Latency spike detected in Database stage (80% of time)"
- [ ] Auto-create JIRA: "Performance Regression: Test X is 5% slower"
- [ ] Exclude spikes: one-off outliers don't pollute baseline

## Technical Details
- Baseline calc: historical stats (mean, median, stddev) over 30d rolling window
- Threshold: Zscore > 2.0 marks as regression
- Metrics: duration, memory, CPU, network bytes (captured from Datadog)
- Alert: only if regression confirmed in 2+ consecutive runs
"@
    },
    @{
        num = 55
        title = "Golden Thread: Compliance & Audit Trail"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Generate audit-ready logs showing who created/modified tests, who deployed code, who viewed sensitive data.

## Acceptance Criteria
- [ ] Audit table: { timestamp, user, action (create|edit|view|delete), resource, change_diff }
- [ ] Immutable: audit table is append-only (no updates/deletes of audit records)
- [ ] Sensitive data: redact passwords, tokens, PII from audit logs
- [ ] Report: compliance export (SOC2, ISO27001) showing full chain of custody
- [ ] Retention: immutable store, 7-year retention for compliance
- [ ] Encryption: all audit records encrypted at rest

## Technical Details
- Audit store: separate SQLite table (audit_log)
- Immutable: application code only permits INSERT, never UPDATE/DELETE
- Diff storage: JSON Patch format (RFC 6902) for tracking changes
- Sensitive fields: hash(password), redact(token) in both live and audit
"@
    },
    @{
        num = 56
        title = "Golden Thread: Test Data Lineage"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Track test data from creation -> test usage -> production data impact to ensure test data governance.

## Acceptance Criteria
- [ ] Data tagging: mark all test data with source (factory, fixture, seed)
- [ ] Lineage graph: test data -> test execution -> production database impact
- [ ] Question: "Did this test create real data in prod?" (answer: no, sandbox only)
- [ ] Validation: warn if production-like data (PII, real email) used in test
- [ ] Cleanup: track test data created per run, auto-delete post-test
- [ ] Report: "100% test data isolated, 0 contamination risk"

## Technical Details
- Data model: { id, source_type (factory|fixture|seed), lifecycle (created|used|deleted), tags }
- Test data: always use @example.com domains, fake PII, sandboxed accounts
- Validation: regex checks (no real emails, no real SSNs)
- Cleanup job: runs post-test, verifies all test data removed from prod DB
"@
    },
    @{
        num = 57
        title = "Golden Thread: CLI Integration (qe-tool trace)"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Provide CLI commands to query and export Golden Thread data for CI/CD pipelines.

## Acceptance Criteria
- [ ] qe-tool trace --issue-key PROJ-123: show full 7-stage chain for requirement
- [ ] qe-tool trace --commit SHA: show chain from code -> production
- [ ] qe-tool trace --test-id UUID: show evidence and logs for test execution
- [ ] qe-tool trace export --format pdf: shareable report of full chain
- [ ] qe-tool trace verify --sla: check if chain meets SLA thresholds
- [ ] qe-tool trace list --from DATE --to DATE: export all chains in date range

## Technical Details
- Commands: trace query-engine over SQLite (join 7 tables)
- Export: Playwright HTML to PDF conversion
- Output: structured JSON (for CI parsing) or human-readable table (CLI)
- Exit codes: 0=all passing, 1=failure, 2=sla breach
"@
    },
    @{
        num = 58
        title = "Golden Thread: Tests & Validation"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Comprehensive test suite for Golden Thread integration, covering chain integrity, data consistency, and edge cases.

## Acceptance Criteria
- [ ] Unit tests: each stage link (spec->test, test->evidence, build->deploy, etc.)
- [ ] Integration tests: full 7-stage chain with mocked external APIs
- [ ] Chain integrity: validate parent links, no orphaned records
- [ ] Idempotency: rerun same test, verify chain doesn't duplicate
- [ ] Data consistency: stage data matches expected schema
- [ ] Error cases: missing stage, broken link, corrupted data
- [ ] Coverage: 80%+ of Golden Thread code

## Technical Details
- Test fixtures: pre-built 7-stage chains (valid, missing stages, cross-linked)
- Mocks: GitHub API, Datadog API, JIRA API
- Edge cases: circular links, null stages, duplicate trace IDs
- Performance: 100 parallel chains query < 500ms
"@
    },
    @{
        num = 59
        title = "Golden Thread: CI/CD Pipeline Integration"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Integrate Golden Thread into CI/CD pipelines to automatically capture traceability at each stage (build, test, deploy).

## Acceptance Criteria
- [ ] GitHub Actions integration: capture build status, test results, deployment info
- [ ] Automatic metadata capture: commit SHA, branch, test coverage, deployment env
- [ ] Pipeline gates: require test evidence before deploying
- [ ] Failure detection: auto-link failed test to incident in prod logs
- [ ] Report generation: auto-create traceability report on each deployment
- [ ] Slack notifications: post Golden Thread summary on successful deploys

## Technical Details
- GitHub Actions webhook: trigger on workflow complete event
- Data capture: leverage existing PROVA test results + GitHub API
- Pipeline gates: require green CI check (test evidence) before merge
- Report template: HTML with embedded evidence (test results, logs, metrics)
"@
    },
    @{
        num = 60
        title = "Golden Thread: Incident Pattern Recognition (Historical)"
        category = "Golden Thread"
        storyPoints = 5
        description = @"
## Description
Analyze historical Golden Thread chains to identify patterns in failures and prevent recurrence.

## Acceptance Criteria
- [ ] Pattern detection: similar error types, common root causes, failure trends
- [ ] Recommendations: "Similar incident 6 weeks ago, check fix in commit X"
- [ ] Prevention: suggest test scenarios for known failure patterns
- [ ] Metrics: incident frequency by root cause, time-to-resolution trends
- [ ] Reporting: "Top 5 failure patterns this quarter, recommendations to prevent"
- [ ] Feedback loop: team marks recommendation as implemented, tracks resolution

## Technical Details
- Pattern storage: incident history table { signature, frequency, root_causes, fixes }
- Similarity: string/semantic similarity to match error messages, stack traces
- Recommendations: ML-based or rules-based (e.g., "if SQL error -> check schema changes")
- Dashboard: incident patterns with prevention recommendations ranked by impact
"@
    }
)

# ============================================================================
# NIGHT 2: SENTINEL ISSUES (20 issues)
# ============================================================================

$sentinelIssues = @(
    @{
        num = 61
        title = "Sentinel: Production Monitoring Foundation"
        category = "Sentinel"
        storyPoints = 8
        description = @"
## Description
Build PROVA Sentinel, a lightweight production monitoring layer that detects test coverage gaps in real-time.

## Acceptance Criteria
- [ ] Sentinel agent: lightweight process running in prod (sidecar or log processor)
- [ ] Triggers: on error/warning in prod logs, check if similar scenario was tested
- [ ] Database: incident log (timestamp, error, test_coverage_pct, action_taken)
- [ ] Coverage: "Was this error scenario covered in automated tests?"
- [ ] Alert: if uncovered incident, create JIRA ticket with Sentinel evidence
- [ ] Sampling: 100% errors, 50% warnings, 10% info to avoid noise

## Technical Details
- Agent deployment: Docker sidecar (100MB, <1% CPU)
- Triggers: log pattern matching (ERROR, WARN, exception types)
- Database: SQLite or S3 (append-only incidents)
- Alert: Slack #incidents or JIRA (Sentinel: Uncovered Incident)
"@
    },
    @{
        num = 62
        title = "Sentinel: Error Pattern Recognition"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Recognize recurring error patterns in prod logs and correlate with test coverage to identify gaps.

## Acceptance Criteria
- [ ] Pattern extraction: regex or ML to extract error signatures (same error, different params)
- [ ] Clustering: group similar errors (e.g., "Timeout" errors across services)
- [ ] Frequency: count incidents per error pattern, alert on spike
- [ ] Coverage check: for each pattern, "is there a test that reproduces this?"
- [ ] Gap report: "Top 5 uncovered error patterns this week"
- [ ] Trend: visualize error frequency over time (spike detection)

## Technical Details
- Error signature: (service, error_type, error_message_prefix, stack_trace_top_frame)
- Clustering: string similarity (Levenshtein, cosine) to group variants
- ML option: train on historical data to recognize new variants
- Storage: SQLite pattern table { signature, count, last_seen, test_coverage }
"@
    },
    @{
        num = 63
        title = "Sentinel: Dependency Monitoring (CVE/SCA)"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Monitor production dependencies for known vulnerabilities and notify when critical CVEs affect running services.

## Acceptance Criteria
- [ ] Dependency snapshot: capture all prod dependencies (npm, pip, jar, etc.)
- [ ] CVE check: daily poll of NVD (National Vulnerability Database) for matches
- [ ] Alert: Slack/email on critical CVE (CVSS >= 7.0)
- [ ] Traceability: link CVE -> affected service -> test coverage
- [ ] Action: "Upgrade to X.Y.Z to fix CVE-XXXX-XXXXX"
- [ ] Compliance: generate SOC2 report of monitored/patched CVEs

## Technical Details
- Dependency sources: npm lockfile, requirements.txt, pom.xml
- CVE API: NVD API (nvd.nist.gov) or commercial (Snyk, Dependabot)
- Alert severity: Critical (CVSS >= 7.0), High (5-7), Medium (<5)
- Report: weekly compliance summary, annual audit export
"@
    },
    @{
        num = 64
        title = "Sentinel: Performance Baseline & Anomalies"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Establish performance baselines for key metrics and alert on anomalies (latency spike, throughput drop, etc.).

## Acceptance Criteria
- [ ] Metrics collected: P50, P95, P99 latency, throughput, error rate, CPU, memory
- [ ] Baseline: 7-day rolling average per metric per service
- [ ] Anomaly detection: alert if metric > baseline + 2 std dev (unusual)
- [ ] Causation: link anomaly to code change (commit) or load spike
- [ ] Trend: gradual degradation alerts (e.g., latency +2% per day for 5 days)
- [ ] Integration: export to Datadog, Prometheus, or internal dashboard

## Technical Details
- Metrics source: Datadog API, Prometheus, CloudWatch, or app instrumentation
- Baseline calc: mean + stddev over 7d rolling window (ignore weekends option)
- Anomaly threshold: Zscore >= 2.0
- Alert: only if anomaly persists in 2+ consecutive 5-min windows
"@
    },
    @{
        num = 65
        title = "Sentinel: Error Budget Tracking"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Track SLA/error budget consumption and warn before exhaustion (e.g., "99.9% uptime budget 50% consumed this month").

## Acceptance Criteria
- [ ] SLA config: per-service SLA target (99%, 99.5%, 99.9%, 99.99%)
- [ ] Error budget: time allowed to be down per month (e.g., 43.2 min for 99.9%)
- [ ] Tracking: track cumulative downtime, alert at 50%, 75%, 90% consumed
- [ ] Projection: "At current rate, you'll exhaust budget in 8 days"
- [ ] Report: monthly SLA compliance and budget status
- [ ] Decision: gate risky deployments if budget near exhaustion

## Technical Details
- SLA config in YAML: services[].sla = { target: 99.9, budget_window: month }
- Tracking: downtime events in DB ({ start, end, duration, cause })
- Alert: automated when consumption > 50% of budget
- Export: compliance reports (SOC2, annual SLA review)
"@
    },
    @{
        num = 66
        title = "Sentinel: User Impact Assessment"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Estimate user impact of incidents: how many users affected, how long issue lasted, what was their experience.

## Acceptance Criteria
- [ ] Impact quantification: users affected, requests failed, revenue at risk
- [ ] Session tracking: correlate error logs to user sessions (user_id in trace)
- [ ] Severity scoring: (users_affected * duration * revenue_per_user) = impact score
- [ ] Alert payload: "3,200 users impacted for 2.3 minutes, est. $4,500 revenue at risk"
- [ ] Historical: top 10 highest-impact incidents this quarter
- [ ] Preventability: "Test coverage for this scenario: 0%, recommending gap fill"

## Technical Details
- User mapping: trace_id -> session_id -> user_id (via app instrumentation)
- Impact score: weighted formula (users > revenue > duration)
- Revenue calc: ARR / 30d / daily_active_users * affected_users
- Report: incident summary with impact quantification and test gap recommendations
"@
    },
    @{
        num = 67
        title = "Sentinel: Automated Remediation Actions"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Automatically take safe actions (rollback, failover, restart, scale) when Sentinel detects known incident patterns.

## Acceptance Criteria
- [ ] Action rules: "If latency > 2s for 30s, scale up 50%"
- [ ] Safe rollback: revert to last known-good deployment if error rate spikes
- [ ] Circuit breaker: trip on threshold (e.g., >50% error rate) to fail fast
- [ ] Escalation: if automated action doesn't resolve in 2 min, page oncall
- [ ] Logging: record all actions taken with timestamp and reasoning
- [ ] Dry-run mode: preview actions without executing (--dry-run flag)

## Technical Details
- Action executor: webhook integration (Kubernetes, ECS, custom APIs)
- Rules: YAML config { trigger_condition, actions[], timeout, escalation }
- Safety: require SLA budget available before taking risky actions
- Audit: immutable log of every action (who, what, when, result)
"@
    },
    @{
        num = 68
        title = "Sentinel: Datadog/APM Integration"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Integrate PROVA Sentinel with Datadog APM for real-time tracing and deep observability.

## Acceptance Criteria
- [ ] Connection: authenticate to Datadog API, ingest metrics + logs + traces
- [ ] Trace correlation: trace_id from Sentinel matches Datadog trace IDs
- [ ] Service maps: visualize dependencies and error propagation
- [ ] Custom metrics: expose Sentinel findings as Datadog custom metrics
- [ ] Dashboards: pre-built Sentinel dashboard in Datadog (uptime, error patterns, gaps)
- [ ] Alerts: create Datadog monitors from Sentinel rules

## Technical Details
- Auth: Datadog API key in env var (DATADOG_API_KEY)
- Sync: batch ingest every 60s (1000 events/batch)
- Trace filter: track only services relevant to PROVA tests
- Custom metrics: sentinel.coverage, sentinel.uncovered_incidents, sentinel.impact
"@
    },
    @{
        num = 69
        title = "Sentinel: Incident Report Generation"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Generate automated post-incident reports with timeline, root cause, impact, test coverage gaps, and recommendations.

## Acceptance Criteria
- [ ] Report template: incident summary, timeline (error -> detect -> resolve), root cause
- [ ] Evidence: screenshots, logs, metrics graphs, trace waterfall
- [ ] Impact: users affected, duration, estimated revenue loss
- [ ] Gap analysis: "Test coverage for this scenario: 0% - recommend adding test X"
- [ ] Recommendations: specific actions to prevent recurrence
- [ ] Distribution: email to team, post to #incidents, attach to JIRA ticket

## Technical Details
- Template: HTML with embedded images/graphs (Playwright render)
- Sections: incident summary, timeline, user impact, test gap analysis, action items
- Data: incident logs, Datadog metrics export, error logs, test coverage data
- Export: PDF, HTML, Markdown for sharing
"@
    },
    @{
        num = 70
        title = "Sentinel: Oncall Integration (PagerDuty/Opsgenie)"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Integrate Sentinel with PagerDuty/Opsgenie to alert oncall engineers with context and auto-escalate if needed.

## Acceptance Criteria
- [ ] Alert format: incident title, description, severity (critical/high/medium)
- [ ] Context: link to incident logs, traces, Sentinel findings, test gap analysis
- [ ] Routing: page the right team (if database error -> page DBA team)
- [ ] Escalation: if not acked in 5 min, escalate to manager
- [ ] Action: oncall can execute remediation actions (scale, rollback) from alert context
- [ ] Post-mortem: auto-attach incident summary to follow-up ticket

## Technical Details
- API: PagerDuty Events API v2 or Opsgenie Alerts API
- Severity mapping: error_rate > 50% -> critical, > 25% -> high, > 10% -> medium
- Routing: service_name -> escalation_policy (config in YAML)
- Integration: Sentinel action -> create incident -> wait for ack/resolve
"@
    },
    @{
        num = 71
        title = "Sentinel: Security & Intrusion Detection"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Monitor prod logs for security anomalies: unusual login patterns, SQL injection attempts, DDoS signs, privilege escalation.

## Acceptance Criteria
- [ ] Detection rules: rate-based (>100 logins/min), pattern-based (SQLi signatures), behavioral (user in 2 countries <1hr)
- [ ] Alert levels: suspicious (investigate), confirmed (block), critical (incident)
- [ ] Auto-actions: block IP, revoke session, rotate credentials, page security team
- [ ] Logs: immutable security audit trail (who, what, when, where, why)
- [ ] Compliance: SOC2/ISO27001 security controls evidence
- [ ] Integration: SIEM (Splunk, ELK) for centralized security monitoring

## Technical Details
- Rule engine: regex, threshold, behavioral ML
- Rate limits: login (10/min per user), API (1000/min per IP), data access (suspicious bulk reads)
- Auto-action: rate limiter + session revocation + IP blocklist
- Audit table: immutable, 7-year retention for compliance
"@
    },
    @{
        num = 72
        title = "Sentinel: Cost Optimization Insights"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Analyze infrastructure costs and recommend optimizations (scale down idle services, use cheaper instances, delete unused resources).

## Acceptance Criteria
- [ ] Cost collection: AWS/GCP/Azure billing APIs or tags
- [ ] Analysis: identify services with low utilization, idle resources, unused storage
- [ ] Recommendations: "Service X idle 95% of time, can turn off after 10 PM" (save $2K/month)
- [ ] Trends: cost per service over time, alert on unexpected increases
- [ ] Savings: estimate ROI of recommendations (e.g., "Update reduces costs by 15%")
- [ ] Report: monthly cost breakdown and optimization opportunities

## Technical Details
- Cost APIs: AWS Cost Explorer, GCP Cloud Billing, Azure Cost Management
- Utilization metrics: CPU <10%, Memory <20%, Data transfer <100GB/month
- Savings calc: (current_cost - recommended_cost) * 12 months
- Alert threshold: any service with savings > $1000/month auto-surfaced
"@
    },
    @{
        num = 73
        title = "Sentinel: Dashboard & Visualization"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Create PROVA Sentinel Studio dashboard showing real-time prod health, incidents, test coverage gaps, and recommendations.

## Acceptance Criteria
- [ ] Live status: traffic, errors, latency, uptime % (big numbers)
- [ ] Incidents: recent incidents with timeline and impact (table)
- [ ] Test gaps: uncovered error patterns with coverage % (sorted by frequency)
- [ ] Alerts: active alerts with severity and age (auto-dismiss after resolution)
- [ ] Trends: latency/error graphs over 24h/7d/30d (selectable)
- [ ] Actions: buttons to view incident details, create test for gap, page oncall

## Technical Details
- Dashboard: React component (Studio integration)
- Live updates: WebSocket to Sentinel backend (events, incidents, metrics)
- Data model: { incidents[], metrics{}, gaps[], recommendations[] }
- Export: PDF report (Playwright), Slack summary (cron daily)
"@
    },
    @{
        num = 74
        title = "Sentinel: Tests & Validation"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Comprehensive test suite for Sentinel, covering detection rules, alert accuracy, and edge cases.

## Acceptance Criteria
- [ ] Unit tests: each detection rule (rate limit, pattern match, anomaly detection)
- [ ] Integration tests: full incident flow (detect -> alert -> action -> resolve)
- [ ] False positive rate: <1% (verified with 30-day prod data)
- [ ] Detection accuracy: >99% for known incident types
- [ ] Performance: process 10K events/s with <100ms latency
- [ ] Coverage: 80%+ of Sentinel code paths

## Technical Details
- Test fixtures: pre-recorded prod logs (real incident patterns)
- Mock APIs: Datadog, PagerDuty, AWS, Slack
- Benchmarks: 10K events/s throughput, <100ms detection latency
- Edge cases: missing fields, corrupted logs, race conditions
"@
    },
    @{
        num = 75
        title = "Sentinel: Change Management & Deployment Tracking"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Track all production changes (deployments, config changes, permission changes) and correlate with incidents.

## Acceptance Criteria
- [ ] Change log: every deployment, config change, permission change tracked
- [ ] Correlation: on incident, show recent changes (likely culprit)
- [ ] Timing: alert if change happens right before incident (suspicious correlation)
- [ ] Rollback: quick rollback link from incident to revert problematic change
- [ ] Approval: changes require approval (deployment gate), tracked in audit log
- [ ] Metrics: change frequency, time-to-recovery correlation with change type

## Technical Details
- Change sources: GitHub (commits/deployments), Datadog (config changes), AWS (IAM changes)
- Event storage: changelog table { timestamp, change_type, details, approved_by, rolled_back }
- Correlation: time window (within 15min of incident) suggests causation
- Rollback: one-click revert to previous version (requires approval)
"@
    },
    @{
        num = 76
        title = "Sentinel: Predictive Alerting (Forecasting)"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Use time-series forecasting to predict incidents before they happen (prevent rather than detect).

## Acceptance Criteria
- [ ] Forecasting: predict when metrics will breach threshold (e.g., disk full in 4 hours)
- [ ] Proactive alerts: alert before breach ("Disk will be full at 2 PM, current growth rate")
- [ ] Recommendations: suggest preventive actions (cleanup, scale up, optimize)
- [ ] Accuracy: measure forecast accuracy (false positive rate, detection latency)
- [ ] Integration: trigger proactive automation (cleanup jobs, scaling)
- [ ] Learning: feedback loop (actual vs predicted, retrain model)

## Technical Details
- Forecasting: ARIMA, exponential smoothing, or ML (Prophet, AutoML)
- Time windows: 1hr, 4hr, 24hr forecasts (detect anomalies at different scales)
- Recommendations: rules { metric, threshold, proactive_action }
- Accuracy metrics: MAE, RMSE, false positive rate
"@
    },
    @{
        num = 77
        title = "Sentinel: Chaos Engineering Integration"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Integrate Sentinel with chaos engineering tools (gremlin, Chaos Monkey) to proactively test resilience.

## Acceptance Criteria
- [ ] Chaos experiments: define failure scenarios (latency spike, instance failure, network partition)
- [ ] Monitoring: run Sentinel during chaos to detect coverage gaps
- [ ] Recovery: measure time-to-recovery during chaos (SLO validation)
- [ ] Reporting: compare expected vs actual behavior (what broke that shouldn't have?)
- [ ] Automation: trigger chaos runs on low-traffic periods (auto-remediation tests)
- [ ] Insights: chaos results feed back into test gap recommendations

## Technical Details
- Chaos tool integration: Gremlin API, Chaos Monkey config
- Experiment design: YAML { failure_type, duration, intensity, validation_checks }
- Metrics: MTTR (mean time to recovery), error rate during chaos vs normal
- Scoring: give teams credit for controlled chaos tests passing
"@
    },
    @{
        num = 78
        title = "Sentinel: Multi-Cloud & Hybrid Infrastructure Support"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Monitor test coverage across multi-cloud deployments (AWS, GCP, Azure) and hybrid on-prem/cloud environments.

## Acceptance Criteria
- [ ] Multi-cloud metrics: aggregate metrics from all clouds (unified dashboard)
- [ ] Coverage per cloud: which test scenarios run on which cloud?
- [ ] Cross-cloud incidents: detect if incident in one cloud repeats in another
- [ ] Recommendation: "This failure in AWS also affects GCP, recommend testing X on GCP"
- [ ] Cost tracking: per-cloud cost attribution (helps justify test automation)
- [ ] Compliance: per-cloud compliance requirements (GDPR in EU, HIPAA in US)

## Technical Details
- Cloud connectors: boto3 (AWS), google-cloud (GCP), azure-cli (Azure), Prometheus (on-prem)
- Unified API: normalize metrics across clouds (latency, error rate, throughput)
- Storage: cloud-agnostic (SQLite with cloud tags)
- Dashboard: cloud selector, drill-down by service
"@
    },
    @{
        num = 79
        title = "Sentinel: Blockchain-Based Audit Log (Immutable)"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Store immutable audit logs using blockchain (or blockchain-style hash chain) for compliance and forensics.

## Acceptance Criteria
- [ ] Hash chain: each audit entry hashes previous entry, making tampering detectable
- [ ] Timestamping: notarize hashes with external timestamping service (RFC 3161)
- [ ] Off-chain: regular backups to external storage (S3, Vault)
- [ ] Verification: periodically verify chain integrity (detect tampering)
- [ ] Compliance: export for auditors (SOC2, ISO27001, PCI-DSS)
- [ ] Retention: 7-year immutable storage

## Technical Details
- Hash chain: entry_hash = SHA256(previous_hash + entry_data)
- Timestamping: FreeTSA or AWS CloudTrail Insight for external proof of timestamp
- Verification job: daily job verifies all hashes (abort if tampering detected)
- Storage: SQLite for hot data, S3 Glacier for cold/archived
"@
    },
    @{
        num = 80
        title = "Sentinel: Advanced Analytics & ML-Powered Recommendations"
        category = "Sentinel"
        storyPoints = 5
        description = @"
## Description
Use machine learning to analyze historical incident patterns and provide intelligent recommendations.

## Acceptance Criteria
- [ ] Pattern clustering: group similar incidents by ML (unsupervised learning)
- [ ] Anomaly detection: detect new incident types never seen before
- [ ] Recommendations: "Similar incident 6 weeks ago, solution was [action]"
- [ ] Scoring: rank incidents by likelihood and severity (prioritize oncall work)
- [ ] Continuous learning: model retrains weekly on new incidents
- [ ] Explainability: show reasoning for recommendations ("based on X incidents")

## Technical Details
- ML algorithms: K-means clustering, Isolation Forest, semantic similarity
- Training data: 6-month incident history (incident logs, resolutions, outcomes)
- Feature extraction: incident text, metrics, services, timing
- Model storage: versioned models with performance metrics
"@
    }
)

# ============================================================================
# NIGHT 3: APPIUM MOBILE NATIVE TESTING (12 issues)
# ============================================================================

$appiumIssues = @(
    @{
        num = 81
        title = "Appium: Mobile Native Testing Foundation"
        category = "Appium"
        storyPoints = 8
        description = @"
## Description
Extend PROVA CLI to support mobile native apps (iOS/Android) using Appium WebDriverIO.

## Acceptance Criteria
- [ ] CLI: qe-tool run --type mobile --platform ios|android --app-path /path/to/app.ipa
- [ ] Appium server integration: auto-start/stop local Appium (or connect to cloud)
- [ ] App upload: support local apps (.ipa, .apk) and cloud app URLs
- [ ] Capabilities: set device type, OS version, app permissions
- [ ] Session management: unique session per test run, auto-cleanup
- [ ] Debugging: capture app logs, device logs, screenshots, video

## Technical Details
- Appium client: webdriverio (npm install --save-dev webdriverio @wdio/appium-service)
- Capabilities: platformName (iOS|Android), deviceName, osVersion, app
- Session: unique sessionId per run, stored in SQLite
- Logs: device logs captured every 5s, app logs on error
"@
    },
    @{
        num = 82
        title = "Appium: Element Selector Strategy (iOS/Android)"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Implement cross-platform element selector strategies for iOS (XCUITest) and Android (UIAutomator2/Espresso).

## Acceptance Criteria
- [ ] iOS selectors: accessibility ID, XPath (XCUITest syntax)
- [ ] Android selectors: resource-id, content-desc, XPath (UIAutomator2 syntax)
- [ ] Self-healing: 5-tier fallback (accessibility ID -> resource-id -> text -> parent+index -> full XPath)
- [ ] Android button selectors: detect native Button, AppCompatButton, MaterialButton
- [ ] iOS button selectors: detect UIButton, Button (SwiftUI)
- [ ] Cross-platform tests: same PROVA test runs on iOS + Android with platform abstraction

## Technical Details
- Appium commands: driver.findElement(MobileBy.AccessibilityId(...))
- XPath syntax: //*[@label='...'] (iOS), //*[@resource-id='...'] (Android)
- Self-healing: try each strategy, log attempts, cache successful selector
- Platform abstraction: @ios @android tags in test steps
"@
    },
    @{
        num = 83
        title = "Appium: Gesture Support (Tap, Swipe, Scroll, Pinch)"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Implement mobile-specific gestures: tap, double-tap, long-press, swipe, scroll, pinch, rotate.

## Acceptance Criteria
- [ ] Tap: single tap, double tap, long press (configurable duration)
- [ ] Swipe: directional swipe (up, down, left, right, diagonal) with speed
- [ ] Scroll: scroll element to top/bottom/specific position
- [ ] Pinch: pinch in/out for zoom (configurable scale factor)
- [ ] Rotate: device rotation (portrait, landscape)
- [ ] Coordinates: support absolute coords and relative (element-relative)
- [ ] Studio UI: gesture builder for visual step configuration

## Technical Details
- Appium MultiTouch API: driver.performTouchAction([{action: 'press', options: {x, y}}, ...])
- Coordinates: screen { x, y } or element-relative { element, xOffset, yOffset }
- Speed: { velocity: 100 } (pixels/ms)
- Studio: drag-drop gesture selector UI, preview on device screenshot
"@
    },
    @{
        num = 84
        title = "Appium: Device Farm Integration (BrowserStack, Sauce Labs)"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Integrate PROVA with BrowserStack and Sauce Labs for testing on real devices in the cloud.

## Acceptance Criteria
- [ ] Config: --device-farm browserstack|sauce-labs --capabilities '{...}'
- [ ] Device selection: filter by device name, OS, brand, screen size
- [ ] Session management: BrowserStack/Sauce Labs creates session, PROVA drives
- [ ] Video recording: auto-captured by device farm, available post-test
- [ ] Device logs: pulled from device farm API after test
- [ ] Cost tracking: log usage minutes per device for billing
- [ ] Parallel: run multiple tests on different devices concurrently

## Technical Details
- Auth: BROWSERSTACK_KEY, SAUCE_USERNAME, SAUCE_ACCESS_KEY env vars
- Capabilities: passed to device farm, device farm picks device matching criteria
- Session: unique sessionId per test, stored with farm info (for debugging)
- Logs: download device logs JSON from farm API after test completion
"@
    },
    @{
        num = 85
        title = "Appium: App Permissions & User Consent Handling"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Handle system permission prompts (location, camera, microphone, contacts) and user consent dialogs.

## Acceptance Criteria
- [ ] Permissions: auto-grant or auto-deny camera, mic, location, contacts, calendar
- [ ] Config: --permissions camera:grant,location:deny
- [ ] Consent dialogs: dismiss or accept app-specific consent (privacy, ToS)
- [ ] Waiting: wait for permission prompts, timeout if not shown (configurable)
- [ ] Validation: verify permission was granted (app can access location, camera, etc.)
- [ ] Multiple runs: reset permissions between test runs

## Technical Details
- iOS: XCUITest system prompt detection (accessibility label 'Allow'), tap 'Allow'/'Don't Allow'
- Android: check AlertDialog text, grant via adb shell pm grant
- Config: YAML { permissions: { camera: grant|deny, location: grant|deny } }
- Reset: uninstall+reinstall app between runs (clears all permission state)
"@
    },
    @{
        num = 86
        title = "Appium: Network Simulation (Slow/Offline Testing)"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Simulate network conditions (slow 3G, 4G, offline) to test app resilience on poor connections.

## Acceptance Criteria
- [ ] Conditions: offline, GPRS, 3G, 4G, LTE, WiFi (pre-defined)
- [ ] Custom: throttle bandwidth, latency, packet loss (--network-condition)
- [ ] BrowserStack: use Network API to simulate conditions
- [ ] Device: use built-in dev tools (Chrome DevTools, Android Studio Emulator)
- [ ] Testing: run full test suite under each network condition
- [ ] Validation: verify app gracefully handles offline (error messages, retry UI)

## Technical Details
- BrowserStack API: POST /v1/mobile/{sessionId}/network { condition: 'slow-3g' }
- Android Emulator: telnet localhost 5554, then 'network throttle' commands
- Chrome DevTools: CDP (Chrome DevTools Protocol) via puppeteer-like API
- Report: per-network-condition results, identify network-sensitive failures
"@
    },
    @{
        num = 87
        title = "Appium: Mobile Screenshots & Visual Regression"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Capture mobile screenshots and detect visual regressions (layout shifts, element misalignment, rendering bugs).

## Acceptance Criteria
- [ ] Screenshots: capture full page, element-specific, before/after action
- [ ] Baseline: store baseline screenshot on first test run (with confirmation)
- [ ] Comparison: Pixelmatch visual diff on subsequent runs
- [ ] Sensitivity: configurable threshold (0-1.0) for acceptable pixel diff %
- [ ] Ignore regions: mark areas to ignore (date/time, ads, dynamic content)
- [ ] Report: highlight diffs with colored overlay (red=changed, blue=new)
- [ ] Device variants: separate baselines per device (pixel-perfect per device)

## Technical Details
- Screenshot: driver.takeScreenshot() returns base64, decode and save PNG
- Diff tool: pixelmatch npm package (npm install --save-dev pixelmatch)
- Baseline dir: tests/baselines/{device}/{test_id}.png
- Comparison: generate diff PNG with red overlay on changes
"@
    },
    @{
        num = 88
        title = "Appium: App State & Lifecycle Management"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Manage app state across test runs: install, launch, background, kill, uninstall.

## Acceptance Criteria
- [ ] Lifecycle: install app -> launch -> test -> background -> kill -> uninstall
- [ ] State: capture app state before/after test (for debugging)
- [ ] Reinstall: between test runs, reinstall app to ensure clean state
- [ ] Caching: option to skip reinstall for faster test runs (--skip-reinstall)
- [ ] Notification: handle app notifications, permission prompts, dialogs
- [ ] Crash detection: detect if app crashes during test, capture logs

## Technical Details
- Install: adb install app.apk (Android), xcode-select install app.ipa (iOS)
- Launch: driver.activateApp(bundleId) -> app comes to foreground
- Background: driver.sendKeyEvent(AndroidKey.HOME)
- Kill: driver.terminateApp(bundleId) -> SIGKILL the app
- Uninstall: adb uninstall package.name
"@
    },
    @{
        num = 89
        title = "Appium: Mobile Test Data Seeding"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Pre-populate mobile app databases/storage with test data for consistent test scenarios.

## Acceptance Criteria
- [ ] Data seeding: SQLite, SharedPreferences (Android), UserDefaults (iOS)
- [ ] Import: --seed-data test-data.json to pre-populate data
- [ ] Isolation: each test run gets a fresh copy of test data
- [ ] Cleanup: delete seeded data post-test
- [ ] Validation: verify data seeded correctly (query DB, check files)
- [ ] Backend sync: if app syncs with backend, seed both local + backend

## Technical Details
- Android: adb shell 'sqlite3 /data/data/com.app/db.db' < seed.sql
- iOS: copy seed.sqlite to app documents folder, run migration
- JSON format: { tables: { users: [{id, name, email}], ... } }
- Cleanup job: runs post-test, verifies all test data removed
"@
    },
    @{
        num = 90
        title = "Appium: Performance Monitoring (CPU, Memory, Battery)"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Monitor mobile app performance metrics during test execution: CPU usage, memory, battery drain, frame rate.

## Acceptance Criteria
- [ ] Metrics: CPU %, memory (MB), battery drain (%/min), FPS (if available)
- [ ] Capture: sample every 500ms during test execution
- [ ] Baseline: compare against baseline (e.g., "CPU > 80% = regression")
- [ ] Alert: flag if metrics exceed thresholds
- [ ] Report: performance graph over time (test duration)
- [ ] Leak detection: memory growth over time indicates potential leak

## Technical Details
- Android: adb shell 'dumpsys meminfo', 'top -n 1' for CPU/memory
- iOS: XCTest performance API, or parse Activity Monitor exports
- Sampling: every 500ms, store in SQLite { timestamp, cpu, memory, battery, fps }
- Baseline: mean + 2 stddev from last 10 runs
"@
    },
    @{
        num = 91
        title = "Appium: Studio Mobile Test Builder UI"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Extend PROVA Studio to support visual mobile test building: drag-drop gestures, element inspector on device screenshot.

## Acceptance Criteria
- [ ] Visual builder: preview of actual device screen (real or emulated)
- [ ] Gesture palette: tap, swipe, scroll, pinch, long-press (drag-drop to canvas)
- [ ] Element inspector: click on device screenshot to select element
- [ ] Element tree: hierarchy of screen elements with accessibility info
- [ ] Gesture preview: show gesture path on screen (e.g., swipe arrow)
- [ ] Live recording: record user interactions on device, auto-generate test steps
- [ ] Replay: playback recorded test on device with visual feedback

## Technical Details
- Device screenshot: pull latest screenshot every 2s (WebSocket stream)
- Gesture palette: pre-built step templates (Tap, Swipe, Scroll, etc.)
- Element tree: accessibility tree from Appium (all focusable elements)
- Recording: hook gesture events from device, serialize as test steps
"@
    },
    @{
        num = 92
        title = "Appium: Mobile Tests & Validation"
        category = "Appium"
        storyPoints = 5
        description = @"
## Description
Comprehensive test suite for Appium integration, covering iOS/Android, gestures, device farms, and edge cases.

## Acceptance Criteria
- [ ] Unit tests: selector strategies, gesture recognition, device detection
- [ ] Integration tests: full test flow on emulator/simulator
- [ ] Device farm tests: BrowserStack/Sauce Labs sessions (cloud integration)
- [ ] Gesture tests: all gesture types, coordinate systems
- [ ] Edge cases: app crash, permission denial, network interruption
- [ ] Coverage: 80%+ of Appium code

## Technical Details
- Test fixtures: pre-recorded app binaries (small test apps)
- Mock Appium: fixture server that responds to Appium protocol
- Device farm mocks: BrowserStack/Sauce Labs API stubs
- Benchmarks: full test execution < 60s on emulator
"@
    }
)

# ============================================================================
# NIGHT 3: OWASP ZAP SECURITY TESTING (8 issues)
# ============================================================================

$zapIssues = @(
    @{
        num = 93
        title = "OWASP ZAP: Security Testing Foundation"
        category = "OWASP ZAP"
        storyPoints = 8
        description = @"
## Description
Integrate OWASP ZAP automated security scanner into PROVA for vulnerability detection in web apps.

## Acceptance Criteria
- [ ] CLI: qe-tool run --type security --url https://app.test --security-level baseline|standard|aggressive
- [ ] ZAP server: auto-start/stop local ZAP daemon or connect to cloud
- [ ] Scanning: passive scan (no payloads), active scan (payloads), or hybrid
- [ ] Report: vulnerability list with severity (critical/high/medium/low/info)
- [ ] Integration: results stored in SQLite, visible in Studio dashboard
- [ ] Fail: exit code 1 if critical/high vulnerabilities found (gate for deploy)

## Technical Details
- ZAP client: npm zaproxy package or direct API calls
- Session: unique sessionId per test, results in DB
- Config: ZAP policies (default, API, web app, etc.)
- Report: JSON export (machine-readable), HTML export (human-readable)
"@
    },
    @{
        num = 94
        title = "OWASP ZAP: Vulnerability Classification & Mapping"
        category = "OWASP ZAP"
        storyPoints = 5
        description = @"
## Description
Classify ZAP findings into standard vulnerability types (OWASP Top 10, CWE) and map to test coverage.

## Acceptance Criteria
- [ ] Classification: map ZAP findings to OWASP Top 10 (A01-A10)
- [ ] CWE mapping: link to Common Weakness Enumeration (CWE-XXX)
- [ ] Coverage: question: "Is there a test for this vulnerability class?"
- [ ] Gap: if no test, recommend test scenario (e.g., "Add XSS injection test")
- [ ] Remediation: link to CWE.org for remediation guidance
- [ ] Dashboard: vulnerabilities sorted by OWASP category, coverage % per category

## Technical Details
- Mapping tables: ZAP rule ID -> OWASP Top 10 -> CWE
- Test coverage: check if any test attempts this attack (XSS payload, SQL injection, etc.)
- Report: vulnerability + recommended test case to cover gap
- Integration: surface in Studio dashboard, link to create test
"@
    },
    @{
        num = 95
        title = "OWASP ZAP: False Positive Filtering"
        category = "OWASP ZAP"
        storyPoints = 5
        description = @"
## Description
Implement false positive filtering to reduce alert fatigue and focus on real vulnerabilities.

## Acceptance Criteria
- [ ] Baseline: first scan establishes baseline of alerts
- [ ] Filtering: hide known false positives (e.g., intentional test XSS)
- [ ] Whitelisting: mark specific alerts as 'reviewed/safe' to exclude future scans
- [ ] Rules: custom rules to ignore alerts (e.g., INFO level, specific URLs)
- [ ] Metrics: track true positive rate, false positive rate over time
- [ ] Feedback: team can mark findings as "Not an issue" to improve filter

## Technical Details
- Baseline storage: SQLite table with first scan results
- Filter rules: YAML { alert_id, cwe, url_pattern, action: ignore|flag }
- Whitelist: per-finding whitelist with reason + date + approver
- Comparison: diff current scan vs baseline, highlight new findings
"@
    },
    @{
        num = 96
        title = "OWASP ZAP: Authenticated Scanning"
        category = "OWASP ZAP"
        storyPoints = 5
        description = @"
## Description
Enable ZAP to scan authenticated endpoints by handling login flows and session management.

## Acceptance Criteria
- [ ] Login: pre-test login flow (username/password, OAuth, SAML) before ZAP scan
- [ ] Session: maintain authenticated session across ZAP requests
- [ ] Cookies: inject session cookies into ZAP scan requests
- [ ] Multi-user: ability to scan as different user roles (admin, user, guest)
- [ ] Token refresh: handle token expiration during long scans
- [ ] Coverage: scan protected endpoints that require authentication

## Technical Details
- Login flow: Playwright pre-test to login, extract session cookies
- Session mgmt: pass cookies to ZAP via API { cookie_name: value }
- Multi-user fixtures: pre-configured user credentials (test users)
- Token refresh: intercept 401 responses, re-authenticate, retry request
"@
    },
    @{
        num = 97
        title = "OWASP ZAP: API Security Scanning"
        category = "OWASP ZAP"
        storyPoints = 5
        description = @"
## Description
Extend ZAP scanning to cover REST APIs: request/response validation, authentication, authorization, injection attacks.

## Acceptance Criteria
- [ ] OpenAPI support: import OpenAPI spec, scan endpoints defined in spec
- [ ] Request templates: generate valid requests from OpenAPI schema
- [ ] Auth: handle API key, Bearer token, OAuth for authenticated endpoints
- [ ] Payloads: inject payloads in query params, headers, body (JSON/XML)
- [ ] Response validation: verify API responses match schema
- [ ] Rate limiting: respect API rate limits during scanning
- [ ] Report: API-specific findings (broken auth, missing input validation, etc.)

## Technical Details
- OpenAPI parsing: npm swagger-parser package
- Request generation: valid JSON/XML bodies from schema
- Auth: API key injection (X-API-Key header or query param)
- Payloads: parameterized by input type (string, number, etc.)
"@
    },
    @{
        num = 98
        title = "OWASP ZAP: Continuous Security Scanning (CI/CD)"
        category = "OWASP ZAP"
        storyPoints = 5
        description = @"
## Description
Integrate ZAP into GitHub Actions CI/CD to run on every PR and main branch deployments.

## Acceptance Criteria
- [ ] Workflow: on PR opened, run ZAP scan on staging environment
- [ ] Gating: fail PR if critical/high vulnerabilities found
- [ ] Baseline comparison: compare scan results to previous (highlight new findings)
- [ ] Reporting: post scan results as PR comment with summary table
- [ ] Trends: track vulnerability count over time (show improvement/regression)
- [ ] Escalation: if vulnerabilities not remediated, escalate to security team

## Technical Details
- GitHub Actions: .github/workflows/security-scan.yml
- Trigger: on pull_request, on push to main
- Scan target: https://staging.app (spinup staging on-demand)
- Report: post comment with table (vulnerability, severity, link to details)
"@
    },
    @{
        num = 99
        title = "OWASP ZAP: Remediation Tracking & Compliance"
        category = "OWASP ZAP"
        storyPoints = 5
        description = @"
## Description
Track vulnerability remediation status and compliance metrics (% critical fixed, SLA for remediation).

## Acceptance Criteria
- [ ] Tracking: link ZAP finding -> JIRA security bug -> fix PR -> verification
- [ ] Status: new, in-progress, fix-deployed, verified, false-positive, accepted-risk
- [ ] SLA: critical must be fixed in 24h, high in 7d, medium in 30d
- [ ] Compliance: % metrics (80% high severity fixed, 100% critical fixed)
- [ ] Report: quarterly compliance report for audit (SOC2, PCI-DSS)
- [ ] Trending: chart showing vulnerability count, remediation rate over time

## Technical Details
- State machine: NEW -> IN_PROGRESS -> FIX_DEPLOYED -> VERIFIED (or ACCEPTED_RISK)
- SLA calendar: business days only (no weekends/holidays)
- Compliance calc: (fixed_critical / total_critical) * 100
- Report export: PDF with timeline, status, SLA compliance, trend charts
"@
    },
    @{
        num = 100
        title = "OWASP ZAP: Security Tests & Validation"
        category = "OWASP ZAP"
        storyPoints = 5
        description = @"
## Description
Comprehensive test suite for ZAP integration, covering scanning, filtering, reporting, and security controls.

## Acceptance Criteria
- [ ] Unit tests: vulnerability classification, false positive filtering, SLA calculation
- [ ] Integration tests: full scan flow (passive, active, authenticated)
- [ ] Safety: ensure ZAP doesn't cause prod outage (rate limiting, timeout)
- [ ] Accuracy: verify ZAP finds known vulnerabilities (test app with intentional bugs)
- [ ] False positive rate: validate filtering reduces noise without hiding real issues
- [ ] Coverage: 80%+ of ZAP integration code

## Technical Details
- Test fixtures: vulnerable test app (DVWA or custom), OpenAPI spec
- Mock ZAP: server stub responding to ZAP API calls
- Known vulns: intentional XSS, SQLi, CSRF in test app
- Benchmarks: scan < 10min, <5% false positive rate
"@
    }
)

# ============================================================================
# NIGHT 3: KNOWLEDGE GRAPH (20 issues)
# ============================================================================

$knowledgeGraphIssues = @(
    @{
        num = 101
        title = "Knowledge Graph: Data Model & Schema Design"
        category = "Knowledge Graph"
        storyPoints = 8
        description = @"
## Description
Design and implement the knowledge graph data model connecting specs, tests, code, deployments, and prod data.

## Acceptance Criteria
- [ ] Node types: Requirement, Test, Code, Deployment, Service, User, Incident
- [ ] Edge types: tests, implements, breaks, depends_on, links_to, caused_by
- [ ] Schema: vertex + edge properties (name, type, status, timestamp, metadata)
- [ ] Relationships: requirement -> test (coverage), code -> deployment (lineage), service -> incident (impact)
- [ ] Query support: find all tests for requirement, all code changes affecting test, etc.
- [ ] Storage: SQLite with proper foreign keys, or Neo4j for native graph DB

## Technical Details
- Schema: vertex { id, type, name, metadata JSON }, edge { from_id, to_id, type, properties }
- Indices: on vertex type, edge type, name for fast queries
- Validation: no orphaned vertices, cycles detected and flagged
- Import: bulk load from GitHub, JIRA, test results, Datadog
"@
    },
    @{
        num = 102
        title = "Knowledge Graph: JIRA Requirements Ingestion"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Import JIRA requirements into knowledge graph: issues, epics, custom fields, acceptance criteria.

## Acceptance Criteria
- [ ] Sync: daily job pulls all open issues from JIRA project
- [ ] Fields: capture issue key, title, description, AC, assignee, priority, status
- [ ] Custom fields: PROVA story points, risk level, test coverage %
- [ ] Relationships: issue -> parent epic, issue -> linked issues (blocks, relates to)
- [ ] Updates: if JIRA issue updated, knowledge graph reflects change (eventually consistent)
- [ ] Deletion: if JIRA issue closed/deleted, mark as archived (keep history)

## Technical Details
- JIRA API: /rest/api/3/search with JQL (project = MYPROJECT AND status = Open)
- OAuth: JIRA_CLIENT_ID, JIRA_CLIENT_SECRET env vars
- Sync schedule: daily 2 AM, or on-demand via --sync-jira flag
- Storage: JIRA issues as vertices { type: requirement, source: jira, jira_key: PROJ-123 }
"@
    },
    @{
        num = 103
        title = "Knowledge Graph: GitHub Code Ingestion"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Import GitHub code into knowledge graph: commits, files, functions, branches, PRs.

## Acceptance Criteria
- [ ] Commits: every commit becomes a vertex with author, message, files changed
- [ ] Files: track file path, language, complexity metrics
- [ ] Functions: extract function signatures (for TypeScript/Python, others best-effort)
- [ ] PRs: link PR -> commits -> related JIRA issue (via PR title/description)
- [ ] Branches: track branch name, parent, deployment environment
- [ ] Blame: for each test failure, show last code change in test file

## Technical Details
- GitHub API: /repos/{owner}/{repo}/commits (paginated, full history)
- AST parsing: TypeScript, Python, JavaScript (fallback: regex for functions)
- Link detection: PR body regex for "Closes #123" or JIRA key
- Storage: commits as vertices { type: code_change, file, author, timestamp }
"@
    },
    @{
        num = 104
        title = "Knowledge Graph: Test Case Ingestion"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Import test cases into knowledge graph: test files, test functions, test steps, assertions.

## Acceptance Criteria
- [ ] Tests: every test file + test function becomes vertices
- [ ] Steps: parse test steps (click, type, assert) from test code
- [ ] Coverage: link test -> requirement (JIRA issue)
- [ ] Dependencies: test A depends on test B (if B setup needed for A)
- [ ] Metadata: test author, last run, pass rate, avg duration
- [ ] Annotations: @flaky, @slow, @skip tags (capture metadata)

## Technical Details
- Test files: glob src/ and tests/, extract test definitions (Jest, Playwright)
- AST: parse test code to extract step descriptions (describe blocks, test steps)
- Coverage link: regex in test comments "// JIRA: PROJ-123" or @requirement decorator
- Storage: tests as vertices { type: test, source: file, coverage_targets: [JIRA_KEY] }
"@
    },
    @{
        num = 105
        title = "Knowledge Graph: Deployment & Service Ingestion"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Import deployment and service topology into knowledge graph: services, dependencies, versions, health.

## Acceptance Criteria
- [ ] Services: list of all services (microservices, external APIs, databases)
- [ ] Dependencies: service A calls service B (API call, DB query, etc.)
- [ ] Versions: track deployed version of each service per environment
- [ ] Health: current health status (up, degraded, down) pulled from monitoring
- [ ] Config: service metadata (owner, runbook URL, SLA, on-call team)
- [ ] Changes: on deployment, update service version in graph

## Technical Details
- Sources: Kubernetes services, systemd services, Docker containers
- Dependency detection: service discovery (Consul), API gateway logs, code analysis
- Health API: Prometheus, Datadog, or custom health check endpoint
- Sync: on deployment (GitHub Actions webhook), or periodic (every 5 min)
"@
    },
    @{
        num = 106
        title = "Knowledge Graph: Production Incident Ingestion"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Import production incidents into knowledge graph: incidents, root causes, affected services, remediation.

## Acceptance Criteria
- [ ] Incidents: each incident is a vertex (from Datadog, PagerDuty, or JIRA)
- [ ] Timeline: incident start -> detection -> mitigation -> resolution timestamps
- [ ] Impact: affected services, users impacted, revenue impact
- [ ] Root cause: link incident -> code change (commit) that caused it
- [ ] Resolution: link incident -> fix PR, verify fix deployed
- [ ] Prevention: link incident -> new test created to prevent recurrence

## Technical Details
- Sources: Datadog events, PagerDuty incidents, JIRA tickets (label: incident)
- Root cause detection: correlate incident time with code deployments
- Links: incident vertex -> service vertex (affected), -> commit vertex (cause)
- Storage: incidents as vertices { type: incident, status, impact, root_cause_vertex_id }
"@
    },
    @{
        num = 107
        title = "Knowledge Graph: Query Engine & API"
        category = "Knowledge Graph"
        storyPoints = 8
        description = @"
## Description
Build a query engine to traverse knowledge graph and answer business questions.

## Acceptance Criteria
- [ ] Questions: "What tests cover requirement X?", "What code changed in test Y?", "What incidents does service Z affect?"
- [ ] Query API: REST endpoint /api/graph/query with GraphQL or SQL interface
- [ ] Traversal: path finding (requirement -> code -> test -> incident)
- [ ] Analytics: count, aggregate, statistical queries
- [ ] Performance: complex queries return in <1s (< 100K vertices)
- [ ] Caching: memoize common queries for instant response

## Technical Details
- Query language: GraphQL (graph queries) or SQL (relational-like queries)
- Storage: SQLite (for <100K vertices) or Neo4j (for larger graphs)
- Indices: on frequently queried properties (type, status, timestamp)
- Cache: Redis or in-memory LRU for common queries
"@
    },
    @{
        num = 108
        title = "Knowledge Graph: Visualization & Dashboard"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Create Studio dashboard to visualize knowledge graph: node explorer, graph traversal, dependency maps.

## Acceptance Criteria
- [ ] Node explorer: search for requirement/code/test/service/incident, see properties
- [ ] Graph view: visualize subgraph around selected node (e.g., requirement -> tests -> code)
- [ ] Filters: show only certain node types (tests, code, incidents)
- [ ] Paths: highlight path from requirement to incident (requirements -> tests -> code -> deployment -> incident)
- [ ] Drill-down: click node to see details (test results, code diff, incident timeline)
- [ ] Export: download subgraph as JSON/SVG for offline analysis

## Technical Details
- Frontend: React component using D3.js or Cytoscape.js for graph rendering
- Data: fetch subgraph from query API ({ nodes, edges, properties })
- Rendering: spring layout for automatic node positioning
- Interactions: pan, zoom, hover tooltips, click to expand
"@
    },
    @{
        num = 109
        title = "Knowledge Graph: AI-Powered Insights & Recommendations"
        category = "Knowledge Graph"
        storyPoints = 8
        description = @"
## Description
Use AI to analyze knowledge graph and provide insights: suggest tests, predict failures, identify risks.

## Acceptance Criteria
- [ ] Test gaps: "Code in X was not tested, recommend test case Y"
- [ ] Risk prediction: "Changes in service A have 5% failure rate, high risk"
- [ ] Flaky tests: "Test X is failing 1% of time, likely flaky, recommend investigation"
- [ ] Incident prediction: "Pattern similar to incident from 3 months ago, recommend mitigation"
- [ ] Optimization: "Test Y is slow (200s), similar test Z is 50s, suggest refactor"
- [ ] Collaboration: "Developer A made changes in service B, contact A for review"

## Technical Details
- Analysis: Claude API (or local ollama) fed relevant subgraph context
- Patterns: ML on historical data (test failures, deployments, incidents) to detect trends
- Scoring: recommendation confidence (0.5-1.0), with reasoning
- UI: "AI Insights" panel on Studio dashboard, sortable by confidence/impact
"@
    },
    @{
        num = 110
        title = "Knowledge Graph: Traceability Reports (Full Chain)"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Generate comprehensive traceability reports showing full requirement -> test -> code -> deployment -> incident chain.

## Acceptance Criteria
- [ ] Report type 1: Requirement coverage (% of requirements tested)
- [ ] Report type 2: Test lineage (test -> code changes -> deployments)
- [ ] Report type 3: Incident root cause (incident -> code -> test gap)
- [ ] Visual: HTML report with navigable links between chain components
- [ ] Export: PDF for compliance/audit purposes
- [ ] Metrics: test coverage %, code change frequency, incident rate per service

## Technical Details
- Report template: HTML with embedded images/links
- Data: queries knowledge graph to build full chains
- Links: clickable to JIRA, GitHub, test results, incident details
- PDF: Playwright HTML to PDF conversion
"@
    },
    @{
        num = 111
        title = "Knowledge Graph: Multi-Source Conflict Resolution"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Handle conflicts when same entity (requirement, code, test) referenced from multiple sources (JIRA, GitHub, tests).

## Acceptance Criteria
- [ ] Deduplication: recognize JIRA issue PROJ-123 and GitHub PR comment \"Closes #123\" refer to same requirement
- [ ] Master record: decide which source is authoritative (JIRA = source of truth for requirements)
- [ ] Merging: combine properties from multiple sources (JIRA description + GitHub PR details)
- [ ] Validation: detect conflicts (JIRA says 'Open', code says 'closed') and alert
- [ ] Reconciliation: periodic job to detect and flag conflicts

## Technical Details
- Linking: regex parsing of PR titles/comments, custom matchers
- Master data: config { requirement: jira, code: github, test: test_files }
- Merging: schema defines which source takes precedence for each property
- Conflict log: table of detected conflicts, resolution status
"@
    },
    @{
        num = 112
        title = "Knowledge Graph: Privacy & Data Redaction"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Implement privacy controls to redact sensitive data in knowledge graph (PII, credentials, internal details).

## Acceptance Criteria
- [ ] Redaction: mask PII (email, phone, SSN) in incident logs, test data, code
- [ ] Rules: configurable regex patterns for sensitive data
- [ ] Access control: some users see redacted data, admins see unredacted
- [ ] Audit: log who viewed unredacted data (for compliance)
- [ ] Export: redacted by default in reports (option to include unredacted if authorized)
- [ ] Retention: PII automatically deleted after X days (GDPR compliance)

## Technical Details
- Rules file: YAML { patterns: { email: regex, ssn: regex, ... } }
- Redaction fn: replace matching text with [REDACTED], keep field (not deleted)
- Access control: role-based (admin, security, dev, viewer) with visibility rules
- Audit: immutable log { timestamp, user, resource, action: view_unredacted }
"@
    },
    @{
        num = 113
        title = "Knowledge Graph: Performance Optimization (Caching, Indexing)"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Optimize knowledge graph performance for fast queries on large datasets (100K+ vertices).

## Acceptance Criteria
- [ ] Indices: on frequently queried properties (type, status, timestamp, source)
- [ ] Query caching: common queries cached (requirement coverage, test lineage)
- [ ] Lazy loading: don't load full graph, load on-demand as user explores
- [ ] Pagination: graph results paginated (100 nodes per page)
- [ ] Analytics: pre-compute metrics (test coverage %, incident rate) daily
- [ ] Benchmarks: simple query <100ms, complex query (5-hop path) <1s

## Technical Details
- DB: SQLite with PRAGMA optimize, or Neo4j with indices
- Cache: Redis for query results (TTL 1 hour)
- Pagination: cursor-based (last_id + limit)
- Analytics job: nightly compute coverage %, incident stats, store in cache
"@
    },
    @{
        num = 114
        title = "Knowledge Graph: Integration with Studio & CLI"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Surface knowledge graph insights in PROVA Studio and CLI for test building and debugging.

## Acceptance Criteria
- [ ] Studio: "Show all tests for requirement" -> click requirement, see linked tests
- [ ] Studio: "Show all code changes in test" -> click test, see commits that changed it
- [ ] CLI: qe-tool graph --requirement PROJ-123 -> show all tests covering requirement
- [ ] CLI: qe-tool graph --incident ID -> show full incident chain (code -> test -> deployment)
- [ ] Suggestions: when creating test, suggest coverage gaps based on graph
- [ ] History: show when test last ran, results, related incidents

## Technical Details
- UI: context-sensitive graph panels in Studio (embedded Cytoscape.js)
- CLI: JSON output of graph queries (for scripting)
- Suggestions: ML-powered, shown when creating new test
- History: timeline of related events (test runs, code changes, incidents)
"@
    },
    @{
        num = 115
        title = "Knowledge Graph: Backup & Disaster Recovery"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Implement backup and recovery for knowledge graph to prevent data loss.

## Acceptance Criteria
- [ ] Backups: daily snapshots of entire graph (SQLite dump or Neo4j backup)
- [ ] Offsite: backups stored in S3 or cloud storage (not local only)
- [ ] Retention: keep last 30 days of backups (monthly archive to cold storage)
- [ ] Restore: ability to restore graph to any point in time
- [ ] Testing: verify backups are restorable (monthly restore test)
- [ ] MTTR: restore graph to production < 1 hour (SLA)

## Technical Details
- Backup format: SQL dump (SQLite) or backup files (Neo4j)
- Schedule: daily 2 AM UTC (cron job)
- Storage: S3 with lifecycle rules (30d hot, then Glacier)
- Restore: automated restore script (test monthly, document procedure)
"@
    },
    @{
        num = 116
        title = "Knowledge Graph: Audit Trail & Compliance"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Maintain immutable audit trail of all graph modifications for compliance and debugging.

## Acceptance Criteria
- [ ] Audit log: every vertex/edge addition, modification, deletion logged with user + timestamp
- [ ] Immutable: audit log append-only, no deletions allowed
- [ ] Queries: audit trail queries (who changed what, when)
- [ ] Retention: 7-year retention for compliance (SOC2, PCI-DSS)
- [ ] Export: audit report for external auditors (certified format)
- [ ] Alerts: suspicious activity alerts (bulk deletions, unauthorized access)

## Technical Details
- Audit table: { id, action (insert|update|delete), vertex_id, old_val, new_val, user, timestamp }
- Encryption: audit records encrypted at rest (AES-256)
- Append-only: application enforces INSERT-only (DB constraints)
- Export: signed audit report (for regulatory compliance)
"@
    },
    @{
        num = 117
        title = "Knowledge Graph: Federation & Multi-Org Support"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Enable multiple organizations to use PROVA with separate knowledge graphs (multi-tenancy).

## Acceptance Criteria
- [ ] Organization isolation: each org has separate graph, no data leakage
- [ ] Data partitioning: org_id column on all tables
- [ ] Access control: user can only see org they belong to
- [ ] Federation: optional link graphs across orgs (for shared dependencies)
- [ ] Compliance: each org independently compliant (GDPR, HIPAA, etc.)
- [ ] Cost: separate billing per org

## Technical Details
- Schema: org_id FK on all tables (vertices, edges, audit)
- Queries: all queries filtered by user's org_id (implicit WHERE clause)
- Auth: token includes org_id, API enforces org isolation
- Federation: optional edge type cross_org linking
"@
    },
    @{
        num = 118
        title = "Knowledge Graph: Tests & Validation"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Comprehensive test suite for knowledge graph, covering ingestion, querying, conflict resolution, and edge cases.

## Acceptance Criteria
- [ ] Unit tests: node types, edge types, schema validation
- [ ] Integration tests: full pipeline (JIRA sync -> GitHub sync -> test ingestion -> query)
- [ ] Data integrity: no orphaned vertices, no circular dependencies
- [ ] Query accuracy: known-answer tests for common queries
- [ ] Performance: benchmarks (queries <1s, ingestion <5 min)
- [ ] Edge cases: missing data, null fields, corrupted records
- [ ] Coverage: 80%+ of graph code

## Technical Details
- Fixtures: pre-built graphs with known structure
- Mocks: JIRA API, GitHub API stubs
- Validation: constraint checks (FK integrity, type consistency)
- Benchmarks: 100K vertex query latency, sync performance
"@
    },
    @{
        num = 119
        title = "Knowledge Graph: Documentation & User Guide"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Document knowledge graph architecture, data model, queries, and use cases for users and developers.

## Acceptance Criteria
- [ ] Architecture doc: overview of graph design, node/edge types, data flow
- [ ] User guide: how to explore graph in Studio, common queries
- [ ] Query examples: "Show all tests for requirement", "Find code changes in test", etc.
- [ ] API docs: REST endpoint reference (query, pagination, filtering)
- [ ] Data model: ER diagram showing all entity types and relationships
- [ ] Troubleshooting: common issues (missing data, stale queries) and solutions

## Technical Details
- Docs location: docs/knowledge-graph/
- Format: Markdown with diagrams (Mermaid for ER, Cytoscape for graph examples)
- Examples: runnable query examples with sample output
- Diagrams: entity relationships, data flow from sources to graph
"@
    },
    @{
        num = 120
        title = "Knowledge Graph: Phase Completion & Integration"
        category = "Knowledge Graph"
        storyPoints = 5
        description = @"
## Description
Final integration of knowledge graph with Golden Thread, Sentinel, and Appium for unified traceability.

## Acceptance Criteria
- [ ] Integration: Golden Thread queries knowledge graph for test coverage
- [ ] Integration: Sentinel uses graph to match prod errors to tests
- [ ] Integration: Appium results linked in knowledge graph (test -> app version -> incident)
- [ ] Dashboard: unified Studio dashboard showing all systems (Studio, Golden Thread, Sentinel, Graph)
- [ ] CLI: qe-tool commands leverage graph for insights
- [ ] Validation: end-to-end tests covering all systems together
- [ ] Performance: full pipeline <10s response time

## Technical Details
- API integration: Golden Thread -> graph query (test coverage)
- Sentinel -> graph query (error pattern coverage)
- Dashboard component: unified widget showing key metrics from all systems
- End-to-end tests: requirement -> test -> deployment -> incident -> root cause
"@
    }
)

# ============================================================================
# FUNCTIONS
# ============================================================================

function Verify-GitHubAuth {
    Write-Host "Verifying GitHub authentication..." -ForegroundColor Cyan

    try {
        $authStatus = & gh auth status 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Authenticated: $authStatus" -ForegroundColor Green
            return $true
        } else {
            Write-Host "GitHub auth failed: $authStatus" -ForegroundColor Red
            return $false
        }
    }
    catch {
        Write-Host "GitHub CLI (gh) not found. Install from: https://cli.github.com/" -ForegroundColor Red
        return $false
    }
}

function Check-RateLimit {
    Write-Host "Checking GitHub API rate limit..." -ForegroundColor Cyan

    try {
        $rateLimit = & gh api rate_limit --jq '.resources.core.remaining' 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Failed to check rate limit: $rateLimit" -ForegroundColor Red
            return $false
        }
        $remaining = [int]$rateLimit

        if ($remaining -lt 150) {
            Write-Host "Low rate limit: $remaining requests remaining (need 150+ for 80 issues)" -ForegroundColor Yellow
            return $false
        }

        Write-Host "Rate limit: $remaining requests remaining" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "Failed to check rate limit: $_" -ForegroundColor Red
        return $false
    }
}

function Create-GitHubIssue {
    param(
        [string]$Title,
        [string]$Body,
        [array]$Labels
    )

    try {
        $args = @(
            "issue", "create",
            "--repo", $RepoSlug,
            "--title", $Title,
            "--body", $Body,
            "--label", ($Labels -join ",")
        )

        $result = & gh @args 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Failed to create issue: $Title - $result" -ForegroundColor Red
            return $false
        }
        Write-Host "Created: $Title" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "Failed to create issue: $Title" -ForegroundColor Red
        Write-Host "   Error: $_" -ForegroundColor Red
        return $false
    }
}

function Show-DryRun {
    param([array]$AllIssues, [string]$NightLabel)

    Write-Host ""
    Write-Host "DRY RUN: Would create $($AllIssues.Count) $NightLabel issues" -ForegroundColor Cyan
    Write-Host ""

    $byCategory = $AllIssues | Group-Object -Property category

    foreach ($group in $byCategory) {
        $categoryLine = $group.Name.ToUpper() + ' (' + $group.Count + ' issues)'
        Write-Host $categoryLine -ForegroundColor White
        Write-Host ("-" * 60)

        foreach ($issue in $group.Group) {
            Write-Host "[#$($issue.num)] $($issue.title)"
            Write-Host "    Story Points: $($issue.storyPoints)"
            $agentLabel = if ($issue.num -le 45) { ", agent-implement (first 5 GT only)" } else { "" }
            $epicLabel = Get-EpicLabel -Category $issue.category
            Write-Host "    Labels: phase3, feature, epic:enterprise, $epicLabel$agentLabel`n"
        }
    }

    Write-Host ("=" * 60) -ForegroundColor Green
    Write-Host "Total: $($AllIssues.Count) issues ready for creation" -ForegroundColor Green
    Write-Host "   Base Labels: phase3, feature, epic:enterprise, epic:<feature>" -ForegroundColor Green
}

function Get-EpicLabel {
    param([string]$Category)

    switch ($Category) {
        "Golden Thread"   { return "epic:golden-thread" }
        "Sentinel"        { return "epic:sentinel" }
        "Appium"          { return "epic:appium" }
        "OWASP ZAP"       { return "epic:zap" }
        "Knowledge Graph" { return "epic:knowledge-graph" }
        default { throw "Unknown Phase 3 category: $Category" }
    }
}

function Create-AllIssues {
    param([array]$AllIssues, [string]$NightLabel)

    Write-Host "Creating $($AllIssues.Count) $NightLabel issues..." -ForegroundColor Cyan

    if (-not (Verify-GitHubAuth)) {
        Write-Host "GitHub authentication failed. Aborting." -ForegroundColor Red
        return $false
    }

    if (-not (Check-RateLimit)) {
        Write-Host "Insufficient API rate limit. Aborting." -ForegroundColor Red
        return $false
    }

    foreach ($label in @(
        @{ Name = 'phase3'; Color = '5319E7'; Description = 'Phase 3 Platform roadmap work' },
        @{ Name = 'feature'; Color = '0E8A16'; Description = 'Product feature' },
        @{ Name = 'epic:enterprise'; Color = '1D76DB'; Description = 'PROVA Enterprise features epic' },
        @{ Name = 'epic:golden-thread'; Color = '0052CC'; Description = 'Golden Thread traceability epic' },
        @{ Name = 'epic:sentinel'; Color = 'B60205'; Description = 'PROVA Sentinel epic' },
        @{ Name = 'epic:appium'; Color = '0E8A16'; Description = 'Native mobile testing epic' },
        @{ Name = 'epic:zap'; Color = 'D93F0B'; Description = 'OWASP ZAP security testing epic' },
        @{ Name = 'epic:knowledge-graph'; Color = '5319E7'; Description = 'Knowledge Graph epic' },
        @{ Name = 'agent-implement'; Color = '0E8A16'; Description = 'Queued for nightly implementation' }
    )) {
        & gh label create $label.Name --repo $RepoSlug --color $label.Color --description $label.Description --force 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Failed to ensure GitHub label: $($label.Name)" -ForegroundColor Red
            return $false
        }
    }

    $existingJson = & gh issue list --repo $RepoSlug --state all --limit 1000 --json title 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to list existing GitHub issues: $existingJson" -ForegroundColor Red
        return $false
    }
    $existingTitles = @($existingJson | ConvertFrom-Json | ForEach-Object { $_.title })
    $created = 0
    $skipped = 0
    $failed = 0

    foreach ($issue in $AllIssues) {
        if ($existingTitles -contains $issue.title) {
            Write-Host "Skipped existing issue: $($issue.title)" -ForegroundColor Yellow
            $skipped++
            continue
        }
        $body = "$($issue.description)`n`n---`n**Story Points:** $($issue.storyPoints)"
        $labels = @("phase3", "feature", "epic:enterprise", (Get-EpicLabel -Category $issue.category))
        # Only first 5 Golden Thread issues get agent-implement
        if ($issue.num -le 45 -and $issue.category -eq "Golden Thread") {
            $labels += "agent-implement"
        }

        if (Create-GitHubIssue -Title $issue.title -Body $body -Labels $labels) {
            $created++
        } else {
            $failed++
        }

        # Delay to avoid rate limiting
        Start-Sleep -Milliseconds 500
    }

    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor Green
    Write-Host "RESULTS:" -ForegroundColor Green
    Write-Host "   Created: $created/$($AllIssues.Count)" -ForegroundColor Green
    Write-Host "   Skipped: $skipped/$($AllIssues.Count)" -ForegroundColor Yellow
    Write-Host "   Failed:  $failed/$($AllIssues.Count)" -ForegroundColor Green

    return ($failed -eq 0 -and ($created + $skipped) -eq $AllIssues.Count)
}

function Update-SprintProgress {
    param([bool]$Success, [string]$NightLabel, [int]$Count)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $status = if ($Success) { "COMPLETE" } else { "PARTIAL" }

    $progressEntry = @(
        "",
        "## $NightLabel Issues ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))",
        "**Time:** $timestamp",
        "**Status:** $status",
        "- Target: $Count $NightLabel issues",
        "- Labels: phase3, feature, epic:enterprise, epic:<feature>",
        "- Story Points: Fibonacci mix",
        ""
    ) -join "`r`n"

    if (Test-Path $ReportPath) {
        Add-Content -Path $ReportPath -Value $progressEntry -Encoding UTF8
    } else {
        Set-Content -Path $ReportPath -Value $progressEntry -Encoding UTF8
    }

    Write-Host "Progress logged to $ReportPath" -ForegroundColor Green
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Host ""
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host "PROVA Phase 3 - Enterprise Backlog Issues Creator" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host ""

$allIssues = @()
$nightLabel = ""

if ($NightFilter -eq "night2" -or $NightFilter -eq "both") {
    $allIssues += $goldenThreadIssues
    $allIssues += $sentinelIssues
    $nightLabel = "Night 2 (Golden Thread + Sentinel)"
}

if ($NightFilter -eq "night3" -or $NightFilter -eq "both") {
    $allIssues += $appiumIssues
    $allIssues += $zapIssues
    $allIssues += $knowledgeGraphIssues
    if ($nightLabel) { $nightLabel += " + Night 3" } else { $nightLabel = "Night 3 (Appium + ZAP + Knowledge Graph)" }
}

if ($DryRun) {
    Show-DryRun -AllIssues $allIssues -NightLabel $nightLabel
} else {
    $success = Create-AllIssues -AllIssues $allIssues -NightLabel $nightLabel
    Update-SprintProgress -Success $success -NightLabel $nightLabel -Count $allIssues.Count

    if ($success) {
        Write-Host ""
        Write-Host "All $($allIssues.Count) issues created successfully!" -ForegroundColor Green
        Write-Host "Phase 3 enterprise issue seed is complete and safe to rerun." -ForegroundColor Cyan
    } else {
        Write-Host ""
        Write-Host "Some issues failed to create." -ForegroundColor Yellow
        exit 1
    }
}

Write-Host ""
