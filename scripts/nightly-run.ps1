# PROVA Nightly Agent Run
# Scheduled via Windows Task Scheduler, 10:00 PM daily.
# Picks up the oldest open Issue labeled 'agent-implement', implements it
# end-to-end (plan -> code -> tests -> PR) using Claude Code CLI (Sonnet),
# then triggers a Haiku-based LENS review pass on the resulting PR.
#
# Requires: gh CLI authenticated, ANTHROPIC_API_KEY set as a user env var,
# Claude Code CLI installed (npm install -g @anthropic-ai/claude-code).

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir   = Join-Path $RepoRoot "daily"
$Today    = Get-Date -Format "yyyy-MM-dd"
$LogFile  = Join-Path $LogDir "$Today-nightlyrun.log"
$MaxRuntimeMinutes = 470   # stop working ~30 min before the 6 AM cutoff

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Write-Output $line
    Add-Content -Path $LogFile -Value $line
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$StartTime = Get-Date
Log "=== Nightly run started ==="

Set-Location $RepoRoot

# 1. Sync repo
Log "Pulling latest main..."
git checkout main 2>&1 | Out-Null
git pull origin main 2>&1 | Tee-Object -Variable pullOut | Out-Null
Log "git pull: $pullOut"

# 2. Find the oldest open Issue labeled agent-implement
Log "Looking for Issues labeled agent-implement..."
$issuesJson = gh issue list --label "agent-implement" --state open --json number,title,body --limit 5
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
git checkout -b $branch 2>&1 | Out-Null

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

Log "Starting implementation pass (claude-sonnet-5)..."
$implementResult = claude -p $implementPrompt --model claude-sonnet-5 --permission-mode bypassPermissions --output-format text 2>&1
Add-Content -Path $LogFile -Value $implementResult
Log "Implementation pass finished."

# 4. Find the PR that was just opened for this branch
$prJson = gh pr list --head $branch --json number,url --limit 1
$pr = $prJson | ConvertFrom-Json
if (-not $pr -or $pr.Count -eq 0) {
    Log "WARNING: no PR found for branch $branch. Skipping LENS review. Check log for failures."
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
$reviewResult = claude -p $reviewPrompt --model claude-haiku-4-5-20251001 --permission-mode bypassPermissions --output-format text 2>&1
Add-Content -Path $LogFile -Value $reviewResult
Log "LENS review pass finished."

# 6. Update sprint tracking file
$completedNote = "- [$Today] PR #$prNumber for Issue #$issueNum ($issueTitle)"
Add-Content -Path (Join-Path $RepoRoot "sprint\completed-prs.md") -Value $completedNote

$elapsed = (Get-Date) - $StartTime
Log "=== Nightly run finished in $([int]$elapsed.TotalMinutes) minutes ==="
