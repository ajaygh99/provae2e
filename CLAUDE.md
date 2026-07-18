# PROVA — AI QE Automation Platform
# Master Context File — READ BY BOTH CLAUDE CODE AND COWORK

## Project Identity
- **Name:** PROVA — provae2e.com (AI QE Automation Platform)
- **Package:** @provae2e/cli
- **Stack:** Node.js 20 + TypeScript strict + Playwright + Ollama + SQLite
- **Release cadence:** Bi-weekly to npm
- **Current phase:** MVP — Browser + Mobile Browser + API testing
- **GHE host:** github.yourcompany.com  ← UPDATE THIS before first run
- **GHE org/repo:** org/provae2e            ← UPDATE THIS before first run

## Trinity System
- **Cowork** = Business brain: planning, scheduling, coordination, communication
- **Claude Code** = Engineering brain: code, tests, commits, PRs, npm publish
- **GHE** = Source of truth: Issues=tasks, PRs=output, Actions=CI/CD

## GHE Labels — The Event Bus
- `agent-implement`  → Cowork fires ARIA Routine → agents start working
- `agent-review`     → Triggers LENS review Routine on the PR
- `ready-for-qa`     → Cowork reads and notifies Ajay for review
- `approved`         → Triggers SHIP Routine → npm publish

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
- **ARIA**  (llama3.1:8b)  — Orchestrator. Reads, plans, delegates.
- **FORGE** (qwen3:14b)    — Coder. Implements features. TypeScript only.
- **VERA**  (qwen3:7b)     — Tester. Writes and runs tests until green.
- **LENS**  (llama3.1:8b)  — Reviewer. Code review on every PR.
- **SHIP**  (no model)     — Releaser. npm publish + changelog + tag.

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
