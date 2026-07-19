# ARIA Plan — Issue #10: Ollama AI summaries (--ai flag)

## Issue summary
`qe-tool run --ai` should send the run's results (pass/fail counts, durations,
failure details) to a local Ollama instance (`http://localhost:11434/api/generate`,
model `llama3.1:8b`) and print a plain-English summary to the console. If
Ollama isn't running or unreachable, warn clearly and continue — never fail or
block the actual test run. Must work across browser/api/mobile run types.

## Current architecture notes
- `src/reporters/allure-reporter.ts` already normalises every runner's result
  into a single `ReportTestCase` shape (`name`, `status`, `durationMs`,
  `error`, `screenshotPath`, `details`) via `browserResultToCase` /
  `apiResultToCase` / `mobileResultToCase`. Reusing `ReportTestCase` as the
  input to the AI summary module gives "works across all run types" for free
  and mirrors how `src/cli/run.ts` already builds cases for `--report`.
- Logging goes exclusively through `src/core/logger.ts`
  (`log.info/success/warn/error/debug`). No `console.log`.
- Functions never throw — failures are reported via a result object, same
  convention as the runners.
- `axios` is already a dependency (`package.json`) but unused so far in
  `src/`; this is the first module to use it.
- Imports use `.js` extension suffix on relative paths (compiled as
  CommonJS, stripped by jest's `moduleNameMapper`).
- Tests live under `tests/<domain>/*.test.ts` (`tests/core/...`), not
  `src/core/*.test.ts` as the issue suggests — matching the existing
  convention used for Issue #9 (`tests/core/self-healing-selector.test.ts`).
  This module's HTTP call is mocked (`jest.mock('axios')`), unlike the
  runner tests which spin up a real `http.Server`, since the issue
  explicitly calls for mocking the Ollama call.

## Design — `src/core/ai-summary.ts`

### `AiSummaryOptions`
```ts
interface AiSummaryOptions {
  runs: ReportTestCase[];       // normalised results, any run type(s) mixed
  endpoint?: string;            // defaults to http://localhost:11434/api/generate
  model?: string;                // defaults to llama3.1:8b
  timeoutMs?: number;            // defaults to 30000
}
```

### `AiSummaryResult`
```ts
interface AiSummaryResult {
  ok: boolean;
  summary?: string;   // present when ok
  error?: string;      // present when !ok
}
```

### Functions
- `buildPrompt(runs): string` (internal) — computes total/passed/failed counts
  and a bulleted failure list (name, error, duration), formatted as a prompt
  instructing the model to produce a 2-4 sentence plain-English summary.
- `generateAiSummary(options): Promise<AiSummaryResult>` — POSTs
  `{ model, prompt, stream: false }` to the Ollama endpoint via axios.
  Catches every error (connection refused, timeout, non-2xx) and returns
  `{ ok: false, error }` instead of throwing. Returns `{ ok: false, error }`
  too if Ollama responds but with an empty/missing `response` field.
- `printAiSummary(options): Promise<void>` — calls `generateAiSummary`; on
  failure, `log.warn('AI summary unavailable — continuing without it', ...)`
  and returns (never throws, never sets a non-zero exit code); on success,
  prints the summary via `log.info` + stdout.

## Files to create
- `src/core/ai-summary.ts` — module described above.
- `tests/core/ai-summary.test.ts` — mocks `axios` (`jest.mock('axios')`).
  Covers: successful summary (verifies prompt content includes pass/fail
  counts and failure details), Ollama unreachable (rejected promise),
  non-2xx/empty response body, and exercising the full path with
  `browserResultToCase`/`apiResultToCase`/`mobileResultToCase` inputs to
  confirm it works across all three run types. 80%+ coverage.

## Files to modify
- `src/cli/run.ts` — the `--ai` flag already exists in the Commander option
  list (unwired). After each of the browser/api/mobile result blocks, when
  `opts.ai` is set, call `printAiSummary({ runs: [xResultToCase(result)] })`
  before the PASS/FAIL exit-code check. Never let this affect `process.exitCode`.

## Done when
- `npx tsc --noEmit` — zero errors.
- `npm run lint` — zero warnings.
- `npm test` — all green, 80%+ coverage on new code.
- `qa/run-results.md` updated.
- Branch `feature/issue-10` pushed, PR opened against `main` referencing
  `Closes #10`.
