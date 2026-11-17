// Process helpers for the Operator Board bridge.
// Ported ideas from MmCodexMgr (https://github.com/Haki-sheep/MmCodexMgr):
//  - re-check the PID is still the process we expect before killing it
//    (Source/InstanceService.cs:98-106 "所选实例进程已变化 请刷新后重试")
//  - kill the whole tree, not just the root (Process.Kill(true); Job object KILL_ON_JOB_CLOSE,
//    Source/Cursor/CursorProcessJob.cs:10-26). Node has no Job API, so Windows uses taskkill /T /F.
//  - strip inherited CODEX_* variables from child processes
//    (Source/InstanceService.cs:82-84, Source/Cursor/CursorCli.cs:53-54)
import { execFile as nodeExecFile } from "node:child_process";

function exited(child) {
  return !child || !child.pid || child.exitCode !== null || child.signalCode !== null;
}

/** Parent PID of `pid` on Windows via Win32_Process, or null if unknown / not running. */
export function queryParentPid(pid, { execFile = nodeExecFile, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const ps = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { $p.ParentProcessId }`;
    try {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
        if (err) return resolve(null);
        const n = Number(String(stdout || "").trim());
        resolve(Number.isInteger(n) && n > 0 ? n : null);
      });
    } catch { resolve(null); }
  });
}

/**
 * End a child spawned by this process together with its descendants.
 * Windows: verify the PID is still alive and still our direct child, then `taskkill /PID <pid> /T /F`.
 * Any failure (or other platforms) falls back to child.kill(), the previous behavior.
 * Resolves to { method, reason? } for logging; never throws.
 */
export async function killTree(child, { platform = process.platform, parentPid = process.pid, execFile = nodeExecFile, queryParent = queryParentPid } = {}) {
  if (exited(child)) return { method: "none", reason: "already exited" };
  const fallback = (reason) => { try { child.kill(); } catch {} return { method: "kill", reason }; };
  if (platform !== "win32") return fallback("non-windows");
  const pid = child.pid;
  const parent = await queryParent(pid, { execFile });
  if (exited(child)) return { method: "none", reason: "exited during check" };
  if (parent === null) return fallback("parent lookup failed");
  if (parent !== parentPid) return fallback(`pid ${pid} parent is ${parent}, not ${parentPid}; taskkill skipped`);
  return new Promise((resolve) => {
    try {
      execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 15000 }, (err) => {
        if (err && !exited(child)) return resolve(fallback("taskkill failed: " + String(err.message || err).slice(0, 120)));
        resolve({ method: "taskkill /T /F", pid });
      });
    } catch (e) { resolve(fallback("taskkill spawn failed")); }
  });
}

const PROXY_RE = /^(https?_proxy|all_proxy|no_proxy)$/i;
// Secrets the bridge itself holds for other executors; never hand them to Codex.
const BRIDGE_SECRETS = ["WB_TOKEN", "CODEBUDDY_GATEWAY_PASSWORD", "AKILI_WEBHOOK_URL", "AKILI_WEBHOOK_AUTH", "AKILI_WEBHOOK_KEY", "AKILI_WEBHOOK_KEY_HEADER"];

/**
 * Copy of `env` for spawning Codex:
 *  - removes inherited CODEX_* (CODEX_THREAD_ID, CODEX_INTERNAL_*, CODEX_SANDBOX*, and the bridge's own
 *    CODEX_MAX/CODEX_CMD/... config) but keeps CODEX_HOME, which selects the Codex account/home;
 *  - keeps proxy variables in any case;
 *  - removes bridge-held secrets, and any *_API_KEY that was injected through POST /bridge/credentials
 *    (marked _AUTH_SOURCE_<ref>=user by discover.setUserSecret), plus the _AUTH_SOURCE_* markers.
 *    OPENAI_API_KEY inherited from the user's own environment is kept.
 */
export function sanitizeCodexEnv(env = process.env, { keepCodexHome = true } = {}) {
  const out = { ...env };
  const removed = [];
  for (const key of Object.keys(out)) {
    if (PROXY_RE.test(key)) continue;
    const upper = key.toUpperCase();
    let drop = false;
    if (upper.startsWith("CODEX_") && !(keepCodexHome && upper === "CODEX_HOME")) drop = true;
    else if (BRIDGE_SECRETS.includes(upper)) drop = true;
    else if (upper.startsWith("_AUTH_SOURCE_")) drop = true;
    else if (out[`_AUTH_SOURCE_${key}`] === "user") drop = true;
    if (drop) { delete out[key]; removed.push(key); }
  }
  Object.defineProperty(out, "__removed", { value: removed, enumerable: false });
  return out;
}
