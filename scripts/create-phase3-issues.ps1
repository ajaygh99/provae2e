# PowerShell wrapper for Phase 3 issue creation
# Usage: .\scripts\create-phase3-issues.ps1

$ErrorActionPreference = "Stop"

Write-Host "🚀 PROVA Phase 3 Issue Creation Script" -ForegroundColor Cyan
Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n" -ForegroundColor Gray

# Set GitHub token from environment
if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
    Write-Host "⚠️  GitHub token not found in environment." -ForegroundColor Yellow
    Write-Host "Set GH_TOKEN or GITHUB_TOKEN and retry." -ForegroundColor Yellow
    exit 1
}

$token = $env:GH_TOKEN ?? $env:GITHUB_TOKEN
Write-Host "✅ Using GitHub token from environment`n" -ForegroundColor Green

# Verify Python
if (-not (Get-Command python3 -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Python 3 not found. Install Python and retry." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Python 3 available`n" -ForegroundColor Green

# Run the issue creation script
$scriptPath = Join-Path $PSScriptRoot "create-phase3-studio-issues.py"

Write-Host "Running issue creation script..." -ForegroundColor Cyan
python3 $scriptPath

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Issue creation failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "`n✨ Phase 3 Studio issues created successfully!" -ForegroundColor Green
