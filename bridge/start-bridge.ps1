# Start the Operator Board dispatch bridge on 127.0.0.1:5180.
# Reads the WorkBuddy GUI serve port + gateway credential from the running serve
# process environment (never printed), passes them to the bridge via env only.
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'wbtoken.ps1')
$board = Split-Path -Parent $here
$logs = Join-Path $board 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

# Stop a previous bridge (only our own server.mjs).
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { [string]$_.CommandLine -match 'bridge\\server\.mjs' } | ForEach-Object {
  Write-Output ('STOP_OLD_BRIDGE pid=' + $_.ProcessId)
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500

$servePid = Find-WbServePid
$wbPort = $null; $wbTok = $null
if ($servePid) { $wbPort = Find-WbPort $servePid; $wbTok = Get-WbTokenById $servePid }
Write-Output ('WB_SERVE_PID=' + $servePid + ' WB_PORT=' + $wbPort + ' TOKEN_PRESENT=' + [bool]$wbTok)

$env:CODEX_MAX = $(if ($env:CODEX_MAX) { $env:CODEX_MAX } else { '10' })
$env:WB_PORT = [string]$wbPort
$env:WB_TOKEN = [string]$wbTok
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $cands = @('C:\Program Files\nodejs\node.exe',
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'))
  $cands += @(Get-ChildItem -Path (Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions\*\node.exe') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | ForEach-Object FullName)
  $node = $cands | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}
$p = Start-Process -FilePath $node -ArgumentList @('"' + (Join-Path $here 'server.mjs') + '"') -WorkingDirectory $here -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $logs 'bridge.stdout.log') -RedirectStandardError (Join-Path $logs 'bridge.stderr.log')
Remove-Item Env:\WB_TOKEN -ErrorAction SilentlyContinue
Write-Output ('BRIDGE_PID=' + $p.Id)
Start-Sleep -Seconds 2
try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 'http://127.0.0.1:5180/bridge/health'; Write-Output ('HEALTH=' + $r.Content) } catch { Write-Output ('HEALTH_FAIL ' + $_.Exception.Message) }

