# Sprint 0 — Bootstrap Sprint
# Written by: Human (Ajay) — first sprint before Cowork takes over

## Dates
Start: [SET DATE]
End:   [SET DATE — 2 weeks later]

## Goal
Bootstrap the PROVA repository and get the Trinity system (Cowork + Claude Code + GitHub) running autonomously.

## Issues This Sprint
| Issue | Title | Priority | Status |
|-------|-------|----------|--------|
| #1    | Implement browser runner (Playwright headless) | P1 | In queue |
| #2    | Implement API testing (Playwright network) | P1 | In queue |
| #3    | Implement mobile browser emulation | P1 | In queue |
| #4    | Build HTML report with Allure | P2 | In queue |

## Definition of Done
- All Playwright tests pass (browser + API + mobile)
- CLI: qe-tool run --url --type --device works end-to-end
- LENS review: no BLOCKER/MAJOR items (auto-merges if clean, one FORGE
  fix-up retry if not, escalates to Ajay by name only if still unclean)
- npm published as @provae2e/cli@0.1.x (still requires Ajay's manual
  releases/vN.N.N-approval.md - merging to main does not auto-publish)

## Notes for Agents
Read CLAUDE.md first. All code goes in src/. All tests go in tests/.
