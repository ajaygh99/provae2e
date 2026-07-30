[CmdletBinding()]
param(
    [switch]$FocusedOnly,
    [switch]$SkipSurfaceGates
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path $repo 'artifacts\phase4-beta-validation'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $artifactDirectory "phase4-beta-$timestamp.log"
$manifest = Join-Path $artifactDirectory "phase4-beta-$timestamp.json"
$script:Failures = 0
$script:Results = @()

$credentialVariables = @(
    'ANTHROPIC_API_KEY', 'BROWSERSTACK_ACCESS_KEY', 'BROWSERSTACK_USERNAME',
    'FIGMA_ACCESS_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'JIRA_ACCESS_TOKEN',
    'JIRA_API_TOKEN', 'OPENAI_API_KEY', 'SAUCE_ACCESS_KEY', 'SAUCE_USERNAME',
    'SLACK_RELEASE_WEBHOOK_URL'
)
$savedEnvironment = @{}
$savedVitestMaxThreads = [Environment]::GetEnvironmentVariable('VITEST_MAX_THREADS', 'Process')

function Invoke-Step {
    param([string]$Name, [scriptblock]$Command)
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $output = Join-Path $artifactDirectory ("step-" + [guid]::NewGuid().ToString('N') + '.tmp')
    "`n=== $Name ===" | Tee-Object -FilePath $log -Append
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = 0
    & $Command *> $output
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previous
    Get-Content -LiteralPath $output | Tee-Object -FilePath $log -Append
    Remove-Item -LiteralPath $output -Force
    $watch.Stop()
    $passed = $exitCode -eq 0
    $seconds = [math]::Round($watch.Elapsed.TotalSeconds, 1)
    $script:Results += [ordered]@{
        name = $Name
        passed = $passed
        durationSeconds = $seconds
    }
    if ($passed) {
        "PASS: $Name (${seconds}s)" | Tee-Object -FilePath $log -Append
    } else {
        "FAIL: $Name (${seconds}s)" | Tee-Object -FilePath $log -Append
        $script:Failures++
    }
}

foreach ($name in $credentialVariables) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
[Environment]::SetEnvironmentVariable('VITEST_MAX_THREADS', '1', 'Process')

Push-Location $repo
try {
    "PROVA Phase 4 beta token-free validation`nRepository: $repo`nStarted: $(Get-Date -Format o)" |
        Tee-Object -FilePath $log
    if (-not $SkipSurfaceGates) {
        Invoke-Step 'Studio workflow validation' {
            powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-studio.ps1
        }
        Invoke-Step 'Figma workflow validation' {
            powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-figma.ps1
        }
        Invoke-Step 'Performance workflow validation' {
            powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-performance.ps1
        }
        Invoke-Step 'Security workflow validation' {
            powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-security.ps1
        }
        Invoke-Step 'Analytics workflow validation' {
            powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-analytics.ps1
        }
        Invoke-Step 'Native mobile validation' {
            powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-native.ps1
        }
        Invoke-Step 'Integration validation' {
            npm run validate:integrations
        }
    }
    if (-not $FocusedOnly) {
        Invoke-Step 'Complete Jest regression suite' { npm run test:ci }
        Invoke-Step 'TypeScript typecheck' { npm run typecheck }
        Invoke-Step 'Zero-error lint' { npm run lint -- --quiet }
        Invoke-Step 'Production build' { npm run build }
    }
} finally {
    Pop-Location
    foreach ($name in $credentialVariables) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
    [Environment]::SetEnvironmentVariable('VITEST_MAX_THREADS', $savedVitestMaxThreads, 'Process')
}

$summary = [ordered]@{
    schemaVersion = 1
    release = '0.3.5-beta.1'
    tokenFree = $true
    focusedOnly = [bool]$FocusedOnly
    surfaceGatesSkipped = [bool]$SkipSurfaceGates
    completedAt = (Get-Date -Format o)
    passed = $script:Failures -eq 0
    credentialVariablesSuppressed = $credentialVariables
    results = $script:Results
    log = [IO.Path]::GetFileName($log)
}
$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding UTF8

"`nDetailed log: $log`nManifest: $manifest" | Tee-Object -FilePath $log -Append
if ($script:Failures -gt 0) {
    Write-Host "VALIDATION FAILED: $script:Failures step(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host 'VALIDATION PASSED: Phase 4 beta token-free gates are green.' -ForegroundColor Green
