[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pollerPath = Join-Path $projectRoot 'src\feishu-app-screenshot-test-poller.mjs'
$formalMode = $env:AM_APP_SCREENSHOT_REPORT_TARGET -eq 'FORMAL_GROUP'
$formalReviewMode =
  !$formalMode -and
  ![string]::IsNullOrWhiteSpace($env:AM_APP_SCREENSHOT_SOURCE_CHAT_ID)
$logName = if ($formalMode) {
  'formal'
} elseif ($formalReviewMode) {
  'formal-review'
} else {
  'test'
}
$taskLogPath = Join-Path $projectRoot ('app-screenshot-' + $logName + '-poller-task.log')
$stdoutPath = Join-Path $projectRoot ('app-screenshot-' + $logName + '-poller.stdout.log')
$stderrPath = Join-Path $projectRoot ('app-screenshot-' + $logName + '-poller.stderr.log')

function Write-TaskLog([string]$Message) {
  if ($Message -eq 'Starting test-group-only APP screenshot poller.') {
    $Message = 'Starting ' + $logName + '-group APP screenshot poller.'
  }
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
  $env:AM_APP_SCREENSHOT_PROJECT_ROOT = $projectRoot
  if ([string]::IsNullOrWhiteSpace($env:AM_APP_SCREENSHOT_REPORT_TARGET)) {
    $env:AM_APP_SCREENSHOT_REPORT_TARGET = 'TEST_GROUP_ONLY'
  }
  if ([string]::IsNullOrWhiteSpace($env:AM_APP_SCREENSHOT_POLL_INTERVAL_MS)) {
    $env:AM_APP_SCREENSHOT_POLL_INTERVAL_MS = '10000'
  }
  if ([string]::IsNullOrWhiteSpace($env:AM_APP_SCREENSHOT_INITIAL_LOOKBACK_MS)) {
    $env:AM_APP_SCREENSHOT_INITIAL_LOOKBACK_MS = '600000'
  }

  $existing = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object {
      $_.CommandLine -like '*feishu-app-screenshot-test-poller.mjs*'
    } |
    Select-Object -First 1
  if ($existing) {
    Write-TaskLog "Poller already running as PID $($existing.ProcessId); task exits."
    exit 0
  }

  $nodePath = (Get-Command node -ErrorAction Stop).Source
  Write-TaskLog "Starting test-group-only APP screenshot poller."
  $process = Start-Process `
    -FilePath $nodePath `
    -ArgumentList $pollerPath `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  Write-TaskLog "Poller exited with code $($process.ExitCode)."
  exit $process.ExitCode
} catch {
  Write-TaskLog "Startup failed: $($_.Exception.Message)"
  throw
}
