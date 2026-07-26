# ARIA Phase 1 Plan — v0.3.2 Device Cloud

Updated: 2026-07-25

## Design

`DeviceCloudProvider` owns initialization, device discovery, session creation, test execution, artifact lookup, and cleanup. `LocalDeviceProvider` preserves current Playwright emulation. `BrowserStackConnector` uses authenticated BrowserStack endpoints and Playwright CDP sessions without introducing mandatory dependencies or credentials.

The mobile runner selects local emulation unless `deviceCloud=browserstack` is explicitly provided. CLI credentials may be supplied by flags or `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY`, but secret values are never logged.

## Work breakdown

- Define provider, device, session, artifact, test, and result types.
- Implement local provider as the compatibility baseline.
- Implement BrowserStack validation, device discovery, session lifecycle, artifacts, errors, and concurrency configuration.
- Route opt-in cloud runs through the mobile runner.
- Add and validate CLI flags.
- Add contract, runner, CLI, and failure-path tests.
- Document setup, security, costs, CI, troubleshooting, and evidence requirements.

## Verification

- Focused device-cloud tests during development.
- Existing mobile and CLI tests for compatibility.
- Full typecheck, lint, build, coverage suite, and smoke suite.
- Credential-gated BrowserStack smoke command; release sign-off remains pending without real-provider credentials and 50-run evidence.
