# dot-source: provides Get-WbTokenById
$helper = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ProcEnvReader3 {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool b, int p);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr p, int c, ref PROCESS_BASIC_INFORMATION b, int l, out int r);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr p, IntPtr a, byte[] buf, int n, out IntPtr r);
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_BASIC_INFORMATION { public IntPtr Reserved1; public IntPtr PebBaseAddress; public IntPtr Reserved2_0; public IntPtr Reserved2_1; public IntPtr UniqueProcessId; public IntPtr InheritedFromUniqueProcessId; }
  public static string GetEnv(int processId) {
    IntPtr h = OpenProcess(0x0410, false, processId);
    if (h == IntPtr.Zero) return null;
    try {
      PROCESS_BASIC_INFORMATION pbi = new PROCESS_BASIC_INFORMATION();
      int ret;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) return null;
      byte[] ptr = new byte[8];
      IntPtr n;
      if (!ReadProcessMemory(h, pbi.PebBaseAddress + 0x20, ptr, 8, out n)) return null;
      IntPtr procParams = (IntPtr)BitConverter.ToInt64(ptr, 0);
      if (!ReadProcessMemory(h, procParams + 0x80, ptr, 8, out n)) return null;
      IntPtr env = (IntPtr)BitConverter.ToInt64(ptr, 0);
      byte[] buf = new byte[32768];
      if (!ReadProcessMemory(h, env, buf, buf.Length, out n)) return null;
      return Encoding.Unicode.GetString(buf, 0, (int)n);
    } finally { CloseHandle(h); }
  }
}
'@
try { Add-Type -TypeDefinition $helper -ErrorAction Stop | Out-Null } catch {}

function Get-WbTokenById([int]$processId) {
  try {
    $raw = [ProcEnvReader3]::GetEnv($processId)
    if ($raw) {
      foreach ($chunk in $raw.Split([char]0)) {
        if ($chunk -like 'CODEBUDDY_GATEWAY_PASSWORD=*') {
          return $chunk.Substring('CODEBUDDY_GATEWAY_PASSWORD='.Length)
        }
      }
    }
  } catch {}
  return $null
}


function Find-WbServePid {
  $p = Get-CimInstance Win32_Process | Where-Object { [string]$_.CommandLine -match 'cli\\bin\\codebuddy --serve' } | Select-Object -First 1
  if ($p) { return [int]$p.ProcessId } else { return $null }
}
function Find-WbPort([int]$processId) {
  $port = $null
  netstat -ano -p tcp | Select-String 'LISTENING' | ForEach-Object {
    $parts = ($_.ToString().Trim() -split '\s+')
    if ($parts[-1] -eq [string]$processId -and $parts[1] -like '127.0.0.1:*') { $port = ($parts[1] -split ':')[-1] }
  }
  return $port
}

# Resolve only a desktop-owned bundled serve. Never treat an arbitrary open port
# or an independently installed CLI as the authenticated desktop gateway.
function Find-WbDesktopServeCandidates {
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $owned = @{}
  foreach ($p in $all) { if ($p.Name -ieq 'WorkBuddy.exe') { $owned[[int]$p.ProcessId] = $true } }
  for ($round=0; $round -lt 12; $round++) {
    foreach ($p in $all) { if ($owned.ContainsKey([int]$p.ParentProcessId)) { $owned[[int]$p.ProcessId] = $true } }
  }
  foreach ($p in $all) {
    $cmd = [string]$p.CommandLine
    if ($owned.ContainsKey([int]$p.ProcessId) -and $p.Name -match '^(WorkBuddy|node)\.exe$' -and
        $cmd -match 'cli[\\/](bin[\\/]codebuddy|dist[\\/]codebuddy-lite-wb\.mjs)' -and
        $cmd -match '(?:^|\s)--serve(?:\s|$)') { $p }
  }
}

function Get-WbGatewayHealth([int]$Port, [string]$Token) {
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/api/v1/health")
    $req.Proxy=$null; $req.Timeout=2000; $req.AllowAutoRedirect=$false
    $req.Headers['X-CodeBuddy-Request']='1'
    if ($Token) { $req.Headers['Authorization']='Bearer '+$Token }
    $response=$null
    try { $response=$req.GetResponse() } catch [System.Net.WebException] { $response=$_.Exception.Response }
    if (!$response) { return $null }
    try {
      $status=[int]$response.StatusCode
      $reader=New-Object System.IO.StreamReader($response.GetResponseStream())
      try { $body=$reader.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop } finally { $reader.Dispose() }
      return @{status=$status; body=$body}
    } finally { $response.Close() }
  } catch { return $null }
}

function Find-WbVerifiedGateway {
  foreach ($candidate in @(Find-WbDesktopServeCandidates)) {
    $ports = @(Get-NetTCPConnection -State Listen -OwningProcess $candidate.ProcessId -ErrorAction SilentlyContinue |
      Where-Object {$_.LocalAddress -in @('127.0.0.1','0.0.0.0','::1','::')} | Select-Object -ExpandProperty LocalPort -Unique)
    foreach ($port in $ports) {
      $probe=Get-WbGatewayHealth $port ''
      $identity=$probe -and (($probe.status -eq 200 -and $probe.body.data.status -eq 'ok') -or
        ($probe.status -in @(401,403) -and $probe.body.error.code -in @('AUTH_REQUIRED','MISSING_REQUIRED_HEADER')))
      if (!$identity) { continue }
      # Read credentials only after desktop ancestry, bundled CLI and HTTP identity agree.
      $secret=Get-WbTokenById ([int]$candidate.ProcessId)
      if (!$secret) { continue }
      $confirmed=Get-WbGatewayHealth $port $secret
      if ($confirmed -and $confirmed.status -eq 200 -and $confirmed.body.data.status -eq 'ok') {
        return @{serve_pid=[int]$candidate.ProcessId;port=[int]$port;token=$secret;token_present=$true;gateway_verified=$true}
      }
    }
  }
  return $null
}
