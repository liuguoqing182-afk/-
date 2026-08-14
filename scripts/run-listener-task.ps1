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
    'FEISHU_TEST_CHAT_ID'
  )) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if ([string]::IsNullOrWhiteSpace($value)) {
      throw "Required user environment variable is missing: $name"
    }
    Set-Item -LiteralPath "Env:$name" -Value $value
  }

  # Keep the user's global formal-group ID for the screenshot poller, but do
  # not expose it to this test-group-only listener process or its child.
  Remove-Item -LiteralPath 'Env:FEISHU_CHAT_ID' -ErrorAction SilentlyContinue

  $existing = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*feishu-listener.mjs*' } |
    Select-Object -First 1
  if ($existing) {
    Write-TaskLog "Listener already running as PID $($existing.ProcessId); task exits without starting a duplicate."
    exit 0
  }

  $nodePath = (Get-Command node -ErrorAction Stop).Source
  Write-TaskLog "Starting test-group-only listener with $nodePath for chat $env:FEISHU_TEST_CHAT_ID."
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
