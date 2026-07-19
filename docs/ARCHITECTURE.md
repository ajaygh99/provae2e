# PROVA Technical Architecture

## System Overview
PROVA is built as a CLI-first npm package (@provae2e/cli) with three test runners
sharing a common infrastructure layer. All runners use Playwright under the hood.

## Directory Structure
```
src/
  cli/         CLI entry point (Commander.js)
  runners/     Test runners: browser, api, mobile
  reporters/   HTML report generation (Allure)
  core/        Shared: logger, config, database, self-healing
tests/
  browser/     Browser runner tests
  api/         API runner tests
  mobile/      Mobile emulation tests
  cli/         CLI integration tests
```

## Key Design Decisions

### Self-Healing Selectors (5-tier)
1. ARIA roles (aria-label, role) — most stable
2. data-testid attributes — developer-set, stable
3. Text content match — user-visible text
4. Visual position hash — layout-based fingerprint
5. CSS selector — fallback, most fragile

### Zero-Cost AI (Ollama)
- FORGE, VERA, ARIA run local models via Ollama API
- `http://localhost:11434/api/generate` — $0 per inference
- Cloud fallback via --premium flag (Anthropic API)

### Test Data (SQLite embedded)
- No external DB server needed
- Test fixtures stored in local SQLite
- Anonymization: replace PII before storing

## Agent Communication
All agents communicate via files in the shared folder:
- ARIA → FORGE: `.agents/tasks/FORGE-task-N.md`
- ARIA → VERA:  `.agents/tasks/VERA-task-N.md`
- VERA → FORGE: `.agents/bugs/issue-N-bug.md`
- All → Cowork: `qa/run-results.md`, `sprint/completed-prs.md`

## CI/CD Flow
1. PR opened → GitHub Actions fires
2. Jobs run in parallel: typecheck + browser tests + API tests + mobile tests + LENS
3. LENS clean (no BLOCKER/MAJOR) → label `ready-for-qa` added → nightly-run.ps1
   auto-merges (squash, branch deleted)
4. LENS flags issues → one automatic FORGE fix-up pass + re-review → merges if
   clean, otherwise left open with a comment tagging @ajaygh99 for manual review
5. Merge to main does NOT publish - SHIP only runs once Ajay writes a
   releases/vN.N.N-approval.md file, then it publishes to npm on next merge
6. Post-deploy smoke → production health confirmed
