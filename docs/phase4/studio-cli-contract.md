# Studio-to-CLI local service contract

Status: Phase 4.1 approved contract  
Version: `v1`

## Trust boundary

Studio is a browser application. It cannot access the filesystem or spawn
processes directly. A loopback-only local service mediates all access.

The service must:

- listen on `127.0.0.1` by default;
- validate `Origin` and use a per-session anti-CSRF token for mutations;
- return opaque workspace, file, run, and evidence identifiers;
- resolve paths beneath an explicitly selected workspace;
- reject symlinks or resolved paths that escape the workspace;
- execute only allow-listed PROVA operations through `spawn`/`execFile`;
- never accept a shell command, executable path, or arbitrary CLI arguments;
- redact secrets from output and evidence metadata;
- cap request bodies, streamed output, run duration, and evidence size;
- serialize writes and apply optimistic revision checks.

## Endpoints

All endpoints use `/api/studio/v1`.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Service/API/CLI version health |
| `POST` | `/workspaces/select` | Validate and select a local workspace |
| `GET` | `/workspaces/:id/files` | List supported test definitions |
| `GET` | `/workspaces/:id/files/:fileId` | Read a test document |
| `PUT` | `/workspaces/:id/files/:fileId` | Validate and save a revision |
| `POST` | `/runs` | Start an allow-listed PROVA file run |
| `GET` | `/runs/:id` | Get current or completed summary |
| `GET` | `/runs/:id/events` | Stream ordered Server-Sent Events |
| `DELETE` | `/runs/:id` | Request cancellation |
| `GET` | `/runs/:id/evidence` | List safe evidence metadata |
| `GET` | `/evidence/:id/content` | Stream one authorized artifact |

## Execution request

`POST /runs` accepts only:

```json
{
  "workspaceId": "workspace_123",
  "fileId": "file_123456",
  "browser": "chromium",
  "timeoutMs": 120000
}
```

`browser` is `chromium`, `firefox`, `webkit`, or `all`. Timeout is between one
second and fifteen minutes. The service resolves the file id and constructs the
PROVA invocation internally.

## Streaming

Events have a monotonically increasing `sequence`, ISO timestamp, and one of:

- `status`
- `stdout`
- `stderr`
- `evidence`
- `complete`

Clients reconnect with `Last-Event-ID`. The service retains a bounded event
buffer until the run expires from local history.

## Error model

Errors return a stable code, safe human-readable message, request id, and
optional validation diagnostics. Stack traces, absolute paths, environment
variables, tokens, and raw command lines are never returned to the browser.

