# VERA Phase 1 Validation — v0.3.2 Device Cloud

Date: 2026-07-26

## Deterministic gates

- TypeScript: PASS, zero errors.
- ESLint: PASS, zero errors.
- Build: PASS.
- Full root suite: PASS with the configured 80% global coverage minimum.
- Smoke suite: PASS for browser, API, and mobile.
- Studio: PASS for tests, typecheck, lint (zero errors), and build.
- Root and Studio npm audits: zero vulnerabilities.

## Real-provider evidence

- Preflight iOS run: PASS on iPhone 14.
- Preflight Android run: PASS on Google Pixel 7.
- Release evidence workflow: PASS, GitHub Actions run `30208768161`.
- Sessions: 50 total, 50 passed, zero failed, 50 unique BrowserStack session IDs.
- Platform distribution: 25 iPhone 14 and 25 Google Pixel 7 sessions.
- Artifacts: 50 screenshots, 50 video links, and 50 log-link sets.
- Concurrency: one sequential session; workflow duration 19m15s.
- Evidence artifact: `browserstack-50-run-evidence`, artifact ID `8634028293`.
- Artifact digest: `sha256:f61fc7c4804317bd834c9f88e6c4a21ffb66634a3d28ce4040ca629979bc5a04`.

## VERA decision

**PASS — Phase 1 real-device release criteria are satisfied.**
