# PROVA Nightly Agent Run
# Scheduled via Windows Task Scheduler, 10:00 PM daily.
# Picks up the oldest open Issue labeled 'agent-implement', implements it
# end-to-end (plan -> code -> tests -> PR) using Claude Code CLI (Sonnet),
# then runs a Haiku-based LENS review pass on the resulting PR.
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

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Write-Output $line
    Add-Content -Path $LogFile -Value $line
}

# Runs the LENS review pass on a PR and returns $true if it came back clean
# (ready-for-qa label present, no BLOCKER/MAJOR items left unresolved).
function Invoke-LensReview($prNumber) {
    $reviewPrompt = @"
You are LENS, the review agent. Read .agents/AGENTS.md for your review checklist.
Review PR #$prNumber in $RepoSlug (gh pr diff $prNumber).
Post inline review comments via gh pr review $prNumber, flagging BLOCKER / MAJOR / MINOR / SUGGESTION per the checklist.
If there are no BLOCKER or MAJOR items, approve the PR and add the label 'ready-for-qa' via gh pr edit $prNumber --add-label ready-for-qa.
If there are BLOCKER or MAJOR items, request changes and do NOT add the label.
"@
    Log "Starting LENS review pass on PR #$prNumber (claude-haiku-4-5)..."
    $reviewResult = claude -p $reviewPrompt --model claude-haiku-4-5-20251001 --permission-mode bypassPermissions --output-format text
    Add-Content -Path $LogFile -Value $reviewResult
    Log "LENS review pass finished (exit code $LASTEXITCODE)."

    $labels = gh pr view $prNumber --repo $RepoSlug --json labels --jq ".labels[].name"
    return ($labels -contains "ready-for-qa")
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$StartTime = Get-Date

try {
    Log "=== Nightly run started ==="
    Set-Location $RepoRoot

    # 1. Sync repo
    Log "Pulling latest main..."
    git checkout main | Out-Null
    Log "checkout exit code: $LASTEXITCODE"
    git pull origin main | Out-Null
    Log "pull exit code: $LASTEXITCODE"
    if ($LASTEXITCODE -ne 0) {
        Log "WARNING: git pull returned non-zero, continuing with local state anyway"
    }

    # Safety net: if a previous run ever left the working tree dirty (crash,
    # interruption, or the completed-prs.md bug this run just fixed), don't
    # let that silently confuse this run's branch/commit steps.
    $dirty = git status --porcelain
    if ($dirty) {
        Log "WARNING: working tree was not clean at start. Stashing leftover changes before proceeding."
        git stash push -u -m "auto-stash before nightly run $Today" | Out-Null
        Log "stash exit code: $LASTEXITCODE"
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

    # 3. Implement + test loop (ARIA + FORGE + VERA in one agentic session, Sonnet)
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

    Log "Starting implementation pass (claude-sonnet-5)... this can take 5-20+ minutes"
    $implementResult = claude -p $implementPrompt --model claude-sonnet-5 --permission-mode bypassPermissions --output-format text
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

    # 5. LENS review pass, with one automatic fix-up retry if it's not clean
    $clean = Invoke-LensReview $prNumber

    if (-not $clean) {
        Log "LENS flagged BLOCKER/MAJOR items. Giving FORGE one automatic fix-up pass."
        $fixPrompt = @"
You are FORGE. Read the review comments LENS left on PR #${prNumber} (see:
  gh pr view $prNumber --repo $RepoSlug --comments )
Address every BLOCKER and MAJOR item LENS raised. Do not touch MINOR/SUGGESTION items unless trivial.
Commit and push the fixes to the same branch '$branch'.
Re-run npm run typecheck && npm run lint && npm test and make sure everything is still green before finishing.
"@
        $fixResult = claude -p $fixPrompt --model claude-sonnet-5 --permission-mode bypassPermissions --output-format text
        Add-Content -Path $LogFile -Value $fixResult
        Log "Fix-up pass finished (exit code $LASTEXITCODE)."

        $clean = Invoke-LensReview $prNumber
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
    git checkout main | Out-Null
    git pull origin main | Out-Null
    $completedNote = "- [$Today] PR #$prNumber for Issue #$issueNum ($issueTitle) - clean=$clean"
    Add-Content -Path (Join-Path $RepoRoot "sprint\completed-prs.md") -Value $completedNote
    git add "sprint/completed-prs.md" | Out-Null
    git commit -m "chore: log completed PR #$prNumber for Issue #$issueNum" | Out-Null
    git push origin main | Out-Null
    Log "Logged completion to sprint/completed-prs.md and pushed to main (exit code $LASTEXITCODE)"

    $elapsed = (Get-Date) - $StartTime
    Log "=== Nightly run finished in $([int]$elapsed.TotalMinutes) minutes ==="
}
catch {
    Log "FATAL ERROR: $($_.Exception.Message)"
    Log "At: $($_.InvocationInfo.PositionMessage)"
    exit 1
}
