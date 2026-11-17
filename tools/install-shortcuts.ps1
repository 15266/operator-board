# install-shortcuts.ps1 - register (or remove) the desktop / startup entries.
#
# Design notes
#   * Shortcuts are .lnk, not .cmd: .lnk stores the target path as Unicode, so a
#     project path containing Chinese characters is fine. The earlier .cmd
#     approach needed an ASCII junction (D:\ob) only because the Windows command
#     interpreter garbles Chinese inside batch files.
#   * Nothing outside this project folder is required to run the board: the
#     entries below are convenience registrations, and this script can recreate
#     or remove all of them. Only the OS-level registration itself must live
#     outside the package - that is inherent, not a design choice.
#   * This file is ASCII-only on purpose: PS 5.1 reads non-BOM scripts as ANSI,
#     so Chinese literals here would be garbled. Chinese entry names are built
#     from code points instead.
#
# Usage
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-shortcuts.ps1
#   ... -Uninstall        # remove every entry this script created
#   ... -NoStartup        # skip the login autostart entry
#   ... -LegacyCleanup    # also delete the old .cmd entries that used D:\ob

param(
  [switch]$Uninstall,
  [switch]$NoStartup,
  [switch]$LegacyCleanup
)

$ErrorActionPreference = 'Stop'
function Say([string]$m) { Write-Host $m }
function U([int[]]$cp) { -join ($cp | ForEach-Object { [char]$_ }) }

# ---- names (code points -> Chinese, keeps this file ASCII) ----
$NAME_BOARD   = (U 0x5706,0x684C,0x4F1A,0x8BAE)                                              # Round Table
$NAME_DOUBAO  = (U 0x542F,0x52A8,0x8C46,0x5305) + '-' + (U 0x8C03,0x8BD5,0x7AEF,0x53E3)      # Start Doubao (debug port)
$NAME_AUTO    = $NAME_BOARD + '-' + (U 0x81EA,0x542F)                                        # Round Table autostart

$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')

# ---- locate the project root (parent of tools\) ----
if (-not $PSScriptRoot) { throw 'Run this file, not -Command.' }
$root = Split-Path -Parent $PSScriptRoot

# If this script was started through a junction, register the REAL path instead:
# .lnk stores Unicode so the Chinese path is fine, and the shortcut then keeps
# working even after the junction is deleted.
$rootItem = Get-Item -LiteralPath $root -Force
if ($rootItem.Target) {
  $real = @($rootItem.Target)[0]
  if ($real -and (Test-Path -LiteralPath $real)) { $root = [string]$real }
}

$launcher = Join-Path $root 'OperatorBoard.exe'
if (-not (Test-Path -LiteralPath $launcher)) {
  $alt = Join-Path $root ($NAME_BOARD + '.exe')
  if (Test-Path -LiteralPath $alt) { $launcher = $alt } else { throw "launcher exe not found in $root" }
}
$startBoard = Join-Path $root 'start-board.ps1'
if (-not (Test-Path -LiteralPath $startBoard)) { throw "start-board.ps1 not found in $root" }
$doubaoCli = Join-Path $root 'tools\ensure-doubao.mjs'

$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershellExe)) { $powershellExe = 'powershell.exe' }
$nodeExe = ''
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $nodeExe = $cmd.Source }
if (-not $nodeExe) {
  $guess = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path -LiteralPath $guess) { $nodeExe = $guess }
}

$targets = @(
  @{ Path = (Join-Path $desktop ($NAME_BOARD + '.lnk'));  Exe = $launcher;      Args = '';                                   Desc = 'Operator Board' },
  @{ Path = (Join-Path $desktop ($NAME_DOUBAO + '.lnk')); Exe = $nodeExe;       Args = ('"' + $doubaoCli + '"');            Desc = 'Doubao with CDP 9225' },
  @{ Path = (Join-Path $startup ($NAME_AUTO + '.lnk'));   Exe = $powershellExe; Args = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startBoard + '" -NoBrowser'); Desc = 'Operator Board autostart' }
)
if ($NoStartup) { $targets = $targets | Where-Object { $_.Path -notlike "$startup*" } }

# ---- uninstall ----
if ($Uninstall) {
  $removed = 0
  foreach ($t in $targets) {
    if (Test-Path -LiteralPath $t.Path) { Remove-Item -LiteralPath $t.Path -Force; Say ("removed : " + $t.Path); $removed++ }
  }
  Say ("done, removed $removed entrie(s).")
  return
}

# ---- install ----
Say ("project root : " + $root)
$shell = $null
try { $shell = New-Object -ComObject WScript.Shell } catch {
  throw 'Cannot create WScript.Shell COM object. Run this script from a normal desktop session (not from a restricted sandbox).'
}

foreach ($t in $targets) {
  if (-not $t.Exe) { Say ("skipped : " + $t.Path + "  (target executable not found)"); continue }
  $lnk = $shell.CreateShortcut($t.Path)
  $lnk.TargetPath = $t.Exe
  $lnk.Arguments = $t.Args
  $lnk.WorkingDirectory = $root
  $lnk.Description = $t.Desc
  $lnk.IconLocation = $launcher + ',0'
  $lnk.Save()
  Say ("created : " + $t.Path)
  Say ("          -> " + $t.Exe + ' ' + $t.Args)
}

# ---- legacy cleanup: old .cmd entries that depended on the D:\ob junction ----
if ($LegacyCleanup) {
  $legacy = @(
    (Join-Path $desktop ((U 0x542F,0x52A8) + $NAME_BOARD + '.c' + 'md')),
    (Join-Path $desktop ($NAME_DOUBAO + '.c' + 'md')),
    (Join-Path $startup ($NAME_AUTO + '.c' + 'md'))
  )
  foreach ($f in $legacy) {
    if (Test-Path -LiteralPath $f) {
      try { [System.IO.File]::Delete($f); Say ("legacy  : removed " + $f) }
      catch { Say ("legacy  : cannot delete " + $f + " (" + $_.Exception.Message + ")") }
    }
  }
  if (Test-Path -LiteralPath 'D:\ob') {
    $it = Get-Item 'D:\ob' -Force
    if ($it.Target) {
      try { [System.IO.Directory]::Delete('D:\ob', $false); Say 'legacy  : removed junction D:\ob' }
      catch { Say ('legacy  : D:\ob is in use by a running process, left in place (' + $_.Exception.Message + ')') }
    }
    else { Say 'legacy  : D:\ob exists but is not a junction, left alone' }
  }
}

Say ''
Say 'Done. Re-run with -Uninstall to remove these entries.'
