# Called only by discover.mjs / the bridge process.
# Prints one JSON line. The line MAY include a token. Callers must not log stdout.
# Read-only: does not start, stop, or kill processes.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot "wbtoken.ps1")
$gateway = Find-WbVerifiedGateway
$servePid = $null
$wbPort = $null
$wbTok = $null
if ($gateway) {
  $servePid = $gateway.serve_pid
  $wbPort = $gateway.port
  $wbTok = $gateway.token
}
$obj = @{
  gateway_verified = [bool]$gateway
  serve_pid = $servePid
  port = $(if ($wbPort) { [int]$wbPort } else { $null })
  token_present = [bool]$wbTok
  token = $wbTok
  auth_ref = "WB_TOKEN"
  source_env_name = "CODEBUDDY_GATEWAY_PASSWORD"
}
[Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
