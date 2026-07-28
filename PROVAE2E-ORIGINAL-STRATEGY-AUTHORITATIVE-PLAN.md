# PROVAE2E Original Strategy - Authoritative Execution Plan

**Audience:** Claude Code, Codex, maintainers, reviewers, and release agents  
**Owner:** Ajay / PROVAE2E Project Lead  
**Status:** AUTHORITATIVE - execute without strategic deviation  
**Effective date:** 2026-07-27  
**Current shipped baseline:** `v0.3.3-beta.1`  

---

## 1. Mandatory instruction to Claude Code

Read this document completely before planning or changing code.

This document restores PROVAE2E's original strategy:

> Build a developer-first, CLI-native, affordable and transparent AI quality
> platform that turns requirements into executable tests with verifiable
> evidence.

Do not optimize for competitor feature counts. Do not attempt to reproduce the
entire Tricentis, ContextQA, ACCELQ, or mabl product catalogue. Do not claim
market leadership based on internal scoring.

The goal is a reliable, differentiated product with real users and measurable
outcomes. A smaller capability that works end-to-end is more valuable than many
shallow or mocked features.

### Order of authority

When instructions conflict, follow this order:

1. Direct instruction from Ajay for the current task.
2. This authoritative plan.
3. Shipped release contracts and backward-compatibility requirements.
4. Security and release-quality gates.
5. Existing implementation documents and historical roadmaps.

The following goals in older documents are superseded:

- "Beat Tricentis" or "market leader 8.5/10."
- "PROVA wins 34/37 features."
- Shipping 10 or 12 plugins merely to increase feature count.
- Treating mocked contract tests as proof of a working integration.
- Treating deterministic selector fallback (five-tier resolver) as equivalent to
  learning-based AI self-healing. (Fallback is deterministic logic; self-healing
  requires persistent learning, approval, and audit.)
- Treating mobile-web BrowserStack execution as native mobile coverage.
- Publishing a release because a calendar date or version target was reached.
- Advertising multi-browser execution, OpenAPI testing, or learning self-healing
  as shipped before Section 5.1 foundation gates are approved and released.

`RELEASE-0.3.4-FINAL-PLAN.md` is no longer an execution authority. It may be
used as historical technical input only. Claude Code must first rewrite the
v0.3.4 execution plan to conform to this document.

---

## 2. Product position

### Target users

- Developers, SDETs, small QA teams, and AI startups.
- Teams that prefer CLI, source control, CI/CD, and inspectable artifacts.
- Teams priced out of large enterprise testing platforms.
- Technical users who value local or controllable AI and low vendor lock-in.

### Core promise

PROVAE2E converts requirements into executable quality checks, runs them across
web, API, and supported mobile surfaces, and returns transparent evidence that
helps a human make a release decision.

### Differentiators to protect

- CLI-first and automation-friendly.
- Playwright-native and developer-readable output.
- MIT-licensed core and affordable operation.
- Local AI option where practical.
- Explicit evidence: screenshots, traces, logs, metrics, and reports.
- Human approval for consequential AI-generated changes.
- Backward-compatible, opt-in capabilities.

### What PROVAE2E is not yet

- A replacement for every enterprise testing suite.
- A certified compliance platform.
- A mature native-mobile device lab.
- A fully autonomous AI testing agent.
- A secure third-party plugin marketplace.
- Multi-browser testing (Chromium-only; Firefox and WebKit support planned for
  Section 5.1, Priority 1).
- OpenAPI-based API test generation (manual test writing only; OpenAPI import
  planned for Section 5.1, Priority 2).
- Learning-based self-healing (deterministic five-tier fallback only; learning
  repair persistence planned for Section 5.1, Priority 3).

Documentation and marketing must state these limits honestly. Any claim of
capabilities listed above must include the version and date when that
capability was shipped and passed the release gates in this plan.

---

## 2.1 Foundation hardening before Phase 4

This work strengthens existing promises and does not replace the original
Phase 4 enterprise roadmap.

### Planned releases after v0.3.4-beta.1

1. `v0.3.5-beta.1`: Phase 4 readiness release combining multi-browser
   execution, safe OpenAPI generation/execution, and local adaptive selector
   memory with human review controls.
2. `v0.3.6-beta.1`: changed-test selection, risk ordering, and CI cost
   reduction.
3. `v0.4.0-beta.1`: first Phase 4 enterprise release after the published
   foundation gate is independently validated.

Capabilities start opt-in, retain existing CLI defaults, and require
representative end-to-end evidence before being called complete.

### Economical agentic architecture

- Target at least 90% deterministic execution through Node.js, PowerShell,
  Playwright, Jest, and local stores.
- Target up to 9% local Ollama analysis and less than 1% paid-cloud
  escalation. These are operating targets, not guarantees.
- Run ARIA, FORGE, and VERA in one shared implementation session per issue.
- Run deterministic lint, typecheck, and tests before LENS.
- Permit at most one automatic AI repair cycle and cancel superseded runs.
- Paid AI is disabled by default for customer execution and deployment.
- Human approval remains mandatory for permanent source changes, merge, npm
  publication, and production deployment.
- Record provider, model, token usage, estimated cost, and escalation reason;
  enforce configurable per-run and monthly budgets.
- Never send secrets, complete DOMs, or unsanitized traces to a model.
- Do not describe Claude Code CLI execution as local AI.

Runtime roles are Planner, Generator, deterministic Executor, Diagnostician,
Healer, Release Guardian, and Sentinel. A role does not imply an LLM call.

---

## 3. Non-negotiable execution principles

1. **Reliability before breadth.** Fix installation, execution, reporting,
   reproducibility, cleanup, and upgrade problems before adding surfaces.
2. **One closed loop before many features.** Prioritize
   requirement -> generate -> execute -> evidence -> diagnose -> approved repair.
3. **Evidence before claims.** A capability is not "complete" without live or
   representative end-to-end evidence.
4. **Depth before plugin count.** Implement at most three deep integrations in
   the current strategy horizon.
5. **Human control.** AI may propose a repair; it must not silently modify or
   publish tests by default.
6. **No silent scope expansion.** New features require the change-control
   procedure in Section 11.
7. **No release by aspiration.** Version, date, test count, or competitor
   announcement cannot override acceptance gates.
8. **No misleading terminology.** Names must describe shipped behavior.
9. **No destructive workspace handling.** Preserve user changes and use an
   isolated branch or worktree where necessary.
10. **No publication without complete release evidence and owner approval.**

---

## 4. Economical Agentic Architecture

**Objective:** Keep PROVAE2E agentic from design through production while
minimizing paid AI usage and maintaining full transparency and control.

### AI usage targets

Operating targets for the PROVA pipeline (development, testing, and release):

- **90%+:** Deterministic Node.js, PowerShell, Playwright, Jest, and scripted operations.
- **Up to 9%:** Local Ollama analysis (no costs, no external API calls).
- **Less than 1%:** Paid Claude escalation for complex unresolved cases.

These percentages are operating targets to guide implementation, not guaranteed
measurements. Actual distributions vary by stage and customer usage patterns.

### Development agent workflow (ARIA + FORGE + VERA)

1. ARIA (orchestrator), FORGE (implementer), and VERA (tester) run in one shared
   Claude session per GitHub issue.
2. Before any AI review, deterministic lint, typecheck, and test suites run in
   PowerShell or Node.js.
3. LENS (code reviewer) runs only after normal CI passes.
4. LENS examines only changed and contextually relevant files (not entire codebase).
5. Allow a maximum of one automatic AI repair attempt per issue; manual fixes
   required thereafter.
6. Cancel running agent sessions when a newer commit supersedes them on main.
7. Cache failure signatures and their successful resolutions; reuse before
   generating new analyses.
8. Never use paid AI for ordinary test execution, report generation, or deployment.
9. Use local Ollama before Claude for failure classification and root-cause analysis.
10. Require explicit human approval for test-source code changes, PR merge,
    npm publication, and production deployment.

### Product runtime agents

PROVAE2E includes these specialized agents that run within customer tests and
analysis workflows:

- **Planner:** Converts requirements (Markdown, Jira, Figma) into an executable
  test plan without modification of customer source.
- **Generator:** Proposes browser and API test code skeletons from requirements;
  customer reviews and approves before use.
- **Executor:** Runs deterministic Node.js/Playwright tests; uses Playwright
  native APIs, no LLM.
- **Diagnostician:** Classifies test failures locally (timeout, assertion, network,
  app error) using deterministic patterns and optional Ollama analysis.
- **Healer:** Reuses learned selector repairs with confidence controls; requires
  human approval before modifying test source.
- **Release Guardian:** Evaluates exit gate evidence and recommends approval or
  rejection; never auto-deploys.
- **Sentinel:** Performs deterministic production monitoring (health checks, logs,
  metrics); escalates anomalies to humans for decision.

### Cost governance

- Record model, input tokens, output tokens, and estimated cost per run in audit logs.
- Configure daily and monthly AI budgets; stop cloud escalation when reached.
- Cloud AI disabled by default for PROVAE2E customers; opt-in only with explicit consent.
- Never expose secrets, complete DOM content, or sensitive production traces to
  an LLM in prompts or artifacts.
- Do not describe Claude Code CLI execution as "local AI"; distinguish development
  agents from customer runtime agents.
- Customer tests run without AI unless explicitly requested (e.g., `--ai` flag).

### Release gates for agentic operations

Before publishing a release:

- At least 90% of pipeline operations (lint, typecheck, test, build, artifact
  upload) must run without an LLM.
- Paid-cloud AI escalation must remain below 1% across representative validation
  runs.
- Every AI decision (repair proposal, failure classification, approval
  recommendation) must be logged and auditable by humans.
- Zero autonomous production deployments; humans review and approve before release.
- Zero secrets, API keys, or sensitive data passed to models or included in AI-generated artifacts.
- Rollback procedure tested and documented before GA.

### Cross-cutting scope

This agentic architecture applies to and supports all releases (v0.3.5-beta.1
through v0.4.0 and beyond). It does not replace or rewrite the Phase 4 roadmap
(Sections 6–6.1); rather, it is a governance policy that constrains how all
roadmap work is executed to remain economical and transparent.

---

## 5. v0.3.4-beta.1 — COMPLETED ✅

### v0.3.4-beta.1 release objective (SHIPPED)

`v0.3.4-beta.1` was a **Beta Reliability and Evidence release**, successfully
shipped to npm on 2026-07-27. Not a "12-plugin ecosystem" release.

The release must strengthen the shipped v0.3.3 product and establish the
foundation for the AI closed loop.

### Included scope

- Audit and fix installation and first-run failures on supported platforms.
- Normalize CLI device aliases and improve actionable validation errors.
- Verify browser, API, mobile emulation, and BrowserStack mobile-web behavior.
- Verify report generation, screenshots, logs, traces, and cleanup on failure.
- Harden analytics persistence, retention, trends, and flaky-test reporting.
- Add a reproducible beta validation suite using non-secret fixtures.
- Add product telemetry only if opt-in, documented, and privacy-safe.
- Rename or document the current selector implementation as
  **resilient selector fallback**.
- Define the versioned repair proposal and evidence contracts needed by the
  next release.
- Preserve existing CLI behavior and published public APIs.

### Optional, tightly bounded plugin work

Existing plugin contracts and registry code may remain if they are
backward-compatible and tested. Do not build or advertise 12 plugins.

At most these integrations may be developed deeply:

1. GitHub - CI status and evidence link.
2. Jira - requirement ingestion and result/defect traceability.
3. Slack **or** Teams - release result notification.

An integration counts as shipped only when:

- Its real authentication flow is documented.
- Secrets are redacted and never stored in plain text.
- At least one credentialed live end-to-end validation is recorded.
- Failure and cleanup behavior are tested.
- The integration has an owner-facing troubleshooting guide.

If credentials are unavailable, keep the work experimental and do not list it
as a completed feature.

### Explicitly excluded from v0.3.4-beta.1

- Twelve built-in plugins.
- Remote plugin installation.
- Public marketplace or untrusted plugin execution.
- Claims of security sandboxing through worker threads.
- Power BI implementation.
- Native iOS or Android app automation.
- Full visual regression.
- Autonomous test modification without approval.
- Enterprise compliance certification.
- Numerical market-leader claims.

---

## 6. Delivery roadmap

Versions are outcome labels, not fixed deadlines. A release moves forward only
after its exit gates pass.

### Stage A - v0.3.4-beta.1: Reliability and evidence

**Outcome:** A new user can install PROVAE2E, run the supported test types, and
understand failures from the resulting evidence.

Required work:

- Establish a clean, tagged v0.3.3 baseline.
- Inventory supported commands and public APIs from the shipped package.
- Create Windows, Linux, and macOS CI coverage where technically supported.
- Test clean installation, browser provisioning, first command, and uninstall.
- Run browser/API/mobile-emulation smoke suites repeatedly.
- Run credentialed BrowserStack mobile-web validation when credentials exist.
- Verify analytics migration, retention, concurrency, and corrupt-data behavior.
- Verify failure artifacts are complete and secret-safe.
- Publish an honest capability and limitation matrix.
- Create beta feedback templates and instrument supportability.

Exit gates:

- 100% of required CI checks pass.
- No known critical or high-severity vulnerability in shipped dependencies.
- No known data-loss or credential-exposure defect.
- Clean-install smoke test passes on every supported CI operating system.
- At least 95% repeatability across 100 controlled core smoke executions.
- Failure cases produce the documented evidence package.
- Backward-compatibility suite passes.
- Documentation matches actual CLI behavior.
- Ajay approves release evidence.

### Stage B - v0.3.5-beta.1: Approved AI closed loop

**Outcome:** PROVAE2E can turn a requirement into a test, execute it, explain a
failure, propose a repair, and apply the repair only after approval.

Required workflow:

1. Ingest a local requirement or Jira issue.
2. Generate readable Playwright test code.
3. Validate generated code before execution.
4. Execute in an isolated test context.
5. Capture screenshot, trace, logs, selectors, timing, and environment metadata.
6. Classify the failure with confidence and supporting evidence.
7. Propose a selector or test repair as a visible diff.
8. Require explicit human approval by default.
9. Apply and persist the approved repair.
10. Re-run the affected test and record before/after evidence.
11. Allow rejection and rollback.

Terminology:

- The existing five-tier resolver remains "resilient selector fallback."
- "Self-healing" may be used only after a repair is proposed, validated,
  persisted, auditable, and reversible.
- "AI root-cause analysis" must expose evidence, confidence, and uncertainty.

Exit gates:

- A fixed benchmark suite contains selector drift, text change, DOM movement,
  ambiguity, application defects, network defects, and test defects.
- Repair precision and incorrect-repair rate are measured and published.
- No silent repair is enabled by default.
- Every accepted repair is auditable and reversible.
- End-to-end demonstrations use previously unseen benchmark mutations.
- Existing v0.3.4 gates remain green.

### Stage C - v0.3.6-beta.1: Visual confidence and native-mobile proof

**Outcome:** Add the next two high-value quality surfaces without compromising
the closed loop.

Visual regression scope:

- Versioned baselines.
- Configurable thresholds and anti-aliasing tolerance.
- Dynamic-region masking.
- Side-by-side and overlay diffs.
- Explicit baseline approval.
- CI evidence and rollback.

Native-mobile scope:

- Appium-based `.apk` validation first.
- Application install, launch, reset, background, and foreground lifecycle.
- Touch gestures, rotation, permissions, and device logs.
- Emulator proof followed by credentialed real-device proof.
- iOS `.ipa` support only after signing and device prerequisites are available.

Do not describe Playwright mobile emulation or mobile-web BrowserStack sessions
as native-mobile testing.

### Stage D - v0.4.0: Trusted beta-to-GA transition

**Outcome:** A stable developer product with early customer proof, focused
integrations, and enterprise trust fundamentals.

Required scope:

- Deep GitHub, Jira, and Slack-or-Teams integrations.
- Role and permission model appropriate to deployed Studio components.
- Secrets lifecycle and documented encryption boundaries.
- Append-only audit evidence for consequential actions.
- Retention and deletion controls.
- Signed release provenance and dependency review.
- Upgrade and rollback guide.
- Service/support expectations stated accurately.
- Case studies or referenceable beta outcomes.

GA is not permitted until:

- At least 10 external beta teams have completed onboarding or Ajay explicitly
  approves a documented alternative sample.
- At least three teams have used PROVAE2E repeatedly for four weeks.
- Critical workflow success, flake rate, diagnosis time, and support burden are
  measured.
- There are no unresolved critical defects.
- Release rollback has been rehearsed.

Compliance certification, ERP/mainframe coverage, and a broad marketplace remain
post-GA initiatives unless customer evidence changes priority.

---

## 6.1. Foundation Hardening Before Phase 4

**Purpose:** Complete foundational testing capabilities before starting Phase 4
enterprise features. Do not change existing released behavior without backward
compatibility. These three capabilities are prerequisites for GA.

### Priority 1 — Multi-browser execution

**Outcome:** PROVAE2E tests run consistently across Chromium, Firefox, and WebKit.

Scope:

- Extend browser runner from Chromium-only to Chromium, Firefox, and WebKit.
- Add CLI option: `--browser chromium|firefox|webkit|all`.
- Preserve Chromium as the default (no breaking change).
- Add Windows, Linux, and macOS CI coverage for all three engines.
- Capture separate evidence (screenshots, logs, traces) for every browser.
- Report pass/fail per-browser with clear summary.

Exit gate:

- Clean-install smoke test passes on Chromium, Firefox, and WebKit.
- All three browsers pass on Windows, Linux, and macOS CI.
- No performance regression vs. Chromium-only baseline.
- User documentation and CLI help clearly describe the `--browser` option.
- Zero backward-compatibility breaks for existing Chromium-default workflows.

### Priority 2 — OpenAPI-based API testing

**Outcome:** PROVAE2E can ingest OpenAPI specifications and generate
executable, documented API tests without manual endpoint discovery.

Scope:

- Import OpenAPI 3.x JSON and YAML specifications.
- Discover endpoints, HTTP methods, parameters, and request/response schemas.
- Generate developer-readable Playwright API test skeletons.
- Validate request payload against schema before sending.
- Validate response payload and status code against specification.
- Support GET, POST, PUT, DELETE, and PATCH methods.
- Never execute destructive endpoints (POST, PUT, DELETE, PATCH) automatically
  without explicit approval (e.g., `--auto-destructive false` by default).
- Provide clear warnings when a test would modify or delete data.

Exit gate:

- A representative REST OpenAPI 3.x specification (with 5+ endpoints) passes
  end-to-end test generation and execution with live evidence.
- Destructive operations respect the approval flag and produce clear audit
  evidence.
- Generated tests are readable, maintainable Playwright code.
- No data loss or unintended side effects from test runs.
- User can opt-in to destructive operations with documented consent.

### Priority 3 — Learning self-healing

**Outcome:** Deterministic fallback learns from successful repairs and reuses
learned selectors safely, with explicit human control and full audit.

Scope:

- Keep the existing deterministic five-tier fallback unchanged (always available,
  no deprecation).
- Persist successful selector repairs in a local, user-owned SQLite store.
- Record per-repair: original selector, repaired selector, confidence score,
  timestamp, test file, line number.
- Reuse learned selectors only when confidence exceeds a configurable threshold
  (default: 95%, range 80–100%).
- Require human approval before permanently modifying the test source file.
- Provide a review UI or `--learn-review` command to preview, approve, or reject
  bulk selector updates.
- Never permit secrets (API keys, passwords, email addresses, PII patterns) to
  enter the learning store through DOM content analysis.
- Implement content filtering and PII detection to prevent credential leakage.
- Allow users to clear learned selectors and revert to deterministic-only mode.

Terminology:

- **Deterministic fallback:** The existing five-tier resolver. Always active.
  Repair rate and confidence metrics are not learned; they are hardcoded logic.
- **Learning selector repair:** Persistent storage of successful deterministic
  repairs. Reusable only above confidence threshold. Requires human approval to
  modify source. Auditable and reversible.
- **Self-healing:** May only be used to describe the combined deterministic +
  learning system after both components are shipped, tested, and approved by Ajay.

Exit gate:

- Controlled UI-change tests (e.g., button color, class name, position change)
  demonstrate recovery with learned selectors above confidence threshold.
- Full audit evidence shows: original selector, repair candidate, confidence,
  approval status, timestamp, user.
- No secrets or PII detected in the learning store.
- Human approval workflow tested and documented.
- Learned selectors revert cleanly on rollback.
- Existing deterministic-only workflows pass unmodified.
- Confidence threshold is user-configurable with clear guidance.

### Release strategy for foundation hardening

- Ship the three priorities together in `v0.3.5-beta.1` only after their
  individual tests and evidence are independently identifiable.
- Do not advertise a capability as complete until its CI and end-to-end evidence
  pass the release quality gates.
- Do not merge into a release branch until Ajay and an independent Codex review
  both approve the evidence.
- Phase 4 (enterprise features, plugin ecosystem, marketplace) begins only after
  these three foundation gates are approved and shipped.

---

## 7. Product success metrics

Do not use an internally invented competitor score as a success metric.

Track these instead:

| Area | Metric | Initial target |
|---|---|---:|
| Onboarding | Clean install to first passing test | <= 10 minutes |
| Reliability | Controlled core smoke repeatability | >= 95% |
| Stability | Framework-caused flaky-run rate | < 2% |
| Evidence | Failed runs with complete evidence package | >= 95% |
| Diagnosis | Median time to actionable failure category | <= 5 minutes |
| Healing | Approved repair precision on benchmark | >= 90% |
| Healing safety | Incorrect auto-applied repairs | 0 by default |
| Compatibility | Supported prior-version workflows passing | 100% |
| Security | Known critical/high shipped vulnerabilities | 0 |
| Adoption | External beta teams completing first run | >= 10 before GA |
| Retention | Teams using product repeatedly for four weeks | >= 3 before GA |

Targets may be revised only with recorded evidence and owner approval.

---

## 8. Required artifacts for every release

Claude Code must produce or update:

- A scope statement with explicit exclusions.
- A traceable implementation checklist.
- Automated test results and coverage summary.
- Live end-to-end evidence for externally integrated features.
- Compatibility results.
- Security and dependency results.
- Performance measurements relevant to the changed code.
- Known limitations.
- Upgrade and rollback instructions.
- Release approval record.
- Changelog and user-facing documentation.

Mocked tests must be labeled **contract tests**. They cannot be used as evidence
that an external integration works live.

Screenshots, logs, and reports must be secret-scanned before they are committed
or published.

---

## 9. Work protocol for Claude Code

For each stage:

1. Read this plan and the shipped release notes.
2. Inspect the repository and distinguish existing behavior from planned work.
3. Create a short gap analysis tied to the current stage only.
4. Propose the smallest vertical slices that reach the stage outcome.
5. Map every slice to tests and evidence before implementation.
6. Work on a clean branch or isolated worktree.
7. Preserve unrelated user changes.
8. Implement one vertical slice at a time.
9. Run targeted tests, then the full quality gate.
10. Record actual results; never pre-fill a checkbox as passed.
11. Stop if a release gate fails.
12. Open or update a PR only after evidence is complete.
13. Merge or publish only with Ajay's explicit approval.

Claude Code must not:

- Create features merely because a competitor advertises them.
- Increase feature count to improve a scorecard.
- silently rewrite this strategy.
- Mark planned, mocked, stubbed, or disabled work as shipped.
- weaken tests to make a release pass.
- suppress errors, security findings, or limitations.
- publish from a dirty or unverified tree.
- overwrite unrelated local changes.

---

## 10. Release quality commands

Use repository scripts as the source of truth. At minimum, execute the
equivalent of:

```powershell
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }

npm run lint
if ($LASTEXITCODE -ne 0) { throw "lint failed" }

npm run test:ci -- --coverage
if ($LASTEXITCODE -ne 0) { throw "test suite failed" }

npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

npm audit --omit=dev
if ($LASTEXITCODE -ne 0) { throw "production dependency audit failed" }
```

Also run clean-install, CLI smoke, Studio, integration, migration, and
backward-compatibility checks applicable to the release.

Passing unit tests alone is not a release gate.

---

## 11. Strategy change control

This plan remains authoritative until the product goal is reached or Ajay
approves a replacement.

A proposed deviation must be written as a Strategy Change Request containing:

- Requested change.
- Customer or operational evidence.
- Expected user outcome.
- Work displaced by the change.
- Security and compatibility impact.
- Acceptance metric.
- Rollback path.

Claude Code may recommend a deviation but must not execute it until Ajay
explicitly approves it.

Competitor announcements, internal scorecards, arbitrary version schedules, and
the existence of partially written code are not sufficient justification.

Urgent security fixes, data-loss fixes, and release-blocking regressions may
interrupt planned work. Record the interruption and return to this roadmap when
the blocker is resolved.

---

## 12. Immediate Claude Code assignment (Stage B & Foundation Hardening)

**Current state:** v0.3.4-beta.1 shipped and approved. Main branch is stable.

Claude Code must now plan and execute the foundation hardening work (Section 5.1)
before Phase 4 enterprise features:

1. Treat this file as the authoritative product execution plan.
2. Audit the current v0.3.4 main branch, open PRs, npm release, and GitHub
   actions without mutating released code.
3. Create `RELEASE-0.3.5-FOUNDATION-HARDENING-PLAN.md` containing:
   - Gap analysis: which foundation priorities (multi-browser, OpenAPI, learning)
     are partially implemented vs. missing.
   - Exact scope for each priority (Sections 5.1).
   - Vertical implementation slices for each priority.
   - Tests and evidence gates for each slice.
   - Effort and dependency estimates.
   - Rollback and backward-compatibility strategy.
   - Success metrics tied to Section 5.1 exit gates.
4. Propose the order and split of work:
   - Can multi-browser (Priority 1) proceed in parallel with Stage B (AI closed loop)?
   - Does OpenAPI (Priority 2) depend on Stage B completion?
   - Does learning self-healing (Priority 3) require changes to Stage B approval flow?
5. Identify any external dependencies: Playwright versions, OpenAPI libraries, PII detection.
6. Stop after the plan for Ajay's approval before implementation.

The plan must clearly distinguish:

- **Deterministic five-tier fallback** (shipped in v0.3.3, working, no changes needed).
- **Learning self-healing** (new; planned for Section 5.1, Priority 3).
- **Stage B AI closed loop** (repair proposal + human approval; planned).

The first response to Ajay must summarize:

- v0.3.4 exit gate results and any unresolved defects.
- Foundation hardening priorities and their dependencies.
- Which can start immediately (multi-browser CI coverage).
- Which must wait for Stage B (learning repair persistence).
- Any blocker requiring owner authority or external credentials.

---

## 13. Definition of strategic completion

The original goal is reached when PROVAE2E is:

- Reliably installable and usable by its target technical teams.
- Demonstrably strong across its supported web, API, and mobile surfaces.
- Able to complete the approved AI quality loop with transparent evidence.
- Safe by default, reversible, and honest about uncertainty.
- Validated by repeat external use, not only internal fixtures.
- Financially and operationally accessible to small teams.
- Ready to expand from demonstrated customer demand rather than competitor fear.

Until those conditions are met, Claude Code must continue prioritizing
reliability, evidence, the closed AI loop, and user validation in that order.
