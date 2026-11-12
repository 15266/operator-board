// Local interface discovery for the Operator Board bridge.
// Learnings (cited in docs/discover-contract.md): Open WebUI Connections,
// Continue providers, LibreChat endpoints — defaults are hints, not proof;
// credentials live in env / auth_ref names, never in state, logs, or git;
// doctor-first: found ≠ listening ≠ authenticated ≠ chat_ok.
// Read-only scan: never starts, stops, or kills WorkBuddy / Codex / Doubao / UE / FlClash.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ALLOWED_AUTH_REFS = [
  "WB_TOKEN",
  "CODEBUDDY_GATEWAY_PASSWORD",
  "OPENAI_API_KEY",
  "OLLAMA_API_KEY",
  "ANTHROPIC_API_KEY",
  "DOUBAO_API_KEY",
  "LMSTUDIO_API_KEY",
];

const HINT_PORTS = {
  11434: "ollama",
  1234: "lmstudio",
  9222: "cdp",
  9225: "cdp",
  8790: "openai-compatible",
  8080: "openai-compatible",
  8000: "openai-compatible",
};

const PROXY_PROCESS = /flclash|clash-verge|clash\.exe|v2ray|hysteria|sing-box/i;
const SKIP_PROBE_PROCESS = /unrealeditor|ue[45]|epicgames|flclash|clash-verge|v2ray|hysteria|sing-box|svchost|lsass|services\.exe|spoolsv|wininit/i;
const SECRET_KEY = /^(token|secret|password|passwd|sessiontoken|authorization|api_key|apikey|gateway_password)$/i;

export function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) {
        // Keep booleans such as workbuddy.token=true; never emit string secret values.
        if (typeof v === "boolean" || v == null) out[k] = v;
        continue;
      }
      out[k] = stripSecrets(v);
    }
    return out;
  }
  return value;
}

export function redactSecrets(text, extraValues = []) {
  let x = String(text ?? "");
  for (const ref of ALLOWED_AUTH_REFS) {
    const val = process.env[ref];
    if (val) x = x.split(val).join("<redacted>");
  }
  for (const val of extraValues) {
    if (val) x = x.split(String(val)).join("<redacted>");
  }
  return x
    .replace(/(Bearer)\s+\S+/gi, "$1 <redacted>")
    .replace(/(password|token|secret|api[_-]?key|sessionToken)\s*[=:]\s*\S+/gi, "$1=<redacted>");
}

function runFile(cmd, args, { timeoutMs = 20000, hide = true } = {}) {
  return new Promise((resolve) => {
    let out = "", err = "";
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: hide, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: -1, out, err: String(e) });
      return;
    }
    const t = setTimeout(() => { try { child.kill(); } catch {} err += "\n[discover] timeout"; }, timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });
    child.on("error", (e) => { err += String(e); });
    child.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

async function runPowershell(scriptName, extraArgs = [], timeoutMs = 25000) {
  const script = path.join(HERE, scriptName);
  const exe = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  return runFile(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...extraArgs], { timeoutMs });
}

async function probe(url, { timeoutMs = 400, headers = {} } = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json", ...headers } });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text: text.slice(0, 4000) };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) };
  }
}

function tryJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function layer(found, listening, authenticated) {
  return { found: !!found, listening: !!listening, authenticated: !!authenticated, chat_ok: false };
}

function authFromEnv(refs) {
  for (const ref of refs) {
    if (process.env[ref]) {
      return {
        auth_status: process.env[`_AUTH_SOURCE_${ref}`] === "user" ? "user_provided_ref" : "from_env",
        auth_ref: ref,
        auth_needed: false,
      };
    }
  }
  return { auth_status: "missing", auth_ref: refs[0] || null, auth_needed: true };
}

function markUserOrEnv(ref, fallbackStatus) {
  if (!ref || !process.env[ref]) return { auth_status: fallbackStatus || "missing", auth_ref: ref, auth_needed: !process.env[ref] };
  const src = process.env[`_AUTH_SOURCE_${ref}`];
  if (src === "user") return { auth_status: "user_provided_ref", auth_ref: ref, auth_needed: false };
  if (src === "process") return { auth_status: "from_process_env", auth_ref: ref, auth_needed: false };
  return { auth_status: "from_env", auth_ref: ref, auth_needed: false };
}

async function inventoryWindows() {
  const r = await runPowershell("scan-local.ps1", [], 30000);
  const line = r.out.trim().split(/\r?\n/).filter(Boolean).pop() || "";
  let data = null;
  try { data = JSON.parse(line); } catch {}
  if (!data) {
    return { error: redactSecrets(r.err || "scan-local.ps1 无 JSON 输出"), listening: [], processes: [], path_hits: [], dir_hits: [], hostname: os.hostname(), platform: process.platform };
  }
  return data;
}

async function readWbServe() {
  const r = await runPowershell("read-wb-serve.ps1", [], 20000);
  const raw = r.out.trim().split(/\r?\n/).filter(Boolean).pop() || "";
  let data = null;
  try { data = JSON.parse(raw); } catch {}
  // Ingest token into env only; never return it.
  if (data?.token) {
    process.env.WB_TOKEN = String(data.token);
    process.env._AUTH_SOURCE_WB_TOKEN = "process";
  }
  return {
    serve_pid: data?.serve_pid ?? null,
    port: data?.port ?? null,
    token_present: !!data?.token_present,
    auth_ref: "WB_TOKEN",
    source_env_name: "CODEBUDDY_GATEWAY_PASSWORD",
    error: data ? null : redactSecrets(r.err || "read-wb-serve.ps1 无 JSON"),
  };
}

function deriveCliFromExe(exe) {
  if (!exe) return null;
  const cli = path.join(path.dirname(exe), "resources", "app.asar.unpacked", "cli", "bin", "codebuddy");
  return fs.existsSync(cli) ? cli : null;
}

function findDir(dirHits, kind) {
  const hits = (dirHits || []).filter((d) => d.kind === kind && d.exists);
  const fromProc = hits.find((d) => d.from_process);
  return (fromProc || hits[0])?.path || null;
}

function findPath(pathHits, names) {
  const want = names.map((n) => n.toLowerCase());
  const hit = (pathHits || []).find((p) => want.includes(String(p.command || "").toLowerCase()));
  return hit?.path || null;
}

async function fingerprint(port, hint) {
  const base = `http://127.0.0.1:${port}`;
  const result = { port, kind: null, transport: null, endpoint: null, health_http: null, models: null, detail: null };

  if (hint === "cdp" || !hint) {
    const v = await probe(`${base}/json/version`);
    const j = tryJson(v.text);
    if (j && (j.webSocketDebuggerUrl || j.Browser || j["User-Agent"])) {
      result.kind = "doubao";
      result.transport = "desktop_bridge";
      result.endpoint = `${base}`;
      result.health_http = v.status;
      result.detail = "cdp";
      result.browser = j.Browser || null;
      return result;
    }
    if (hint === "cdp") return result;
  }

  if (hint === "ollama" || !hint) {
    const v = await probe(`${base}/api/version`);
    const j = tryJson(v.text);
    if (v.status && j && (j.version || j.Version) && !Array.isArray(j.data)) {
      result.kind = "ollama";
      result.transport = "openai-compatible";
      result.endpoint = `${base}/v1`;
      result.health_http = v.status;
      result.detail = "ollama " + (j.version || j.Version);
      return result;
    }
  }

  const models = await probe(`${base}/v1/models`);
  const mj = tryJson(models.text);
  if (models.status === 401 || models.status === 403) {
    result.kind = "openai-compatible";
    result.transport = "openai-compatible";
    result.endpoint = `${base}/v1`;
    result.health_http = models.status;
    result.detail = "openai-compatible (auth required)";
    result.auth_required = true;
    return result;
  }
  if (mj && Array.isArray(mj.data)) {
    result.kind = hint === "lmstudio" ? "lmstudio" : (hint === "ollama" ? "ollama" : "openai-compatible");
    result.transport = "openai-compatible";
    result.endpoint = `${base}/v1`;
    result.health_http = models.status;
    result.models = mj.data.map((m) => m.id).filter(Boolean).slice(0, 20);
    return result;
  }

  if (hint === "cdp") return result;
  return result;
}

function iface({ id, kind, transport, display_name, found, source, exe_path, cli_path, endpoint, port, pid, listening, health_http, auth, notes, extra }) {
  // Discover never sets chat_ok. Authenticated means cred present (or none required)
  // and, when a health URL exists, it returned 200. Codex login is left unverified.
  const authOk = auth.auth_status !== "desktop_login_unverified" && auth.auth_status !== "missing" && (
    auth.auth_status === "none_required"
    || (auth.auth_needed === false && (health_http === 200 || (kind === "proxy" && found)))
  );
  return {
    id,
    kind,
    transport,
    display_name,
    found: !!found,
    source: source || [],
    exe_path: exe_path || null,
    cli_path: cli_path || null,
    endpoint: endpoint || null,
    port: port ?? null,
    pid: pid ?? null,
    listening: !!listening,
    health_http: health_http ?? null,
    ...auth,
    layers: layer(found, listening, authOk),
    notes: notes || [],
    ...(extra || {}),
  };
}

export async function discover({ ingestToken = true } = {}) {
  const scanned_at = new Date().toISOString();
  const home = os.homedir();
  let inv = { listening: [], processes: [], path_hits: [], dir_hits: [], hostname: os.hostname(), platform: process.platform };

  if (process.platform === "win32") {
    inv = await inventoryWindows();
  }

  const processes = inv.processes || [];
  const listening = inv.listening || [];
  const pathHits = inv.path_hits || [];
  const dirHits = inv.dir_hits || [];

  const loopbackPorts = new Map(); // port -> { addr, pid, name, exe, cmd_preview }
  for (const L of listening) {
    const loop = L.addr === "127.0.0.1" || L.addr === "[::1]" || L.addr === "::1";
    if (!loop && L.addr !== "0.0.0.0" && L.addr !== "[::]") continue;
    const proc = processes.find((p) => p.pid === L.pid);
    const prev = loopbackPorts.get(L.port);
    if (!prev || loop) {
      loopbackPorts.set(L.port, {
        addr: L.addr,
        pid: L.pid,
        name: proc?.name || null,
        exe: proc?.exe || null,
        cmd_preview: proc?.cmd_preview || null,
      });
    }
  }

  const interfaces = [];
  const notesGlobal = [];
  if (inv.error) notesGlobal.push(inv.error);

  // ---------- WorkBuddy ----------
  let wbCred = { serve_pid: null, port: null, token_present: false, auth_ref: "WB_TOKEN" };
  if (ingestToken && process.platform === "win32") {
    wbCred = await readWbServe();
  } else {
    const serve = processes.find((p) => /codebuddy --serve|cli\\bin\\codebuddy --serve/i.test(p.cmd_preview || ""));
    if (serve) {
      wbCred.serve_pid = serve.pid;
      wbCred.port = (serve.ports && serve.ports[0]) || null;
    }
    wbCred.token_present = !!process.env.WB_TOKEN;
  }

  const wbProc = processes.find((p) => /workbuddy/i.test(p.name || "") || /workbuddy/i.test(p.exe || ""))
    || processes.find((p) => /codebuddy --serve/i.test(p.cmd_preview || ""));
  const wbExe = wbProc?.exe
    || findDir(dirHits, "workbuddy_exe")
    || findPath(pathHits, ["WorkBuddy", "workbuddy"]);
  const wbCli = deriveCliFromExe(wbExe) || findDir(dirHits, "workbuddy_cli") || findPath(pathHits, ["codebuddy"]);
  const wbPort = wbCred.port || (wbProc?.ports || []).find((p) => p) || null;
  let wbHealth = null;
  if (wbPort && process.env.WB_TOKEN) {
    const h = await probe(`http://127.0.0.1:${wbPort}/api/v1/health`, {
      timeoutMs: 2000,
      headers: { "X-CodeBuddy-Request": "1", Authorization: `Bearer ${process.env.WB_TOKEN}` },
    });
    wbHealth = h.status || 0;
  } else if (wbPort) {
    const h = await probe(`http://127.0.0.1:${wbPort}/api/v1/health`, { timeoutMs: 1500 });
    wbHealth = h.status || 0;
  }

  const wbFound = !!(wbProc || wbExe || wbCli || wbPort);
  if (wbFound) {
    let auth;
    if (wbCred.token_present && process.env.WB_TOKEN) {
      auth = { auth_status: "from_process_env", auth_ref: "WB_TOKEN", auth_needed: false };
    } else {
      auth = markUserOrEnv("WB_TOKEN", "missing");
    }
    interfaces.push(iface({
      id: "workbuddy-serve",
      kind: "workbuddy",
      transport: "acp",
      display_name: "WorkBuddy",
      found: true,
      source: [
        wbProc ? "process" : null,
        wbPort ? "loopback_port" : null,
        wbExe && !wbProc ? "install_dir_or_path" : null,
      ].filter(Boolean),
      exe_path: wbExe,
      cli_path: wbCli,
      endpoint: wbPort ? `http://127.0.0.1:${wbPort}` : null,
      port: wbPort,
      pid: wbCred.serve_pid || wbProc?.pid || null,
      listening: !!wbPort,
      health_http: wbHealth,
      auth,
      notes: [
        "派发走已核实的官方 ACP；session/new 必须带 workingDirectory，不能只用 cwd。",
        "jobs 仍 EADDRINUSE，不要当作已修复。",
        wbCred.token_present ? "凭据已从本机 serve 进程环境读取到 WB_TOKEN，无需再问用户。" : (wbPort ? "已发现 serve 端口，但未从进程环境取到凭据。" : "未发现正在监听的 serve 端口。"),
      ],
      extra: { jobs_ok: false, jobs_issue: "后台 job 会与 GUI serve 抢同一端口（EADDRINUSE），待修复", adapter: "acp" },
    }));
  }

  // ---------- Codex ----------
  const envCodex = process.env.CODEX_JS && fs.existsSync(process.env.CODEX_JS) ? process.env.CODEX_JS : null;
  const codexJs = envCodex
    || findDir(dirHits, "codex_js")
    || (() => {
      const cmd = findPath(pathHits, ["codex"]) || findDir(dirHits, "codex_cmd");
      if (!cmd) return null;
      // If PATH hit is a shim, prefer sibling node_modules js when present.
      const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      const js = path.join(roaming, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
      return fs.existsSync(js) ? js : cmd;
    })();
  const codexCmd = findPath(pathHits, ["codex"]) || findDir(dirHits, "codex_cmd");
  const codexProc = processes.find((p) => /(^|\\)codex(\.exe)?$/i.test(p.name || "") || /@openai[\\/]codex/i.test(p.exe || "") || /@openai[\\/]codex/i.test(p.cmd_preview || ""));
  const codexFound = !!(codexJs || codexCmd || codexProc);
  if (codexFound) {
    interfaces.push(iface({
      id: "codex-cli",
      kind: "codex",
      transport: "cli",
      display_name: "Codex",
      found: true,
      source: [codexProc ? "process" : null, (codexJs || codexCmd) ? "path_or_install_dir" : null].filter(Boolean),
      exe_path: codexProc?.exe || null,
      cli_path: codexJs || codexCmd,
      endpoint: null,
      port: null,
      pid: codexProc?.pid || null,
      listening: false,
      health_http: null,
      auth: { auth_status: "desktop_login_unverified", auth_ref: null, auth_needed: false },
      notes: [
        "发现 CLI/桌面应用不等于 chat_ok，也不等于已登录已核实。",
        "本扫描不调用会消耗额度的 Codex 请求。",
      ],
      extra: { cli_js: codexJs && /\.js$/i.test(codexJs) ? codexJs : null, cli_cmd: codexCmd },
    }));
  }

  // ---------- Proxy (for Codex outbound), not an AI interface ----------
  const proxyProcs = processes.filter((p) => PROXY_PROCESS.test(`${p.name} ${p.exe} ${p.cmd_preview}`));
  const SYSTEM_PORTS = new Set([135, 139, 445, 53, 88, 389, 636, 3268, 3269, 5985, 5986, 47001, 2179, 5357, 7680]);
  const HTTP_PROXY_HINTS = [7890, 7897, 7891, 7892, 10809, 20171, 1080, 8118, 8888, 9090, 6152, 33210, 33331];
  const envProxy = process.env.CODEX_PROXY_PORT ? Number(process.env.CODEX_PROXY_PORT) : null;
  let proxyPort = null;
  let proxyPid = null;
  const procPorts = proxyProcs.flatMap((p) => (p.ports || []).filter((n) => !SYSTEM_PORTS.has(Number(n))));
  if (envProxy && !SYSTEM_PORTS.has(envProxy) && loopbackPorts.has(envProxy)) {
    proxyPort = envProxy;
    proxyPid = loopbackPorts.get(envProxy).pid;
  } else if (procPorts.length) {
    proxyPort = HTTP_PROXY_HINTS.find((n) => procPorts.includes(n)) || null;
    // Do not fall back to an arbitrary first port (e.g. 135 / epmap).
    if (proxyPort) {
      const owner = proxyProcs.find((p) => (p.ports || []).includes(proxyPort));
      proxyPid = owner?.pid || proxyProcs[0].pid;
    } else {
      proxyPid = proxyProcs[0].pid;
    }
  } else if (loopbackPorts.has(7890) && !SYSTEM_PORTS.has(7890)) {
    const meta = loopbackPorts.get(7890);
    if (meta?.name && PROXY_PROCESS.test(meta.name)) {
      proxyPort = 7890;
      proxyPid = meta.pid;
    }
  }
  if (proxyPort || proxyProcs.length) {
    interfaces.push(iface({
      id: "local-http-proxy",
      kind: "proxy",
      transport: "http-proxy",
      display_name: "本机 HTTP 代理（如 FlClash）",
      found: true,
      source: [proxyProcs.length ? "process" : "loopback_port"],
      exe_path: proxyProcs[0]?.exe || null,
      endpoint: proxyPort ? `http://127.0.0.1:${proxyPort}` : null,
      port: proxyPort,
      pid: proxyPid,
      listening: !!proxyPort,
      health_http: null,
      auth: { auth_status: "none_required", auth_ref: null, auth_needed: false },
      notes: [
        "这是出站代理，不是 AI 接口。发现端口不等于代理已对 ChatGPT 连通。禁止由本扫描重启该进程。",
        proxyPort ? null : "已找到代理进程，但没有识别到常见 HTTP 代理端口（不会把 135 等系统端口当成代理）。",
      ].filter(Boolean),
    }));
  }

  // ---------- Doubao / CDP / dsh-doubao-bridge ----------
  const doubaoProc = processes.find((p) => /doubao|豆包/i.test(p.name || "") || /doubao|豆包/i.test(p.exe || ""));
  const doubaoExe = doubaoProc?.exe || findDir(dirHits, "doubao_exe");
  const doubaoBridge = (process.env.DOUBAO_SERVER && fs.existsSync(process.env.DOUBAO_SERVER) ? process.env.DOUBAO_SERVER : null)
    || findDir(dirHits, "doubao_bridge")
    || processes.find((p) => /dsh-doubao-bridge/i.test(p.cmd_preview || "") || /dsh-doubao-bridge/i.test(p.exe || ""));
  const doubaoBridgePath = typeof doubaoBridge === "string" ? doubaoBridge : null;

  const cdpHintPorts = new Set([9222, 9225]);
  for (const [port, meta] of loopbackPorts) {
    if (meta.cmd_preview && /remote-debugging-port|9225|9222/i.test(meta.cmd_preview)) cdpHintPorts.add(port);
  }
  if (process.env.DOUBAO_CDP) {
    try {
      const u = new URL(process.env.DOUBAO_CDP);
      if (u.port) cdpHintPorts.add(Number(u.port));
    } catch {}
  }

  let cdpHit = null;
  for (const port of cdpHintPorts) {
    const fp = await fingerprint(port, "cdp");
    if (fp.detail === "cdp") { cdpHit = fp; cdpHit.pid = loopbackPorts.get(port)?.pid || doubaoProc?.pid || null; break; }
  }
  if (!cdpHit) {
    for (const [port, meta] of loopbackPorts) {
      if (cdpHintPorts.has(port)) continue;
      const blob = `${meta.name || ""} ${meta.exe || ""} ${meta.cmd_preview || ""}`;
      if (!/doubao|豆包|chrome|msedge|chromium|remote-debugging/i.test(blob)) continue;
      if (meta.name && SKIP_PROBE_PROCESS.test(meta.name)) continue;
      const fp = await fingerprint(port, "cdp");
      if (fp.detail === "cdp") { cdpHit = fp; cdpHit.pid = meta.pid; break; }
    }
  }

  const doubaoFound = !!(doubaoProc || doubaoExe || doubaoBridgePath || cdpHit);
  if (doubaoFound) {
    interfaces.push(iface({
      id: "doubao-cdp",
      kind: "doubao",
      transport: "desktop_bridge",
      display_name: "豆包",
      found: true,
      source: [
        doubaoProc ? "process" : null,
        cdpHit ? "cdp_probe" : null,
        doubaoBridgePath ? "install_dir" : null,
      ].filter(Boolean),
      exe_path: doubaoExe,
      cli_path: doubaoBridgePath,
      endpoint: cdpHit?.endpoint || null,
      port: cdpHit?.port || null,
      pid: cdpHit?.pid || doubaoProc?.pid || null,
      listening: !!cdpHit,
      health_http: cdpHit?.health_http || null,
      auth: { auth_status: "none_required", auth_ref: null, auth_needed: false },
      notes: [
        "CDP /json/version 成功只说明调试口在听，不是 chat_bridge=ok。",
        doubaoBridgePath ? "已找到 dsh-doubao-bridge。" : "未在常见目录找到 dsh-doubao-bridge；派发桌面工作任务仍需要该桥。",
        "本扫描不重启豆包进程。",
      ],
      extra: { adapter: "work-task", browser: cdpHit?.browser || null, bridge_cli: !!doubaoBridgePath },
    }));
  }

  // ---------- OpenAI-compatible local services (Ollama, LM Studio, others) ----------
  const claimedPorts = new Set();
  if (wbPort) claimedPorts.add(Number(wbPort));
  if (cdpHit?.port) claimedPorts.add(Number(cdpHit.port));
  if (proxyPort) claimedPorts.add(Number(proxyPort));
  claimedPorts.add(Number(process.env.BRIDGE_PORT || 5180));

  const unidentified = [];
  const probeQueue = [];
  const interestingName = /ollama|lm.?studio|lmstudio|openai|litellm|vllm|llama|openclaw|dsh-doubao|workbuddy-to-dsh|codebuddy|one-api|nextchat|open-webui/i;
  for (const [port, hint] of Object.entries(HINT_PORTS)) {
    const p = Number(port);
    if (claimedPorts.has(p)) continue;
    if (hint === "cdp") continue;
    probeQueue.push({ port: p, hint, meta: loopbackPorts.get(p) || null });
  }
  for (const [port, meta] of loopbackPorts) {
    if (claimedPorts.has(port)) continue;
    if (HINT_PORTS[port]) continue;
    if (meta.name && SKIP_PROBE_PROCESS.test(meta.name)) {
      unidentified.push({ port, pid: meta.pid, name: meta.name });
      continue;
    }
    if (interestingName.test(`${meta.name || ""} ${meta.exe || ""} ${meta.cmd_preview || ""}`)) {
      const hint = /ollama/i.test(meta.name || "") ? "ollama" : (/lm.?studio|lmstudio/i.test(meta.name || "") ? "lmstudio" : null);
      probeQueue.push({ port, hint, meta });
    } else if (meta && meta.name) {
      unidentified.push({ port, pid: meta.pid, name: meta.name });
    }
  }

  const seenFp = new Set();
  for (const item of probeQueue) {
    if (seenFp.has(item.port)) continue;
    seenFp.add(item.port);
    const fp = await fingerprint(item.port, item.hint);
    if (!fp.kind) {
      if (item.meta && item.hint) {
        // Hint port not responding: do not invent an interface. Record absence only if a process exists.
      }
      if (item.meta && !item.hint && item.meta.name && !SKIP_PROBE_PROCESS.test(item.meta.name)) {
        unidentified.push({ port: item.port, pid: item.meta.pid, name: item.meta.name });
      }
      continue;
    }
    if (fp.kind === "doubao") continue;
    const name = fp.kind === "ollama" ? "Ollama" : fp.kind === "lmstudio" ? "LM Studio" : "OpenAI 兼容本地服务";
    const proc = processes.find((p) => (p.ports || []).includes(item.port)) || item.meta;
    const exe = proc?.exe
      || (fp.kind === "ollama" ? findDir(dirHits, "ollama_exe") || findPath(pathHits, ["ollama"]) : null)
      || (fp.kind === "lmstudio" ? findDir(dirHits, "lmstudio_exe") : null);
    const defaultAuthRef = fp.kind === "ollama" ? "OLLAMA_API_KEY" : "OPENAI_API_KEY";
    let auth;
    if (fp.auth_required) {
      auth = markUserOrEnv(defaultAuthRef, "missing");
      if (auth.auth_status === "missing") auth.auth_needed = true;
    } else if (fp.kind === "ollama" && fp.health_http === 200) {
      auth = { auth_status: "none_required", auth_ref: null, auth_needed: false };
    } else {
      auth = markUserOrEnv(defaultAuthRef, "none_required");
      if (auth.auth_status === "missing") {
        auth = { auth_status: "none_required", auth_ref: defaultAuthRef, auth_needed: false };
      }
    }
    interfaces.push(iface({
      id: `${fp.kind}-${item.port}`,
      kind: fp.kind,
      transport: "openai-compatible",
      display_name: name,
      found: true,
      source: [proc ? "process" : null, "loopback_probe"].filter(Boolean),
      exe_path: exe,
      endpoint: fp.endpoint,
      port: item.port,
      pid: proc?.pid || item.meta?.pid || null,
      listening: true,
      health_http: fp.health_http,
      auth,
      notes: [
        "探测 /v1/models 或 /api/version 成功只说明接口在听，不是已核实可对话。",
        fp.models && fp.models.length ? `模型目录（声称）：${fp.models.slice(0, 8).join(", ")}` : null,
      ].filter(Boolean),
      extra: { models: fp.models || [] },
    }));
    claimedPorts.add(item.port);
  }

  // Ollama/LM Studio installed but not listening
  if (!interfaces.some((i) => i.kind === "ollama")) {
    const exe = findDir(dirHits, "ollama_exe") || findPath(pathHits, ["ollama"]);
    const proc = processes.find((p) => /ollama/i.test(p.name || "") || /ollama/i.test(p.exe || ""));
    if (exe || proc) {
      interfaces.push(iface({
        id: "ollama-installed",
        kind: "ollama",
        transport: "openai-compatible",
        display_name: "Ollama",
        found: true,
        source: [proc ? "process" : "install_dir_or_path"],
        exe_path: exe || proc?.exe,
        pid: proc?.pid || null,
        listening: false,
        auth: { auth_status: "none_required", auth_ref: null, auth_needed: false },
        notes: ["已找到 Ollama，但本机环回端口上还没有探测到 /api/version。安装在不等于服务在听。"],
      }));
    }
  }

  const needs_credential = interfaces
    .filter((i) => i.auth_needed && i.found && i.auth_ref)
    .map((i) => ({
      interface_id: i.id,
      auth_ref: i.auth_ref,
      prompt: `已发现「${i.display_name}」，但缺少凭据。请只填写密钥（环境变量 ${i.auth_ref}），不必填端口或安装路径。`,
    }));

  return stripSecrets({
    scanned_at,
    machine: { hostname: inv.hostname || os.hostname(), platform: inv.platform || process.platform },
    interfaces,
    needs_credential,
    unidentified_loopback: unidentified.slice(0, 40),
    notes: notesGlobal,
  });
}

export function applyDiscovery(report, runtime) {
  const next = { ...runtime };
  const wb = (report.interfaces || []).find((i) => i.kind === "workbuddy");
  if (wb) {
    if (wb.port) next.WB_PORT = String(wb.port);
    if (wb.exe_path) next.WB_EXE = wb.exe_path;
    if (wb.cli_path) next.WB_CLI = wb.cli_path;
  }
  const codex = (report.interfaces || []).find((i) => i.kind === "codex");
  if (codex) {
    if (codex.cli_js) next.CODEX_JS = codex.cli_js;
    else if (codex.cli_path) next.CODEX_JS = codex.cli_path;
    if (codex.cli_cmd) next.CODEX_CMD = codex.cli_cmd;
  }
  const doubao = (report.interfaces || []).find((i) => i.kind === "doubao");
  if (doubao) {
    if (doubao.endpoint) next.DOUBAO_CDP = doubao.endpoint;
    if (doubao.cli_path) next.DOUBAO_SERVER = doubao.cli_path;
  }
  const proxy = (report.interfaces || []).find((i) => i.kind === "proxy" && i.port);
  if (proxy) next.PROXY_PORT = Number(proxy.port);
  return next;
}

export function setUserSecret(authRef, secret) {
  if (!ALLOWED_AUTH_REFS.includes(authRef)) {
    return { ok: false, error: "auth_ref 不在允许名单中" };
  }
  if (!secret || typeof secret !== "string") {
    return { ok: false, error: "缺少密钥" };
  }
  process.env[authRef] = secret;
  process.env[`_AUTH_SOURCE_${authRef}`] = "user";
  if (authRef === "CODEBUDDY_GATEWAY_PASSWORD" && !process.env.WB_TOKEN) {
    process.env.WB_TOKEN = secret;
    process.env._AUTH_SOURCE_WB_TOKEN = "user";
  }
  return { ok: true, auth_ref: authRef, auth_status: "user_provided_ref" };
}
