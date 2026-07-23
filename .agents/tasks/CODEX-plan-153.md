# Issue #153 — Contract Testing Integration

## Scope

- Versioned in-memory registry for OpenAPI and Pact contracts.
- OpenAPI YAML/JSON and Pact JSON ingestion.
- Link an E2E API request to an operation/provider interaction.
- Validate request body, response body, and response status offline.
- Probe production through an injected fetch implementation and report drift.
- Emit drift alerts through an injected notifier.
- Produce aggregate request-compliance metrics.

## Safety

- No external API calls in tests.
- No new dependency: use the existing `yaml` package.
- No CLI or package metadata changes.
- Export the public API from `src/index.ts`.

## Verification

- Focused Jest suite.
- TypeScript strict mode.
- ESLint.
- Full Jest coverage gate in GitHub CI.
