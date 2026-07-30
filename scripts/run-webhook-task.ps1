[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$serverPath = Join-Path $projectRoot 'src\webhook-server.mjs'
$taskLogPath = Join-Path $projectRoot 'webhook-task.log'
$stdoutPath = Join-Path $projectRoot 'webhook.stdout.log'
$stderrPath = Join-Path $projectRoot 'webhook.stderr.log'

function Write-TaskLog([string]$Message) {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $taskLogPath -Value "[$timestamp] $Message" -Encoding UTF8
}

try {
  foreach ($name in @(
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_CHAT_ID',
    'AM_INSPECT_UID',
    'AM_WEBHOOK_SECRET'
  )) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if ([string]::IsNullOrWhiteSpace($value)) {
      throw "Required user environment variable is missing: $name"
    }
    Set-Item -LiteralPath "Env:$name" -Value $value
  }

  foreach ($name in @(
    'AM_WEBHOOK_HOST',
    'AM_WEBHOOK_PORT',
    'AM_WEBHOOK_DATA_DIR',
    'AM_WEBHOOK_MAX_SKEW_SECONDS',
    'AM_WEBHOOK_MAX_BODY_BYTES',
    'AM_WEBHOOK_WORKER_ENABLED',
    'AM_WEBHOOK_FEISHU_CHAT_ID',
    'AM_WEBHOOK_POLL_INTERVAL_MS',
    'AM_WEBHOOK_INSPECTION_ATTEMPTS',
    'AM_WEBHOOK_REPORT_ATTEMPTS',
    'AM_WEBHOOK_RETRY_BASE_MS',
    'AM_WEBHOOK_SETTLE_MS',
    'AM_PUBLISH_SETTLE_MS'
  )) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      Set-Item -LiteralPath "Env:$name" -Value $value
    }
  }

  $existing = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*webhook-server.mjs*' } |
    Select-Object -First 1
  if ($existing) {
    Write-TaskLog "Webhook service already running as PID $($existing.ProcessId); task exits without starting a duplicate."
    exit 0
  }

  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $port = if ($env:AM_WEBHOOK_PORT) { $env:AM_WEBHOOK_PORT } else { '8787' }
  Write-TaskLog "Starting webhook service with $nodePath on local port $port."
  $process = Start-Process `
    -FilePath $nodePath `
    -ArgumentList $serverPath `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  Write-TaskLog "Webhook service exited with code $($process.ExitCode)."
  exit $process.ExitCode
} catch {
  Write-TaskLog "Startup failed: $($_.Exception.Message)"
  throw
}
