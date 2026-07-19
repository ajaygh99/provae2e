You are working on the PROVA repo (ajaygh99/provae2e), on a dedicated branch created for this session. This is a large, ordered defect-fix session covering 12 items. Work through them in the exact order listed below.

## Preserve existing work - read this first

Before doing anything else, run `git status` and `git stash list`. If there is ANY uncommitted work already in the tree (especially anything related to Issue #10 / AI-summary files), do NOT reset, stash, delete, or overwrite it. Incorporate it, work around it, or explicitly tell me about it in your final report - never silently discard user or prior-session work.

## Fix these defects, in this order

1. Repair `.github/workflows/prova-ci.yml` so a missing release approval makes publishing impossible. Calculate the intended next version first (from `package.json`'s current version, patch-bumped) and require `releases/v<exact-next-version>-approval.md` to exist specifically - not just "some approval file present".

2. Stop ordinary bookkeeping pushes (e.g. `sprint/completed-prs.md` updates from the nightly script) from triggering package publication. Prefer an explicitly-dispatched release workflow (`workflow_dispatch`) rather than triggering SHIP on every push to `main`.

3. Implement `--type all` in the CLI (runs browser + api + mobile together); reject unknown `--type` values with exit code 1 and a clear error message.

4. Add runtime validation for: URL, HTTP method, expected status code, workers count, device name, environment, scope, and GraphQL variables. Invalid input should fail fast with a clear error message, not crash with a raw stack trace.

5. Ensure the browser/mobile/API runners honor their "never throws" contract - including failures during browser/context launch, context creation, and cleanup/teardown. They must always return a PASS/FAIL result object, never let an exception escape to the caller.

6. Fix the API runner to measure response duration AFTER the response body has been fully consumed/read, not just after headers arrive.

7. Treat GraphQL responses with `errors: []` (empty array) as success, and any non-empty `errors` array as failure - check current handling carefully, this may be inverted or missing.

8. Fix report (Allure) screenshot paths so they resolve correctly, and make sure the current run is included in the trend data, not just historical runs.

9. Make CI actually execute every test directory that exists (browser/api/mobile/reporters/cli/etc.) - not just a subset - and enforce a real 80% coverage gate that fails the build if not met.

10. Add a real smoke test suite (referenced by `prova-ci.yml`'s "Post-deploy Smoke" job) that actually fails if zero smoke tests execute - currently it may report success even when nothing ran.

11. Remove the duplicate/redundant LENS review path - there should be exactly one mechanism by which LENS reviews a PR, not two overlapping ones. Make sure CI checks are deterministic and required before any merge.

12. Make `scripts/nightly-run.ps1` abort safely (not proceed) if it finds a dirty/uncommitted working tree it can't account for, fail immediately (not silently continue) on critical command errors, and add a mechanism to prevent the same Issue from being picked up and processed by more than one concurrent or overlapping run.

## For every defect you fix

- Add a regression test that demonstrably fails before your fix and passes after it.
- Keep TypeScript strict mode, zero `any` types.
- Preserve existing public CLI compatibility unless the current behavior is actually invalid/broken.
- By the end, run: `npm run typecheck`, `npm run lint`, the full test suite with coverage, `npm run build`, and an `npm pack` + smoke-install of the resulting tarball in a temp directory to confirm the published package would actually work.

## Hard constraints

- Do NOT modify `AGENTS.md`, `CLAUDE.md`, `package.json`'s version field, or any `.env` files.
- Do NOT publish to npm, do NOT merge any PR, and do NOT push directly to `main`. Push only to this current branch and open a PR that stays open for human review - do not merge it yourself even if it looks clean.
- Work only on this current branch.

## When you're done (or if you get blocked)

Report back clearly: every file you changed, every test you added and ran, final coverage numbers, and any remaining known limitations or things you couldn't fully fix. Be honest about partial progress - don't claim something is done if it isn't fully verified by the test suite.
