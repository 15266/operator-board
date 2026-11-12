// Operator Board local dispatch bridge.
// Zero-dependency Node HTTP server (pattern: small loopback "agent gateway" like
// Open WebUI pipelines / LibreChat agents — UI posts a job, bridge runs an adapter,
// UI polls job state). Binds 127.0.0.1 only. Never logs secrets.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { adapterWorkBuddyGui } from "./workbuddy-gui.mjs";
import { listWorkBuddyModels } from "./workbuddy-models.mjs";
import { applyDiscovery, discover as scanLocal, redactSecrets as discoverRedact, setUserSecret, stripSecrets } from "./discover.mjs";
import { handleScanHttp, scanLocal as scanWithPlugins, createLiveHost, assertNoSecrets as assertScannerNoSecrets, promoteDraft } from "./scanners/loader.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");
const AKILI = path.resolve(BOARD, "..");
const LOGS = path.join(BOARD, "logs");
const STATE_FILE = path.join(LOGS, "dispatches.json");
const PLAN_FILE = path.join(HERE, "test-plan.json");
const PORT = Number(process.env.BRIDGE_PORT || 5180);
const HOME = os.homedir();

/** Last good /bridge/models answer, so the UI does not open a session per render. */
let modelCache = { at: 0, executor: "", body: null };

let WB_TOKEN = process.env.WB_TOKEN || "";
let WB_PORT = process.env.WB_PORT || "";
let WB_EXE = process.env.WB_EXE || "";
let WB_CLI = process.env.WB_CLI || "";
let CODEX_JS = process.env.CODEX_JS || "";
let CODEX_CMD = "";
let DOUBAO_SERVER = process.env.DOUBAO_SERVER || "";
let DOUBAO_CDP = process.env.DOUBAO_CDP || "";
let PROXY_PORT = process.env.CODEX_PROXY_PORT ? Number(process.env.CODEX_PROXY_PORT) : 0;
let lastDiscover = null;
const CODEX_MAX = Number(process.env.CODEX_MAX || 1);
const CODEX_NET_FAIL = /routing discovery timed out|Reconnecting\.\.\. 5\/5|error sending request/;

fs.mkdirSync(LOGS, { recursive: true });

function now() { return new Date().toISOString(); }
function log(...a) { const line = `[${now()}] ` + a.join(" ") + "\n"; fs.appendFileSync(path.join(LOGS, "bridge.log"), line); }
function redact(s) {
  return discoverRedact(s, [WB_TOKEN, process.env.CODEBUDDY_GATEWAY_PASSWORD]);
}

let state = { dispatches: [], codexUsed: 0 };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch {}
function save() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

function loadPlan() { try { return JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")); } catch { return null; } }

function newRecord(body) {
  const id = "d-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const rec = {
    id, executor: body.executor, task_id: body.task_id || null, project_id: body.project_id || null,
    title: body.title || "", model: body.model || null, prompt: body.prompt || "",
    state: "queued", via: null, created_at: now(), updated_at: now(), finished_at: null,
    reply: null, evidence: {}, checks: [], error: null, events: [],
  };
  state.dispatches.unshift(rec);
  state.dispatches = state.dispatches.slice(0, 200);
  save();
  return rec;
}
function update(rec, patch, event) {
  Object.assign(rec, patch, { updated_at: now() });
  if (event) rec.events.push({ ts: now(), msg: redact(event) });
  if (rec.events.length > 60) rec.events = rec.events.slice(-60);
  save();
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = "", err = "";
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env || process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) { resolve({ code: -1, out, err: String(e) }); return; }
    const timer = setTimeout(() => { err += "\n[bridge] timeout"; try { child.kill(); } catch {} }, opts.timeoutMs || 300000);
    child.stdout.on("data", (d) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });
    child.on("error", (e) => { err += String(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (opts.stdin != null) child.stdin.end(opts.stdin, "utf8"); else child.stdin.end();
  });
}

function applyChecks(rec, expect) {
  const checks = [];
  const reply = rec.reply || "";
  if (expect?.token) checks.push({ name: `回复包含 ${expect.token}`, ok: reply.includes(expect.token) });
  if (expect?.file) {
    let ok = false, detail = "";
    try { const c = fs.readFileSync(expect.file, "utf8"); ok = expect.token ? c.includes(expect.token) : true; detail = c.slice(0, 200); } catch (e) { detail = "文件不存在"; }
    checks.push({ name: `文件 ${expect.file}`, ok, detail });
  }
  if (!expect) checks.push({ name: "收到非空回复（无预设校验）", ok: reply.trim().length > 0 });
  const allOk = checks.length > 0 && checks.every((c) => c.ok);
  return { checks, allOk };
}

// ---------------- WorkBuddy ----------------
async function wbFetch(p, init = {}) {
  const r = await fetch(`http://127.0.0.1:${WB_PORT}${p}`, {
    ...init,
    headers: { "X-CodeBuddy-Request": "1", Authorization: `Bearer ${WB_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
function collectText(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, out)); return; }
  const kind = node.sessionUpdate || node.type || "";
  if (/agent_message/.test(String(kind)) && node.content) {
    const c = node.content;
    if (typeof c === "string") out.push(c);
    else if (typeof c.text === "string") out.push(c.text);
    else if (Array.isArray(c)) c.forEach((x) => typeof x?.text === "string" && out.push(x.text));
    return;
  }
  for (const v of Object.values(node)) if (v && typeof v === "object") collectText(v, out);
}
async function adapterWorkBuddyJobs(rec, expect, cwd) {
  if (!WB_TOKEN || !WB_PORT) throw new Error("未拿到 WorkBuddy serve 端口/凭据（桥接需由 start-bridge.ps1 启动）");
  const health = await wbFetch("/api/v1/health");
  update(rec, { via: "workbuddy POST /api/v1/jobs" }, `health ${health.status}`);
  const res = await wbFetch("/api/v1/jobs", { method: "POST", body: JSON.stringify({ prompt: rec.prompt, cwd, name: `akili-${rec.task_id || rec.id}`.slice(0, 60), permissionMode: "acceptEdits", ...(rec.model ? { model: rec.model } : {}) }) });
  const job = res.json?.data?.job || res.json?.data || {};
  const jobId = job.id || job.shortId;
  update(rec, { evidence: { ...rec.evidence, job_post_status: res.status, job_id: jobId || null, cwd } }, `POST /api/v1/jobs -> ${res.status} ${redact(res.text).slice(0, 300)}`);
  if (!jobId) throw new Error(`jobs 派发失败 HTTP ${res.status}: ${redact(res.text).slice(0, 300)}`);
  update(rec, { state: "running" });
  const deadline = Date.now() + 8 * 60 * 1000;
  let last = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const g = await wbFetch(`/api/v1/jobs/${jobId}`);
    last = g.json?.data?.job || g.json?.data || null;
    if (!last) continue;
    const st = `${last.state}/${last.tempo || last.status || ""} alive=${last.alive} settled=${last.settled}`;
    if (st !== rec.evidence.job_state_raw) update(rec, { evidence: { ...rec.evidence, job_state: last.state, job_state_raw: st, job_detail: last.detail || null, session_id: last.sessionId || null } }, `job ${jobId} ${st} ${last.detail || ""}`);
    if (["done", "failed", "stopped"].includes(last.state) || (last.settled && !last.alive)) break;
    if (last.state === "blocked") { update(rec, {}, "job blocked（等待输入/授权，需在 WorkBuddy 里处理）"); }
  }
  const tr = await wbFetch(`/api/v1/jobs/${jobId}/transcript`);
  const parts = []; collectText(tr.json?.data?.updates || [], parts);
  const reply = parts.join("").trim();
  let jobLog = "";
  try { jobLog = fs.readFileSync(path.join(HOME, ".workbuddy", "logs", `job-${jobId}.log`), "utf8").slice(-1500); } catch {}
  update(rec, { reply: reply || null, evidence: { ...rec.evidence, transcript_updates: (tr.json?.data?.updates || []).length, job_log_tail: redact(jobLog) } });
  if (!last || last.state !== "done") {
    throw new Error(`job ${jobId} 结束状态 ${last?.state || "unknown"}：${last?.detail || ""}${/EADDRINUSE/.test(jobLog) ? "（日志：子进程 listen EADDRINUSE 127.0.0.1:" + WB_PORT + "，WorkBuddy 精简版 CLI 把后台 job 当交互模式，抢 GUI serve 的端口）" : ""}`);
  }
  return true;
}
async function adapterWorkBuddyPrint(rec, cwd) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", CODEBUDDY_CONFIG_DIR: path.join(HOME, ".workbuddy"), CODEBUDDY_FORCE_LITE_WB_BUNDLE: "1", CODEBUDDY_SKIP_GIT_BASH_CHECK: "1" };
  delete env.WB_TOKEN; delete env.CODEBUDDY_GATEWAY_PASSWORD;
  const args = [WB_CLI, "-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--max-turns", "6"];
  if (rec.model) args.push("--model", rec.model);
  args.push(rec.prompt);
  update(rec, { via: "workbuddy CLI codebuddy -p（WorkBuddy 自带 CLI，同一登录；不进 GUI 任务列表）", state: "running" }, "spawn codebuddy -p");
  const r = await run(WB_EXE, args, { cwd, env, timeoutMs: 6 * 60 * 1000 });
  let reply = r.out.trim(); let sessionId = null;
  try { const j = JSON.parse(r.out.trim().split(/\r?\n/).filter(Boolean).pop()); reply = j.result ?? j.text ?? reply; sessionId = j.session_id || j.sessionId || null; } catch {}
  update(rec, { reply: String(reply || "").trim() || null, evidence: { ...rec.evidence, print_exit: r.code, print_session_id: sessionId, print_stderr_tail: redact(r.err).slice(-600) } }, `codebuddy -p exit ${r.code}`);
  if (/Authentication required|\/login/i.test(r.err) && !String(reply || "").trim()) throw new Error("codebuddy -p 未登录：独立 CLI 不共享 WorkBuddy 桌面端的登录（按规则不执行 /login）");
  if (r.code !== 0) throw new Error(`codebuddy -p 退出码 ${r.code}: ${redact(r.err).slice(-300)}`);
  if (!String(reply || "").trim()) throw new Error("codebuddy -p 没有输出回复：" + redact(r.err).slice(-300));
  return true;
}

// ---------------- Codex ----------------
function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port }, () => { sock.destroy(); resolve(true); });
    sock.on("error", () => resolve(false));
    sock.setTimeout(1500, () => { sock.destroy(); resolve(false); });
  });
}
async function adapterCodex(rec) {
  if (state.codexUsed >= CODEX_MAX && !rec._force) throw new Error(`Codex 额度保护：本桥接已发送 ${state.codexUsed} 次（上限 ${CODEX_MAX}），未再发送`);
  const codexEntry = (CODEX_JS && fs.existsSync(CODEX_JS)) ? CODEX_JS : ((CODEX_CMD && fs.existsSync(CODEX_CMD)) ? CODEX_CMD : "");
  if (!codexEntry) throw new Error("本机扫描未找到 Codex CLI（已查进程、PATH 与常见安装目录，未写死默认 npm 路径）");
  const dir = path.join(LOGS, "codex", rec.id); fs.mkdirSync(dir, { recursive: true });
  const last = path.join(dir, "last-message.txt");
  const proxyUp = PROXY_PORT ? await portOpen(PROXY_PORT) : false;
  if (!proxyUp && !rec._force) throw new Error(`本机未发现可用的 HTTP 代理端口` + (PROXY_PORT ? `（上次发现 127.0.0.1:${PROXY_PORT} 当前未监听）` : "") + `，为免空等和浪费额度未发送。请先在代理软件里启动，再点刷新发现后派发`);
  const proxyUrl = proxyUp ? `http://127.0.0.1:${PROXY_PORT}` : "";
  const codexEnv = { ...process.env };
  delete codexEnv.WB_TOKEN;
  if (proxyUp) Object.assign(codexEnv, { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, ALL_PROXY: proxyUrl, NO_PROXY: "localhost,127.0.0.1,::1" });
  rec.evidence = { ...rec.evidence, proxy: proxyUp ? proxyUrl : "none" };
  state.codexUsed += 1; save();
  update(rec, { via: "codex exec（会话持久化，可在 Codex 桌面端按会话打开）", state: "running" }, "spawn codex exec");
  const useNode = /\.js$/i.test(codexEntry);
  const args = useNode
    ? [codexEntry, "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--output-last-message", last]
    : ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--output-last-message", last];
  if (rec.model) args.push("-m", rec.model);
  args.push("-");
  if (rec.model) update(rec, { evidence: { ...rec.evidence, model_requested: rec.model, model_applied: rec.model, model_source: "codex exec -m" } }, "codex 使用模型 " + rec.model);
  const r = await run(useNode ? process.execPath : codexEntry, useNode ? args : args, { cwd: dir, stdin: rec.prompt, env: codexEnv, timeoutMs: 5 * 60 * 1000 });
  fs.writeFileSync(path.join(dir, "exec-log.txt"), redact(r.out + "\n--- stderr ---\n" + r.err));
  const m = /session id:\s*([0-9a-fA-F-]{20,})/.exec(r.out + r.err);
  let reply = null; try { reply = fs.readFileSync(last, "utf8").trim(); } catch {}
  const ev = { ...rec.evidence, exit: r.code, session_id: m ? m[1] : null, last_message_file: last, exec_log: path.join(dir, "exec-log.txt"), model_requested: rec.model || rec.evidence?.model_requested || null, model_applied: rec.model || rec.evidence?.model_applied || null, model_source: rec.model ? "codex exec -m" : rec.evidence?.model_source || null };
  if (m) { ev.thread_url = `codex://threads/${m[1]}`; try { spawn("cmd.exe", ["/d", "/c", "start", "", ev.thread_url], { windowsHide: true, detached: true, stdio: "ignore" }).unref(); ev.opened_in_app = true; } catch {} }
  update(rec, { reply, evidence: ev }, `codex exit ${r.code}`);
  if (r.code !== 0 && !reply) {
    const net = CODEX_NET_FAIL.test(r.err);
    if (net) { state.codexUsed = Math.max(0, state.codexUsed - 1); save(); }
    throw new Error(`codex exec 退出码 ${r.code}${net ? "（网络不通：连不上 chatgpt.com，请求未到达服务器，不计额度；本机 FlClash 在运行但未开代理端口）" : ""}: ${redact(r.err).slice(-300)}`);
  }
  return true;
}

// ---------------- Doubao ----------------
async function adapterDoubao(rec, cwd) {
  if (!DOUBAO_SERVER || !fs.existsSync(DOUBAO_SERVER)) throw new Error("本机扫描未找到 dsh-doubao-bridge（已查常见目录与进程，未写死默认路径）");
  if (!DOUBAO_CDP) throw new Error("本机扫描未发现豆包 CDP 调试口（不会假定 9225）");
  const env = { ...process.env, DOUBAO_CDP }; delete env.WB_TOKEN;
  fs.mkdirSync(cwd, { recursive: true });
  const wantedModel = typeof rec.model === "string" ? rec.model.trim() : "";
  const localHandoff = path.join(HERE, "doubao-work-task.mjs");
  const useLocal = Boolean(wantedModel) && fs.existsSync(localHandoff);
  update(rec, { via: useLocal ? `豆包「新工作任务」handoff（先选官方模型 ${wantedModel}，CDP ${DOUBAO_CDP}）` : `dsh-doubao-bridge handoff（桌面版「新工作任务」，CDP ${DOUBAO_CDP}）`, state: "running" }, "doubao handoff " + cwd + (wantedModel ? " model " + wantedModel : ""));
  const a = await run(process.execPath, useLocal ? [localHandoff, "handoff", cwd, rec.prompt, wantedModel] : [DOUBAO_SERVER, "handoff", cwd, rec.prompt], { env, timeoutMs: 16 * 60 * 1000 });
  let j = null; try { j = JSON.parse(a.out); } catch {}
  const reply = j?.reply ?? (String(a.out || "").trim() || null);
  update(rec, { reply, evidence: { ...rec.evidence, exit: a.code, completed: j?.completed ?? null, needsUserInput: j?.needsUserInput ?? null, timedOut: j?.timedOut ?? null, elapsedMs: j?.elapsedMs ?? null, url: j?.url ?? null, cwd, model_requested: wantedModel || j?.model_requested || null, model_applied: j?.model_applied || null, model_source: useLocal ? "doubao work-task picker" : (wantedModel ? "requested_but_upstream_handoff_has_no_model" : null) } }, `handoff exit ${a.code}`);
  if (a.code !== 0) throw new Error(`doubao handoff 失败：${(j?.error || a.err || a.out).toString().slice(0, 300)}`);
  if (j?.needsUserInput) throw new Error("豆包正在询问用户，请在豆包窗口确认或回复后再继续：" + String(j.question || "").slice(0, 300));
  if (j?.timedOut) throw new Error("豆包工作任务等待超时（未看到结束标记 HANDOFF-DONE）");
  if (j && j.completed === false && !String(reply || "").trim()) throw new Error("豆包工作任务未完成，且没有回复");
  return true;
}

async function execute(rec, body) {
  const plan = loadPlan();
  const pt = plan?.tasks?.find((t) => t.task_id === rec.task_id);
  const expect = pt?.expect || null;
  const cwd = pt?.cwd ? path.resolve(AKILI, pt.cwd) : path.join(AKILI, "ai-dispatch-test", "adhoc");
  fs.mkdirSync(cwd, { recursive: true });
  if (expect?.file && !path.isAbsolute(expect.file)) expect.file = path.join(cwd, expect.file);
  rec._force = !!body.force;
  try {
    if (rec.executor === "workbuddy") {
      await adapterWorkBuddyGui(rec, cwd, { update, exePath: WB_EXE });
    } else if (rec.executor === "codex") await adapterCodex(rec);
    else if (rec.executor === "doubao") await adapterDoubao(rec, cwd);
    else throw new Error(`执行器 ${rec.executor} 还没有桥接适配器（待核实）`);
    if (rec._guiDelivered) {
      update(rec, {
        checks: [{ name: "已在 WorkBuddy 窗口新建可见任务", ok: true }],
        state: "replied_unverified",
        finished_at: now(),
      }, "已投递到 WorkBuddy 可见窗口，请在左侧「任务」中查看并发送");
    } else {
      const { checks, allOk } = applyChecks(rec, expect);
      update(rec, { checks, state: allOk ? "verified" : rec.reply ? "replied_unverified" : "failed", finished_at: now() }, allOk ? "校验通过" : "收到结果但校验未通过");
    }
  } catch (e) {
    const { checks } = applyChecks(rec, expect);
    const msg = String(e.message || e);
    const combined = rec.error && rec.error !== msg ? `${rec.error}；兜底也失败：${msg}` : msg;
    update(rec, { checks, state: "failed", error: combined, finished_at: now() }, "失败：" + msg);
  }
  delete rec._force; save();
}

function applyRuntime(report) {
  const next = applyDiscovery(report, { WB_PORT, WB_EXE, WB_CLI, CODEX_JS, CODEX_CMD, DOUBAO_SERVER, DOUBAO_CDP, PROXY_PORT });
  WB_PORT = next.WB_PORT || WB_PORT || "";
  WB_EXE = next.WB_EXE || WB_EXE || "";
  WB_CLI = next.WB_CLI || WB_CLI || "";
  CODEX_JS = next.CODEX_JS || CODEX_JS || "";
  CODEX_CMD = next.CODEX_CMD || CODEX_CMD || "";
  DOUBAO_SERVER = next.DOUBAO_SERVER || DOUBAO_SERVER || "";
  DOUBAO_CDP = next.DOUBAO_CDP || DOUBAO_CDP || "";
  if (next.PROXY_PORT) PROXY_PORT = Number(next.PROXY_PORT);
  if (process.env.WB_TOKEN) WB_TOKEN = process.env.WB_TOKEN;
}

let discoverInFlight = null;
async function refreshDiscover() {
  const report = await scanLocal({ ingestToken: true });
  lastDiscover = report;
  applyRuntime(report);
  return stripSecrets(report);
}
function ensureDiscover(force = false) {
  if (!force && lastDiscover && !discoverInFlight) return Promise.resolve(lastDiscover);
  if (!force && discoverInFlight) return discoverInFlight;
  discoverInFlight = refreshDiscover().finally(() => { discoverInFlight = null; });
  return discoverInFlight;
}

async function health() {
  // Never block health on a full scan; start-bridge.ps1 and the UI poll this path.
  if (!lastDiscover) ensureDiscover(false);
  const out = { bridge: { ok: true, port: PORT, started_at: STARTED }, workbuddy: {}, codex: {}, doubao: {}, discover: { scanning: !lastDiscover, scanned_at: lastDiscover?.scanned_at || null, needs_credential: lastDiscover?.needs_credential || [] } };
  const wb = (lastDiscover?.interfaces || []).find((i) => i.kind === "workbuddy");
  try {
    const h = WB_PORT ? await wbFetch("/api/v1/health") : null;
    out.workbuddy = {
      serve_port: WB_PORT || null,
      token: !!WB_TOKEN,
      health: h?.status ?? null,
      jobs_ok: false,
      jobs_issue: "后台 job 会与 GUI serve 抢同一端口（EADDRINUSE），待修复",
      acp_ok: h?.status === 200 && !!WB_TOKEN,
      adapter: "task-deeplink",
      exe_path: WB_EXE || wb?.exe_path || null,
      source: wb?.source || [],
      auth_status: wb?.auth_status || (WB_TOKEN ? "from_env" : "missing"),
    };
  } catch (e) {
    out.workbuddy = { error: String(e), jobs_ok: false, jobs_issue: "后台 job 会与 GUI serve 抢同一端口（EADDRINUSE），待修复", acp_ok: false, adapter: "task-deeplink" };
  }
  const codexCli = (CODEX_JS && fs.existsSync(CODEX_JS)) || (CODEX_CMD && fs.existsSync(CODEX_CMD));
  out.codex = { cli: !!codexCli, cli_path: CODEX_JS || CODEX_CMD || null, used: state.codexUsed, max: CODEX_MAX, proxy_port: PROXY_PORT || null, proxy_up: PROXY_PORT ? await portOpen(PROXY_PORT) : false };
  try {
    const r = DOUBAO_CDP ? await fetch(DOUBAO_CDP + "/json/version", { signal: AbortSignal.timeout(3000) }) : { ok: false };
    out.doubao = { cdp: !!r.ok, cdp_endpoint: DOUBAO_CDP || null, bridge_cli: !!(DOUBAO_SERVER && fs.existsSync(DOUBAO_SERVER)), bridge_path: DOUBAO_SERVER || null, adapter: "work-task" };
  } catch {
    out.doubao = { cdp: false, cdp_endpoint: DOUBAO_CDP || null, bridge_cli: !!(DOUBAO_SERVER && fs.existsSync(DOUBAO_SERVER)), bridge_path: DOUBAO_SERVER || null, adapter: "work-task" };
  }
  out.openai_compatible = (lastDiscover?.interfaces || []).filter((i) => i.transport === "openai-compatible").map((i) => ({ id: i.id, kind: i.kind, endpoint: i.endpoint, listening: i.listening, auth_status: i.auth_status, auth_needed: i.auth_needed }));
  return stripSecrets(out);
}

const STARTED = now();
const scannerHost = createLiveHost();
async function readJsonBody(req) {
  let body = "";
  for await (const c of req) body += c;
  return body ? JSON.parse(body) : {};
}
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
  res.end(JSON.stringify(obj));
}
function publicRec(r) { const { _force, ...rest } = r; return rest; }

http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) return send(res, 403, { error: "origin not allowed" });
    if (req.method === "OPTIONS") return send(res, 204, {});
    const url = new URL(req.url, "http://x");
    if (handleScanHttp(url, req.method, (code, body) => send(res, code, body)) !== null) return;
    if (req.method === "POST" && url.pathname === "/bridge/scan") {
      const b = await readJsonBody(req).catch(() => ({}));
      if (b && b.live === true) return send(res, 400, { error: "live probes are not allowed on /bridge/scan" });
      const records = await scanWithPlugins(scannerHost, { probe: false, scanner_id: b.scanner_id || null });
      assertScannerNoSecrets(records);
      return send(res, 200, { records, scanned_at: now() });
    }
    if (req.method === "POST" && url.pathname === "/bridge/scan/probe") {
      const b = await readJsonBody(req).catch(() => ({}));
      if (!b.scanner_id) return send(res, 400, { error: "scanner_id required" });
      const records = await scanWithPlugins(scannerHost, { probe: true, scanner_id: b.scanner_id });
      assertScannerNoSecrets(records);
      return send(res, 200, { records, scanned_at: now(), probe: true });
    }
    if (req.method === "POST" && url.pathname === "/bridge/scan/promote") {
      const b = await readJsonBody(req).catch(() => ({}));
      if (!b.scanner_id) return send(res, 400, { error: "scanner_id required" });
      const records = await scanWithPlugins(scannerHost, { probe: false, scanner_id: b.scanner_id });
      const rec = records[0];
      const result = promoteDraft(rec);
      return send(res, result.ok ? 200 : 400, result);
    }
    if (url.pathname === "/bridge/health") return send(res, 200, await health());
    if (url.pathname === "/bridge/discover" && req.method === "GET") return send(res, 200, stripSecrets(await ensureDiscover(url.searchParams.get("refresh") === "1")));
    if (url.pathname === "/bridge/discover/refresh" && req.method === "POST") return send(res, 200, stripSecrets(await ensureDiscover(true)));
    if (url.pathname === "/bridge/credentials" && req.method === "POST") {
      let body = ""; for await (const c of req) body += c;
      const b = JSON.parse(body || "{}");
      const result = setUserSecret(b.auth_ref, b.secret);
      if (result.ok) {
        if (b.auth_ref === "WB_TOKEN" || b.auth_ref === "CODEBUDDY_GATEWAY_PASSWORD") WB_TOKEN = process.env.WB_TOKEN || WB_TOKEN;
        await ensureDiscover(true);
      }
      return send(res, result.ok ? 200 : 400, result);
    }
    if (url.pathname === "/bridge/plan") return send(res, 200, loadPlan() || {});
    // Which models the live executor will actually accept. Listing only: this
    // opens and closes a session without sending a prompt.
    if (url.pathname === "/bridge/models") {
      const executor = url.searchParams.get("executor") || "workbuddy";
      if (executor !== "workbuddy") {
        return send(res, 400, { ok: false, models: [], error: `暂不支持查询 ${executor} 的模型列表（该执行器不从会话读模型）` });
      }
      const now = Date.now();
      if (modelCache.at && now - modelCache.at < 60000 && modelCache.executor === executor) {
        return send(res, 200, { ...modelCache.body, cached: true });
      }
      let out;
      try {
        const r = await listWorkBuddyModels({ port: WB_PORT, token: WB_TOKEN, cwd: BOARD });
        out = { ok: r.ok, models: r.models, current: r.current, error: r.error, source: "acp session/new configOptions" };
      } catch (e) {
        out = { ok: false, models: [], current: null, error: String(e.message || e), source: "acp session/new configOptions" };
      }
      if (out.ok) modelCache = { at: now, executor, body: out };
      return send(res, out.ok ? 200 : 502, out);
    }
    if (url.pathname === "/bridge/dispatches") return send(res, 200, { dispatches: state.dispatches.map(publicRec), codexUsed: state.codexUsed });
    if (url.pathname === "/bridge/dispatch" && req.method === "POST") {
      let body = ""; for await (const c of req) body += c;
      const b = JSON.parse(body || "{}");
      if (!b.executor || !b.prompt) return send(res, 400, { error: "executor 和 prompt 必填" });
      const busy = state.dispatches.find((d) => d.task_id && d.task_id === b.task_id && ["queued", "running"].includes(d.state));
      if (busy) return send(res, 409, { error: "该任务已有派发在进行", dispatch: publicRec(busy) });
      const rec = newRecord(b);
      log("dispatch", rec.id, rec.executor, rec.task_id || "");
      execute(rec, b);
      return send(res, 202, { dispatch: publicRec(rec) });
    }
    send(res, 404, { error: "not found" });
  } catch (e) { send(res, 500, { error: String(e) }); }
}).listen(PORT, "127.0.0.1", () => {
  log(`bridge listening 127.0.0.1:${PORT} wbPort=${WB_PORT || "-"} token=${!!WB_TOKEN}`);
  ensureDiscover(true).then((d) => {
    log(`discover scanned_at=${d.scanned_at} interfaces=${(d.interfaces || []).length} needs_credential=${(d.needs_credential || []).length} wbPort=${WB_PORT || "-"} token=${!!WB_TOKEN}`);
  }).catch((e) => log("discover failed " + redact(e)));
});

for (const d of state.dispatches) if (d.executor === "codex" && !d.reply && CODEX_NET_FAIL.test(d.error || "") && !/网络不通/.test(d.error)) d.error = "网络不通：连不上 chatgpt.com（workspace routing discovery timed out），请求未到达服务器，不计额度。原始输出：" + d.error;
for (const d of state.dispatches) {
  const j = d.executor === "workbuddy" && d.state === "failed" && !/jobs|job /.test(d.error || "") ? (d.events || []).find((x) => x.msg.startsWith("jobs 通道失败：")) : null;
  if (j) d.error = j.msg.replace("jobs 通道失败：", "") + "；兜底也失败：" + d.error;
}
// Codex quota counter = attempts that reached the server (network failures excluded).
state.codexUsed = state.dispatches.filter((d) => d.executor === "codex" && (d.reply || !CODEX_NET_FAIL.test(d.error || ""))).length;
// Mark any dispatch left running by a previous bridge process.
for (const d of state.dispatches) if (["queued", "running"].includes(d.state)) { d.state = "failed"; d.error = "桥接重启，过程中断（结果未知，待核实）"; }
save();
