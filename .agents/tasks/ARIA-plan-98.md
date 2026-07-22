# Issue #98 Implementation Plan
## Golden Thread: Build->Deploy Link (Stage 4-5)

**Issue:** #98 — Link GitHub build artifacts (code commit, test pass, build status) to deployment evidence
**Branch:** feature/issue-98
**Story Points:** 5

### Acceptance Criteria
- [x] GitHub Actions integration: read workflow run status, build logs
- [x] Link commit SHA -> build run -> deployment
- [x] Deployment metadata: { environment, timestamp, deployed_by, rollback_info }
- [x] Status: GREEN (deployed), YELLOW (warnings), RED (failed/rolled back)
- [x] Traceability report shows code -> tests -> build -> deployed artifact
- [x] CLI: qe-tool trace --commit SHA shows full chain from code to production

### Architecture

#### 1. Enhanced Schema (golden-thread-store.ts)
- Add `deployment_status` column to stage_logs: GREEN | YELLOW | RED
- Add `deployment_metadata` JSON field for:
  - `environment` (dev, staging, prod)
  - `timestamp` (when deployed)
  - `deployed_by` (GitHub Actions, user, CD pipeline)
  - `rollback_info` (parent deployment ID if rolled back)
  - `workflow_run_id` (GitHub Actions run)
  - `build_logs_url` (GitHub Actions logs)
  - `test_pass_rate` (%)

#### 2. Enhanced GitHub Integration (golden-thread-github.ts)
New exports:
- `fetchGitHubWorkflowRun(owner, repo, commit_sha)` → Gets latest workflow for commit
  - Returns: { run_id, status, conclusion, created_at, updated_at, logs_url }
  - Maps GitHub status (queued, in_progress, completed) to deployment status (PENDING, IN_PROGRESS, PASSED/FAILED)
  
- `fetchGitHubDeployments(owner, repo, commit_sha)` → Gets deployments for commit
  - Returns: Array of { environment, created_at, creator, state, production_environment }
  - State: success, failure, pending, error, inactive
  - Maps to status: success→GREEN, failure/error→RED, pending→YELLOW

- `linkGitHubBuildAndDeploy(opts)` → Full Stage 4-5 linking
  - Fetches workflow run for stage 4 (Build)
  - Fetches deployments for stage 5 (Deploy)
  - Creates both stages in the chain with full metadata
  - Validates commit exists and build passed before deploying

#### 3. New CLI Command: trace --commit
File: src/cli/run.ts
```
qe-tool trace --commit <SHA> [--repo owner/repo] [--database path] [--output file] [--json]
```
Options:
- `--commit <SHA>` (required) — Git commit SHA to trace
- `--repo <owner/repo>` (required unless GITHUB_OWNER/GITHUB_REPO env vars set)
- `--database <file>` (default: ./prova-golden-thread.sqlite)
- `--output <file>` (optional, auto-named if omitted)
- `--json` (output JSON instead of HTML)

Logic:
1. Query golden_thread_store for any chain with this commit SHA
2. If not found, create new chain starting at Stage 1 (Spec)
3. Call linkGitHubBuildAndDeploy to add Stages 4-5
4. Render HTML/JSON report showing full 7-stage chain
5. Highlight status (GREEN/YELLOW/RED) for each stage

#### 4. New Reporter: golden-thread-commit-reporter.ts
- `renderCommitTraceHtml(chain, commit_sha)` — HTML with:
  - Commit badge with link to GitHub
  - Each stage as a card: Spec → Test → Evidence → Build → Deploy → Monitor → Debug
  - Status badge (GREEN/YELLOW/RED) on Build and Deploy stages
  - Rollback chain visualization (if applicable)
  - Links to GitHub workflow runs, deployment logs, test evidence
  
- `renderCommitTraceJson(chain)` — JSON structure same as trace --issue-key

#### 5. Test Coverage (stage-4-5.test.ts)
Tests for:
- `linkGitHubStage` with valid/invalid commit
- `fetchGitHubWorkflowRun` mocked GitHub API responses
- `fetchGitHubDeployments` with multiple environments
- Status mapping: GitHub conclusion → deployment status
- `traceCommit` CLI command with --commit --repo flags
- Rollback scenario: parent_id linking for redeployments
- Chain validation: fails if commit not found or build failed

#### 6. Files to Create
- src/core/github-api-client.ts — Low-level GitHub API wrapper
- src/reporters/golden-thread-commit-reporter.ts — Commit trace rendering
- tests/stage-4-5.test.ts — Full Stage 4-5 test suite

#### 7. Files to Modify
- src/core/golden-thread-store.ts — Add `deployment_status` and `deployment_metadata` columns
- src/core/golden-thread-github.ts — Replace stub with full implementation
- src/cli/run.ts — Add `traceCommand --commit` variant
- tests/golden-thread/stage-3.test.ts — If needed to verify existing tests still pass

### Implementation Order
1. Create github-api-client.ts (low-level GitHub API)
2. Enhance golden-thread-store.ts schema
3. Implement golden-thread-github.ts (full GitHub integration)
4. Create golden-thread-commit-reporter.ts (rendering)
5. Add traceCommit command to CLI (run.ts)
6. Write stage-4-5.test.ts (comprehensive tests)
7. Verify all tests pass and lint clean

### Done When
- TypeScript compiles with zero errors
- All tests pass (including new stage-4-5.test.ts)
- npm run lint passes
- CLI: `qe-tool trace --commit <sha> --repo owner/repo` works end-to-end
- Coverage: new code at 80%+
