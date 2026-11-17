# Local inventory for Operator Board discovery. JSON to stdout only.
# Never prints environment values, tokens, or passwords.
# Called by discover.mjs. Read-only: does not start, stop, or kill processes.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Redact-Cmd([string]$cmd) {
  if ([string]::IsNullOrEmpty($cmd)) { return $null }
  $x = $cmd
  $x = [regex]::Replace($x, '(?i)(password|passwd|token|secret|authorization|api[_-]?key|sessionToken|gateway_password)\s*[=:]\s*\S+', '$1=<redacted>')
  $x = [regex]::Replace($x, '(?i)Bearer\s+\S+', 'Bearer <redacted>')
  if ($x.Length -gt 240) { $x = $x.Substring(0, 240) + [char]0x2026 }
  return $x
}

function Is-Interesting([string]$name, [string]$cmd, [string]$exe) {
  $blob = ("$name $cmd $exe").ToLowerInvariant()
  return $blob -match 'workbuddy|codebuddy|codex|doubao|豆包|ollama|lm.?studio|lmstudio|openclaw|flclash|clash-verge|clash\.exe|dsh-doubao|workbuddy-to-dsh|litellm|vllm|llama\.cpp|llama-server|text-generation-webui'
}

$listenByPid = @{}
$listening = @()
netstat -ano -p tcp 2>$null | Select-String "LISTENING" | ForEach-Object {
  $parts = ($_.ToString().Trim() -split "\s+")
  if ($parts.Count -lt 4) { return }
  $addr = $parts[1]
  $pidStr = $parts[-1]
  if ($addr -notmatch '^(127\.0\.0\.1|\[::1\]|\[::\]|0\.0\.0\.0):(\d+)$') { return }
  $port = [int]$Matches[2]
  $ip = $Matches[1]
  if ($ip -eq "0.0.0.0" -or $ip -eq "[::]") {
    # still record, but discover.mjs only treats loopback as local AI
  }
  $procId = 0
  [void][int]::TryParse($pidStr, [ref]$procId)
  $listening += @{ addr = $ip; port = $port; pid = $procId }
  if ($procId -gt 0) {
    if (-not $listenByPid.ContainsKey($procId)) { $listenByPid[$procId] = @() }
    $listenByPid[$procId] += $port
  }
}

$processes = @()
Get-CimInstance Win32_Process | ForEach-Object {
  $procId = [int]$_.ProcessId
  $name = [string]$_.Name
  $exe = [string]$_.ExecutablePath
  $cmd = [string]$_.CommandLine
  $ports = @()
  if ($listenByPid.ContainsKey($procId)) { $ports = @($listenByPid[$procId] | Select-Object -Unique) }
  if ($ports.Count -eq 0 -and -not (Is-Interesting $name $cmd $exe)) { return }
  $processes += @{
    pid = $procId
    name = $name
    exe = $(if ($exe) { $exe } else { $null })
    cmd_preview = (Redact-Cmd $cmd)
    ports = $ports
  }
}

$path_hits = @()
foreach ($cmdName in @("workbuddy", "WorkBuddy", "codebuddy", "codex", "ollama", "node")) {
  try {
    $cmd = Get-Command $cmdName -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
      $path_hits += @{ command = $cmdName; path = [string]$cmd.Source }
    }
  } catch {}
}

$home = [Environment]::GetFolderPath("UserProfile")
$local = $env:LOCALAPPDATA
$roaming = $env:APPDATA
$pf = ${env:ProgramFiles}
$pf86 = ${env:ProgramFiles(x86)}

$dir_templates = @(
  @{ kind = "workbuddy_exe"; path = (Join-Path $pf "WorkBuddy\WorkBuddy.exe") },
  @{ kind = "workbuddy_exe"; path = (Join-Path $local "Programs\WorkBuddy\WorkBuddy.exe") },
  @{ kind = "workbuddy_exe"; path = "D:\workbuddy\WorkBuddy.exe" },
  @{ kind = "workbuddy_cli"; path = "D:\workbuddy\resources\app.asar.unpacked\cli\bin\codebuddy" },
  @{ kind = "codex_js"; path = (Join-Path $roaming "npm\node_modules\@openai\codex\bin\codex.js") },
  @{ kind = "codex_cmd"; path = (Join-Path $roaming "npm\codex.cmd") },
  @{ kind = "codex_cmd"; path = (Join-Path $roaming "npm\codex.ps1") },
  @{ kind = "ollama_exe"; path = (Join-Path $local "Programs\Ollama\ollama.exe") },
  @{ kind = "ollama_exe"; path = (Join-Path $pf "Ollama\ollama.exe") },
  @{ kind = "doubao_bridge"; path = (Join-Path $home "agent-tools\dsh-doubao-bridge\server.mjs") },
  @{ kind = "doubao_exe"; path = (Join-Path $local "Programs\Doubao\Doubao.exe") },
  @{ kind = "doubao_exe"; path = (Join-Path $local "Programs\豆包\豆包.exe") },
  @{ kind = "lmstudio_exe"; path = (Join-Path $local "Programs\LM Studio\LM Studio.exe") }
)

$dir_hits = @()
foreach ($t in $dir_templates) {
  if ([string]::IsNullOrWhiteSpace($t.path)) { continue }
  $dir_hits += @{ kind = $t.kind; path = $t.path; exists = [bool](Test-Path -LiteralPath $t.path) }
}

# If a running WorkBuddy/codex/doubao process has an exe, also derive sibling CLI paths.
foreach ($p in $processes) {
  if ($p.exe -and $p.name -match '(?i)WorkBuddy') {
    $root = Split-Path -Parent $p.exe
    $cli = Join-Path $root "resources\app.asar.unpacked\cli\bin\codebuddy"
    $dir_hits += @{ kind = "workbuddy_cli"; path = $cli; exists = [bool](Test-Path -LiteralPath $cli); from_process = $true }
  }
}

$result = @{
  hostname = [System.Net.Dns]::GetHostName()
  platform = "win32"
  listening = $listening
  processes = $processes
  path_hits = $path_hits
  dir_hits = $dir_hits
}

$json = $result | ConvertTo-Json -Compress -Depth 8
[Console]::Out.WriteLine($json)
