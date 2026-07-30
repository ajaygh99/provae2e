[CmdletBinding()]
param([switch]$Full)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
    npm test -- --runInBand --testPathPatterns='native-appium|native-device-farm|native-test-data'
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm run lint -- --quiet
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    node .\dist\cli\run.js native --help
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($Full) {
        npm test -- --runInBand --forceExit
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        npm pack --dry-run
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
} finally {
    Pop-Location
}
