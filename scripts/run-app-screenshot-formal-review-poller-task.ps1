[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$expectedFormalChatId = 'oc_a3d62e948296c31948f744f3db3758ad'
if (
  [Environment]::GetEnvironmentVariable('FEISHU_CHAT_ID', 'User') -cne
  $expectedFormalChatId
) {
  throw 'FEISHU_CHAT_ID does not match the explicitly confirmed formal chat'
}

# Temporary review gate: poll the formal group, but deliver the completed report
# to the test group. Reuse the formal cursor and deduplication files so that a
# reviewed release is not delivered again when normal formal mode resumes.
$env:AM_APP_SCREENSHOT_SOURCE_CHAT_ID = $expectedFormalChatId
$env:AM_APP_SCREENSHOT_REPORT_TARGET = 'TEST_GROUP_ONLY'
$env:AM_APP_SCREENSHOT_POLL_INTERVAL_MS = '1800000'
if ([string]::IsNullOrWhiteSpace($env:AM_APP_SCREENSHOT_INITIAL_LOOKBACK_MS)) {
  $env:AM_APP_SCREENSHOT_INITIAL_LOOKBACK_MS = '3600000'
}
$env:AM_APP_SCREENSHOT_POLL_STATE_PATH = Join-Path $projectRoot 'data-app-screenshot\formal-group-poller-state.json'
$env:AM_APP_SCREENSHOT_MESSAGE_ID_PATH = Join-Path $projectRoot 'data-app-screenshot\formal-group-processed-message-ids.json'
$runner = Join-Path $PSScriptRoot 'run-app-screenshot-test-poller-task.ps1'
& $runner
exit $LASTEXITCODE
