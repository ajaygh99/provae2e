# ARIA Phase 3 Plan — v0.3.4 Plugin Ecosystem

Status: in progress
Baseline: v0.3.3-beta.1 published and smoke-verified

## Architecture

1. Stable typed contracts for integration, notification, reporting, and device-cloud plugins.
2. Duplicate-safe registry with lifecycle state, immutable metadata, timeouts, and deterministic cleanup.
3. Custom plugin discovery through validated manifests and a constrained worker host.
4. MCP stdio server exposing bounded PROVA tools without sharing cross-client state.
5. Thirteen built-ins: GitHub, GitLab, Jira, Azure DevOps, Linear, Slack, Teams, Discord, Power BI, Grafana, BrowserStack, LambdaTest, and Sauce Labs.
6. CLI commands for plugin discovery, validation, and MCP startup; existing commands remain unchanged.

## Security gates

- Resolve plugin paths inside the configured root and reject traversal/symlinks outside it.
- Never evaluate TypeScript or arbitrary inline source.
- Validate manifests, names, semantic versions, plugin categories, configuration, and exported shape.
- Run custom plugins in isolated workers with time and message-size budgets.
- Redact secrets from errors and metadata.
- Pin the MCP SDK and patched HTTP adapter; npm audit must report zero vulnerabilities.

## Verification gates

- Every built-in loads and its core adapter contract is tested.
- Custom example runs end-to-end.
- Registry isolation, duplicate handling, failure containment, and cleanup pass.
- MCP handles at least 100 concurrent in-process requests.
- Full root/Studio typecheck, lint, tests, global coverage, build, audit, smoke, and LENS pass.
