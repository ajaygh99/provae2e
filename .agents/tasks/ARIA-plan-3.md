Issue: #3 — [FEATURE] Implement API testing runner — Playwright network + supertest
Branch: feature/issue-3

## Acceptance Criteria (from Issue)
- `qe-tool run --url https://api.example.com --type api` sends requests and validates responses
- Supports REST (GET/POST/PUT/DELETE) via Playwright's request context
- Supports GraphQL query/mutation testing
- Asserts status code, response schema, and response time
- Output: PASS/FAIL + duration + response summary
- Tests: src/runners/api-runner.test.ts (80%+ coverage)

## Plan
1. Create `src/runners/api-runner.ts`:
   - Export `runApiTest(options: ApiRunnerOptions): Promise<ApiRunResult>`
   - `ApiRunnerOptions`: `{ url: string; method?: 'GET'|'POST'|'PUT'|'DELETE'; body?: unknown; headers?: Record<string,string>; graphql?: { query: string; variables?: Record<string,unknown> }; expectedStatus?: number; schema?: ResponseSchema; maxResponseTimeMs?: number; timeoutMs?: number }`
   - `ApiRunResult`: `{ status: 'PASS'|'FAIL'; url: string; method: string; statusCode?: number; durationMs: number; responseSummary?: string; error?: string }`
   - `ResponseSchema` — lightweight flat `Record<fieldName, 'string'|'number'|'boolean'|'object'|'array'|'null'>` shape validator (no new dependency; `export function validateSchema(body, schema): string[]` returns mismatch messages)
   - Uses Playwright's `request.newContext()` from `@playwright/test` (APIRequestContext) — no separate HTTP client (satisfies AC + no new deps, `@playwright/test` already installed)
   - REST: dispatches GET/POST/PUT/DELETE via the context's matching method; GraphQL: always POSTs `{ query, variables }` to `options.url`
   - Asserts: status code equals `expectedStatus` (default 200), duration under `maxResponseTimeMs` (default 5000), GraphQL responses have no top-level `errors`, and optional schema validation against the JSON body (`data` field for GraphQL)
   - Always disposes the request context in a `finally` block
   - Wraps the request/assertions in try/catch → on error, returns `status: 'FAIL'` with `error` message instead of throwing (never throws, matches browser-runner pattern)
   - Logs via `log.info`/`log.success`/`log.error` from `../core/logger.js`
   - Full JSDoc with `@param`/`@returns` per AGENTS.md hard rules; zero `any`

2. Wire into `src/cli/run.ts`:
   - `run` command's `--type api` branch calls `runApiTest`
   - New CLI options: `--method <method>` (default GET), `--body <json>` (parsed as JSON; used as REST body or GraphQL variables), `--graphql <query>` (presence switches to GraphQL mode), `--expect-status <code>` (default 200)
   - Logs PASS/FAIL, status code, duration, response summary via `log`
   - Exits process with code 1 on FAIL (`process.exitCode = 1`) without throwing, matching the browser branch
   - Invalid `--body` JSON is reported via `log.error` and exits 1 before calling the runner

3. Tests — replace placeholder `tests/api/api-runner.test.ts`:
   - Spin up a local `http` server fixture (no external network dependency, avoids flaky/offline CI) exposing: GET success route, POST/PUT/DELETE echo routes, a 404 route, a slow route (artificial delay), and a `/graphql` route that returns `{ data }` or `{ errors }` depending on the query
   - Happy path: GET/POST/PUT/DELETE all PASS with correct status/duration/summary
   - Status mismatch → FAIL with descriptive error, no throw
   - Response time above `maxResponseTimeMs` → FAIL
   - Schema validation: passing schema, missing field, wrong type
   - GraphQL: successful query passes and validates `data` against schema; response containing `errors` → FAIL
   - Network/unreachable host → FAIL without throwing
   - Coverage target 80%+ of `api-runner.ts`

## Files to create
- src/runners/api-runner.ts
- tests/api/api-runner.test.ts (overwrite placeholder)

## Files to study first
- src/runners/browser-runner.ts (runner shape, error handling, logging pattern)
- src/core/logger.ts (logging patterns)
- src/cli/run.ts (CLI wiring point)
- tests/browser/browser-runner.test.ts (local-server test fixture pattern)
- tsconfig.json / eslint.config.mjs (strict mode, no `any`, no `console.log`)

## Done when
- TypeScript compiles (`npm run typecheck`)
- ESLint passes (`npm run lint`)
- `npm test` green, 80%+ coverage on new file
- qa/run-results.md updated
- PR opened against main referencing Closes #3
