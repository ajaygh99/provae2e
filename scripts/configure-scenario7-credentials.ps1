[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Read-SecretText {
    param([Parameter(Mandatory)][string]$Prompt)

    $secure = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Set-UserVariable {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Value
    )

    [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
}

Write-Host ''
Write-Host 'ProvaE2E Scenario 7 credential setup' -ForegroundColor Cyan
Write-Host 'Secrets remain hidden while you type.' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'IMPORTANT: Revoke the Slack webhook exposed earlier and create a NEW webhook first.' -ForegroundColor Yellow
Write-Host ''

$clientId = (Read-Host 'Paste Jira OAuth app Client ID').Trim()
if ($clientId.Length -lt 10) {
    throw 'Jira Client ID appears invalid. Copy it from ProvaE2E Beta > Settings.'
}

$clientSecret = Read-SecretText 'Paste Jira OAuth app Client Secret'
if ([string]::IsNullOrWhiteSpace($clientSecret)) {
    throw 'Jira Client Secret cannot be empty.'
}

$slackWebhook = Read-SecretText 'Paste the NEW Slack webhook'
if ($slackWebhook -notmatch '^https://hooks\.slack\.com/services/[A-Za-z0-9/_-]+$') {
    throw 'Slack webhook format is invalid. It must begin with https://hooks.slack.com/services/.'
}

# Remove the earlier accidental entry where the webhook itself became a variable name.
[Environment]::GetEnvironmentVariables('User').Keys |
    Where-Object { $_ -like 'https://hooks.slack.com/services/*' } |
    ForEach-Object { [Environment]::SetEnvironmentVariable([string]$_, $null, 'User') }

Set-UserVariable 'JIRA_CLIENT_ID' $clientId
Set-UserVariable 'JIRA_CLIENT_SECRET' $clientSecret
Set-UserVariable 'JIRA_SITE_URL' 'https://ajaygh99.atlassian.net'
Set-UserVariable 'JIRA_CLOUD_ID' 'a2516525-c3ff-4812-8638-0d346d21ef25'
Set-UserVariable 'JIRA_BASE_URL' 'https://api.atlassian.com/ex/jira/a2516525-c3ff-4812-8638-0d346d21ef25'
Set-UserVariable 'JIRA_PROJECT_KEY' 'DEMO'
Set-UserVariable 'JIRA_TEST_ISSUE_KEY' 'DEMO-5'
Set-UserVariable 'SLACK_RELEASE_WEBHOOK_URL' $slackWebhook

$clientSecret = $null
$slackWebhook = $null

Write-Host ''
Write-Host 'SUCCESS: Scenario 7 settings saved.' -ForegroundColor Green
Write-Host '  Jira site:  https://ajaygh99.atlassian.net'
Write-Host '  Project:    DEMO'
Write-Host '  Test issue: DEMO-5'
Write-Host '  Jira secret: saved (hidden)'
Write-Host '  Slack webhook: saved (hidden)'
Write-Host ''
Write-Host 'Close this PowerShell window, then tell Codex: Credentials configured.' -ForegroundColor Cyan
