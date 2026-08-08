[CmdletBinding()]
param(
    [int]$Port = 4173,
    [string]$EvidenceRoot = ".\evidence\phase-4-scenario1",
    [ValidateSet("Chromium", "Firefox", "Edge", "WebKit")][string[]]$Browser = @("Chromium"),
    [switch]$ReturnToOrchestrator,
    [switch]$OpenReport
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot
$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDir = Join-Path $EvidenceRoot $RunId
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
$RunDir = (Resolve-Path $RunDir).Path
$BaseUrl = "http://127.0.0.1:$Port"
$StudioProcess = $null
$Result = $null
$BrowserResults = @()

function Wait-Studio([string]$Uri, [int]$Seconds) {
    $Deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $Response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3
            if ($Response.StatusCode -eq 200 -and $Response.Content -match 'PROVA Studio') { return $true }
        } catch { Start-Sleep -Seconds 2 }
    } while ((Get-Date) -lt $Deadline)
    return $false
}

try {
    foreach ($Command in @("node", "npm")) {
        if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "Required command '$Command' is not available." }
    }
    if (-not (Test-Path ".\node_modules\@playwright\test")) { throw "Playwright is not installed. Run npm install first." }

    Write-Host "Validating and building PROVA Studio..." -ForegroundColor Cyan
    & npm --prefix .\studio test 2>&1 | Tee-Object -FilePath (Join-Path $RunDir "studio-tests.log")
    if ($LASTEXITCODE -ne 0) { throw "Studio unit tests failed." }
    & npm --prefix .\studio run build 2>&1 | Tee-Object -FilePath (Join-Path $RunDir "studio-build.log")
    if ($LASTEXITCODE -ne 0) { throw "Studio production build failed." }

    if (-not (Wait-Studio "$BaseUrl/dashboard" 2)) {
        $StudioProcess = Start-Process npm.cmd -ArgumentList @("--prefix", ".\studio", "run", "dev", "--", "--host", "127.0.0.1", "--port", "$Port", "--strictPort") -RedirectStandardOutput (Join-Path $RunDir "studio-server.log") -RedirectStandardError (Join-Path $RunDir "studio-server-error.log") -PassThru -WindowStyle Hidden
        if (-not (Wait-Studio "$BaseUrl/dashboard" 45)) { throw "Studio did not become ready at $BaseUrl." }
    }

    foreach ($BrowserName in @($Browser | Sort-Object -Unique)) {
        $BrowserKey = $BrowserName.ToLowerInvariant()
        Write-Host "Running Phase 4 Scenario 1 in $BrowserName..." -ForegroundColor Cyan
        & node .\scripts\scenario1-browser-proof.js $BaseUrl $RunDir $BrowserName 2>&1 | Tee-Object -FilePath (Join-Path $RunDir "scenario-1-$BrowserKey-browser.log")
        $BrowserResult = Get-Content (Join-Path $RunDir "scenario-1-$BrowserKey-result.json") -Raw | ConvertFrom-Json
        $BrowserResults += $BrowserResult
        if ($LASTEXITCODE -ne 0 -or $BrowserResult.result -ne "PASS") { throw "Scenario 1 $BrowserName automation failed: $($BrowserResult.details)" }
    }
    $Result = [pscustomobject]@{
        scenario = 1
        result = "PASS"
        details = "Studio created, saved, and executed a browser test successfully in: $($BrowserResults.browser -join ', ')."
        browser = $BrowserResults.browser -join ", "
        selector = $BrowserResults[0].selector
        browsers = $BrowserResults
    }
    $Result | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $RunDir "scenario-1-result.json") -Encoding UTF8
}
catch {
    if (-not $Result) {
        $Result = [pscustomobject]@{ scenario = 1; result = "FAILED"; details = $_.Exception.Message; browser = "Chromium" }
        $Result | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $RunDir "scenario-1-result.json") -Encoding UTF8
    }
}
finally {
    if ($StudioProcess -and -not $StudioProcess.HasExited) { & taskkill.exe /PID $StudioProcess.Id /T /F 2>$null | Out-Null }
}

$StatusClass = if ($Result.result -eq "PASS") { "pass" } else { "fail" }
$Details = [Net.WebUtility]::HtmlEncode([string]$Result.details)
$Selector = if ($Result.PSObject.Properties.Name -contains "selector") { [Net.WebUtility]::HtmlEncode([string]$Result.selector) } else { "-" }
$BrowserRows = foreach ($BrowserResult in $BrowserResults) {
    $Key = ([string]$BrowserResult.browser).ToLowerInvariant()
    $RowClass = if ($BrowserResult.result -eq "PASS") { "pass" } else { "fail" }
    "<tr><td>$($BrowserResult.browser)</td><td class='$RowClass'>$($BrowserResult.result)</td><td><a href='./scenario-1-$Key-result.json'>JSON</a></td><td><a href='./scenario-1-$Key-test-saved.png'>Saved</a> | <a href='./scenario-1-$Key-pass.png'>Execution</a></td></tr>"
}
$Html = @"
<!doctype html><html><head><meta charset="utf-8"><title>ProvaE2E Scenario 1 Report</title><style>body{font-family:Segoe UI,Arial;margin:36px;color:#14213d}.card{padding:22px;border:1px solid #dbe2ef;border-radius:12px}.pass{color:#087f23}.fail{color:#c1121f}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{padding:10px;border:1px solid #dbe2ef;text-align:left}</style></head><body><h1>ProvaE2E Phase 4 - Scenario 1</h1><div class="card"><h2 class="$StatusClass">$($Result.result)</h2><p>$Details</p><p><b>Browsers:</b> $($Result.browser)</p><p><b>Selector:</b> <code>$Selector</code></p><p><a href="./scenario-1-result.json">Combined JSON evidence</a></p></div><table><thead><tr><th>Browser</th><th>Status</th><th>Result</th><th>Screenshots</th></tr></thead><tbody>$($BrowserRows -join "`n")</tbody></table></body></html>
"@
$ReportPath = Join-Path $RunDir "scenario-1-report.html"
Set-Content -Path $ReportPath -Value $Html -Encoding UTF8
Write-Host "Scenario 1 result: $($Result.result)" -ForegroundColor $(if ($Result.result -eq "PASS") { "Green" } else { "Red" })
Write-Host "HTML report: $ReportPath"
if ($OpenReport) { Start-Process $ReportPath }
if ($Result.result -ne "PASS" -and -not $ReturnToOrchestrator) { exit 1 }
