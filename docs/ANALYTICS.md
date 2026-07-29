# PROVA Analytics dashboard

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

Reports include totals, pass/failure/skip/flake rates, weighted average duration,
daily outcomes, duration and failure-rate anomalies, and tests whose outcomes
frequently alternate. JSON is intended for automation. HTML is a self-contained,
responsive dashboard with no scripts, external fonts, trackers, or network
dependencies.

Report files are written through a same-directory temporary file and atomic
rename. Existing output is preserved if replacement fails, and temporary files
are cleaned up. When `--output` is omitted, report content is the only content
written to stdout.

## Read the dashboard

The status badge summarizes the selected window:

- `no data`: no persisted outcomes in the window.
- `healthy`: pass rate is at least 95% with no anomalies or flaky tests.
- `warning`: pass rate is from 80% through 94.9%, or an anomaly/flaky test needs
  attention.
- `critical`: pass rate is below 80% or a high-severity anomaly exists.

Skipped tests do not reduce pass rate, but remain visible through total and
skip-rate metrics. Daily flake rate measures tests that had both passing and
failing outcomes. The ranked flaky-test table uses consecutive result
transitions across non-skipped runs.

Anomalies are ordered high-to-low severity and the HTML view is bounded.
Duration anomalies compare the latest duration with prior history. Failure-rate
anomalies compare the five most recent results with the older baseline.
Flakiness anomalies identify frequently alternating outcomes.

Empty states are expected for a new database and are not errors.

## Continuous integration

`.github/workflows/analytics-integration.yml` runs on relevant Analytics changes
and manual dispatch. It:

1. runs Analytics tests and the production build;
2. seeds deterministic SQLite data;
3. invokes the built CLI for JSON and HTML;
4. verifies metrics, accessibility markers, and self-contained output;
5. uploads dashboard artifacts for 14 days; and
6. independently verifies PostgreSQL storage.

The workflow has read-only repository permission and bounded job timeouts.

## Power BI — deferred to v0.3.3.1

Power BI export is feature-flagged off in v0.3.3-beta.1 and is not exposed by the CLI. SQLite, PostgreSQL, HTML, and JSON analytics are fully available. The exporter code remains isolated for the credentialed Phase 2 release.

When v0.3.3.1 enables the integration, create a streaming/push dataset with a table (default `TestTrends`) containing:

- `date` (DateTime)
- `passCount`, `failCount`, `skipCount` (whole number)
- `passRate`, `averageDuration`, `flakeRate` (decimal number)

The planned credential contract is:

```powershell
$env:POWERBI_WORKSPACE_ID = "workspace-id"
$env:POWERBI_DATASET_ID = "dataset-id"
$env:POWERBI_ACCESS_TOKEN = "short-lived-oauth-token"
```

The access token is sent only in the Authorization header and is never included in reports or logs. Workspace, dataset, and table identifiers are validated before a request is made.

## Programmatic API

`SQLiteAnalyticsStore`, `PostgresAnalyticsStore`, `AnalyticsReporter`, and
`PowerBIExporter` are exported from `@provae2e/cli`. Call `initialize()` before
use and `close()` in a `finally` block. `AnalyticsReport` is the stable
presentation contract for custom dashboard consumers.

## Validation

Run the focused dashboard gate:

```powershell
npm run validate:analytics
```

Run release-depth validation:

```powershell
npm run validate:analytics -- -Full
```

Artifacts and logs are written below
`artifacts\phase4-analytics-validation`.

## Operational notes

- PostgreSQL tables and indexes are created idempotently.
- SQLite writes are transactional for batches and persisted after mutation.
- `id` is an upsert key, so replayed evidence does not create duplicate rows.
- Trend queries use the timestamp index and daily aggregation.
- Keep `DATABASE_URL` and `POWERBI_ACCESS_TOKEN` in environment/CI secrets, never CLI history.
- Analytics errors redact PostgreSQL URLs and named password/token/secret values.
- Back up `.prova/analytics.db` before moving or replacing it.
- Use JSON artifacts for policy automation and HTML artifacts for human review.
