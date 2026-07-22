#requires -version 5.0
<#
.SYNOPSIS
    PROVA Phase 3 — Night 1 Studio Issues Creator (PowerShell)

.DESCRIPTION
    Creates 40 PROVA Studio feature issues on GitHub using the 'gh' CLI.
    Designed to run via Windows Task Scheduler at 10 PM nightly.

.PARAMETER DryRun
    Show what would be created without actually creating issues

.PARAMETER ReportPath
    Path to write progress report (default: sprint/phase3-sprint.md)

.EXAMPLE
    .\create-phase3-studio-issues.ps1 -DryRun
    .\create-phase3-studio-issues.ps1 -ReportPath "sprint/phase3-progress.md"

.NOTES
    Requires: GitHub CLI (gh) with authentication configured
    Environment: Windows PowerShell 5.0+
    Author: PROVA Automation
    Date: 2026-07-22
#>

param(
    [switch]$DryRun,
    [string]$ReportPath = "sprint/phase3-sprint.md"
)

# ============================================================================
# STUDIO ISSUES DEFINITION (40 total)
# ============================================================================

$studioIssues = @(
    # UI Framework & Scaffolding (5 issues)
    @{
        num = 1
        title = "Studio: React Dashboard Skeleton"
        category = "UI Framework & Scaffolding"
        storyPoints = 5
        description = @"
## Description
Create a React-based dashboard skeleton for PROVA Studio with routing, layout structure, and navigation.

## Acceptance Criteria
- [ ] React + TypeScript project initialized with Vite
- [ ] Main layout with sidebar navigation and content area
- [ ] Route structure defined (dashboard, builder, execution, settings)
- [ ] Header with user profile and logout
- [ ] Navigation bar with active page highlighting

## Technical Details
- Use React Router v6 for routing
- Implement responsive layout (desktop-first)
- No authentication required for MVP
- Keep component structure flat and composable
"@
    },
    @{
        num = 2
        title = "Studio: Component Library Setup"
        category = "UI Framework & Scaffolding"
        storyPoints = 3
        description = @"
## Description
Establish a reusable component library with base UI components (buttons, modals, input fields, etc.) using TypeScript + TSX.

## Acceptance Criteria
- [ ] Button component (primary, secondary, danger variants)
- [ ] Input/textarea components with validation state
- [ ] Modal/dialog component
- [ ] Dropdown/select component
- [ ] Toast/notification component
- [ ] Storybook setup for component documentation

## Technical Details
- Use TypeScript for type safety
- Prop validation via TypeScript interfaces
- Document all component props
- Create a components/ directory in src/
"@
    },
    @{
        num = 3
        title = "Studio: TypeScript Strict Mode Setup"
        category = "UI Framework & Scaffolding"
        storyPoints = 2
        description = @"
## Description
Configure TypeScript strict mode for type safety and enforce no 'any' types in Studio codebase.

## Acceptance Criteria
- [ ] tsconfig.json updated with strict: true
- [ ] noImplicitAny enabled
- [ ] strictNullChecks enabled
- [ ] ESLint rules configured to catch 'any' types
- [ ] All existing files pass type checking

## Technical Details
- Use @typescript-eslint/eslint-plugin
- Create .eslintrc.json with strict rules
- Document TypeScript setup in README
- No bypass comments allowed in review
"@
    },
    @{
        num = 4
        title = "Studio: Styling System (Tailwind CSS)"
        category = "UI Framework & Scaffolding"
        storyPoints = 3
        description = @"
## Description
Set up Tailwind CSS as the styling framework with custom theme configuration for PROVA branding.

## Acceptance Criteria
- [ ] Tailwind CSS installed and configured
- [ ] Custom theme colors defined (PROVA brand palette)
- [ ] Global styles (reset, base typography)
- [ ] CSS variables for design tokens
- [ ] Dark mode support configured (if needed for MVP)

## Technical Details
- Install: npm install -D tailwindcss postcss autoprefixer
- Create tailwind.config.ts with custom theme
- Configure PostCSS pipeline
- Test theme on sample components
"@
    },
    @{
        num = 5
        title = "Studio: Responsive Layout System"
        category = "UI Framework & Scaffolding"
        storyPoints = 3
        description = @"
## Description
Implement responsive layout components and breakpoint system for desktop, tablet, and mobile views.

## Acceptance Criteria
- [ ] Grid/flexbox layout utilities via Tailwind
- [ ] Breakpoint mixin helpers (sm, md, lg, xl)
- [ ] Responsive sidebar (collapse on mobile)
- [ ] Mobile menu component
- [ ] Tested on 3+ viewport sizes

## Technical Details
- Use Tailwind's built-in breakpoints
- Create layout wrapper component
- Document responsive patterns in Storybook
- Test with Chrome DevTools device mode
"@
    }
)

# Add Test Builder issues (15 issues) - abbreviated for length
$studioIssues += @(
    @{
        num = 6
        title = "Studio: Drag-Drop Canvas for Test Steps"
        category = "Test Builder UI"
        storyPoints = 8
        description = "Create a drag-and-drop canvas where users can add, reorder, and remove test steps. Integrate react-beautiful-dnd or react-dnd."
    },
    @{
        num = 7
        title = "Studio: Test Step Add/Edit Panel"
        category = "Test Builder UI"
        storyPoints = 5
        description = "Create a side panel to add or edit test steps with fields for action, selector, and parameters."
    },
    @{
        num = 8
        title = "Studio: Element Selector Tool"
        category = "Test Builder UI"
        storyPoints = 5
        description = "Create an interactive element selector that lets users click on page elements to capture CSS selectors or XPaths."
    },
    @{
        num = 9
        title = "Studio: Assertion Builder UI"
        category = "Test Builder UI"
        storyPoints = 5
        description = "Build a UI component for creating test assertions (element visible, text contains, etc.)."
    },
    @{
        num = 10
        title = "Studio: Wait Conditions & Synchronization"
        category = "Test Builder UI"
        storyPoints = 3
        description = "Add UI for configuring wait/synchronization steps (wait for selector, wait for navigation, etc.)."
    },
    @{
        num = 11
        title = "Studio: Screenshot Capture & Annotation"
        category = "Test Builder UI"
        storyPoints = 5
        description = "Enable users to capture screenshots at any step and annotate them with comments/markers."
    },
    @{
        num = 12
        title = "Studio: Test Step Library & Reusability"
        category = "Test Builder UI"
        storyPoints = 5
        description = "Create a library of reusable test step templates and composite steps."
    },
    @{
        num = 13
        title = "Studio: Test Step Documentation"
        category = "Test Builder UI"
        storyPoints = 3
        description = "Add inline documentation and help for each step type within the UI."
    },
    @{
        num = 14
        title = "Studio: Undo/Redo for Test Builder"
        category = "Test Builder UI"
        storyPoints = 3
        description = "Implement undo/redo functionality for test building actions."
    },
    @{
        num = 15
        title = "Studio: Save/Load Test Projects"
        category = "Test Builder UI"
        storyPoints = 5
        description = "Implement file save/load operations for test projects (as JSON)."
    },
    @{
        num = 16
        title = "Studio: Test Versioning & History"
        category = "Test Builder UI"
        storyPoints = 5
        description = "Track test versions and allow reverting to previous versions."
    },
    @{
        num = 17
        title = "Studio: Test Cloning & Duplication"
        category = "Test Builder UI"
        storyPoints = 3
        description = "Allow users to quickly clone/duplicate existing tests as a starting point."
    },
    @{
        num = 18
        title = "Studio: Test Search & Filter"
        category = "Test Builder UI"
        storyPoints = 3
        description = "Add search and filter capabilities to the test library."
    },
    @{
        num = 19
        title = "Studio: Bulk Edit Test Steps"
        category = "Test Builder UI"
        storyPoints = 3
        description = "Allow bulk editing of multiple test steps (e.g., update selector across steps)."
    },
    @{
        num = 20
        title = "Studio: Test Metadata & Tagging"
        category = "Test Builder UI"
        storyPoints = 2
        description = "Add metadata fields and tagging system for test organization."
    }
)

# Add Execution Viewer issues (10 issues)
$studioIssues += @(
    @{
        num = 21
        title = "Studio: Live Execution Dashboard"
        category = "Execution Viewer"
        storyPoints = 5
        description = "Create a real-time dashboard showing test execution progress and results."
    },
    @{
        num = 22
        title = "Studio: Step-by-Step Execution Results"
        category = "Execution Viewer"
        storyPoints = 5
        description = "Display detailed results for each test step (pass/fail, duration, error messages)."
    },
    @{
        num = 23
        title = "Studio: Screenshot Evidence in Results"
        category = "Execution Viewer"
        storyPoints = 3
        description = "Display screenshots captured during execution as evidence."
    },
    @{
        num = 24
        title = "Studio: Video Playback of Execution"
        category = "Execution Viewer"
        storyPoints = 5
        description = "Record and play back video of the test execution."
    },
    @{
        num = 25
        title = "Studio: Performance Metrics Dashboard"
        category = "Execution Viewer"
        storyPoints = 5
        description = "Display performance metrics for the test execution (page load time, step duration, etc.)."
    },
    @{
        num = 26
        title = "Studio: Detailed Error Information & Stack Traces"
        category = "Execution Viewer"
        storyPoints = 3
        description = "Show comprehensive error details when a step fails."
    },
    @{
        num = 27
        title = "Studio: Retry Failed Step / Continue Execution"
        category = "Execution Viewer"
        storyPoints = 3
        description = "Allow retrying a failed step or continuing test execution from a specific point."
    },
    @{
        num = 28
        title = "Studio: Export Test Results to Report"
        category = "Execution Viewer"
        storyPoints = 5
        description = "Generate and export test results to HTML/PDF report format."
    },
    @{
        num = 29
        title = "Studio: Compare Test Runs Side-by-Side"
        category = "Execution Viewer"
        storyPoints = 3
        description = "Compare results from two different test executions to identify differences."
    },
    @{
        num = 30
        title = "Studio: Trend Charts & Analytics"
        category = "Execution Viewer"
        storyPoints = 5
        description = "Display charts showing test trends over time (pass rate, duration, failure types)."
    }
)

# Add Integration & Auth issues (10 issues)
$studioIssues += @(
    @{
        num = 31
        title = "Studio: GitHub OAuth Setup & Login"
        category = "Integration & Auth"
        storyPoints = 5
        description = "Implement GitHub OAuth for user authentication in PROVA Studio."
    },
    @{
        num = 32
        title = "Studio: JIRA Connector Integration"
        category = "Integration & Auth"
        storyPoints = 8
        description = "Connect Studio to JIRA for linking tests to issues and bug reports."
    },
    @{
        num = 33
        title = "Studio: Figma Design Sync"
        category = "Integration & Auth"
        storyPoints = 5
        description = "Sync designs from Figma to Studio for reference during test building."
    },
    @{
        num = 34
        title = "Studio: Team Workspace & Collaboration"
        category = "Integration & Auth"
        storyPoints = 5
        description = "Enable multiple team members to work together in shared workspaces."
    },
    @{
        num = 35
        title = "Studio: User Permissions & Access Control"
        category = "Integration & Auth"
        storyPoints = 5
        description = "Implement role-based access control (RBAC) for workspace members."
    },
    @{
        num = 36
        title = "Studio: API Key Management"
        category = "Integration & Auth"
        storyPoints = 3
        description = "Allow users to generate and manage API keys for programmatic access to PROVA."
    },
    @{
        num = 37
        title = "Studio: Test Library Sharing & Permissions"
        category = "Integration & Auth"
        storyPoints = 3
        description = "Allow sharing test library steps with team members or making them public."
    },
    @{
        num = 38
        title = "Studio: Slack Notifications & Alerts"
        category = "Integration & Auth"
        storyPoints = 5
        description = "Send test execution notifications to Slack channels."
    },
    @{
        num = 39
        title = "Studio: CLI Integration & Remote Execution"
        category = "Integration & Auth"
        storyPoints = 8
        description = "Integrate with PROVA CLI to run Studio tests from command line."
    },
    @{
        num = 40
        title = "Studio: S3 / Cloud Storage Integration"
        category = "Integration & Auth"
        storyPoints = 5
        description = "Store test artifacts (screenshots, videos, reports) in S3 or cloud storage."
    }
)

# ============================================================================
# FUNCTIONS
# ============================================================================

function Verify-GitHubAuth {
    Write-Host "🔍 Verifying GitHub authentication..." -ForegroundColor Cyan

    try {
        $authStatus = & gh auth status 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ $authStatus" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ GitHub auth failed: $authStatus" -ForegroundColor Red
            return $false
        }
    }
    catch {
        Write-Host "❌ GitHub CLI (gh) not found. Install from: https://cli.github.com/" -ForegroundColor Red
        return $false
    }
}

function Check-RateLimit {
    Write-Host "🔍 Checking GitHub API rate limit..." -ForegroundColor Cyan

    try {
        $rateLimit = & gh api rate-limit --jq '.resources.core | .remaining' 2>&1
        $remaining = [int]$rateLimit

        if ($remaining -lt 100) {
            Write-Host "⚠️  Low rate limit: $remaining requests remaining (need 100+)" -ForegroundColor Yellow
            return $false
        }

        Write-Host "✅ Rate limit: $remaining requests remaining" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ Failed to check rate limit: $_" -ForegroundColor Red
        return $false
    }
}

function Create-GitHubIssue {
    param(
        [string]$Title,
        [string]$Body,
        [array]$Labels
    )

    try {
        $args = @(
            "issue", "create",
            "--title", $Title,
            "--body", $Body,
            "--label", ($Labels -join ",")
        )

        $result = & gh @args
        Write-Host "✅ Created: $Title" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ Failed to create issue: $Title" -ForegroundColor Red
        Write-Host "   Error: $_" -ForegroundColor Red
        return $false
    }
}

function Show-DryRun {
    Write-Host "`n📋 DRY RUN: Would create $($studioIssues.Count) Studio issues`n" -ForegroundColor Cyan

    $byCategory = $studioIssues | Group-Object -Property category

    foreach ($group in $byCategory) {
        Write-Host "$($group.Name.ToUpper()) ($($group.Count) issues)" -ForegroundColor White
        Write-Host ("-" * 60)

        foreach ($issue in $group.Group) {
            Write-Host "[#$($issue.num)] $($issue.title)"
            Write-Host "    Story Points: $($issue.storyPoints)"
            Write-Host "    Labels: phase3, epic:studio, feature`n"
        }
    }

    Write-Host ("=" * 60) -ForegroundColor Green
    Write-Host "✅ Total: $($studioIssues.Count) issues ready for creation" -ForegroundColor Green
    Write-Host "   Labels: phase3, epic:studio, feature" -ForegroundColor Green
}

function Create-AllIssues {
    Write-Host "📝 Creating $($studioIssues.Count) Studio issues...`n" -ForegroundColor Cyan

    if (-not (Verify-GitHubAuth)) {
        Write-Host "❌ GitHub authentication failed. Aborting." -ForegroundColor Red
        return $false
    }

    if (-not (Check-RateLimit)) {
        Write-Host "❌ Insufficient API rate limit. Aborting." -ForegroundColor Red
        return $false
    }

    $created = 0
    $failed = 0
    $createdNumbers = @()

    foreach ($issue in $studioIssues) {
        $body = "$($issue.description)`n`n---`n**Story Points:** $($issue.storyPoints)"
        $labels = @("phase3", "epic:studio", "feature")

        if (Create-GitHubIssue -Title $issue.title -Body $body -Labels $labels) {
            $created++
        } else {
            $failed++
        }

        # Delay to avoid rate limiting
        Start-Sleep -Milliseconds 500
    }

    Write-Host "`n$("=" * 60)" -ForegroundColor Green
    Write-Host "📊 RESULTS:" -ForegroundColor Green
    Write-Host "   Created: $created/$($studioIssues.Count)" -ForegroundColor Green
    Write-Host "   Failed:  $failed/$($studioIssues.Count)" -ForegroundColor Green

    return ($failed -eq 0)
}

function Update-SprintProgress {
    param([bool]$Success)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $status = if ($Success) { "✅ COMPLETE" } else { "⚠️  PARTIAL" }

    $progressEntry = @"

## Night 1 — Studio Issues (2026-07-22 22:00)
**Time:** $timestamp
**Status:** $status
- Created: 40 Studio feature issues
- Labels: `phase3`, `epic:studio`, `feature`
- Story Points: Fibonacci mix (2-8 points)
- Categories:
  - UI Framework & Scaffolding (5 issues)
  - Test Builder UI (15 issues)
  - Execution Viewer (10 issues)
  - Integration & Auth (10 issues)
- Git commit: "chore: create Phase 3 Studio issues batch 1/3"

"@

    if (Test-Path $ReportPath) {
        Add-Content -Path $ReportPath -Value $progressEntry -Encoding UTF8
    } else {
        Set-Content -Path $ReportPath -Value $progressEntry -Encoding UTF8
    }

    Write-Host "✅ Progress logged to $ReportPath" -ForegroundColor Green
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Host "`n$("=" * 60)" -ForegroundColor Cyan
Write-Host "PROVA Phase 3 — Night 1 Studio Issues Creator" -ForegroundColor Cyan
Write-Host "$("=" * 60)`n" -ForegroundColor Cyan

if ($DryRun) {
    Show-DryRun
} else {
    $success = Create-AllIssues
    Update-SprintProgress -Success $success

    if ($success) {
        Write-Host "`n✅ All issues created successfully!" -ForegroundColor Green
        Write-Host "Next step: git commit and push" -ForegroundColor Cyan
    } else {
        Write-Host "`n⚠️  Some issues failed to create." -ForegroundColor Yellow
    }
}

Write-Host "`n"
