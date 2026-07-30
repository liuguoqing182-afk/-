[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$registrationLogPath = Join-Path $projectRoot 'feishu-history-poller-registration.log'
$taskName = 'AIMirror-AM-Config-History-Poller-Test'

function Write-RegistrationLog([string]$Message) {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $registrationLogPath -Value "[$timestamp] $Message" -Encoding UTF8
}

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principalContext = New-Object Security.Principal.WindowsPrincipal($identity)
  if (!$principalContext.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Administrator privileges are required to register an AtStartup task'
  }

  $runnerPath = Join-Path $projectRoot 'scripts\run-history-poller-task.ps1'
  $powerShellPath = "$PSHOME\powershell.exe"
  $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runnerPath + '"'
  $action = New-ScheduledTaskAction `
    -Execute $powerShellPath `
    -Argument $arguments `
    -WorkingDirectory $projectRoot
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $trigger.Delay = 'PT1M'
  $taskPrincipal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType S4U `
    -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Register-ScheduledTask `
    -TaskName $taskName `
    -Description 'AIMirror boot-time formal-group history polling; reports locked to test group during observation.' `
    -Action $action `
    -Trigger $trigger `
    -Principal $taskPrincipal `
    -Settings $settings `
    -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-RegistrationLog "Registered and started $taskName with AtStartup/S4U and one-minute restart-on-failure."
} catch {
  Write-RegistrationLog "Registration failed: $($_.Exception.Message)"
  throw
}
