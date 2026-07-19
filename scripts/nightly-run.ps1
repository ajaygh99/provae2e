# PROVA Nightly Agent Run
# Scheduled via Windows Task Scheduler, 10:00 PM daily.
# Picks up the oldest open Issue labeled 'agent-implement', implements it
# end-to-end (plan -> code -> tests -> PR) using Claude Code CLI (Haiku,
# switched from Sonnet 2026-07-19 for cost control while API balance is low),
# then waits for LENS's review. LENS itself only ever runs in exactly one
# place - the GitHub Actions workflow (.github/workflows/agent-trigger.yml),
# auto-triggered by the PR's opened/synchronize event - this script never
# re-implements or re-runs that review locally, only observes its outcome.
#
# Merge policy:
#   - LENS approves (no BLOCKER/MAJOR)      -> auto-merge immediately
#   - LENS flags BLOCKER/MAJOR               -> one automatic FORGE fix-up pass,
#                                                then LENS re-reviews once
#   - still not clean after the retry        -> leave the PR open, comment
#                                                tagging @ajaygh99 for manual review
# npm publish is NOT affected by any of this - SHIP only runs when a
# releases/vN.N.N-approval.md file exists, which is a separate manual step.
#
# Requires: gh CLI authenticated, ANTHROPIC_API_KEY set as a user env var,
# Claude Code CLI installed, and "Allow auto-merge" enabled once in the repo's
# Settings -> General -> Pull Requests (needed for `gh pr merge --auto`).
#
# NOTE: deliberately does NOT use `$ErrorActionPreference = "Stop"` combined
# with `2>&1` on native commands (git/gh/claude) - in Windows PowerShell that
# combination turns ordinary stderr chatter into fatal terminating errors.
# Real failures are instead detected via $LASTEXITCODE after each native call.

$ErrorActionPreference = "Continue"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir   = Join-Path $RepoRoot "daily"
$Today    = Get-Date -Format "yyyy-MM-dd"
$LogFile  = Join-Path $LogDir "$Today-nightlyrun.log"
$RepoSlug = "ajaygh99/provae2e"
# LENS reviews a PR in exactly one place: the GitHub Actions workflow below,
# triggered automatically by `gh pr create`/`gh pr push` via the
# `pull_request: [opened, synchronize]` event. This script never re-runs its
# own separate LENS pass - it only waits for and observes that one outcome.
$LensWorkflowFile          = "agent-trigger.yml"
$LensReviewTimeoutMinutes  = 10
$LensPollIntervalSeconds   = 15
# Guards against two overlapping invocations of this script (e.g. a manual
# Start-ScheduledTask run overlapping the scheduled 10pm one, or a previous
# run still mid-flight) picking up and processing the same Issue twice.
$LockFile = Join-Path $LogDir "nightly-run.lock"
$RunMutex = New-Object System.Threading.Mutex($false, "Global\PROVA-NightlyAgentRun")
$RunMutexAcquired = $false

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    # Write-Host, not Write-Output: Write-Output would leak into the return
    # value of any function that calls Log() as a bare statement (like
    # Wait-ForLensReview below), silently turning a clean boolean into a
    # multi-element array - which PowerShell always treats as truthy
    # regardless of content. Write-Host prints to console without touching
    # the pipeline, so it's safe to call from inside functions.
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

# Waits for the one-and-only LENS review (GitHub Actions, triggered by the
# PR's opened/synchronize event) to finish, then returns $true if it left the
# PR labeled 'ready-for-qa'. Does NOT run its own review pass - LENS reviews
# a PR in exactly one place; this only observes that single outcome, so a
# fix-up push (which re-triggers the same workflow via `synchronize`) can
# call this again to wait for the re-review instead of duplicating LENS logic.
function Wait-ForLensReview($prNumber) {
    Log "Waiting for LENS (GitHub Actions: $LensWorkflowFile) to review PR #$prNumber..."
    $deadline = (Get-Date).AddMinutes($LensReviewTimeoutMinutes)
    $headSha = gh pr view $prNumber --repo $RepoSlug --json headRefOid --jq ".headRefOid"
    if ($LASTEXITCODE -ne 0 -or -not $headSha) {
        Log "FATAL: could not resolve the head commit for PR #$prNumber."
        return $false
    }
    $reviewCompleted = $false

    while ((Get-Date) -lt $deadline) {
        $runsJson = gh run list --repo $RepoSlug --workflow $LensWorkflowFile --branch $branch --json headSha,status,conclusion --limit 10
        if ($LASTEXITCODE -eq 0 -and $runsJson) {
            $runs = @($runsJson | ConvertFrom-Json)
            $currentRun = $runs | Where-Object { $_.headSha -eq $headSha } | Select-Object -First 1
            if ($currentRun -and $currentRun.status -eq "completed") {
                Log "LENS review run for commit $headSha finished (conclusion: $($currentRun.conclusion))."
                $reviewCompleted = ($currentRun.conclusion -eq "success")
                break
            }
        }
        Start-Sleep -Seconds $LensPollIntervalSeconds
    }

    if (-not $reviewCompleted) {
        Log "LENS did not complete successfully for commit $headSha within $LensReviewTimeoutMinutes minutes."
        return $false
    }

    $labels = gh pr view $prNumber --repo $RepoSlug --json labels --jq ".labels[].name"
    if ($LASTEXITCODE -ne 0) {
        Log "FATAL: could not read labels for PR #$prNumber."
        return $false
    }
    return ($labels -contains "ready-for-qa")
}

# Waits for every GitHub check attached to the exact PR head to complete and
# returns true only when they all pass. This is an in-script merge safeguard;
# branch protection should also mark these checks as required in GitHub.
function Wait-ForQualityChecks($prNumber) {
    Log "Waiting for all CI checks on PR #$prNumber..."
    gh pr checks $prNumber --repo $RepoSlug --watch --fail-fast --interval 15
    if ($LASTEXITCODE -ne 0) {
        Log "CI checks for PR #$prNumber did not all pass."
        return $false
    }
    return $true
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$StartTime = Get-Date

try {
    Log "=== Nightly run started ==="
    Set-Location $RepoRoot

    # 0. Atomically guard against overlapping/concurrent runs before touching
    # the repository. The lock file is retained only as human-readable owner
    # metadata; the named mutex is the actual race-free exclusion mechanism.
    try {
        $RunMutexAcquired = $RunMutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $RunMutexAcquired = $true
        Log "WARNING: recovered the run mutex from a previously terminated process."
    }
    if (-not $RunMutexAcquired) {
        Log "FATAL: another nightly-run.ps1 invocation is still running. Refusing to start a second overlapping run."
        exit 1
    }

    if (Test-Path $LockFile) {
        Log "WARNING: found stale lock metadata from a previous terminated run. Removing it and proceeding under the acquired mutex."
        Remove-Item $LockFile -Force
    }
    @{ ProcessId = $PID; StartedAt = (Get-Date -Format "o") } | ConvertTo-Json | Set-Content -Path $LockFile
    Log "Acquired run lock (PID $PID)."

    # Never attempt a checkout or pull while unrelated local work is present.
    # Checking this before sync prevents checkout itself from carrying changes
    # to another branch or failing partway through the automation.
    $dirty = git status --porcelain
    if ($LASTEXITCODE -ne 0) {
        Log "FATAL: git status failed (exit code $LASTEXITCODE). Aborting."
        exit 1
    }
    if ($dirty) {
        Log "FATAL: working tree is not clean at start. Refusing to proceed automatically - inspect and resolve manually before the next run:"
        Log $dirty
        exit 1
    }

    # 1. Sync repo
    Log "Pulling latest main..."
    git checkout main | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "FATAL: git checkout main failed (exit code $LASTEXITCODE). Aborting."
        exit 1
    }
    git pull origin main | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "FATAL: git pull origin main failed (exit code $LASTEXITCODE). Aborting rather than risk implementing against a stale/diverged main."
        exit 1
    }

    # 2. Find the oldest open Issue labeled agent-implement
    Log "Looking for Issues labeled agent-implement..."
    $issuesJson = gh issue list --label "agent-implement" --state open --json number,title,body --limit 5
    if ($LASTEXITCODE -ne 0) {
        Log "FAILED: gh issue list returned exit code $LASTEXITCODE. Is 'gh auth status' still valid?"
        exit 1
    }
    $issues = $issuesJson | ConvertFrom-Json

    if (-not $issues -or $issues.Count -eq 0) {
        Log "No pending Issues. Nothing to do tonight."
        exit 0
    }

    $issue = $issues | Sort-Object number | Select-Object -First 1
    $issueNum   = $issue.number
    $issueTitle = $issue.title
    Log "Picked Issue #$issueNum : $issueTitle"

    # 3. Implement + test loop (ARIA + FORGE + VERA in one agentic session, Haiku)
    $branch = "feature/issue-$issueNum"
    git checkout -b $branch 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        git checkout $branch | Out-Null
        Log "Branch $branch already existed, switched to it (exit code $LASTEXITCODE)"
    }

    $implementPrompt = @"
You are working on the PROVA repo. Read CLAUDE.md and .agents/AGENTS.md first and follow them exactly.

Implement GitHub Issue #$issueNum end to end:
1. Run: gh issue view $issueNum --repo $RepoSlug   (to get full context)
2. Write an implementation plan to .agents/tasks/ARIA-plan-$issueNum.md
3. Implement the feature in src/ following existing patterns
4. Write tests in tests/ (or alongside in src/) with 80%+ coverage of new code
5. Run: npm run typecheck && npm run lint && npm test -- run all of these until they pass with zero errors. Fix issues yourself and re-run until green. Never skip or stub a test.
6. Update qa/run-results.md with the outcome
7. Commit all changes with a clear message referencing #$issueNum
8. Push branch '$branch' to origin
9. Open a PR against main with: gh pr create --title "..." --body "Closes #$issueNum" --head $branch
10. Comment on the Issue confirming the plan and PR link

Do not stop until typecheck, lint, and tests all pass and the PR is open. Work autonomously - do not ask for confirmation.
"@

    Log "Starting implementation pass (claude-haiku-4-5-20251001)... this can take 5-20+ minutes"
    $implementResult = claude -p $implementPrompt --model claude-haiku-4-5-20251001 --permission-mode bypassPermissions --output-format text
    Add-Content -Path $LogFile -Value $implementResult
    Log "Implementation pass finished (exit code $LASTEXITCODE)."

    # 4. Find the PR that was just opened for this branch
    $prJson = gh pr list --head $branch --json number,url --limit 1
    $pr = $prJson | ConvertFrom-Json
    if (-not $pr -or $pr.Count -eq 0) {
        Log "WARNING: no PR found for branch $branch. Implementation pass may have failed - check the output logged above."
        exit 1
    }
    $prNumber = $pr[0].number
    Log "PR #$prNumber opened: $($pr[0].url)"

    # 5. Wait for LENS's (GitHub Actions) review, with one automatic fix-up retry if it's not clean
    $clean = [bool](Wait-ForLensReview $prNumber)
    if ($clean) {
        $clean = [bool](Wait-ForQualityChecks $prNumber)
    }

    if (-not $clean) {
        Log "LENS flagged BLOCKER/MAJOR items. Giving FORGE one automatic fix-up pass."
        $fixPrompt = @"
You are FORGE. Read the review comments LENS left on PR #${prNumber} (see:
  gh pr view $prNumber --repo $RepoSlug --comments )
Address every BLOCKER and MAJOR item LENS raised. Do not touch MINOR/SUGGESTION items unless trivial.
Commit and push the fixes to the same branch '$branch'.
Re-run npm run typecheck && npm run lint && npm test and make sure everything is still green before finishing.
"@
        $fixResult = claude -p $fixPrompt --model claude-haiku-4-5-20251001 --permission-mode bypassPermissions --output-format text
        Add-Content -Path $LogFile -Value $fixResult
        Log "Fix-up pass finished (exit code $LASTEXITCODE). Pushing re-triggers LENS's re-review automatically."

        $clean = [bool](Wait-ForLensReview $prNumber)
        if ($clean) {
            $clean = [bool](Wait-ForQualityChecks $prNumber)
        }
    }

    if ($clean) {
        Log "PR #$prNumber is clean. Auto-merging (squash, delete branch)."
        gh pr merge $prNumber --repo $RepoSlug --squash --auto --delete-branch
        Log "gh pr merge exit code: $LASTEXITCODE"
        if ($LASTEXITCODE -ne 0) {
            Log "WARNING: auto-merge command failed. Check that 'Allow auto-merge' is enabled in repo Settings > General. PR left open: $($pr[0].url)"
        }
    } else {
        Log "PR #$prNumber still not clean after one fix-up attempt. Leaving open for manual review."
        gh pr comment $prNumber --repo $RepoSlug --body "Needs human review - LENS still found BLOCKER/MAJOR issues after one automated fix-up attempt. @ajaygh99 please take a look." | Out-Null
    }

    # 6. Update sprint tracking file - do this on a clean main checkout and
    # commit/push it directly, so it never sits as an uncommitted local change
    # that the next run's implementation pass would otherwise trip over.
    # PR #$prNumber is already open/merged by this point - a failure here only
    # affects sprint bookkeeping, but it must still fail loudly, not vanish silently.
    git checkout main | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "FATAL: git checkout main failed while logging completion (exit code $LASTEXITCODE). PR #$prNumber is unaffected, but sprint/completed-prs.md was not updated."
        exit 1
    }
    git pull origin main | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "FATAL: git pull origin main failed while logging completion (exit code $LASTEXITCODE). PR #$prNumber is unaffected, but sprint/completed-prs.md was not updated."
        exit 1
    }
    $completedNote = "- [$Today] PR #$prNumber for Issue #$issueNum ($issueTitle) - clean=$clean"
    Add-Content -Path (Join-Path $RepoRoot "sprint\completed-prs.md") -Value $completedNote
    git add "sprint/completed-prs.md" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "FATAL: git add sprint/completed-prs.md failed (exit code $LASTEXITCODE)."
        exit 1
    }
    git commit -m "chore: log completed PR #$prNumber for Issue #$issueNum" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "FATAL: git commit failed while logging completion (exit code $LASTEXITCODE)."
        exit 1
    }
    git push origin main | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "FATAL: git push origin main failed while logging completion (exit code $LASTEXITCODE)."
        exit 1
    }
    Log "Logged completion to sprint/completed-prs.md and pushed to main."

    $elapsed = (Get-Date) - $StartTime
    Log "=== Nightly run finished in $([int]$elapsed.TotalMinutes) minutes ==="
}
catch {
    Log "FATAL ERROR: $($_.Exception.Message)"
    Log "At: $($_.InvocationInfo.PositionMessage)"
    exit 1
}
finally {
    if (Test-Path $LockFile) {
        Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
    }
    if ($RunMutexAcquired) {
        $RunMutex.ReleaseMutex()
    }
    $RunMutex.Dispose()
}
