[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$listenerPath = Join-Path $projectRoot 'src\feishu-listener.mjs'
$taskLogPath = Join-Path $projectRoot 'feishu-listener-task.log'
$stdoutPath = Join-Path $projectRoot 'feishu-listener.stdout.log'
$stderrPath = Join-Path $projectRoot 'feishu-listener.stderr.log'

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

  $existing = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*feishu-listener.mjs*' } |
    Select-Object -First 1
  if ($existing) {
    Write-TaskLog "Listener already running as PID $($existing.ProcessId); task exits without starting a duplicate."
    exit 0
  }

  $nodePath = (Get-Command node -ErrorAction Stop).Source
  Write-TaskLog "Starting listener with $nodePath for chat $env:FEISHU_CHAT_ID."
  $process = Start-Process `
    -FilePath $nodePath `
    -ArgumentList $listenerPath `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  Write-TaskLog "Listener exited with code $($process.ExitCode)."
  exit $process.ExitCode
} catch {
  Write-TaskLog "Startup failed: $($_.Exception.Message)"
  throw
}
