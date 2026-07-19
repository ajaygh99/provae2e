# PROVA — AI QE Automation Platform
# Master Context File — READ BY BOTH CLAUDE CODE AND COWORK

## Project Identity
- **Name:** PROVA — provae2e.com (AI QE Automation Platform)
- **Package:** @provae2e/cli
- **Stack:** Node.js 20 + TypeScript strict + Playwright + Ollama + SQLite
- **Release cadence:** Bi-weekly to npm
- **Current phase:** MVP — Browser + Mobile Browser + API testing
- **GitHub host:** github.com
- **GitHub repo:** ajaygh99/provae2e

## Trinity System
- **Cowork** = Business brain: planning, scheduling, coordination, communication
- **Claude Code** = Engineering brain: code, tests, commits, PRs, npm publish
- **GitHub** = Source of truth: Issues=tasks, PRs=output, Actions=CI/CD

## Execution Model (hybrid — local + cloud)
- **ARIA + FORGE + VERA** run together in one local, unattended session: Windows
  Task Scheduler fires `scripts/nightly-run.ps1` at 10 PM, which runs Claude Code
  CLI headless (`claude -p`, model `claude-sonnet-5`) to plan, implement, test,
  and open a PR for the oldest Issue labeled `agent-implement`. Runs on Ajay's
  PC, billed per-token on the Claude API (no local Ollama in this path).
- **LENS** runs in GitHub Actions on every PR (`.github/workflows/agent-trigger.yml`),
  via the Claude GitHub App + `claude-code-action`, model `claude-haiku-4-5` (cheap,
  checklist-style review).
- **SHIP** runs in GitHub Actions (`prova-ci.yml`), scripted only, no model.
- Local Ollama models (qwen3:14b/8b, llama3.1:8b) stay installed for ad hoc/manual
  use but are not part of the automated pipeline — kept out for reliability and
  speed, since the whole MVP's Claude API cost is roughly $30-100 total.

## GitHub Labels — The Event Bus
- `agent-implement`  → picked up by tonight's `nightly-run.ps1` pass
- `ready-for-qa`     → added by LENS after a clean review; Cowork notifies Ajay
- `approved`         → SHIP publishes to npm on next merge to main

## Shared Folder Contract
### Cowork WRITES here → Claude Code READS as inputs:
- `sprint/current-sprint.md`         Sprint goals and priorities
- `sprint/agent-tasks.md`            Delegated task queue for ARIA
- `daily/YYYY-MM-DD-standup.md`      Daily context
- `releases/vN.N.N-approval.md`      Ajay's go/no-go decision
- `feedback/YYYY-MM-feedback.md`     Customer requests and feedback

### Claude Code WRITES here → Cowork READS as outputs:
- `sprint/completed-prs.md`          PRs merged this sprint
- `qa/run-results.md`                Latest test results summary
- `.agents/bugs/ISSUE-N-bug.md`      Bug reports from VERA to FORGE
- `.agents/tasks/ARIA-plan-N.md`     ARIA's implementation plan

## Agent Team
- **ARIA**  (claude-sonnet-5, local nightly run) — Orchestrator. Reads, plans, delegates.
- **FORGE** (claude-sonnet-5, local nightly run) — Coder. Implements features. TypeScript only.
- **VERA**  (claude-sonnet-5, local nightly run) — Tester. Writes and runs tests until green.
- **LENS**  (claude-haiku-4-5, GitHub Actions)    — Reviewer. Code review on every PR.
- **SHIP**  (no model, GitHub Actions)            — Releaser. npm publish + changelog + tag.

## MVP Scope — Weeks 1-10
Phase 1 ONLY. Resist adding anything else:
1. Browser testing (Playwright headless)
2. Mobile browser emulation (Playwright device emulation)
3. API testing (Playwright network + supertest)
4. CLI: `qe-tool run --url --type --device --workers --report`
5. HTML report (Allure)
6. Self-healing selectors (5-tier fallback)
7. Ollama AI summaries (--ai flag, local, $0)
8. GitHub Actions config (drop-in YAML)
9. npm publish as @provae2e/cli

## Code Standards (enforced by LENS)
- TypeScript strict mode — zero `any` types
- Every public function has JSDoc comment
- Every CLI command has --help text
- Error handling on every async operation
- Structured logging: log.info(), log.error() — no console.log
- All new code has corresponding tests (min 80% coverage)
- Never commit secrets, API keys, or .env files
- File structure: src/[domain]/[feature].ts

## What Agents Must Never Touch
- CLAUDE.md (this file) — human-owned
- package.json version field — SHIP-owned
- .env files — never committed
- Files outside src/ and tests/ unless explicitly told

## See Also
- @.agents/AGENTS.md       Full agent role specifications
- @docs/ROADMAP.md          Complete 24-month roadmap
- @docs/ARCHITECTURE.md     Full technical architecture
- @docs/SETUP.md            One-time setup instructions
