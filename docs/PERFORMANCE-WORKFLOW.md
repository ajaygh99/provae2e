# Performance workflow

PROVA supports a legacy portable JSON baseline and a history-backed SQLite workflow. Use SQLite for teams and CI; use JSON for a small local smoke check.

## Fast validation

From the repository root in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-performance.ps1
```

This reuses installed dependencies and runs only the five relevant test suites. It does not run `npm ci`, download browsers, or invoke k6.

Before a pull request or release, run all performance gates:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-performance.ps1 -Full
```

For an optional one-VU, one-second live smoke test, install k6 and use a URL you are authorized to test:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-performance.ps1 -Full -LiveUrl 'https://test.example.com/health'
```

Every invocation writes a timestamped log under `artifacts/phase4-performance-validation/`.

## Establish and check a team baseline

Build once:

```powershell
npm run build
```

Create the SQLite baseline for an exact URL, VU count, and duration:

```powershell
node .\dist\cli\run.js perf --action set --database .\artifacts\performance.sqlite --url 'https://test.example.com/api/health' --vus 5 --duration 30
```

Run the same profile and fail when a material regression exceeds the default 10% policy:

```powershell
node .\dist\cli\run.js perf --action check --database .\artifacts\performance.sqlite --url 'https://test.example.com/api/health' --vus 5 --duration 30 --threshold 10
```

The check combines the percentage policy with absolute noise floors, so tiny measurement changes do not create false failures.

## Produce reports

```powershell
node .\dist\cli\run.js perf --action report --database .\artifacts\performance.sqlite --days 14 --format csv --output .\artifacts\performance.csv
node .\dist\cli\run.js perf --action report --database .\artifacts\performance.sqlite --days 14 --format json --output .\artifacts\performance.json
node .\dist\cli\run.js perf --action report --database .\artifacts\performance.sqlite --days 14 --format markdown --output .\artifacts\performance.md
```

Add `--fail-on-trend` in CI to return exit code 1 when the three newest runs show material p95 degradation.

## Recovery

- `k6 not found`: install k6, open a new PowerShell window, and run `k6 version`.
- No baseline found: repeat `--action set` with the exact URL, VUs, and duration used by `--action check`.
- Corrupt database: retain the file for diagnosis, create a new database path, and establish a reviewed baseline. PROVA refuses to overwrite a corrupt database.
- Unsupported schema: upgrade PROVA. A newer database is intentionally rejected to prevent silent data loss.
- Timeout: reduce load or increase the supported runner timeout in the calling integration; do not disable the execution bound.
