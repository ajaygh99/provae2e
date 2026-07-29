[CmdletBinding()]
param([switch]$Full)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path $repo 'artifacts\phase4-analytics-validation'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$log = Join-Path $artifactDirectory "analytics-validation-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
$script:Failures = 0

function Invoke-Step {
    param([string]$Name, [scriptblock]$Command)
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $output = "$log.step.tmp"
    "`n=== $Name ===" | Tee-Object -FilePath $log -Append
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $Command *> $output
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previous
    Get-Content -LiteralPath $output | Tee-Object -FilePath $log -Append
    Remove-Item -LiteralPath $output -Force
    $watch.Stop()
    $seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1)
    if ($exitCode -eq 0) {
        "PASS: $Name (${seconds}s)" | Tee-Object -FilePath $log -Append
    } else {
        "FAIL: $Name (${seconds}s)" | Tee-Object -FilePath $log -Append
        $script:Failures++
    }
}

Push-Location $repo
try {
    "PROVA Phase 4.5 analytics validation`nRepository: $repo`nStarted: $(Get-Date -Format o)" |
        Tee-Object -FilePath $log
    Invoke-Step 'Analytics and workflow tests' {
        npm test -- --runInBand --testPathPatterns='analytics|analytics-dashboard-workflow'
    }
    Invoke-Step 'TypeScript typecheck' { npm run typecheck }
    Invoke-Step 'Zero-error lint' { npm run lint -- --quiet }
    Invoke-Step 'Production build' { npm run build }
    Invoke-Step 'Built analytics CLI discovery' { node .\dist\cli\run.js report --help }
    Invoke-Step 'Deterministic built dashboard smoke' {
        node .\scripts\verify-analytics-dashboard.js (Join-Path $artifactDirectory 'dashboard')
    }
    if ($Full) {
        Invoke-Step 'Full regression suite' { npm test -- --runInBand }
        Invoke-Step 'Package dry run' { npm pack --dry-run }
    }
} finally {
    Pop-Location
}

"`nDetailed log: $log" | Tee-Object -FilePath $log -Append
if ($script:Failures -gt 0) {
    Write-Host "VALIDATION FAILED: $script:Failures step(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host 'VALIDATION PASSED: analytics dashboard gates are green.' -ForegroundColor Green
