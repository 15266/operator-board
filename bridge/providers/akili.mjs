// AKILI (a Grok Bot agent) as a dispatchable executor via a webhook routine.
// Secrets: AKILI_WEBHOOK_URL + AKILI_WEBHOOK_AUTH (primary: ready-made Authorization header value from the routine panel, sent verbatim).
//  Fallback when AUTH is unset: AKILI_WEBHOOK_KEY (+ AKILI_WEBHOOK_KEY_HEADER). If both are set, AUTH wins.
//  - read once from the bridge env at startup, then DELETED from process.env so no child process inherits them
//  - may also be entered at runtime via POST /bridge/credentials {auth_ref, secret} (kept in memory only)
//  - never returned, logged, or stored in dispatch records / kb (only booleans and the header NAME are exposed)
import path from "node:path";
import fs from "node:fs";

export const AKILI_REFS = Object.freeze(["AKILI_WEBHOOK_URL", "AKILI_WEBHOOK_AUTH", "AKILI_WEBHOOK_KEY", "AKILI_WEBHOOK_KEY_HEADER"]);
export const DEFAULT_KEY_HEADER = "Authorization"; // fallback path only: sent as "Bearer <key>"; any other header name gets the raw key
const HEADER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const RESERVED_HEADERS = new Set(["host", "content-length", "content-type", "connection", "transfer-encoding"]);

export function createAkili({ env = process.env, scrubEnv = true, fetchImpl = (...a) => fetch(...a), timeoutMs = 15000 } = {}) {
  const store = { url: "", auth: "", key: "", header: "" };
  const source = { url: null, auth: null, key: null, header: null };
  const take = (ref, field) => { const v = env[ref]; if (typeof v === "string" && v.trim()) { store[field] = v.trim(); source[field] = "env"; } if (scrubEnv) delete env[ref]; };
  take("AKILI_WEBHOOK_URL", "url"); take("AKILI_WEBHOOK_AUTH", "auth"); take("AKILI_WEBHOOK_KEY", "key"); take("AKILI_WEBHOOK_KEY_HEADER", "header");

  function validUrl(u) { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; } }
  function headerName() { return store.auth ? "Authorization" : (store.header || DEFAULT_KEY_HEADER); }
  function authMode() { return store.auth ? "auth" : store.key ? "key" : "none"; }
  function configured() { return validUrl(store.url); }

  /** /bridge/credentials hook. Returns null when ref is not an AKILI ref (caller falls back to setUserSecret). */
  function setCredential(ref, value) {
    if (!AKILI_REFS.includes(ref)) return null;
    if (typeof value !== "string" || !value.trim() || value.length > 4096) return { ok: false, error: "缺少密钥" };
    const v = value.trim();
    if (ref === "AKILI_WEBHOOK_URL" && !validUrl(v)) return { ok: false, error: "AKILI_WEBHOOK_URL 必须是 http(s) 地址" };
    if (ref === "AKILI_WEBHOOK_AUTH" && /[\r\n]/.test(v)) return { ok: false, error: "AKILI_WEBHOOK_AUTH 不能包含换行" };
    if (ref === "AKILI_WEBHOOK_KEY_HEADER" && (!HEADER_RE.test(v) || RESERVED_HEADERS.has(v.toLowerCase()))) return { ok: false, error: "请求头名称无效" };
    const field = { AKILI_WEBHOOK_URL: "url", AKILI_WEBHOOK_AUTH: "auth", AKILI_WEBHOOK_KEY: "key", AKILI_WEBHOOK_KEY_HEADER: "header" }[ref];
    store[field] = v; source[field] = "user";
    return { ok: true, auth_ref: ref, auth_status: "user_provided_ref" };
  }

  /** Values to redact anywhere (logs, events, kb). */
  function secretValues() { const out = [store.auth, store.key]; { const m = /^\S+\s+(\S.*)$/.exec(store.auth); if (m && m[1].length >= 6) out.push(m[1]); } if (store.url) { out.push(store.url); try { const u = new URL(store.url); if (u.search.length > 1) out.push(u.search.slice(1)); for (const v of u.searchParams.values()) if (v.length >= 6) out.push(v); } catch {} } return out.filter(Boolean); }

  function publicConfig() {
    return { url_configured: configured(), url_source: source.url, auth_configured: !!store.auth, auth_source: source.auth, auth_mode: authMode(), key_configured: !!store.key, key_source: source.key, key_header: headerName(), key_header_source: source.header || "default" };
  }

  /** POST the dispatch. Resolves { ok, status? , error_code? } and never includes the URL or key. */
  async function send(payload) {
    if (!configured()) return { ok: false, error_code: "not_configured" };
    const headers = { "Content-Type": "application/json" };
    if (store.auth) headers.Authorization = store.auth; // primary: verbatim
    else if (store.key) { const h = headerName(); headers[h] = h.toLowerCase() === "authorization" && !/^bearer\s/i.test(store.key) ? `Bearer ${store.key}` : store.key; }
    try {
      const r = await fetchImpl(store.url, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
      try { await r.arrayBuffer(); } catch {}
      return r.status >= 200 && r.status < 300 ? { ok: true, status: r.status } : { ok: false, status: r.status };
    } catch (e) {
      const code = e?.cause?.code || e?.code || (e?.name === "TimeoutError" ? "timeout" : "network_error");
      return { ok: false, error_code: String(code).replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "network_error" };
    }
  }

  const provider = {
    id: "akili", name: "AKILI (Grok Bot webhook)", kind: "webhook",
    capabilities: { dispatch: true, result_callback: true, status: true, sessions: false, processes: false },
    async status() {
      const cfg = publicConfig();
      const base = { id: "akili", limits: [], source: "bridge config (env / /bridge/credentials)", recorded_at: new Date().toISOString(), config: cfg };
      if (!cfg.url_configured) return { ...base, available: false, reason: "未录入 AKILI webhook" };
      if (!cfg.auth_configured && !cfg.key_configured) return { ...base, available: true, reason: "已录入 webhook 地址，但未录入 AKILI_WEBHOOK_AUTH（或备用 AKILI_WEBHOOK_KEY）；如例程需要鉴权，派发会被拒" };
      return { ...base, available: true };
    },
    async sessions() { return { available: false, reason: "AKILI 是 Grok Bot 例程，桥接没有它的会话接口；结果通过 POST /bridge/dispatch/<id>/result 回写", total: 0, items: [] }; },
    async processes() { return { available: false, reason: "AKILI 运行在 Grok Bot 云端，不是本机进程", items: [] }; },
  };
  return { provider, configured, setCredential, secretValues, publicConfig, send, headerName };
}

/** Payload sent to the webhook (only the documented fields). */
export function akiliPayload(rec) {
  return { dispatch_id: rec.id, title: rec.title || "", prompt: rec.prompt || "", project_id: rec.project_id || null, task_id: rec.task_id || null,
    project_dir: rec.project_dir || null, model: rec.model || null, expect_files: rec.expect_files || null, expect_marker: rec.expect_marker || null, kb_refs: Array.isArray(rec.kb_refs) ? rec.kb_refs : [] };
}

const lower = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
function under(child, root) { const c = lower(path.resolve(child)), r = lower(path.resolve(root)); return c === r || c.startsWith(r + path.sep); }
function realOr(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }

/**
 * Validates POST /bridge/dispatch/<id>/result. Returns { reply, files:[abs], reported_state } or throws {status:400}.
 * files: relative (to project_dir, else dispatch dir) or absolute; must stay inside project_dir or dispatch dir (realpath when the file exists).
 */
export function validateAkiliResult(body, { projectDir = null, dispatchDir }) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("请求必须是 JSON 对象");
  if (body.reply != null && (typeof body.reply !== "string" || body.reply.length > 128000)) throw bad("reply 必须是不超过 128000 字的文本");
  if (body.state != null && (typeof body.state !== "string" || body.state.length > 40)) throw bad("state 必须是短文本（仅作参考）");
  const files = body.files == null ? [] : body.files;
  if (!Array.isArray(files) || files.length > 200) throw bad("files 必须是最多 200 项的路径数组");
  const roots = [projectDir, dispatchDir].filter(Boolean).map(realOr);
  const base = projectDir || dispatchDir;
  const out = [];
  for (const f of files) {
    if (typeof f !== "string" || !f.trim() || f.length > 500 || f.includes("\0")) throw bad("files 每项必须是非空路径");
    if (f.split(/[\\/]+/).includes("..")) throw bad("files 不允许包含 ..：" + f.slice(0, 80));
    const abs = path.isAbsolute(f) || path.win32.isAbsolute(f) ? path.resolve(f) : path.resolve(base, f);
    const resolved = fs.existsSync(abs) ? realOr(abs) : abs;
    if (!roots.some((r) => under(resolved, r))) throw bad("files 路径超出 project_dir / 派发目录：" + f.slice(0, 80));
    out.push(resolved);
  }
  return { reply: body.reply ?? null, files: out, reported_state: body.state ?? null };
}
