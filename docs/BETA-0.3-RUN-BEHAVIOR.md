# PROVAE2E Beta 0.3 run behavior

## Scope

`--scope` now controls browser and mobile verification depth.

| Scope | Verification |
| --- | --- |
| `smoke` | Page loads and has a non-empty title |
| `component` | Smoke checks plus a rendered body |
| `cr` | Component checks plus a successful navigation HTTP status |
| `full` | CR checks plus uncaught page-error detection; mobile also checks horizontal viewport overflow |

## Workers

`--workers` is the maximum number of browser, API, and mobile-device legs
executed concurrently. Results retain deterministic command order in reports.

## Reports

`allure-report/index.html` remains the latest report and `history.json` remains
the trend source. Every invocation also writes an immutable report to:

`allure-report/runs/<timestamp>/index.html`

## Chrome extensions

A Chrome Web Store URL verifies that the listing loads. The report explicitly
labels the test as listing-only. Headless Playwright cannot install a store
extension, approve permissions, confirm its toolbar icon, or execute its
service worker. Those checks require an unpacked extension build and a
persistent Chrome context.

## Mnemox comprehensive command

Use the supported `all` run type:

```powershell
qe-tool run --url "https://www.mnemoxpro.com" --type all --device "iphone14,pixel7" --scope full --workers 4 --ai --retries 2 --report
```
