[CmdletBinding()]
param([switch]$Full)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path $repo 'artifacts\phase4-studio-validation'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $artifactDirectory "studio-validation-$stamp.log"
$script:Failures = 0

function Invoke-ValidationStep {
    param([string]$Name, [scriptblock]$Command)
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    "`n=== $Name ===" | Tee-Object -FilePath $log -Append
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $stepOutput = "$log.step-output.tmp"
    & $Command *> $stepOutput
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    Get-Content -LiteralPath $stepOutput | Tee-Object -FilePath $log -Append
    Remove-Item -LiteralPath $stepOutput -Force
    $watch.Stop()
    $seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1)
    if ($exitCode -ne 0) {
        "FAIL: $Name (${seconds}s)" | Tee-Object -FilePath $log -Append
        $script:Failures++
    } else {
        "PASS: $Name (${seconds}s)" | Tee-Object -FilePath $log -Append
    }
}

Push-Location $repo
try {
    "PROVA Studio Phase 4.1 validation`nRepository: $repo`nFull: $Full`nStarted: $(Get-Date -Format o)" |
        Tee-Object -FilePath $log
    Invoke-ValidationStep 'Root typecheck' { npm run typecheck }
    Invoke-ValidationStep 'Root Studio integration tests' { npm test -- --runInBand tests/studio }
    Invoke-ValidationStep 'Root build' { npm run build }
    Invoke-ValidationStep 'Studio lint' { npm --prefix .\studio run lint }
    Invoke-ValidationStep 'Studio typecheck' { npm --prefix .\studio run typecheck }
    Invoke-ValidationStep 'Studio tests' { npm --prefix .\studio test }
    Invoke-ValidationStep 'Studio production build' { npm --prefix .\studio run build }
    Invoke-ValidationStep 'Built Studio CLI discovery' { node .\dist\cli\run.js studio --help }
    if ($Full) {
        Invoke-ValidationStep 'Complete root regression suite' { npm test -- --runInBand }
        Invoke-ValidationStep 'Root lint' { npm run lint }
    }
} finally {
    Pop-Location
}

"`nDetailed log: $log" | Tee-Object -FilePath $log -Append
if ($script:Failures -gt 0) {
    Write-Host "VALIDATION FAILED: $script:Failures step(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host 'VALIDATION PASSED: every requested step completed.' -ForegroundColor Green
