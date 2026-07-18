# QA Summary Skill
# Cowork runs this when GitHub Actions CI completes on a PR

## Trigger
- Event: GitHub Actions workflow completed on a PR (via Composio webhook)

## Steps
1. Read the PR details via Composio GitHub MCP
2. Read GitHub Actions run results:
   - typecheck job: pass/fail
   - test-matrix browser: pass/fail + count
   - test-matrix api: pass/fail + count
   - test-matrix mobile: pass/fail + count
   - lens-review job: read LENS comments
3. Read any `.agents/bugs/` files for this Issue
4. Write `qa/run-results.md` with complete summary
5. Post to Slack #prova-qa:
   ```
   PR #N: [title]
   ✅ 187/187 tests pass | ⚠️ 3 tests failing
   LENS: ✅ No blockers | ⚠️ 2 MAJOR items
   → [PR URL]
   ```
6. If ALL pass AND LENS has no BLOCKERs or MAJORs:
   - Add label `ready-for-qa` to PR
   - Send Slack DM to Ajay: "PR #N ready for your review. Est. 15 min."
7. If FAILS:
   - DO NOT add `ready-for-qa`
   - Post failure details to Slack #prova-qa
   - Fire VERA Routine to rerun failing tests

## Output: qa/run-results.md
```
# QA Run Results — PR #N — YYYY-MM-DD HH:MM

## Test Results
| Suite   | Pass | Fail | Duration |
|---------|------|------|----------|
| Browser | 62   | 0    | 4m 12s   |
| API     | 48   | 0    | 2m 33s   |
| Mobile  | 77   | 0    | 5m 44s   |

## LENS Review
- BLOCKERs: 0
- MAJORs: 0
- MINORs: 1 (cosmetic, non-blocking)

## Verdict: ✅ READY FOR AJAY REVIEW
PR URL: [link]
```
