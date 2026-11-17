# start-board.ps1 - one-click launcher for the Operator Board (operator-board)
#
# Starts:
#   0) doubao  -> Doubao desktop app with CDP 9225 (tools\ensure-doubao.mjs; warn only)
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

# Files extracted from a downloaded zip carry the Mark-of-the-Web (Zone.Identifier ADS).
# Under the default RemoteSigned policy those count as "remote unsigned" and PowerShell
# refuses to dot-source them, so Find-WbVerifiedGateway goes missing and the bridge starts
# with no gateway token -- king report then silently falls back to the deep link that never
# lands (hit 2026-11-17). Unblock just the scripts we execute, once.
function Clear-LocalMarks([string]$dir) {
  $n = 0
  foreach ($f in @('wbtoken.ps1', 'read-wb-serve.ps1')) {
    $p = Join-Path $dir $f
    if (-not (Test-Path -LiteralPath $p)) { continue }
    if (Get-Item -LiteralPath $p -Stream Zone.Identifier -ErrorAction SilentlyContinue) {
      try { Unblock-File -LiteralPath $p -ErrorAction Stop; $n++ } catch { Write-Log ("WARN cannot unblock " + $f + ": " + $_.Exception.Message) }
    }
  }
  if ($n -gt 0) { Write-Log ("unblocked " + $n + " script(s) carrying the downloaded-file mark") }
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

# 2.5 Doubao desktop app with CDP (prerequisite for driving Doubao "new work task")
#     Doubao loses --remote-debugging-port on every restart, and then the bridge
#     can never drive it again. tools\ensure-doubao.mjs relaunches it detached.
#     This script is normally launched by the user from Explorer (not inside a job
#     object), so the child process survives. Failure here only warns.
#     NOTE: keep this file ASCII-only -- PS 5.1 reads non-BOM scripts as ANSI and
#     would garble any Chinese text written into logs.
$ensureDoubao = Join-Path $root 'tools\ensure-doubao.mjs'
if (Test-Path -LiteralPath $ensureDoubao) {
  try {
    $doubaoMsg = (& $node $ensureDoubao 2>&1 | Out-String).Trim()
    Write-Log ("doubao: " + $doubaoMsg)
  } catch {
    Write-Log ("doubao: launcher error " + $_.Exception.Message)
  }
} else {
  Write-Log 'doubao: tools\ensure-doubao.mjs missing - doubao executor unavailable'
}

# 3. read WorkBuddy serve port + gateway credential
#    Dot-sourcing wbtoken.ps1 fails when the file carries the downloaded-file mark (RemoteSigned
#    treats it as remote unsigned), or when this process runs under AllSigned. Both leave
#    Find-WbVerifiedGateway undefined -> bridge starts with no token -> king report silently
#    falls back to the deep link that never lands. Clear the mark, then bypass the policy for
#    this process only; Group Policy can still override, which is why the fallback below is loud.
Clear-LocalMarks $bridgeDir
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction Stop } catch {}
try { . (Join-Path $bridgeDir 'wbtoken.ps1') } catch { Write-Log ("ERROR cannot load wbtoken.ps1: " + $_.Exception.Message) }
$verifiedGateway = $null
if (Get-Command Find-WbVerifiedGateway -ErrorAction SilentlyContinue) { $verifiedGateway = Find-WbVerifiedGateway }
else { Write-Log 'ERROR Find-WbVerifiedGateway unavailable - gateway credential cannot be read' }
$servePid = $null
$wbPort = $null
$wbTok = $null
if ($verifiedGateway) {
  $servePid = $verifiedGateway.serve_pid
  $wbPort = $verifiedGateway.port
  $wbTok = $verifiedGateway.token
}
Write-Log ("serve_pid=" + $servePid + " wb_port=" + $wbPort + " token_present=" + [bool]$wbTok)
if (-not $servePid) { Write-Log 'WARN WorkBuddy serve not running - workbuddy row will show found (no session)' }
if (-not $wbTok) { Write-Log 'WARN no gateway token - king report will fall back to workbuddy:// deep link, which does NOT land; run this script through the 圆桌会议 .lnk (it passes -ExecutionPolicy Bypass)' }

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
  $viteEntry = Join-Path $root 'node_modules/vite/bin/vite.js'
  if (-not (Test-Path -LiteralPath $viteEntry)) { Write-Log 'ERROR install dependencies first (npm install or pnpm install)'; exit 1 }
  $dp = Start-Process -FilePath $node `
    -ArgumentList @('"' + $viteEntry + '"', '--host', '127.0.0.1', '--port', [string]$WebPort, '--strictPort') `
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

