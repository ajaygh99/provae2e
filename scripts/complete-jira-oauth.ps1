[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$redirectUri = 'http://localhost:4318/oauth/jira/callback'
$cloudId = 'a2516525-c3ff-4812-8638-0d346d21ef25'
$clientId = [Environment]::GetEnvironmentVariable('JIRA_CLIENT_ID', 'User')
$clientSecret = [Environment]::GetEnvironmentVariable('JIRA_CLIENT_SECRET', 'User')

if ([string]::IsNullOrWhiteSpace($clientId) -or [string]::IsNullOrWhiteSpace($clientSecret)) {
    throw 'Jira Client ID or Client Secret is missing. Run configure-scenario7-credentials.ps1 first.'
}

$stateBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($stateBytes)
$state = [Convert]::ToBase64String($stateBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$scope = [Uri]::EscapeDataString('read:jira-work write:jira-work offline_access')
$authorizationUrl = 'https://auth.atlassian.com/authorize' +
    '?audience=api.atlassian.com' +
    '&client_id=' + [Uri]::EscapeDataString($clientId) +
    '&scope=' + $scope +
    '&redirect_uri=' + [Uri]::EscapeDataString($redirectUri) +
    '&state=' + [Uri]::EscapeDataString($state) +
    '&response_type=code&prompt=consent'

$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:4318/')
$listener.Start()

Write-Host 'Opening Atlassian authorization in your browser...' -ForegroundColor Cyan
Write-Host 'Select ajaygh99.atlassian.net and click Accept.' -ForegroundColor Yellow
Start-Process $authorizationUrl

try {
    $pending = $listener.GetContextAsync()
    if (-not $pending.Wait([TimeSpan]::FromMinutes(5))) {
        throw 'Timed out waiting for Atlassian authorization. Run the script again.'
    }
    $context = $pending.Result
    $request = $context.Request
    $response = $context.Response

    if ($request.Url.AbsolutePath -ne '/oauth/jira/callback') {
        throw 'Unexpected callback path.'
    }
    if ($request.QueryString['state'] -ne $state) {
        throw 'OAuth state validation failed. Authorization was cancelled for safety.'
    }
    $code = $request.QueryString['code']
    if ([string]::IsNullOrWhiteSpace($code)) {
        throw 'Atlassian did not return an authorization code.'
    }

    $tokenBody = @{
        grant_type = 'authorization_code'
        client_id = $clientId
        client_secret = $clientSecret
        code = $code
        redirect_uri = $redirectUri
    } | ConvertTo-Json -Compress

    $tokens = Invoke-RestMethod -Uri 'https://auth.atlassian.com/oauth/token' -Method Post `
        -ContentType 'application/json' -Body $tokenBody -TimeoutSec 30
    if ([string]::IsNullOrWhiteSpace($tokens.access_token)) {
        throw 'Atlassian token response did not contain an access token.'
    }

    [Environment]::SetEnvironmentVariable('JIRA_ACCESS_TOKEN', [string]$tokens.access_token, 'User')
    if (-not [string]::IsNullOrWhiteSpace($tokens.refresh_token)) {
        [Environment]::SetEnvironmentVariable('JIRA_REFRESH_TOKEN', [string]$tokens.refresh_token, 'User')
    }
    [Environment]::SetEnvironmentVariable('JIRA_BASE_URL', "https://api.atlassian.com/ex/jira/$cloudId", 'User')

    $html = '<html><body><h2>Jira authorization succeeded.</h2><p>You may close this tab and return to PowerShell.</p></body></html>'
    $bytes = [Text.Encoding]::UTF8.GetBytes($html)
    $response.ContentType = 'text/html; charset=utf-8'
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.Close()

    Write-Host 'SUCCESS: Jira OAuth access token saved securely.' -ForegroundColor Green
}
finally {
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
    $clientSecret = $null
}
