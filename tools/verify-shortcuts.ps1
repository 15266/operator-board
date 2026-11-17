# verify-shortcuts.ps1 - read back the .lnk entries and prove their targets exist.
# ASCII-only source; non-ASCII characters in paths are masked as '?' on output so
# the console codepage cannot make the result ambiguous. The verdict is the
# Test-Path result, not the printed path.
param([switch]$Json)

$ErrorActionPreference = 'Stop'
function U([int[]]$cp) { -join ($cp | ForEach-Object { [char]$_ }) }
function Mask([string]$s) { if (-not $s) { return '' }; -join ($s.ToCharArray() | ForEach-Object { if ([int]$_ -lt 128) { $_ } else { '?' } }) }

$NAME_BOARD  = (U 0x5706,0x684C,0x4F1A,0x8BAE)
$NAME_DOUBAO = (U 0x542F,0x52A8,0x8C46,0x5305) + '-' + (U 0x8C03,0x8BD5,0x7AEF,0x53E3)
$NAME_AUTO   = $NAME_BOARD + '-' + (U 0x81EA,0x542F)

$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')

$paths = @(
  (Join-Path $desktop ($NAME_BOARD + '.lnk')),
  (Join-Path $desktop ($NAME_DOUBAO + '.lnk')),
  (Join-Path $startup ($NAME_AUTO + '.lnk'))
)

$shell = New-Object -ComObject WScript.Shell
$rows = @()
foreach ($p in $paths) {
  $row = [ordered]@{ lnk = (Mask $p); exists = (Test-Path -LiteralPath $p); target = ''; target_len = 0; args = ''; args_len = 0; target_ok = $false }
  if ($row.exists) {
    $s = $shell.CreateShortcut($p)
    $row.target = Mask $s.TargetPath
    $row.target_len = ([string]$s.TargetPath).Length
    $row.args = Mask $s.Arguments
    $row.args_len = ([string]$s.Arguments).Length
    $row.target_ok = (Test-Path -LiteralPath $s.TargetPath)
  }
  $rows += [pscustomobject]$row
}

if ($Json) {
  $rows | ConvertTo-Json -Depth 3
} else {
  foreach ($r in $rows) {
    Write-Host ('lnk    : ' + $r.lnk)
    Write-Host ('  exists  : ' + $r.exists)
    Write-Host ('  target  : ' + $r.target + '   (len ' + $r.target_len + ', reachable=' + $r.target_ok + ')')
    if ($r.args_len) { Write-Host ('  args    : ' + $r.args + '   (len ' + $r.args_len + ')') }
  }
  $bad = @($rows | Where-Object { (-not $_.exists) -or (-not $_.target_ok) })
  Write-Host ''
  if ($bad.Count -eq 0) { Write-Host 'VERDICT: ALL OK' } else { Write-Host ('VERDICT: ' + $bad.Count + ' BROKEN') }
}
