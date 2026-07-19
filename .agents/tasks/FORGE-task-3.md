Issue: #3 — [FEATURE] Implement API testing runner — Playwright network + supertest
Branch: feature/issue-3
Files to create: src/runners/api-runner.ts
Files to modify: src/cli/run.ts
Files to study first: src/runners/browser-runner.ts, src/core/logger.ts, src/cli/run.ts

Function signatures:
- export function validateSchema(body: unknown, schema: ResponseSchema): string[]
- export async function runApiTest(options: ApiRunnerOptions): Promise<ApiRunResult>

Acceptance criteria:
- qe-tool run --url https://api.example.com --type api sends requests and validates responses
- Supports REST (GET/POST/PUT/DELETE) via Playwright's APIRequestContext (no separate HTTP client)
- Supports GraphQL query/mutation testing
- Asserts status code, response schema, and response time
- Output: PASS/FAIL + duration + response summary
- Never throws — all failure modes resolve to a FAIL result

Done when: TypeScript compiles, ESLint passes, VERA tests green

FORGE: Done. Files: src/runners/api-runner.ts (new), src/cli/run.ts (modified — added --method/--body/--graphql/--expect-status options and the --type api branch)
