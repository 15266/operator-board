# Called only by discover.mjs / the bridge process.
# Prints one JSON line. The line MAY include a token. Callers must not log stdout.
# Read-only: does not start, stop, or kill processes.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot "wbtoken.ps1")
$servePid = Find-WbServePid
$wbPort = $null
$wbTok = $null
if ($servePid) {
  $wbPort = Find-WbPort $servePid
  $wbTok = Get-WbTokenById $servePid
}
$obj = @{
  serve_pid = $servePid
  port = $(if ($wbPort) { [int]$wbPort } else { $null })
  token_present = [bool]$wbTok
  token = $wbTok
  auth_ref = "WB_TOKEN"
  source_env_name = "CODEBUDDY_GATEWAY_PASSWORD"
}
[Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
