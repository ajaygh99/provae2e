# Economical Agentic Architecture — Section 4 Addition

**File:** PROVAE2E-ORIGINAL-STRATEGY-AUTHORITATIVE-PLAN.md  
**Date:** 2026-07-27  
**New Section:** 4 — Economical Agentic Architecture  
**Status:** ADDED (Section numbering updated throughout document)

---

## Overview

Added comprehensive new Section 4 that defines PROVAE2E's approach to economical,
transparent agentic operations during development, testing, and production.

**Core principle:** Keep PROVAE2E agentic from design through production while
minimizing paid AI usage and maintaining full transparency and control.

---

## Section 4 Structure

### 1. AI Usage Targets

Operating targets (not guaranteed):
- **90%+** Deterministic Node.js, PowerShell, Playwright, Jest, scripted operations
- **Up to 9%** Local Ollama analysis (no costs)
- **Less than 1%** Paid Claude escalation (complex unresolved cases only)

### 2. Development Agent Workflow (ARIA + FORGE + VERA)

Ten principles for economical agent operation:

1. **Shared session per issue** — ARIA, FORGE, VERA run in one Claude session
2. **Deterministic first** — Lint, typecheck, tests before any AI review
3. **LENS review only after CI passes** — Avoid redundant AI review
4. **Scoped review** — LENS examines changed files only, not entire codebase
5. **Max one auto-repair attempt** — Manual fixes required thereafter
6. **Cancel superseded runs** — Stop agent sessions when newer commits arrive
7. **Cache resolutions** — Reuse cached failure signatures and solutions
8. **Never use paid AI for ordinary execution** — Only for unresolved escalations
9. **Ollama before Claude** — Local analysis first
10. **Human approval gates** — Source changes, merge, npm publish, production deployment

### 3. Product Runtime Agents

Seven specialized agents running within customer workflows (not in development):

- **Planner** → Requirements to executable plan (no source modification)
- **Generator** → Test skeletons from requirements (customer approval required)
- **Executor** → Deterministic Node.js/Playwright tests (no LLM)
- **Diagnostician** → Local failure classification (patterns + optional Ollama)
- **Healer** → Learned repair reuse with confidence controls (human approval)
- **Release Guardian** → Evaluates exit gates; recommends not auto-deploys
- **Sentinel** → Deterministic production monitoring; escalates anomalies

### 4. Cost Governance

- **Audit logging** — Model, input/output tokens, cost per run
- **Budget controls** — Daily/monthly limits; stop cloud escalation when reached
- **Default disabled** — Cloud AI off by default for customers (opt-in only)
- **Data safety** — Never expose secrets, DOM, sensitive traces to LLMs
- **Clear terminology** — Don't call Claude Code "local AI"; distinguish dev vs. runtime agents
- **Customer default** — Tests run without AI unless `--ai` flag specified

### 5. Release Gates for Agentic Operations

Before publishing any release:

- ✅ **90%+ pipeline** runs without LLM (lint, test, build, deploy)
- ✅ **<1% cloud AI** during representative validation
- ✅ **100% auditable** — Every AI decision logged
- ✅ **Zero autonomous** — No self-deploying production changes
- ✅ **Zero secrets** — No sensitive data in model prompts or artifacts
- ✅ **Tested rollback** — Rollback procedure documented and rehearsed

### 6. Cross-Cutting Scope

This architecture is a **governance policy** supporting all releases (v0.3.5-beta.1
through v0.4.0 and beyond), not a replacement for Phase 4 roadmap (Sections 6–6.1).

---

## Document Adjustments

### Section Renumbering

All subsequent sections re-numbered to accommodate new Section 4:

| Old Section | New Section | Title |
|-------------|-------------|-------|
| 4 | 5 | v0.3.4-beta.1 — COMPLETED ✅ |
| 5 | 6 | Delivery roadmap |
| 5.1 | 6.1 | Foundation Hardening Before Phase 4 |
| 6 | 7 | Product success metrics |
| 7 | 8 | Required artifacts for every release |
| 8 | 9 | Work protocol for Claude Code |
| 9 | 10 | Release quality commands |
| 10 | 11 | Strategy change control |
| 11 | 12 | Immediate Claude Code assignment |
| 12 | 13 | Definition of strategic completion |

### Cross-Reference Updates

- Section 3 reference to "Section 10" → updated to "Section 11" (strategy change control)
- Section 4 (new) references "Sections 6–6.1" for Phase 4 roadmap
- All internal citations consistent

---

## Key Implications

### For Development (ARIA + FORGE + VERA)

- Run in shared session per GitHub issue (cost-efficient)
- Deterministic CI (lint, test) is gate; AI review only validates, doesn't duplicate
- Ollama-first for analysis → Claude only for complex escalations
- Cache resolutions to avoid re-analyzing same failures

### For Customer Runtime

- Tests default to zero AI usage (deterministic only)
- Customers opt-in with `--ai` flag (costs exposed, budgets respected)
- Runtime agents (Planner, Generator, Executor, etc.) are deterministic-first
- Ollama local; paid Claude for unresolved cases only
- Budget limits prevent surprise costs

### For Release Gates

- **90% deterministic** requirement enforces lean architecture
- **<1% cloud AI** requirement prevents cost creep
- **100% audit** requirement maintains transparency
- **Zero secrets** requirement enforces data safety
- **Human approval** gates prevent autonomous failures

### For Phase 4 Compatibility

- Does NOT change v0.3.5, v0.3.6, v0.4.0 roadmap (Sections 6–6.1)
- IS a constraint on HOW roadmap work executes (economically, transparently)
- Blocks any future work that would violate economical targets
- Supports all features planned in Sections 6–6.1 within cost/governance bounds

---

## Why This Matters

1. **Cost predictability** — Customers and PROVA know AI usage limits upfront
2. **Transparency** — Every AI decision logged and auditable
3. **Trust** — Secrets safe by design; no silent data leaks to LLMs
4. **Scalability** — Deterministic-first architecture doesn't hit AI API limits
5. **User control** — Humans approve all consequential changes
6. **Competition** — Proves PROVAE2E can offer AI features affordably

---

## Next Steps (For Execution)

1. Section 4 is now live in the authoritative plan
2. Development agents (Claude Code running ARIA/FORGE/VERA) should adopt the
   10-principle workflow immediately
3. Product runtime agents (Planner, Generator, Executor, etc.) should implement
   during v0.3.5/v0.4.0 per Sections 6–6.1
4. Cost governance and budget controls should be instrumented in GitHub Actions
   and npm scripts
5. Release gates should verify 90%+ deterministic and <1% cloud AI before approval

---

**Authority:** PROVAE2E-ORIGINAL-STRATEGY-AUTHORITATIVE-PLAN.md (Section 4)  
**Effective:** 2026-07-27  
**Scope:** All releases v0.3.5-beta.1 through v0.4.0 and beyond  
**Approval Status:** Pending Ajay review and Codex independent assessment
