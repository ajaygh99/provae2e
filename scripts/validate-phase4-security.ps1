[CmdletBinding()]
param([switch]$Full)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path $repo 'artifacts\phase4-security-validation'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$log = Join-Path $artifactDirectory "security-validation-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
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
    "PROVA Phase 4.4 security validation`nRepository: $repo`nStarted: $(Get-Date -Format o)" |
        Tee-Object -FilePath $log
    Invoke-Step 'Focused ZAP and workflow tests' {
        npm test -- --runInBand --testPathPatterns='zap|security.test|zap-security-workflow'
    }
    Invoke-Step 'TypeScript typecheck' { npm run typecheck }
    Invoke-Step 'Zero-error lint' { npm run lint -- --quiet }
    Invoke-Step 'Production build' { npm run build }
    Invoke-Step 'Built security CLI discovery' { node .\dist\cli\run.js security --help }

    $smokeDirectory = Join-Path $artifactDirectory 'smoke'
    New-Item -ItemType Directory -Force -Path $smokeDirectory | Out-Null
    $zapReport = Join-Path $smokeDirectory 'zap.json'
    $smokeJson = @'
{"site":[{"alerts":[{"pluginid":"10020","alert":"Missing header","riskcode":"1","cweid":"693","instances":[{"uri":"https://example.test/?token=private","evidence":"token=private"}]}]}]}
'@
    [System.IO.File]::WriteAllText($zapReport, $smokeJson, [System.Text.UTF8Encoding]::new($false))
    Invoke-Step 'Deterministic security CLI smoke' {
        node .\dist\cli\run.js security `
            --report $zapReport `
            --target validation `
            --database (Join-Path $smokeDirectory 'zap.sqlite') `
            --minimum-risk HIGH `
            --maximum-findings 0 `
            --all-findings `
            --format json `
            --output (Join-Path $smokeDirectory 'prova-zap-report.json')
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
Write-Host 'VALIDATION PASSED: security workflow hardening gates are green.' -ForegroundColor Green
