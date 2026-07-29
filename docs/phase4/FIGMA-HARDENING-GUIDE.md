# Phase 4.2 Figma workflow hardening

## Delivered scope

1. Safe copied-URL and explicit file/node parsing.
2. Bounded retry, rate-limit, timeout, cancellation, and redaction behavior.
3. Encrypted named credential profiles with expiry and removal.
4. Deterministic runnable Playwright generation with semantic locators.
5. Cross-layer integration coverage, documentation, and validation automation.

## Configure an encrypted OAuth profile

Keep secrets in environment variables, never CLI arguments:

```powershell
$env:PROVA_CREDENTIAL_KEY = '<at-least-16-character-local-key>'
$env:FIGMA_OAUTH_ACCESS_TOKEN = '<figma-oauth-token>'
$env:FIGMA_OAUTH_EXPIRES_AT = '2030-01-01T00:00:00.000Z'

node .\dist\cli\run.js figma --auth `
  --profile design-team `
  --database .\.prova\credentials.sqlite
```

List profile names without token material:

```powershell
node .\dist\cli\run.js figma --list-profiles `
  --database .\.prova\credentials.sqlite
```

## Generate tests from a copied Figma URL

```powershell
node .\dist\cli\run.js figma `
  --sync 'https://www.figma.com/design/AbCdEf123/App?node-id=12-34' `
  --node '12-34' `
  --profile design-team `
  --url 'https://app.example.com' `
  --output .\generated-tests\figma `
  --database .\.prova\credentials.sqlite
```

Identical regeneration is safe. If a generated file was edited, generation
fails rather than destroying it. Use `--overwrite` only after reviewing the
local changes.

Remove a profile:

```powershell
node .\dist\cli\run.js figma --logout `
  --profile design-team `
  --database .\.prova\credentials.sqlite
```

## Validation

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\validate-phase4-figma.ps1
```

The validator runs Figma unit/integration tests, typecheck, lint, build, and CLI
command discovery. Logs are written to `artifacts\phase4-figma-validation`.

## Security notes

- Only HTTPS `figma.com` copied links are accepted.
- OAuth access tokens take precedence over personal access tokens.
- Tokens remain encrypted at rest with AES-256-GCM.
- Expired or near-expiry credentials fail before a network request.
- Only 429 and 5xx responses are retried; 401/403/404 fail immediately.
- Retry count, backoff, request timeout, generated element count, and output
  overwrite behavior are bounded.
