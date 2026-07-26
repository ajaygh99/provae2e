# PROVA Analytics

PROVA can persist test outcomes and turn them into 7-, 30-, or 90-day trends, anomaly alerts, flaky-test rankings, HTML/JSON reports, and Power BI rows. Analytics is opt-in; existing `qe-tool run` behavior is unchanged.

## Persist results

SQLite is the zero-configuration default:

```powershell
qe-tool run --url "https://example.com" --type all --persist-analytics
```

The default database is `.prova/analytics.db`. Override it with `--analytics-database <file>`.

For PostgreSQL, set `DATABASE_URL`. The URL is read from the environment and should be supplied through the CI secret store:

```powershell
$env:DATABASE_URL = "postgresql://user:password@host:5432/prova"
qe-tool run --url "https://example.com" --persist-analytics
```

Each successful persistence operation also removes records older than 90 days. Programmatic callers can select a different retention period through `store.cleanup(days)`.

## Reports

```powershell
prova report --analytics --days 7 --format html --output analytics.html
prova report --analytics --days 30 --format json --output analytics.json
prova report --analytics --days 90 --database .prova/analytics.db
```

Reports include totals, pass rate, weighted average duration, daily trends, duration and failure-rate anomalies, and tests whose outcomes frequently alternate.

## Power BI

Create a streaming/push dataset with a table (default `TestTrends`) containing:

- `date` (DateTime)
- `passCount`, `failCount`, `skipCount` (whole number)
- `passRate`, `averageDuration`, `flakeRate` (decimal number)

Then set secrets and export:

```powershell
$env:POWERBI_WORKSPACE_ID = "workspace-id"
$env:POWERBI_DATASET_ID = "dataset-id"
$env:POWERBI_ACCESS_TOKEN = "short-lived-oauth-token"
prova export --analytics --format powerbi --days 90
```

The access token is sent only in the Authorization header and is never included in reports or logs. Workspace, dataset, and table identifiers are validated before a request is made.

## Programmatic API

`SQLiteAnalyticsStore`, `PostgresAnalyticsStore`, `AnalyticsReporter`, and `PowerBIExporter` are exported from `@provae2e/cli`. Call `initialize()` before use and `close()` in a `finally` block.

## Operational notes

- PostgreSQL tables and indexes are created idempotently.
- SQLite writes are transactional for batches and persisted after mutation.
- `id` is an upsert key, so replayed evidence does not create duplicate rows.
- Trend queries use the timestamp index and daily aggregation.
- Keep `DATABASE_URL` and `POWERBI_ACCESS_TOKEN` in environment/CI secrets, never CLI history.
