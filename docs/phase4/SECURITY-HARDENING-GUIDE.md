# Phase 4.4 ZAP security workflow

## Delivered scope

1. Bounded OWASP ZAP traditional JSON ingestion with normalization, deduplication,
   evidence redaction, and URL credential removal.
2. Persistent first-scan baselines, YAML false-positive rules, reviewed
   whitelists, feedback, and accuracy history.
3. SQLite integrity/schema checks, atomic replacement, temporary-file cleanup,
   and in-memory rollback after persistence failures.
4. Enforceable total and per-risk budgets for new or all visible findings.
5. Share-safe JSON and bounded Markdown reports plus a Jira story draft.
6. One CLI command and a guarded, manual GitHub Actions workflow.

## Process a local ZAP report

ZAP generates the input report; PROVA does not start a scanner from the local
CLI. Treat the raw ZAP JSON as sensitive because it can contain request
evidence. Keep it outside source control and pass only a local file path:

```powershell
node .\dist\cli\run.js security `
  --report .\private-artifacts\zap.json `
  --target staging-checkout `
  --database .\.prova\security\zap.sqlite `
  --minimum-risk HIGH `
  --maximum-findings 0 `
  --maximum-high 0 `
  --maximum-critical 0 `
  --all-findings `
  --format markdown `
  --output .\artifacts\security\zap-report.md
```

Exit code `0` means processing and policy evaluation passed. Exit code `1`
means invalid input, a read/persistence/reporting failure, or a policy
violation. The CLI logs totals and paths, never raw report contents or finding
evidence.

The default policy evaluates only findings introduced after the first scan.
Use `--all-findings` for release and CI gates. A first scan establishes a
baseline, so new-finding mode intentionally reports no new findings on that
run. Keep `--target` stable for the same application/environment; using a new
identifier creates a separate baseline.

## Filter known test fixtures

Rules are explicit and local. Catch-all ignore rules are rejected:

```yaml
rules:
  - alert_id: "40012"
    url_pattern: "https://staging.example.test/security-fixtures/*"
    action: ignore
    reason: Deliberate XSS verification fixture
  - cwe: CWE-79
    risk: HIGH
    action: flag
    reason: Security review is always required
```

Pass the file with `--rules .\.prova\security\zap-rules.yaml`. A matching
`flag` rule overrides an `ignore` rule. Reviewed whitelist decisions and team
feedback are available through the programmatic `ZapFalsePositiveFilter` API;
the CLI does not silently approve findings.

## Reports and Jira drafts

`--format json` produces the complete normalized machine-readable report.
`--format markdown` limits displayed finding rows to keep CI and issue content
bounded. Both omit evidence and remove URL credentials/fragments while
replacing query values with `[REDACTED]`.

`createZapJiraSecurityStory()` builds a summary, Markdown description, labels,
and priority without contacting Jira. An integration must require an explicit
destination and credentials before publishing the draft.

## Guarded GitHub Actions scan

The `ZAP security policy` workflow is manual-only. Before enabling it:

1. Create a GitHub environment named `security-scanning`.
2. Add required reviewers who can confirm that the target is owned by, or has
   written scanning authorization from, your organization.
3. Restrict which branches may deploy to the environment.
4. Enter an approved HTTP(S) target without credentials or a fragment.
5. Use `baseline` for passive/spider coverage. Use `full` only when active
   scanning is explicitly authorized for the target.

The job has read-only repository permission, no secret references, a
30-minute job limit, and a 20-minute container limit. It gates all visible
HIGH/CRITICAL findings, uploads only the sanitized PROVA JSON/Markdown
reports, retains them for 14 days, and fails after artifact upload when the
scan cannot complete or policy does not pass.

## Validation

Run focused validation:

```powershell
npm run validate:security
```

Run the release-depth validation:

```powershell
npm run validate:security -- -Full
```

Logs and deterministic smoke artifacts are written beneath
`artifacts\phase4-security-validation`. A real ZAP target is deliberately not
contacted by this validator.

## Operational safety

- Scan only targets you are authorized to test.
- Never commit the raw ZAP report, local SQLite database, rules containing
  internal URLs, or generated validation artifacts.
- Back up the SQLite database before moving it between systems. Corrupt or
  schema-incompatible files fail closed.
- Review filter rules and whitelist decisions as security changes.
- Keep CI in `--all-findings` mode. New-only mode is for regression triage, not
  a complete release gate.
