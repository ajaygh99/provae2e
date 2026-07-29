# Native mobile testing with Appium

PROVA's `native` command creates a genuine Appium Android session for an
`.apk`. It is separate from `qe-tool run --type mobile`, which performs
Playwright mobile-browser emulation and is not native application testing.

## Android emulator proof

Prerequisites:

1. Node.js 20+, Java, Android SDK, and an Android emulator.
2. Appium 2 with the UiAutomator2 driver installed.
3. A testable local `.apk`.

Start Appium and an emulator, then run:

```powershell
qe-tool native --app .\app-debug.apk --device Pixel_7_API_35 --platform-version 15
```

The runner validates the APK, creates a W3C session, returns structured
evidence, and deletes the session even when execution fails. Permissions,
network changes, lifecycle actions, screenshots, and seeded data are explicit
operations; none are silently enabled.

## Real-device proof

Real-device evidence requires valid BrowserStack or Sauce Labs credentials,
an uploaded native application reference, and an available physical device.
Keep credentials in the provider's secret store or environment; do not put
them in command history, source files, reports, or URLs. A cloud session is
native proof only when the provider reports a physical Android device and a
native uploaded application. Mobile-web BrowserStack sessions do not qualify.

iOS `.ipa` execution is intentionally deferred until signing, Xcode, and
device provisioning prerequisites are available and validated.

## Validation

```powershell
npm run validate:native
npm run validate:native -- -Full
```

The default CI job is a credential-free protocol contract gate. It does not
claim an emulator or real-device run. Credentialed device evidence must be
captured separately in an authorized environment.
