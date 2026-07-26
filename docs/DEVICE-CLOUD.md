# Real Device Testing with BrowserStack

PROVA can run mobile-web checks on BrowserStack real devices. Device-cloud execution is opt-in; existing local Playwright emulation remains the default.

## Credentials

Prefer environment variables so credentials do not appear in shell history:

```powershell
$env:BROWSERSTACK_USERNAME = "your-user"
$env:BROWSERSTACK_ACCESS_KEY = "your-access-key"
```

Never commit BrowserStack credentials. PROVA does not include credentials in logs or test results.

## Run on a real device

```powershell
qe-tool run `
  --type mobile `
  --url "https://example.com" `
  --device "iPhone 14" `
  --device-cloud browserstack `
  --browserstack-parallel 4 `
  --browserstack-video true `
  --scope full `
  --report
```

Flags can override the environment:

- `--browserstack-username <user>`
- `--browserstack-key <key>`
- `--browserstack-parallel <1-25>`
- `--browserstack-video <true|false>`

Credential flags are useful for isolated CI secret expansion, but environment variables are safer for interactive terminals.

## Multiple devices and concurrency

```powershell
qe-tool run `
  --type mobile `
  --url "https://example.com" `
  --device "iPhone 14,Google Pixel 7" `
  --device-cloud browserstack `
  --workers 2 `
  --browserstack-parallel 2 `
  --report
```

`--workers` limits PROVA task concurrency. `--browserstack-parallel` records and validates the account-side concurrency request. Keep both at or below the parallel capacity purchased for the BrowserStack account.

## Artifacts

Screenshots are stored under `artifacts/browserstack` by default. BrowserStack video and console-log metadata are collected from the session API when available. Artifact availability can lag immediately after a session closes; the BrowserStack dashboard remains the authoritative source for finalized video.

Use `--evidence <file.json>` to retain a machine-readable record containing the provider, BrowserStack session ID, result, screenshot path, video URL, and log URLs:

```powershell
qe-tool run --type mobile --url "https://example.com" `
  --device "iPhone 14" --device-cloud browserstack `
  --evidence "evidence/iphone-14.json" --report
```

## CI

Store `BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY` as masked CI secrets. A real-device smoke job should be credential-gated and must not silently substitute emulation when credentials are missing.

```yaml
- name: BrowserStack real-device smoke
  env:
    BROWSERSTACK_USERNAME: ${{ secrets.BROWSERSTACK_USERNAME }}
    BROWSERSTACK_ACCESS_KEY: ${{ secrets.BROWSERSTACK_ACCESS_KEY }}
  run: >
    qe-tool run --type mobile --url https://example.com
    --device "iPhone 14" --device-cloud browserstack
    --scope smoke --browserstack-video true --report
```

## Troubleshooting

- `username and access key are required`: configure both standard environment variables or both CLI flags.
- `Device ... is not available`: use the exact name returned by the BrowserStack Automate device catalog for the account.
- HTTP 401/403: rotate or correct credentials and confirm Automate access.
- HTTP 429: reduce `--workers` and `--browserstack-parallel`, or increase account capacity.
- Session creation timeout: confirm the selected OS/device combination exists and check BrowserStack service status.

## Costs and release evidence

BrowserStack charges and concurrency limits belong to the connected BrowserStack account. PROVA does not estimate or bill those costs.

The v0.3.2 release gate requires genuine evidence for at least 50 successful real-device runs plus video/log capture. Mocked contract tests and local emulation prove integration behavior but do not satisfy that external evidence requirement.
