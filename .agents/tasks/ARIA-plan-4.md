# ARIA Plan — Issue #4: Mobile browser emulation

## Issue summary
Add a mobile runner that runs Playwright with device emulation (viewport, user
agent, touch, device scale factor) instead of a plain desktop browser. Wire it
into the CLI as `--type mobile --device <name>`. Support at least 5 devices to
start: iPhone 14, iPhone SE, Pixel 7, Galaxy S21, iPad. Output must match the
browser runner's PASS/FAIL + duration + screenshot format.

## Architecture fit
- `src/runners/browser-runner.ts` already does headless desktop Chromium:
  launch → newPage → goto → title assertion → screenshot → close. The mobile
  runner reuses this shape almost exactly; the only difference is the browser
  context is created with a Playwright device descriptor
  (`chromium.launch()` + `browser.newContext(devices['iPhone 14'])`) instead of
  a bare `browser.newPage()`.
- `src/runners/api-runner.ts` shows the project's pattern for options/result
  interfaces, JSDoc, and never-throw error handling — mobile runner follows
  the same shape as browser-runner (closest analog).
- `src/cli/run.ts` already declares `--device <device>` with a default of
  `iPhone14` (no space) — the CLI-facing device names are compact aliases;
  the runner is responsible for mapping them to Playwright's official device
  descriptor keys (which contain spaces, e.g. `'iPhone 14'`).

## Device support
Playwright 1.44's bundled `devices` dictionary does not include an exact
`'Galaxy S21'` entry (device descriptors move on with each Playwright release).
Nearest available Samsung phone descriptor is used instead and documented in
code. Device alias map (CLI name → Playwright device key):

| CLI `--device` value | Playwright device key |
|---|---|
| `iPhone14`  | `iPhone 14` |
| `iPhoneSE`  | `iPhone SE` |
| `Pixel7`    | `Pixel 7` |
| `GalaxyS21` | `Galaxy S24` (nearest available; Playwright dropped the S21 profile) |
| `iPad`      | `iPad (gen 7)` |

Alias matching is case-insensitive and also accepts the exact Playwright key
(with spaces) so `--device "iPhone 14"` keeps working.

## Files to create
- `src/runners/mobile-runner.ts` — `runMobileTest(options)` returning the same
  `PASS/FAIL + durationMs + screenshotPath` shape as `BrowserRunResult`, plus
  the resolved `device` name.
- `tests/mobile/mobile-runner.test.ts` — replaces the VERA placeholder; real
  coverage of happy path, unknown device, no-title failure, navigation
  failure, and default screenshot dir, using the same local `http` fixture
  server pattern as `tests/browser/browser-runner.test.ts`.

## Files to modify
- `src/cli/run.ts` — add a `mobile` branch in the `run` command's action,
  mirroring the existing `browser`/`api` branches, calling `runMobileTest`
  with `{ url: opts.url, device: opts.device }`.
- `README.md` — document the `--type mobile --device <name>` usage and the
  supported device list, if a README section for CLI usage already exists.

## Acceptance criteria mapping
- `qe-tool run --url ... --type mobile --device iPhone14` → CLI branch calls
  `runMobileTest`.
- 5 devices (iPhone 14, iPhone SE, Pixel 7, Galaxy S21→S24, iPad) → alias map.
- PASS/FAIL + duration + screenshot format → reuse `BrowserRunResult` shape.
- `src/runners/mobile-runner.test.ts` with 80%+ coverage → see test file above
  (placed under `tests/mobile/` to match the existing `tests/browser/` and
  `tests/api/` layout already in the repo).

## Done when
TypeScript compiles (`npm run typecheck`), ESLint passes (`npm run lint`),
and all Jest tests pass (`npm test`), including the new mobile runner tests.
