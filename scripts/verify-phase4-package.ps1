[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$artifactDirectory = Join-Path $repo 'artifacts\phase4-package'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null

Push-Location $repo
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw 'Production build failed before packaging.'
    }

    $packOutput = @(npm pack --json --ignore-scripts --pack-destination $artifactDirectory)
    if ($LASTEXITCODE -ne 0) {
        throw 'npm pack failed.'
    }
    $pack = (($packOutput -join "`n") | ConvertFrom-Json)[0]
    $tarball = Join-Path $artifactDirectory $pack.filename
    if (-not (Test-Path -LiteralPath $tarball -PathType Leaf)) {
        throw "Packed tarball was not created: $tarball"
    }

    $files = @(tar -tf $tarball)
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inspect the packed tarball.'
    }
    $required = @(
        'package/package.json',
        'package/dist/index.js',
        'package/dist/cli/run.js',
        'package/README.md',
        'package/CHANGELOG.md',
        'package/docs/PHASE4-BETA-GUIDE.md',
        'package/releases/v0.3.5-beta.1.md'
    )
    $missing = @($required | Where-Object { $files -notcontains $_ })
    if ($missing.Count -gt 0) {
        throw "Package is missing required files: $($missing -join ', ')"
    }

    $forbidden = @($files | Where-Object {
        $_ -match '^package/(tests?|artifacts|coverage|\.git)(/|$)' -or
        (($_ -match '(^|/)\.env($|\.)') -and ($_ -notmatch '\.example$')) -or
        $_ -match '\.(sqlite|log)$'
    })
    if ($forbidden.Count -gt 0) {
        throw "Package contains forbidden files: $($forbidden -join ', ')"
    }

    $hash = (Get-FileHash -LiteralPath $tarball -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = [ordered]@{
        schemaVersion = 1
        release = '0.3.5-beta.1'
        packageName = '@provae2e/cli'
        filename = $pack.filename
        sha256 = $hash
        sizeBytes = (Get-Item -LiteralPath $tarball).Length
        fileCount = $files.Count
        requiredFiles = $required
        forbiddenFiles = $forbidden
        publishPerformed = $false
        verifiedAt = (Get-Date -Format o)
    }
    $manifestPath = Join-Path $artifactDirectory 'package-integrity.json'
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Write-Host "PACKAGE VERIFIED: $($pack.filename)" -ForegroundColor Green
    Write-Host "SHA256: $hash"
    Write-Host "Manifest: $manifestPath"
} finally {
    Pop-Location
}
