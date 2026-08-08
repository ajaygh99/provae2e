# PROVA Product Roadmap

Updated: July 28, 2026

## Shipped beta foundation

- `v0.3.3-beta.1`: persistent analytics, retention, trends, anomaly detection, and reports.
- `v0.3.4-beta.1`: clean-install reliability, failure evidence, secret scanning, and zero-loss analytics migration.
- `v0.3.5-beta.1`: multi-browser execution, safe OpenAPI generation/execution, and approved learning-based selector repair.

## Phase 4 readiness gate

Phase 4 starts only after `v0.3.5-beta.1` is published and independently
validated. Required gates are:

- Chromium, Firefox, and WebKit on Windows, Ubuntu, and macOS.
- OpenAPI 3.x generation and execution with writes disabled by default.
- Selector reuse at 95% minimum confidence.
- Human review, approval, rejection, rollback, and clear controls.
- Zero credentials or PII in learning/model artifacts.
- Full test, coverage, build, package, audit, and release evidence.

## Phase 4 — Enterprise

1. LLM/AI feature testing, including hallucination and policy evaluation.
2. Advanced multi-environment orchestration and production quality gates.
3. Compliance evidence automation for GDPR, HIPAA, and PCI.
4. PROVA Chat integrations for Slack and Teams.
5. Enterprise connectors selected from validated customer demand.

Marketplace breadth, white-label delivery, and ERP/mainframe integrations remain
post-readiness initiatives and require customer evidence before prioritization.

## Quality principles for every future release

Every release must assess and improve these areas wherever they apply:

1. Compatibility with widely used industry applications and platforms.
2. Maintainability across many projects and long-term upgrades.
3. Adaptability through secure connectors for systems such as Jira, ALM,
   GitHub, cloud platforms, Slack, and Teams.
4. Security against misuse, dependency attacks, data leakage, and unauthorized
   modification. Open-source code cannot be made impossible to copy.
5. User experience that novice professionals can understand and operate without
   specialist assistance.
6. Performance measured against an established baseline.
7. Scalable workload distribution, including queueing, worker balancing,
   autoscaling, and recovery where the release scope requires them.

Release plans and evidence must state which principles are applicable, what was
improved, what was tested, and what remains deferred. These principles guide
every release but do not justify shallow integrations or unsupported claims.

## Success metrics

- Reliability, evidence completeness, diagnostic time, and CI cost.
- Adoption, retained users, paying customers, and verified customer outcomes.
- No internally invented competitor score is used as a release gate.
