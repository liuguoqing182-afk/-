[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pollerPath = Join-Path $projectRoot 'src\feishu-history-poller.mjs'
$taskLogPath = Join-Path $projectRoot 'feishu-history-poller-task.log'
$stdoutPath = Join-Path $projectRoot 'feishu-history-poller.stdout.log'
$stderrPath = Join-Path $projectRoot 'feishu-history-poller.stderr.log'

function Write-TaskLog([string]$Message) {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $taskLogPath -Value "[$timestamp] $Message" -Encoding UTF8
}

try {
  foreach ($name in @(
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_CHAT_ID',
    'FEISHU_TEST_CHAT_ID',
    'AM_INSPECT_UID'
  )) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if ([string]::IsNullOrWhiteSpace($value)) {
      throw "Required user environment variable is missing: $name"
    }
    Set-Item -LiteralPath "Env:$name" -Value $value
  }

  if ($env:FEISHU_CHAT_ID -eq $env:FEISHU_TEST_CHAT_ID) {
    throw 'FEISHU_TEST_CHAT_ID must be different from FEISHU_CHAT_ID'
  }

  foreach ($name in @(
    'AM_PUBLISH_SETTLE_MS',
    'AM_INSPECT_DATA_DIR',
    'FEISHU_HISTORY_POLL_INTERVAL_MS',
    'FEISHU_HISTORY_INITIAL_LOOKBACK_MS',
    'FEISHU_HISTORY_OVERLAP_MS',
    'FEISHU_HISTORY_POLL_STATE_PATH',
    'FEISHU_HISTORY_MESSAGE_ID_STATE_PATH',
    'FEISHU_HISTORY_REPORT_OUTBOX_PATH'
  )) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if (![string]::IsNullOrWhiteSpace($value)) {
      Set-Item -LiteralPath "Env:$name" -Value $value
    }
  }

  $existing = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*feishu-history-poller.mjs*' } |
    Select-Object -First 1
  if ($existing) {
    Write-TaskLog "History poller already running as PID $($existing.ProcessId); task exits without starting a duplicate."
    exit 0
  }

  $nodePath = (Get-Command node -ErrorAction Stop).Source
  Write-TaskLog "Starting hourly history poller with $nodePath; reports are locked to the test chat."
  Push-Location $projectRoot
  try {
    & $nodePath $pollerPath 1>> $stdoutPath 2>> $stderrPath
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($null -eq $exitCode) { $exitCode = 1 }
  Write-TaskLog "History poller exited with code $exitCode."
  exit $exitCode
} catch {
  Write-TaskLog "Startup failed: $($_.Exception.Message)"
  throw
}
