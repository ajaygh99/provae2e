# Phase 4 beta operator guide

This guide is the entry point for the `0.3.5-beta.1` Phase 4 release
candidate. It describes what is implemented, what the automated evidence
proves, and what still requires an authorized credentialed environment.

## Prerequisites

- Node.js 20 or newer and `npm ci`.
- Windows PowerShell 5.1 for the complete local release orchestrator.
- Playwright browser binaries for the full browser regression suite.
- No GitHub, Jira, Slack, Figma, BrowserStack, Sauce Labs, ZAP service, or
  language-model token is required for the deterministic release gate.

## Implemented surfaces

| Surface | Beta evidence | Detailed guide |
| --- | --- | --- |
| Studio and Figma | Local contract, credential-store, generator, workflow, and regression tests | [README](../README.md) |
| Performance | Bounded k6 ingestion, baseline policy, persistence, CLI, and deterministic fixtures | [Performance hardening](phase4/PERFORMANCE-HARDENING-GUIDE.md) |
| Security | Bounded ZAP JSON ingestion, policy, atomic database, reports, CLI, and CI contract | [Security hardening](phase4/SECURITY-HARDENING-GUIDE.md) |
| Analytics | SQLite/PostgreSQL contracts, metrics, responsive report, CLI, and CI fixtures | [Analytics](ANALYTICS.md) |
| Native Android | W3C Appium contract, selectors, gestures, lifecycle, permissions, network, screenshots, and seed isolation | [Native mobile](NATIVE-MOBILE.md) |
| Integrations | Local-only GitHub, Jira, and Slack contracts with runtime secret references | [Integrations](INTEGRATIONS.md) |

## Evidence boundaries

The token-free suite proves deterministic parsing, validation, persistence,
protocol payloads, cleanup, redaction, public exports, packaging, and CLI
behavior. It does not prove:

- a physical Android device or credentialed device-farm session;
- a live GitHub check, Jira issue mutation, or Slack notification;
- a live Figma OAuth/API session;
- a production ZAP scan or externally hosted PostgreSQL service.

Those surfaces remain experimental until an owner records credentialed
evidence without storing credentials. Playwright mobile emulation is not
native-mobile evidence.

## Validation

Run the complete token-free PowerShell gate from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-beta.ps1
```

The orchestrator suppresses known provider and LLM credentials in its child
processes, runs every deterministic Phase 4 validator, and writes token-free
logs and a JSON manifest under `artifacts/phase4-beta-validation/`.

Focused gates remain available:

```powershell
npm run validate:perf
npm run validate:security
npm run validate:analytics
npm run validate:native
npm run validate:integrations
```

Build and inspect the local beta tarball without publishing it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-phase4-package.ps1
```

The package gate rejects tests, artifacts, environment files, databases, and
logs, then records the tarball SHA-256 in
`artifacts/phase4-package/package-integrity.json`.

Release artifacts are written below `artifacts/phase4-beta-validation`.
Private provider evidence must be stored outside the npm package and reviewed
for secrets before sharing.

## Operational limits

- No remote plugin installation, public marketplace, or untrusted execution.
- No iOS `.ipa` claim until signing and device prerequisites are validated.
- Integration adapters are experimental until credentialed live evidence is
  recorded.
- Publishing remains a separate, explicitly approved operation after the
  release approval and package-integrity gates pass.
