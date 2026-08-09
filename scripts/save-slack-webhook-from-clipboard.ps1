[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$webhook = (Get-Clipboard -Raw).Trim()
if ($webhook -notmatch '^https://hooks\.slack\.com/services/[A-Za-z0-9/_-]+$') {
    throw 'Clipboard does not contain a valid Slack webhook. Copy the complete NEW webhook URL and run this script again.'
}

[Environment]::GetEnvironmentVariables('User').Keys |
    Where-Object { $_ -like 'https://hooks.slack.com/services/*' } |
    ForEach-Object { [Environment]::SetEnvironmentVariable([string]$_, $null, 'User') }

[Environment]::SetEnvironmentVariable('SLACK_RELEASE_WEBHOOK_URL', $webhook, 'User')
# Windows PowerShell 5.1 rejects an empty string for Set-Clipboard.
Set-Clipboard -Value '[cleared by ProvaE2E]'
$webhook = $null

Write-Host ''
Write-Host 'SUCCESS: New Slack webhook saved and clipboard cleared.' -ForegroundColor Green
Write-Host 'Tell Codex: Credentials configured.' -ForegroundColor Cyan
