# PROVA Studio Phase 4.1 operator guide

Phase 4.1 is a local-first Studio MVP. The browser UI and API run on the same
computer. The API binds only to `127.0.0.1`, resolves opaque workspace/file
identifiers server-side, and never accepts an arbitrary shell command.

## Prerequisites and installation

- Node.js 20.19 or newer, npm, Git, and PowerShell
- A workspace containing a file such as `checkout.prova.yaml`

```powershell
Set-Location C:\Users\ajjuk\Documents\Cowork\Provae2e-phase4-studio
npm ci
npm --prefix .\studio ci
npm run build
npm --prefix .\studio run build
```

Example definition:

```yaml
name: checkout
url: https://example.com
browser: chromium
steps:
  - action: navigate
```

## Start Studio manually

Keep two PowerShell terminals open.

Terminal 1 — start the loopback API:

```powershell
Set-Location C:\Users\ajjuk\Documents\Cowork\Provae2e-phase4-studio
npm run build
node .\dist\cli\run.js studio --port 4317
```

Expected: `PROVA Studio API listening on http://127.0.0.1:4317`

Terminal 2 — start the browser UI:

```powershell
Set-Location C:\Users\ajjuk\Documents\Cowork\Provae2e-phase4-studio
npm --prefix .\studio run dev
```

Open `http://localhost:4173`. Vite proxies `/api/studio` to port 4317.

## Manual sanity run

1. In **Settings**, enter the absolute path of a test workspace.
2. Open **Test builder** and select a discovered YAML/JSON test.
3. Confirm source and visual editors represent the same steps.
4. Introduce an invalid URL or missing selector. Saving must be blocked with an
   actionable path such as `$.url` or `$.steps[0].selector`.
5. Restore valid content and save.
6. Choose a browser and select **Run test**.
7. Confirm queued/running status and live output.
8. Optionally start another run to see queuing, or select **Cancel run**.
9. Refresh **Run results** and open the command log or other evidence.
10. Stop both processes using `Ctrl+C`.

## Automated validation

Fast validation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\validate-phase4-studio.ps1
```

Full repository validation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\validate-phase4-studio.ps1 -Full
```

Logs are written under `artifacts\phase4-studio-validation`. Fast mode avoids
package installation and the approximately four-minute root regression suite.

## Security and limits

- The API host is fixed to `127.0.0.1`; foreign browser origins are rejected.
- Execution uses `shell: false` and a fixed `prova run` argument vector.
- Absolute workspace/file paths never cross the browser contract.
- Symlinks, filesystem roots, build directories, test files over 1 MB, and
  evidence over 25 MB are rejected.
- Default concurrency is two processes; supported configuration is 1–8.
- Run timeouts are restricted to 1,000–900,000 ms.
- Evidence must remain inside the workspace and is served with safe headers.

## Troubleshooting

- **API unavailable:** confirm Terminal 1 is running on port 4317.
- **No tests found:** check the supported filename suffix and refresh.
- **Revision conflict:** reload; another process changed the file.
- **Browser executable missing:** run `npx playwright install`.
- **Validation is slow:** use fast mode during development and `-Full` only for
  release verification.
