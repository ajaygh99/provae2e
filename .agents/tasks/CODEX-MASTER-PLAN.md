# CODEX Master Plan — v0.3.2 to v0.3.4 Beta

Updated: 2026-07-25

## Mission

Deliver three backward-compatible, opt-in beta increments:

1. v0.3.2: real-device testing through a provider abstraction and BrowserStack.
2. v0.3.3: persistent analytics, trends, anomaly detection, and Power BI export.
3. v0.3.4: an isolated plugin registry, MCP server, and built-in integrations.

## Execution order

Although engineering tasks may be prepared independently, releases are gated in order. A phase advances only after typecheck, lint, the complete coverage suite, smoke tests, build, documentation, compatibility review, and phase sign-off pass.

## Non-negotiable constraints

- Existing CLI behavior and local Playwright emulation remain the defaults.
- Every new network integration is opt-in and validates credentials without logging secrets.
- External-provider tests are deterministic when credentials are absent; real-provider evidence requires valid external credentials.
- Global coverage remains at least 80%.
- No release is claimed from simulated evidence. BrowserStack run counts, beta-user counts, and satisfaction metrics must come from real external evidence.

## Phase gates

### v0.3.2 — Device cloud

- Provider contracts and local provider.
- BrowserStack REST/Playwright connector with session lifecycle, logs, video metadata, failure handling, and bounded concurrency.
- CLI options and documentation.
- Unit/contract tests plus credential-gated real-device smoke tests.

### v0.3.3 — Analytics

- Storage abstraction with SQLite default and PostgreSQL option.
- Retention, indexed trend queries, anomaly detection, reporters, and Power BI export.
- Query performance and data-integrity evidence.

### v0.3.4 — Plugins

- Typed plugin contracts, registry, discovery, lifecycle isolation, and MCP tools.
- Built-in integration, notification, reporting, and device-cloud plugins.
- Concurrency, isolation, security, and custom-plugin evidence.

## Known evidence dependencies

- BrowserStack credentials are required for 50+ real-device executions and real video/log evidence.
- PostgreSQL and Power BI credentials are required for live enterprise integration evidence.
- Beta enrollment, feedback, and satisfaction require external participants and cannot be manufactured.

These dependencies do not block implementation or deterministic validation, but they block the corresponding release sign-off until genuine evidence exists.
