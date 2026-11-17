// Codex local status for the Operator Board bridge (read-only).
// Practices ported from MmCodexMgr (https://github.com/Haki-sheep/MmCodexMgr):
//  - sessions come from CODEX_HOME/state_5.sqlite `threads` opened read-only
//    (Source/AgentManagement/AgentCatalog.cs:34-54, Source/ConversationDatabase.cs:7-17)
//  - Codex processes are enumerated via Win32_Process, filtering Electron helper processes
//    (Source/InstanceService.cs:13-37)
//  - credential files are only inspected for presence; auth.json is never copied out
// Rate limits are NOT in MmCodexMgr; they are read from Codex's own rollout files
// (event_msg/token_count -> payload.rate_limits), which Codex writes after each turn.
// Never returns token values, auth.json contents or full command lines.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

export function codexHome() {
  return process.env.CODEX_HOME && fs.existsSync(process.env.CODEX_HOME) ? process.env.CODEX_HOME : path.join(os.homedir(), ".codex");
}

function listRollouts(home, limit = 400) {
  const out = [];
  for (const sub of ["sessions", "archived_sessions"]) {
    const walk = (dir, depth) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && depth < 4) walk(full, depth + 1);
        else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) {
          try { const st = fs.statSync(full); out.push({ file: full, mtimeMs: st.mtimeMs, size: st.size, archived: sub === "archived_sessions" }); } catch {}
        }
      }
    };
    walk(path.join(home, sub), 0);
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, limit);
}

// Read only the tail of a rollout so large sessions stay cheap.
function tailLines(file, bytes = 256 * 1024) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split(/\r?\n/);
    if (start > 0) lines.shift();
    return lines.filter(Boolean);
  } finally { fs.closeSync(fd); }
}

function windowView(w) {
  if (!w || typeof w !== "object") return null;
  const resets = Number(w.resets_at);
  return {
    used_percent: typeof w.used_percent === "number" ? w.used_percent : null,
    window_minutes: typeof w.window_minutes === "number" ? w.window_minutes : null,
    resets_at: Number.isFinite(resets) && resets > 0 ? new Date(resets * 1000).toISOString() : null,
  };
}

export function readRateLimits(home = codexHome(), maxFiles = 30) {
  for (const r of listRollouts(home, maxFiles)) {
    let lines = [];
    try { lines = tailLines(r.file); } catch { continue; }
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"token_count"')) continue;
      let j; try { j = JSON.parse(lines[i]); } catch { continue; }
      const rl = j?.payload?.type === "token_count" ? j.payload.rate_limits : null;
      if (!rl) continue;
      const observed = j.timestamp || new Date(r.mtimeMs).toISOString();
      return {
        ok: true,
        source: "Codex rollout event_msg/token_count.rate_limits（本机文件，非实时接口）",
        source_file: r.file,
        observed_at: observed,
        age_minutes: Math.round((Date.now() - Date.parse(observed)) / 60000),
        limit_id: rl.limit_id ?? null,
        plan_type: rl.plan_type ?? null,
        primary: windowView(rl.primary),
        secondary: windowView(rl.secondary),
        credits: rl.credits ? { has_credits: !!rl.credits.has_credits, unlimited: !!rl.credits.unlimited } : null,
        rate_limit_reached_type: rl.rate_limit_reached_type ?? null,
        note: "数值是该会话最后一次回合结束时 Codex 记录的快照；之后其它地方（桌面端/其它会话）的用量不会反映，越旧越不准",
      };
    }
  }
  return { ok: false, error: "最近的会话文件里没有 token_count/rate_limits 记录", source_file: null };
}

export function readAccount(home = codexHome()) {
  const file = path.join(home, "auth.json");
  const out = { home, auth_file: fs.existsSync(file) };
  if (!out.auth_file) return out;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    out.auth_mode = typeof j.auth_mode === "string" ? j.auth_mode : null;
    out.api_key_present = !!j.OPENAI_API_KEY;
    out.token_fields = j.tokens && typeof j.tokens === "object" ? Object.keys(j.tokens).filter((k) => !!j.tokens[k]).sort() : [];
    out.last_refresh = typeof j.last_refresh === "string" ? j.last_refresh : null;
  } catch { out.parse_error = true; }
  return out;
}

async function openStateDb(home) {
  const file = path.join(home, "state_5.sqlite");
  if (!fs.existsSync(file)) return null;
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(file, { readOnly: true });
}

function linkDispatch(dispatches, id) {
  const d = (dispatches || []).find((x) => x?.evidence?.session_id === id);
  return d ? { id: d.id, state: d.state, task_id: d.task_id || null } : null;
}

export async function listSessions({ home = codexHome(), limit = 20, offset = 0, dispatches = [] } = {}) {
  limit = Math.min(100, Math.max(1, Number(limit) || 20));
  offset = Math.max(0, Number(offset) || 0);
  let db = null;
  try { db = await openStateDb(home); } catch (e) { db = null; }
  if (db) {
    try {
      const cols = new Set(db.prepare("PRAGMA table_info(threads)").all().map((c) => c.name));
      const pick = (c, alias = c) => (cols.has(c) ? `${c} AS ${alias}` : `NULL AS ${alias}`);
      const title = cols.has("name") ? "COALESCE(NULLIF(name,''),title)" : "title";
      const rows = db.prepare(`SELECT id, ${title} AS title, ${pick("source")}, ${pick("cwd")}, ${pick("model")}, ${pick("updated_at")}, ${pick("tokens_used")}, ${pick("rollout_path")} FROM threads WHERE archived=0 ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`).all(limit, offset);
      const total = db.prepare("SELECT count(*) AS n FROM threads WHERE archived=0").get().n;
      return {
        ok: true, source: "state_5.sqlite threads（只读）", total, offset, limit,
        sessions: rows.map((r) => ({
          id: r.id, title: String(r.title || "").slice(0, 120), source: r.source, cwd: r.cwd, model: r.model,
          updated_at: r.updated_at ? new Date(Number(r.updated_at) * 1000).toISOString() : null,
          tokens_used: r.tokens_used, rollout_exists: r.rollout_path ? fs.existsSync(r.rollout_path) : false,
          thread_url: `codex://threads/${r.id}`, dispatch: linkDispatch(dispatches, r.id),
        })),
      };
    } finally { try { db.close(); } catch {} }
  }
  // Fallback: rollout files, session_meta on the first line.
  const all = listRollouts(home);
  const sessions = [];
  for (const r of all.slice(offset, offset + limit)) {
    let meta = null;
    try { const first = fs.readFileSync(r.file, "utf8").split(/\r?\n/, 1)[0]; const j = JSON.parse(first); if (j.type === "session_meta") meta = j.payload; } catch {}
    const id = meta?.id || (/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i.exec(r.file) || [])[1] || null;
    sessions.push({ id, title: null, source: meta?.source || null, cwd: meta?.cwd || null, model: null, updated_at: new Date(r.mtimeMs).toISOString(), tokens_used: null, rollout_exists: true, archived: r.archived, thread_url: id ? `codex://threads/${id}` : null, dispatch: id ? linkDispatch(dispatches, id) : null });
  }
  return { ok: true, source: "sessions/*.jsonl（state_5.sqlite 不可用时的兜底）", total: all.length, offset, limit, sessions };
}

// Win32_Process listing like MmCodexMgr InstanceService.ListRunning, read-only.
export function listCodexProcesses(bridgePid = process.pid) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve({ ok: false, error: "仅支持 Windows", processes: [] });
    const ps = "Get-CimInstance Win32_Process -Filter \"Name='codex.exe' OR Name='node.exe'\" | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{n='Created';e={$_.CreationDate.ToString('o')}} | ConvertTo-Json -Compress";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: "进程查询失败", processes: [] });
      let rows = []; try { rows = JSON.parse(stdout || "[]"); } catch {}
      if (!Array.isArray(rows)) rows = [rows];
      const alive = new Set(rows.map((r) => r.ProcessId));
      const isBridge = (r) => r && /bridge[\\/]server\.mjs/i.test(String(r.CommandLine || ""));
      const byPid = new Map(rows.map((r) => [r.ProcessId, r]));
      const procs = rows.filter((r) => /^codex\.exe$/i.test(r.Name)).map((r) => {
        const cl = String(r.CommandLine || "");
        const exec = /\sexec(\s|$)/.test(cl);
        const parent = byPid.get(r.ParentProcessId);
        let owner = "other";
        if (exec && r.ParentProcessId === bridgePid) owner = "this_bridge";
        else if (exec && isBridge(parent)) owner = "other_bridge";
        else if (exec && !alive.has(r.ParentProcessId)) owner = "orphan_exec";
        else if (exec) owner = "exec_other_parent";
        return { pid: r.ProcessId, parent_pid: r.ParentProcessId, created: r.Created || null, exec, owner,
          flags: { read_only_sandbox: /--sandbox\s+read-only/.test(cl), unelevated: /windows\.sandbox=.?"?unelevated/.test(cl), has_cwd: /\s-C\s/.test(cl), has_model: /\s-m\s/.test(cl) } };
      });
      resolve({ ok: true, bridge_pid: bridgePid, processes: procs,
        summary: procs.reduce((a, p) => { a[p.owner] = (a[p.owner] || 0) + 1; return a; }, {}),
        note: "只读。owner=orphan_exec 表示 codex exec 的父进程已不存在（多为桥接重启后遗留），不会自动结束；结束前需人工确认 PID" });
    });
  });
}

/** Returns true when the route was handled. `send(code, body)` writes the JSON response. */
export async function handleCodexHttp(url, method, send, ctx = {}) {
  if (!url.pathname.startsWith("/bridge/codex")) return false;
  if (method !== "GET") { send(405, { error: "只支持 GET（只读接口）" }); return true; }
  const dispatches = typeof ctx.dispatches === "function" ? ctx.dispatches() : [];
  const home = codexHome();
  if (url.pathname === "/bridge/codex/status") {
    const used = dispatches.filter((d) => d.executor === "codex").length;
    send(200, { ok: true, account: readAccount(home), rate_limits: readRateLimits(home), bridge_counter: { used: ctx.used ?? null, max: ctx.max ?? null, codex_dispatch_records: used, note: "桥接自己的派发计数，与官方额度无关" } });
    return true;
  }
  if (url.pathname === "/bridge/codex/sessions") {
    try { send(200, await listSessions({ home, limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset"), dispatches })); }
    catch (e) { send(500, { ok: false, error: "读取会话失败：" + String(e.message || e).slice(0, 200) }); }
    return true;
  }
  if (url.pathname === "/bridge/codex/processes") { send(200, await listCodexProcesses(ctx.bridgePid || process.pid)); return true; }
  send(404, { error: "未知 codex 接口", routes: ["/bridge/codex/status", "/bridge/codex/sessions?limit=&offset=", "/bridge/codex/processes"] });
  return true;
}
