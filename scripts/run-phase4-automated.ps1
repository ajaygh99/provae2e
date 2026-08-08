[CmdletBinding()]
param(
    [switch]$Configure,
    [switch]$OpenReport,
    [ValidateNotNullOrEmpty()][int[]]$Scenarios = @(1, 2, 3, 4, 5, 6, 7, 8),
    [ValidateSet("Chromium", "Firefox", "Edge", "WebKit")][string[]]$Browser = @("Chromium"),
    [string]$AvdName = "Pixel_5",
    [int]$AppiumPort = 4723,
    [string]$EvidenceRoot = ".\evidence\phase-4-automated"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot
$SettingsDir = Join-Path $env:LOCALAPPDATA "ProvaE2E"
$SettingsFile = Join-Path $SettingsDir "phase4-settings.clixml"

function ConvertFrom-ProvaSecureString([Security.SecureString]$Value) {
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer) }
}

function Normalize-JiraUrl([string]$Value) {
    $Normalized = $Value.Trim().Trim('"').Trim("'").Trim().TrimEnd('/')
    while ($Normalized -match '^https://https://') { $Normalized = $Normalized.Substring(8) }
    if ($Normalized -notmatch '^https://') { $Normalized = "https://$Normalized" }
    $Uri = $null
    if (-not [Uri]::TryCreate($Normalized, [UriKind]::Absolute, [ref]$Uri) -or
        $Uri.Scheme -ne "https" -or $Uri.Host -in @("https", "http")) {
        throw "Jira URL must be a valid HTTPS site URL, for example https://company.atlassian.net."
    }
    return $Normalized
}

function Save-ProvaSettings {
    New-Item -ItemType Directory -Force -Path $SettingsDir | Out-Null
    $JiraUrl = Normalize-JiraUrl (Read-Host "Jira URL (example: https://company.atlassian.net)")
    $JiraEmail = (Read-Host "Jira account email").Trim()
    $JiraToken = Read-Host "Jira API token" -AsSecureString
    $SlackWebhook = Read-Host "Slack incoming-webhook URL" -AsSecureString
    [pscustomobject]@{
        JiraUrl = $JiraUrl
        JiraEmail = $JiraEmail
        JiraToken = $JiraToken
        SlackWebhook = $SlackWebhook
    } | Export-Clixml -Path $SettingsFile
    # Use the newly entered values for this run even if stale process variables exist.
    $env:JIRA_URL = $JiraUrl
    $env:JIRA_EMAIL = $JiraEmail
    $env:JIRA_API_TOKEN = ConvertFrom-ProvaSecureString $JiraToken
    $env:SLACK_WEBHOOK_URL = ConvertFrom-ProvaSecureString $SlackWebhook
    Write-Host "Encrypted settings saved for this Windows user: $SettingsFile" -ForegroundColor Green
}

function Import-ProvaSettings {
    # The encrypted profile is authoritative. This prevents stale variables in a
    # long-lived PowerShell window from overriding corrected saved credentials.
    if (-not (Test-Path $SettingsFile)) {
        if ($env:JIRA_URL -and $env:JIRA_EMAIL -and $env:JIRA_API_TOKEN -and $env:SLACK_WEBHOOK_URL) {
            $env:JIRA_URL = Normalize-JiraUrl $env:JIRA_URL
            return
        }
        throw "Credentials are not configured. First run: .\scripts\run-phase4-automated.ps1 -Configure"
    }
    $Saved = Import-Clixml -Path $SettingsFile
    $NormalizedJiraUrl = Normalize-JiraUrl $Saved.JiraUrl
    if ($NormalizedJiraUrl -ne $Saved.JiraUrl) {
        $Saved.JiraUrl = $NormalizedJiraUrl
        $Saved | Export-Clixml -Path $SettingsFile
        Write-Host "Corrected and resaved the Jira URL in the encrypted settings profile." -ForegroundColor Yellow
    }
    $env:JIRA_URL = $NormalizedJiraUrl
    $env:JIRA_EMAIL = $Saved.JiraEmail
    $env:JIRA_API_TOKEN = ConvertFrom-ProvaSecureString $Saved.JiraToken
    $env:SLACK_WEBHOOK_URL = ConvertFrom-ProvaSecureString $Saved.SlackWebhook
}

function Wait-HttpReady([string]$Uri, [int]$Seconds) {
    $Deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try { Invoke-RestMethod -Uri $Uri -TimeoutSec 3 | Out-Null; return $true } catch { Start-Sleep -Seconds 2 }
    } while ((Get-Date) -lt $Deadline)
    return $false
}

function Start-AndroidIfNeeded([string]$RunDir) {
    $Sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
    $Adb = Join-Path $Sdk "platform-tools\adb.exe"
    $Emulator = Join-Path $Sdk "emulator\emulator.exe"
    if (-not (Test-Path $Adb) -or -not (Test-Path $Emulator)) { throw "Android SDK adb/emulator was not found at $Sdk" }
    $env:ANDROID_HOME = $Sdk
    $env:ANDROID_SDK_ROOT = $Sdk
    $env:Path = "$(Split-Path $Adb);$(Split-Path $Emulator);$env:Path"
    $Connected = @(& $Adb devices | Select-String '^emulator-\d+\s+device')
    if ($Connected.Count -gt 0) { return $false }
    $SelectedAvd = $AvdName
    $Avds = @(& $Emulator -list-avds)
    if ($Avds -notcontains $SelectedAvd) {
        if ($Avds.Count -eq 0) { throw "No Android Virtual Device exists. Create an AVD in Android Studio first." }
        $SelectedAvd = $Avds[0].Trim()
    }
    Start-Process -FilePath $Emulator -ArgumentList @("-avd", $SelectedAvd, "-no-snapshot-load", "-gpu", "swiftshader_indirect") -RedirectStandardOutput (Join-Path $RunDir "emulator.log") -RedirectStandardError (Join-Path $RunDir "emulator-error.log") | Out-Null
    & $Adb wait-for-device
    $Deadline = (Get-Date).AddMinutes(4)
    do {
        $Booted = (& $Adb shell getprop sys.boot_completed 2>$null).Trim()
        if ($Booted -eq "1") { return $true }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $Deadline)
    throw "Android emulator did not complete boot within four minutes."
}

if ($Configure) { Save-ProvaSettings }
Import-ProvaSettings

$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDir = Join-Path $EvidenceRoot $RunId
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
$RunDir = (Resolve-Path $RunDir).Path
$StartedAppium = $null
$StartedEmulator = $false
$Results = @()
$Scenarios = @($Scenarios | Sort-Object -Unique)
if (@($Scenarios | Where-Object { $_ -lt 1 -or $_ -gt 8 }).Count -gt 0) { throw "Scenarios must be between 1 and 8." }

try {
    foreach ($Command in @("node", "npm", "gh", "appium")) {
        if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "Required command '$Command' is not installed or not on PATH." }
    }
    & gh auth status 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI is not authenticated." }
    foreach ($Fixture in @("openapi-sample.json", "openapi-server.js", "zap-sample-report.json", "phase4-web-server.js")) {
        if (-not (Test-Path (Join-Path $RepoRoot "test-fixtures\$Fixture"))) { throw "Missing test fixture: $Fixture" }
    }

    Write-Host "Building the current CLI..." -ForegroundColor Cyan
    & npm run build 2>&1 | Tee-Object -FilePath (Join-Path $RunDir "build.log")
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }

    if ($Scenarios -contains 6) {
        $StartedEmulator = Start-AndroidIfNeeded $RunDir
        if (-not (Wait-HttpReady "http://127.0.0.1:$AppiumPort/status" 3)) {
            $AppiumCommand = (Get-Command appium.cmd -ErrorAction SilentlyContinue)
            if (-not $AppiumCommand) { $AppiumCommand = Get-Command appium }
            $StartedAppium = Start-Process -FilePath $AppiumCommand.Source -ArgumentList @("--port", "$AppiumPort") -RedirectStandardOutput (Join-Path $RunDir "appium.log") -RedirectStandardError (Join-Path $RunDir "appium-error.log") -PassThru -WindowStyle Hidden
            if (-not (Wait-HttpReady "http://127.0.0.1:$AppiumPort/status" 45)) { throw "Appium did not become ready on port $AppiumPort." }
        }
    }

    $Commit = (& git rev-parse --short HEAD).Trim()
    foreach ($Number in $Scenarios) {
        Write-Host "Running Phase 4 Scenario $Number..." -ForegroundColor Cyan
        if ($Number -eq 1) {
            $ScenarioOneRoot = Join-Path $RunDir "scenario-1"
            & (Join-Path $PSScriptRoot "run-phase4-scenario1.ps1") -EvidenceRoot $ScenarioOneRoot -Browser $Browser -ReturnToOrchestrator
            $Evidence = Get-ChildItem $ScenarioOneRoot -Filter "scenario-1-result.json" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if (-not $Evidence) { throw "Scenario 1 did not produce evidence JSON." }
            $Result = Get-Content $Evidence.FullName -Raw | ConvertFrom-Json
            $RelativeEvidence = $Evidence.FullName.Substring($RunDir.Length + 1).Replace('\', '/')
            $Results += [pscustomobject]@{ Scenario = 1; Result = [string]$Result.result; Details = [string]$Result.details; Evidence = $RelativeEvidence }
            continue
        }
        $Before = @(Get-ChildItem $RunDir -Filter "scenario-$Number-*.json" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
        $Arguments = @{ Scenario = "$Number"; TargetCommit = $Commit; EvidenceDir = $RunDir }
        if ($Number -eq 7) { $Arguments.PostSlack = $true }
        & (Join-Path $PSScriptRoot "phase-4-beta-validation.ps1") @Arguments
        $Evidence = Get-ChildItem $RunDir -Filter "scenario-$Number-*.json" | Where-Object { $_.FullName -notin $Before } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $Evidence) { throw "Scenario $Number did not produce evidence JSON." }
        $Result = Get-Content $Evidence.FullName -Raw | ConvertFrom-Json
        $Results += [pscustomobject]@{ Scenario = [int]$Number; Result = [string]$Result.Result; Details = [string]$Result.Details; Evidence = $Evidence.Name }
    }
}
catch {
    $Results += [pscustomobject]@{ Scenario = 0; Result = "FAILED"; Details = $_.Exception.Message; Evidence = "" }
}
finally {
    if ($StartedAppium -and -not $StartedAppium.HasExited) { & taskkill.exe /PID $StartedAppium.Id /T /F 2>$null | Out-Null }
    if ($StartedEmulator) {
        $AdbPath = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
        if (Test-Path $AdbPath) { & $AdbPath emu kill 2>$null | Out-Null }
    }
}

$Passed = @($Results | Where-Object Result -eq "PASS").Count
$Failed = @($Results | Where-Object Result -ne "PASS").Count
$Rows = foreach ($Item in $Results) {
    $StatusClass = if ($Item.Result -eq "PASS") { "pass" } else { "fail" }
    $Details = [Net.WebUtility]::HtmlEncode($Item.Details)
    $EvidenceLink = if ($Item.Evidence) { "<a href='./$($Item.Evidence)'>$($Item.Evidence)</a>" } else { "-" }
    "<tr><td>$($Item.Scenario)</td><td class='$StatusClass'>$($Item.Result)</td><td>$Details</td><td>$EvidenceLink</td></tr>"
}
$Overall = if ($Failed -eq 0 -and $Results.Count -eq $Scenarios.Count) { "PASS" } else { "FAIL" }
$Html = @"
<!doctype html><html><head><meta charset="utf-8"><title>ProvaE2E Phase 4 Report</title>
<style>body{font-family:Segoe UI,Arial;margin:36px;color:#14213d}table{border-collapse:collapse;width:100%}th,td{padding:12px;border:1px solid #dbe2ef;text-align:left}th{background:#111b3d;color:white}.pass{color:#087f23;font-weight:700}.fail{color:#c1121f;font-weight:700}.summary{padding:18px;background:#f4f6fb;border-radius:10px;margin-bottom:20px}</style></head>
<body><h1>ProvaE2E Phase 4 - Scenarios $($Scenarios -join ', ')</h1><div class="summary"><b>Overall: $Overall</b><br>Passed: $Passed &nbsp; Failed: $Failed<br>Run: $RunId</div>
<table><thead><tr><th>Scenario</th><th>Status</th><th>Details</th><th>Evidence</th></tr></thead><tbody>$($Rows -join "`n")</tbody></table></body></html>
"@
$ReportPath = Join-Path $RunDir "phase4-report.html"
Set-Content -Path $ReportPath -Value $Html -Encoding UTF8
[pscustomobject]@{ RunId = $RunId; Overall = $Overall; Passed = $Passed; Failed = $Failed; Results = $Results } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $RunDir "phase4-summary.json") -Encoding UTF8
Write-Host "Phase 4 result: $Overall ($Passed passed, $Failed failed)" -ForegroundColor $(if ($Overall -eq "PASS") { "Green" } else { "Red" })
Write-Host "HTML report: $ReportPath"
if ($OpenReport) { Start-Process $ReportPath }
if ($Overall -ne "PASS") { exit 1 }
