# PROVA Nightly Agent Run
# Scheduled via Windows Task Scheduler, 10:00 PM daily.
# Picks up the oldest open Issue labeled 'agent-implement', implements it
# end-to-end (plan -> code -> tests -> PR) using Claude Code CLI (Sonnet),
# then triggers a Haiku-based LENS review pass on the resulting PR.
#
# Requires: gh CLI authenticated, ANTHROPIC_API_KEY set as a user env var,
# Claude Code CLI installed (npm install -g @anthropic-ai/claude-code).
#
# NOTE: deliberately does NOT use `$ErrorActionPreference = "Stop"` combined
# with `2>&1` on native commands (git/gh/claude) - in Windows PowerShell that
# combination turns ordinary stderr chatter (e.g. git's own status messages)
# into fatal terminating errors, killing the script on step 1 even when the
# underlying command actually succeeded. Real failures are instead detected
# via $LASTEXITCODE after each native call.

$ErrorActionPreference = "Continue"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir   = Join-Path $RepoRoot "daily"
$Today    = Get-Date -Format "yyyy-MM-dd"
$LogFile  = Join-Path $LogDir "$Today-nightlyrun.log"

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Write-Output $line
    Add-Content -Path $LogFile -Value $line
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
        # branch may already exist from a prior attempt - just switch to it
        git checkout $branch | Out-Null
        Log "Branch $branch already existed, switched to it (exit code $LASTEXITCODE)"
    }

    $implementPrompt = @"
You are working on the PROVA repo. Read CLAUDE.md and .agents/AGENTS.md first and follow them exactly.

Implement GitHub Issue #$issueNum end to end:
1. Run: gh issue view $issueNum --repo ajaygh99/provae2e   (to get full context)
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
    $implementExit = $LASTEXITCODE
    Add-Content -Path $LogFile -Value $implementResult
    Log "Implementation pass finished (exit code $implementExit)."

    # 4. Find the PR that was just opened for this branch
    $prJson = gh pr list --head $branch --json number,url --limit 1
    $pr = $prJson | ConvertFrom-Json
    if (-not $pr -or $pr.Count -eq 0) {
        Log "WARNING: no PR found for branch $branch. Implementation pass may have failed - check the output logged above."
        exit 1
    }
    $prNumber = $pr[0].number
    Log "PR #$prNumber opened: $($pr[0].url)"

    # 5. LENS review pass (Haiku, cheap, checklist-based)
    $reviewPrompt = @"
You are LENS, the review agent. Read .agents/AGENTS.md for your review checklist.
Review PR #$prNumber in ajaygh99/provae2e (gh pr diff $prNumber).
Post inline review comments via gh pr review $prNumber, flagging BLOCKER / MAJOR / MINOR / SUGGESTION per the checklist.
If there are no BLOCKER or MAJOR items, approve the PR and add the label 'ready-for-qa' via gh pr edit $prNumber --add-label ready-for-qa.
If there are BLOCKER or MAJOR items, request changes and do NOT add the label.
"@

    Log "Starting LENS review pass (claude-haiku-4-5)..."
    $reviewResult = claude -p $reviewPrompt --model claude-haiku-4-5-20251001 --permission-mode bypassPermissions --output-format text
    Add-Content -Path $LogFile -Value $reviewResult
    Log "LENS review pass finished (exit code $LASTEXITCODE)."

    # 6. Update sprint tracking file
    $completedNote = "- [$Today] PR #$prNumber for Issue #$issueNum ($issueTitle)"
    Add-Content -Path (Join-Path $RepoRoot "sprint\completed-prs.md") -Value $completedNote

    $elapsed = (Get-Date) - $StartTime
    Log "=== Nightly run finished in $([int]$elapsed.TotalMinutes) minutes ==="
}
catch {
    Log "FATAL ERROR: $($_.Exception.Message)"
    Log "At: $($_.InvocationInfo.PositionMessage)"
    exit 1
}
