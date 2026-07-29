[CmdletBinding()]
param(
    [switch]$Full,
    [ValidatePattern('^https?://')]
    [string]$LiveUrl
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path $repo 'artifacts\phase4-performance-validation'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$log = Join-Path $artifactDirectory "performance-validation-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
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
    "PROVA Phase 4.3 performance validation`nRepository: $repo`nStarted: $(Get-Date -Format o)" |
        Tee-Object -FilePath $log
    Invoke-Step 'Focused performance tests' {
        npm test -- --runInBand tests/core/k6-runner.test.ts tests/core/performance-baseline.test.ts tests/perf/performance-store.test.ts tests/cli/perf.test.ts tests/cli/phase2-enhancements.test.ts
    }
    if ($Full) {
        Invoke-Step 'TypeScript typecheck' { npm run typecheck }
        Invoke-Step 'Zero-error lint' { npm run lint -- --quiet }
        Invoke-Step 'Production build' { npm run build }
        Invoke-Step 'Built performance CLI discovery' { node .\dist\cli\run.js perf --help }
    }
    if ($LiveUrl) {
        if (-not $Full) {
            Invoke-Step 'Production build for live smoke' { npm run build }
        }
        $baseline = Join-Path $artifactDirectory 'live-baseline.json'
        Invoke-Step 'Live k6 baseline smoke' {
            node .\dist\cli\run.js perf --url $LiveUrl --vus 1 --duration 1 --baseline $baseline --update-baseline
        }
        Invoke-Step 'Live k6 comparison smoke' {
            node .\dist\cli\run.js perf --url $LiveUrl --vus 1 --duration 1 --baseline $baseline
        }
    }
} finally {
    Pop-Location
}

"`nDetailed log: $log" | Tee-Object -FilePath $log -Append
if ($script:Failures -gt 0) {
    Write-Host "VALIDATION FAILED: $script:Failures step(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host 'VALIDATION PASSED: performance workflow hardening gates are green.' -ForegroundColor Green
