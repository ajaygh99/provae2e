# Show Phase 3 Live Dashboards
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/show-phase3-dashboards.ps1

function Show-ProvaeDashboards {
    param(
        [string]$ProjectRoot = (Get-Item (Split-Path -Parent $PSCommandPath)).Parent.FullName
    )

    Write-Host "Opening Phase 3 dashboards..." -ForegroundColor Cyan

    $dashboards = @(
        @{
            Name = "LIVE-PROJECT-DASHBOARD.html"
            Path = Join-Path $ProjectRoot "LIVE-PROJECT-DASHBOARD.html"
            Description = "Main project overview"
        },
        @{
            Name = "LIVE-PROJECT-DASHBOARD-UPDATED.html"
            Path = Join-Path $ProjectRoot "LIVE-PROJECT-DASHBOARD-UPDATED.html"
            Description = "Phase 3 live progress dashboard"
        }
    )

    foreach ($dash in $dashboards) {
        Write-Host "`nChecking: $($dash.Name)" -ForegroundColor Yellow

        if (Test-Path $dash.Path) {
            Write-Host "  Found: $($dash.Description)" -ForegroundColor Green
            Write-Host "  Opening: $($dash.Path)" -ForegroundColor Cyan

            Start-Process -FilePath $dash.Path

            Start-Sleep -Seconds 2
        } else {
            Write-Host "  ERROR: File not found at $($dash.Path)" -ForegroundColor Red
        }
    }

    Write-Host "`nOK: Dashboards opened in default browser" -ForegroundColor Green
}

# Run the function
Show-ProvaeDashboards

Write-Host "`nTip: Use these dashboards for real-time Phase 3 progress tracking" -ForegroundColor Cyan
