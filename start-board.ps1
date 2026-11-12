# start-board.ps1 - one-click launcher for the Operator Board (operator-board)
#
# Starts:
#   1) bridge  -> http://127.0.0.1:5180  (WB_TOKEN / WB_PORT taken from the running WorkBuddy serve process)
#   2) vite    -> http://127.0.0.1:5173
#   3) opens     http://127.0.0.1:5173/#interfaces
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-board.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-board.ps1 -Stop
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-board.ps1 -NoBrowser -WebPort 5173
#
# Notes:
#   * Windows PowerShell 5.1 refuses Start-Process when env holds keys that differ only by case
#     (HTTPS_PROXY / https_proxy). This script removes the lowercase duplicates first.
#   * The token is only passed through the child process environment. It is never written to disk
#     or printed by this script.

param(
  [switch]$Stop,
  [switch]$NoBrowser,
  [int]$WebPort = 5173,
  [int]$BridgePort = 5180
)

$ErrorActionPreference = 'Continue'
$root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeDir = Join-Path $root 'bridge'
$logs      = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$logFile   = Join-Path $logs 'launcher.log'

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

function Test-Listen([int]$port) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  return [bool]$c
}

function Get-PortOwner([int]$port) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if ($c) { return [int]$c[0].OwningProcess } else { return $null }
}

function Test-Http([string]$url) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Proxy = $null
    $req.Timeout = 2000
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $resp.Close()
    return ($code -eq 200)
  } catch { return $false }
}

function Stop-OurBridge {
  $hit = $false
  foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)) {
    if ([string]$p.CommandLine -match 'bridge[\\/]server\.mjs') {
      Write-Log ("stop bridge pid=" + $p.ProcessId)
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      $hit = $true
    }
  }
  if ($hit) { Start-Sleep -Milliseconds 700 }
}

function Stop-OurDev {
  $owner = Get-PortOwner $WebPort
  if (-not $owner) { return }
  $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=$owner") -ErrorAction SilentlyContinue
  if ($proc -and ([string]$proc.CommandLine -match 'vite')) {
    Write-Log ("stop vite pid=" + $owner)
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
  }
  foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)) {
    if ([string]$p.CommandLine -match 'npm-cli\.js.*run dev') {
      Write-Log ("stop npm dev pid=" + $p.ProcessId)
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 700
}

if ($Stop) {
  Stop-OurBridge
  Stop-OurDev
  Write-Log ("stopped. web " + $WebPort + " listening=" + (Test-Listen $WebPort) + " bridge " + $BridgePort + " listening=" + (Test-Listen $BridgePort))
  return
}

Write-Log "=== start ==="

# 1. PS 5.1 env-key collision guard (must run before any Start-Process)
foreach ($k in 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy') {
  if (Test-Path ("Env:" + $k)) { Remove-Item ("Env:" + $k) -ErrorAction SilentlyContinue }
}

# 2. node
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) { Write-Log 'ERROR node not found'; exit 1 }

# 3. read WorkBuddy serve port + gateway credential
. (Join-Path $bridgeDir 'wbtoken.ps1')
$servePid = Find-WbServePid
$wbPort = $null
$wbTok = $null
if ($servePid) {
  $wbPort = Find-WbPort $servePid
  $wbTok = Get-WbTokenById $servePid
}
Write-Log ("serve_pid=" + $servePid + " wb_port=" + $wbPort + " token_present=" + [bool]$wbTok)
if (-not $servePid) { Write-Log 'WARN WorkBuddy serve not running - workbuddy row will show found (no session)' }

# 4. restart bridge with a fresh credential
Stop-OurBridge
$env:WB_PORT = [string]$wbPort
$env:WB_TOKEN = [string]$wbTok
if (-not $env:CODEX_MAX) { $env:CODEX_MAX = '10' }
$bp = Start-Process -FilePath $node `
  -ArgumentList @('"' + (Join-Path $bridgeDir 'server.mjs') + '"') `
  -WorkingDirectory $bridgeDir -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $logs 'bridge.stdout.log') `
  -RedirectStandardError  (Join-Path $logs 'bridge.stderr.log')
if ($bp) { Write-Log ("bridge_pid=" + $bp.Id) } else { Write-Log 'ERROR bridge failed to start' }
Remove-Item Env:\WB_TOKEN -ErrorAction SilentlyContinue

# 5. dev server (reuse if already up)
if (Test-Listen $WebPort) {
  Write-Log ("web port " + $WebPort + " already listening - reuse")
} else {
  $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npm) { $npm = 'C:\Program Files\nodejs\npm.cmd' }
  $dp = Start-Process -FilePath $npm `
    -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', [string]$WebPort) `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'dev.stdout.log') `
    -RedirectStandardError  (Join-Path $logs 'dev.stderr.log')
  if ($dp) { Write-Log ("vite_pid=" + $dp.Id) } else { Write-Log 'ERROR vite failed to start' }
}

# 6. wait for readiness
$okBridge = $false
$okWeb = $false
for ($i = 0; $i -lt 40; $i++) {
  if (-not $okBridge) { $okBridge = Test-Http ("http://127.0.0.1:" + $BridgePort + "/bridge/health") }
  if (-not $okWeb)    { $okWeb    = Test-Http ("http://127.0.0.1:" + $WebPort + "/") }
  if ($okBridge -and $okWeb) { break }
  Start-Sleep -Milliseconds 500
}
Write-Log ("bridge_ok=" + $okBridge + " web_ok=" + $okWeb)

if ($okBridge -and $okWeb) {
  $url = "http://127.0.0.1:" + $WebPort + "/#interfaces"
  Write-Log ("open " + $url)
  if (-not $NoBrowser) { Start-Process $url }
  exit 0
} else {
  Write-Log 'FAILED - check logs\bridge.stderr.log and logs\dev.stderr.log'
  exit 1
}
