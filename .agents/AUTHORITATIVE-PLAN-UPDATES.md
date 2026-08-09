# PROVAE2E Authoritative Plan — Update Summary

**File:** PROVAE2E-ORIGINAL-STRATEGY-AUTHORITATIVE-PLAN.md  
**Date:** 2026-07-27  
**Author:** Ajay / PROVAE2E Project Lead  
**Status:** UPDATED for foundation hardening & Stage B execution

---

## Changes Made

### 1. **Section 1 — Clarified Terminology** ✅

Updated the "goals superseded" list to distinguish:

- **Deterministic selector fallback** (five-tier resolver, existing, hardcoded logic)
- **Learning-based AI self-healing** (new, requires persistent learning + approval + audit)

Added explicit prohibition against advertising multi-browser, OpenAPI, or learning
self-healing before foundation gates are approved.

**Impact:** Prevents false marketing claims about capabilities not yet shipped.

---

### 2. **Section 2 — Expanded "What PROVAE2E is not yet"** ✅

Added clear statements:

- Multi-browser testing (Chromium-only; Firefox/WebKit planned in Section 5.1, Priority 1).
- OpenAPI-based API test generation (planned in Section 5.1, Priority 2).
- Learning-based self-healing (planned in Section 5.1, Priority 3).

Each claim now includes version/date requirement and references to planned work.

**Impact:** Honest product positioning; clear roadmap for users and maintainers.

---

### 3. **Section 4 — Updated Status Header** ✅

Changed from:

```
## 4. Immediate correction of the v0.3.4 plan
### v0.3.4-beta.1 release objective
```

To:

```
## 4. v0.3.4-beta.1 — COMPLETED ✅
### v0.3.4-beta.1 release objective (SHIPPED)
```

Added: "successfully shipped to npm on 2026-07-27."

**Impact:** Document reflects current state; v0.3.4 assigned to history, not active work.

---

### 4. **NEW Section 5.1 — Foundation Hardening Before Phase 4** ✅

Complete new section covering three mandatory capabilities before Phase 4 enterprise
features and GA.

#### Priority 1: Multi-browser execution

- Extend from Chromium-only to Chromium + Firefox + WebKit.
- Add `--browser chromium|firefox|webkit|all` CLI option.
- Preserve Chromium default (no breaking change).
- Windows, Linux, macOS CI coverage for all three.
- Separate evidence per browser.
- Exit gate: all three browsers pass all platforms.

#### Priority 2: OpenAPI-based API testing

- Import OpenAPI 3.x JSON/YAML specs.
- Auto-discover endpoints, methods, parameters, schemas.
- Generate readable Playwright test skeletons.
- Validate requests/responses against specification.
- Never auto-execute destructive endpoints (POST/PUT/DELETE/PATCH) without approval.
- Exit gate: representative 5+ endpoint spec passes end-to-end with live evidence.

#### Priority 3: Learning self-healing

- Keep existing deterministic five-tier fallback (unchanged).
- Persist successful repairs in local SQLite.
- Record: original selector, repaired selector, confidence, timestamp, source location.
- Reuse learned selectors only above configurable confidence (default 95%, range 80–100%).
- Require human approval before modifying test source.
- Prevent PII/secrets from entering learning store.
- Exit gate: controlled UI-change tests show recovery with learned selectors; full audit
  trail; no PII leakage; human approval workflow documented and tested.

#### Release strategy

- Feature-flag each priority (multi-browser, OpenAPI, learning) in separate PRs.
- Do not advertise as complete until CI + end-to-end evidence pass gates.
- Phase 4 (enterprise, plugins, marketplace) starts only after all three gates approved.
- Implement as v0.3.5-beta.1 or v0.4.0-beta.1.

**Impact:** Clear prerequisites for GA. Blocks Phase 4 expansion until foundation is solid.

---

### 5. **Section 11 — Updated Claude Code Assignment** ✅

Changed from v0.3.4 audit/plan to Stage B + Foundation Hardening execution:

**Previous focus:**
- Audit v0.3.4 plan (now complete).
- Identify distracted plugin work.

**New focus:**
- Audit v0.3.4 release results & any remaining defects.
- Plan foundation hardening work (Section 5.1).
- Create `RELEASE-0.3.5-FOUNDATION-HARDENING-PLAN.md`.
- Distinguish deterministic fallback vs. learning self-healing.
- Identify dependencies between Stage B (AI closed loop) and foundation priorities.
- Propose work order and parallelization strategy.

**Key distinctions required:**
- Deterministic five-tier (shipped, no changes).
- Learning self-healing (new; Section 5.1, Priority 3).
- Stage B closed loop (repair proposal + approval; concurrent with foundation work).

**Impact:** Clear path from v0.3.4 completion to v0.3.5/v0.4.0 foundation work.

---

## Terminology Corrections Throughout

### Before (Misleading)

"Self-healing selectors" - could mean either deterministic fallback or learning-based.

### After (Clear)

- **Deterministic fallback:** Five-tier resolver, hardcoded logic (shipped).
- **Learning repair:** Persistent storage of successful repairs (planned).
- **Self-healing:** May only apply to combined system after both shipped and approved.

---

## Backward Compatibility

✅ **No breaking changes to shipped product.**

- Existing v0.3.4-beta.1 CLI behavior unchanged.
- Existing v0.3.3/v0.3.4 tests remain valid.
- New `--browser` option defaults to Chromium (current behavior).
- Deterministic five-tier fallback unchanged.
- Learning repair persistence is opt-in (user approval required).

---

## Why These Updates

1. **Accuracy:** Document now reflects actual shipped state (v0.3.4 complete).
2. **Honesty:** Product positioning no longer claims capabilities not yet delivered.
3. **Clarity:** Foundation hardening scope is explicit and measurable.
4. **Sequencing:** Phase 4 blocked until three foundation gates pass.
5. **Terminology:** "Self-healing" and "deterministic fallback" are now distinct.
6. **Execution:** Claude Code assignment is clear and sequenced (Stage B + foundation).

---

## Next Steps (For Claude Code)

1. Read updated Section 5.1 completely.
2. Audit current v0.3.4 main branch for unresolved defects.
3. Plan `RELEASE-0.3.5-FOUNDATION-HARDENING-PLAN.md`:
   - Gap analysis for each priority.
   - Slice breakdown.
   - Dependency mapping.
   - Effort estimates.
4. Propose work order to Ajay.
5. Stage B (AI closed loop) and Priority 1 (multi-browser) likely proceed in parallel.
6. Priorities 2 & 3 may depend on Stage B completion.

---

**Authority:** PROVAE2E-ORIGINAL-STRATEGY-AUTHORITATIVE-PLAN.md (Sections 1, 2, 4, 5.1, 11)  
**Effective:** 2026-07-27  
**Approval:** Pending Ajay review and Codex independent assessment
