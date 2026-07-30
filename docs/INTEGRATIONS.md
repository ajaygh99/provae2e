# Bounded integrations

PROVA supports three in-process integration contracts: GitHub check evidence,
Jira requirement/result traceability, and Slack release notifications. This is
not a marketplace. Remote installation and untrusted plugin execution are not
supported.

All adapters use contract version 1, resolve secrets from environment
references at execution time, enforce bounded inputs and responses, honor
abort signals, and return redacted evidence. Tokens and webhooks must never be
stored in manifests, configuration files, logs, reports, or URLs.

## GitHub

Owner: PROVA Platform.

Use a GitHub App installation token where possible. A fine-grained personal
access token is acceptable for an owner-controlled validation environment.
Grant only repository metadata read access and Checks read/write access for
the target repository. Export it at runtime as `GITHUB_TOKEN`.

The adapter creates a check-run for a commit SHA or updates an existing
`checkRunId`, making retries safe. Evidence links must use credential-free
HTTPS URLs.

Troubleshooting:

- `401`: token expired or malformed; rotate it and retry.
- `403`: verify Checks write permission and repository installation access.
- `404`: verify owner/repository, commit SHA, and installation scope.
- Timeout: check GitHub status and outbound HTTPS access; the registry aborts
  the request at the configured deadline.

## Jira Cloud

Owner: PROVA Platform.

Use Atlassian OAuth 2.0 authorization-code flow with offline access. Required
scopes are `read:jira-work`, `write:jira-work`, and `offline_access`. Store the
rotating access token only in the runtime secret provider and expose it as
`JIRA_ACCESS_TOKEN`. The Jira base URL must be credential-free HTTPS.

The adapter reads issue summary/ADF description, posts result comments with
evidence links, and creates Bug issues. Defect creation searches for the
`prova-run-<runId>` label first and reuses an existing issue.

Troubleshooting:

- `401/403`: renew consent and verify project browse/comment/create rights.
- `404`: verify issue key, project permissions, and Jira site URL.
- Malformed response: confirm Jira Cloud REST API v3 and field visibility.
- Duplicate defect: preserve the same stable run ID across retries.

## Slack

Owner: PROVA Platform.

Create a dedicated Slack app and incoming webhook for the release-results
channel. Store the webhook as `SLACK_RELEASE_WEBHOOK_URL`; only
`https://hooks.slack.com/services/...` is accepted. Rotate it immediately if
it appears in logs or command history.

Notifications include release, environment, status, summary, evidence link,
and a stable run ID in Slack message metadata.

Troubleshooting:

- `400`: validate Block Kit payload fields and lengths.
- `403/404`: webhook was revoked or no longer belongs to the workspace.
- `429`: honor Slack rate limits and retry with the same run ID.
- Timeout: verify outbound HTTPS and Slack service status.

## Cleanup and failure behavior

Registry registration is local and rejects duplicates. Unregistering always
removes the adapter even if its `dispose` hook fails. `disposeAll` attempts
every adapter and reports combined failures. Provider errors return HTTP
status only; response bodies, tokens, and webhook URLs are not included.

## Validation status

The credential-free contract suite is reproducible with:

```bash
npm run validate:integrations
npm run validate:integrations -- --full
```

As of 2026-07-29, no credentialed live end-to-end validation record is stored
in this repository. Therefore GitHub, Jira, and Slack adapters remain
experimental and must not be advertised as shipped integrations. A release
owner may change that status only after recording the date, owner, provider
account, external evidence URL, tested action, cleanup outcome, and secret
rotation confirmation—without recording credentials.
