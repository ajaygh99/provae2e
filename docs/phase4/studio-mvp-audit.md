# Phase 4.1 Studio MVP audit

Date: 2026-07-28  
Baseline: `release/v0.3.5-phase4` at `95aaa86`

## Baseline verification

- Root sanity validation: passed typecheck, lint, build, Chromium, Firefox,
  WebKit, and CLI contract checks.
- Studio typecheck: passed.
- Studio lint: passed with one non-blocking Fast Refresh warning in
  `src/router.tsx`.
- Studio tests: 60/60 passed across six test files.
- Studio production build: passed.

## Existing capabilities to preserve

| Area | Existing implementation | Maturity |
|---|---|---|
| Application shell | React 19, Vite, TypeScript, responsive sidebar/header | Working foundation |
| Routing | Same-origin routes for dashboard, builder, execution, and settings | Working foundation |
| UI components | Button, text field, select, modal, toast, mobile menu | Tested foundation |
| Dashboard | Static quality metrics and recent-activity placeholder | Prototype |
| Builder | Knowledge graph panel and same-origin element selector | Partial |
| Execution | Route and explanatory copy only | Placeholder |
| Settings | Route and explanatory copy only | Placeholder |
| Responsive layout | Mobile menu and responsive grid | Tested foundation |
| Element selector | CSS/XPath capture, highlight, clipboard support | Tested beta |
| Knowledge graph | Read-only panel integration | Partial |

## MVP gaps

1. No workspace or project selection.
2. No safe filesystem boundary or test-file discovery.
3. No editable YAML/JSON test document model.
4. No schema validation or actionable diagnostics.
5. Existing visual tools do not update an editor document.
6. No documented Studio-to-CLI request/response contract.
7. No local execution service.
8. No streaming execution events.
9. No cancellation, timeout, or concurrent-run protection.
10. No run history or evidence viewer.
11. No screenshot, log, trace, or failure-summary presentation.
12. Async empty, loading, offline, and failure states are incomplete.
13. Keyboard and accessibility coverage is incomplete for the full workflow.
14. No end-to-end Studio workflow test.
15. No Studio-specific operational or security documentation.

## Phase 4.1 product boundary

Phase 4.1 hardens the existing local-first Studio. It does not add hosted
multi-tenancy, billing, remote arbitrary command execution, native-mobile
device management, or a public plugin marketplace.

The browser UI must never receive unrestricted filesystem paths or shell
commands. A local service owns workspace resolution, file access, execution,
timeouts, and evidence discovery. Every path is resolved beneath an explicitly
selected workspace, and every executable action maps to an allow-listed PROVA
operation.

## Exit criteria

- A user can select a local workspace and browse supported test files.
- A user can create or edit a validated YAML/JSON test definition.
- Visual builder actions update the same editor document model.
- A user can start, observe, cancel, and inspect a local PROVA run.
- Run output includes a summary and safe links to captured evidence.
- Keyboard, responsive, error-state, unit, integration, and end-to-end checks
  pass.
- Security boundaries, setup, rollback, and known limitations are documented.

