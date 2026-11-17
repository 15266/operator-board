# build.ps1 - compile the board launcher with .NET Framework 4.x csc (no extra runtime)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $here '..\..')).Path
$csc  = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $csc)) { throw 'csc.exe not found (.NET Framework 4.x)' }

$cnName = -join [char[]](0x5706, 0x684C, 0x4F1A, 0x8BAE)
$outCn  = Join-Path $root ($cnName + '.exe')
$outEn  = Join-Path $root 'OperatorBoard.exe'
$src    = Join-Path $here 'Program.cs'
& $csc /nologo /target:winexe /optimize+ /platform:anycpu /utf8output /codepage:65001 /out:"$outEn" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.dll "$src"
if ($LASTEXITCODE -ne 0) { throw "csc failed, exit $LASTEXITCODE" }
Copy-Item -LiteralPath $outEn -Destination $outCn -Force
$item = Get-Item -LiteralPath $outCn
Write-Host ("built {0} and {1} ({2} bytes)" -f $outCn, $outEn, $item.Length)