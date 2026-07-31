[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$expectedFormalChatId = 'oc_a3d62e948296c31948f744f3db3758ad'
if (
  [Environment]::GetEnvironmentVariable('FEISHU_CHAT_ID', 'User') -cne
  $expectedFormalChatId
) {
  throw 'FEISHU_CHAT_ID does not match the explicitly confirmed formal chat'
}

$env:AM_APP_SCREENSHOT_REPORT_TARGET = 'FORMAL_GROUP'
$env:AM_APP_SCREENSHOT_FORMAL_SEND_ENABLED = '1'
$env:AM_APP_SCREENSHOT_FORMAL_CHAT_ID_CONFIRMATION = $expectedFormalChatId
$env:AM_APP_SCREENSHOT_POLL_INTERVAL_MS = '1800000'
$env:AM_APP_SCREENSHOT_INITIAL_LOOKBACK_MS = '3600000'
$runner = Join-Path $PSScriptRoot 'run-app-screenshot-test-poller-task.ps1'
& $runner
exit $LASTEXITCODE
