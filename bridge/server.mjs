import {adapterWorkBuddyAcp} from './workbuddy-acp.mjs';
import {probeAcp} from './acp-probe.mjs';
import {validateDispatch, isPendingDispatch, closeHandoff, readObjectBody} from "./dispatch-validation.mjs";
import {accessCatalog, probeAccess} from "./access-probe.mjs";
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
import { inventory } from "./software-inventory.mjs";
import { adapterWorkBuddyGui } from "./workbuddy-gui.mjs";
import { listWorkBuddyModels } from "./workbuddy-models.mjs";
import { applyDiscovery, discover as scanLocal, redactSecrets as discoverRedact, setUserSecret, stripSecrets } from "./discover.mjs";
import { handleScanHttp, scanLocal as scanWithPlugins, createLiveHost, assertNoSecrets as assertScannerNoSecrets, promoteDraft } from "./scanners/loader.mjs";
import { createKb } from "./kb/routes.mjs";
import { handleCodexHttp } from "./codexMgr.mjs"; // read-only /bridge/codex/* (Codex status, sessions, processes)
import { killTree, sanitizeCodexEnv } from "./procUtil.mjs"; // taskkill /T /F on Windows; strip inherited CODEX_* for Codex children
import { writeFileAtomicSync } from "./atomicWrite.mjs"; // temp + rename for logs/dispatches.json
import { resolveCodexSandbox, buildCodexArgs, validateDispatchPolicy, newDispatchDir, evaluateChecks, resolveProjectDir, CODEX_SANDBOX_DEFAULT, CODEX_SANDBOX_ALLOWED } from "./dispatchPolicy.mjs"; // per-dispatch sandbox / cwd / checks
import { createProviderRegistry } from "./providers/index.mjs"; // read-only /bridge/providers, /bridge/provider/<id>/*
import { createCodexProvider } from "./providers/codex.mjs";
import { createAkili, akiliPayload, validateAkiliResult } from "./providers/akili.mjs"; // executor "akili" via webhook

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
let CODEX_CMD = process.env.CODEX_CMD || "";
let DOUBAO_SERVER = process.env.DOUBAO_SERVER || "";
let DOUBAO_CDP = process.env.DOUBAO_CDP || "";
let PROXY_PORT = process.env.CODEX_PROXY_PORT ? Number(process.env.CODEX_PROXY_PORT) : 0;
// Reads AKILI_WEBHOOK_URL/AUTH/KEY/KEY_HEADER once, then removes them from process.env so no child inherits them.
const akili = createAkili();
let lastDiscover = null;
const CODEX_MAX = Number(process.env.CODEX_MAX || 1);
const CODEX_NET_FAIL = /routing discovery timed out|Reconnecting\.\.\. 5\/5|error sending request/;

fs.mkdirSync(LOGS, { recursive: true });

function now() { return new Date().toISOString(); }
function log(...a) { const line = `[${now()}] ` + a.join(" ") + "\n"; fs.appendFileSync(path.join(LOGS, "bridge.log"), line); }
function redact(s) {
  return discoverRedact(s, [WB_TOKEN, process.env.CODEBUDDY_GATEWAY_PASSWORD, ...akili.secretValues()]);
}

let state = { dispatches: [], codexUsed: 0 };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch {}
function save() { writeFileAtomicSync(STATE_FILE, JSON.stringify(state, null, 2), { backup: true }); }

function loadPlan() { try { return JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")); } catch { return null; } }

// Local knowledge base (bridge/kb/, replaceable module; contract in kb/contract.md).
// Same cwd rule as execute(): plan task cwd, else ai-dispatch-test/adhoc.
// New records carry rec.cwd (per-dispatch dir, set at POST /bridge/dispatch); older records keep the old rule.
function dispatchCwd(r) { if (typeof r?.cwd === "string" && r.cwd) return r.cwd; const pt = loadPlan()?.tasks?.find((t) => t.task_id === r?.task_id); return pt?.cwd ? path.resolve(AKILI, pt.cwd) : path.join(AKILI, "ai-dispatch-test", "adhoc"); }
// Shared project dir (dispatch.project_dir / alias cwd): only under these roots; auto-created only under ai-dispatch-test.
const PROJECT_DIR_ROOTS = [path.join(AKILI, "ai-dispatch-test"), BOARD];
const PROJECT_DIR_FORBIDDEN = ["E:\\ue_test\\fdz_2"];
function newDispatchId() { return "d-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6); }
function newDispatchCwd(body, id) { const pt = loadPlan()?.tasks?.find((t) => t.task_id === body?.task_id); return newDispatchDir({ akili: AKILI, planCwd: pt?.cwd || null, id, project_id: body?.project_id || null, task_id: body?.task_id || null }); }
const kb = createKb({ dataDir: path.join(HERE, "kb", "data"), boardDir: BOARD, cwdFor: dispatchCwd, secrets: () => [WB_TOKEN, process.env.CODEBUDDY_GATEWAY_PASSWORD, ...akili.secretValues()], log });
const providers = createProviderRegistry([createCodexProvider(), akili.provider]);

function newRecord(body, presetId = null, cwd = null) {
  const id = presetId || newDispatchId();
  const rec = {
    id, executor: body.executor, task_id: body.task_id || null, project_id: body.project_id || null,
    title: body.title || "", model: body.model || null, prompt: body.prompt || "",
    cwd: cwd || null, project_dir: body._project_dir || null, sandbox: body.sandbox || null,
    expect_files: Array.isArray(body.expect_files) ? body.expect_files : null, expect_marker: body.expect_marker || null,
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
    const timer = setTimeout(() => { err += "\n[bridge] timeout"; killTree(child).then((k) => { err += `\n[bridge] kill: ${k.method}${k.reason ? " (" + k.reason + ")" : ""}`; }); }, opts.timeoutMs || 300000);
    child.stdout.on("data", (d) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });
    child.on("error", (e) => { err += String(e); });
    // codex exec sometimes stays alive after writing its final message; once the done file
    // has non-empty content and stops changing for doneGraceMs, end the process ourselves.
    let doneTimer = null, lastSize = -1, stableSince = 0;
    if (opts.doneFile) doneTimer = setInterval(() => {
      let size = 0; try { size = fs.statSync(opts.doneFile).size; } catch { size = 0; }
      if (size > 0 && size === lastSize) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= (opts.doneGraceMs || 30000)) { err += "\n[bridge] final message written; process still alive, ended by bridge"; clearInterval(doneTimer); killTree(child).then((k) => { err += `\n[bridge] kill: ${k.method}${k.reason ? " (" + k.reason + ")" : ""}`; }); }
      } else { stableSince = 0; }
      lastSize = size;
    }, 3000);
    child.on("close", (code) => { clearTimeout(timer); if (doneTimer) clearInterval(doneTimer); resolve({ code, out, err, endedAfterDone: /ended by bridge/.test(err) }); });
    if (opts.stdin != null) child.stdin.end(opts.stdin, "utf8"); else child.stdin.end();
  });
}

// verified only when explicit checks (plan expect / expect_files / expect_marker) exist and all pass.
function applyChecks(rec, expect, cwd) {
  const { checks, allOk } = evaluateChecks({ reply: rec.reply, cwd: rec.project_dir || cwd || dispatchCwd(rec), expect_files: rec.expect_files, expect_marker: rec.expect_marker, planExpect: expect });
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
const CODEX_TIMEOUT_MS = Math.max(60000, Number(process.env.CODEX_TIMEOUT_MS) || 15 * 60 * 1000);
async function adapterCodex(rec, cwd, dispatchDir = null) {
  if (state.codexUsed >= CODEX_MAX && !rec._force) throw new Error(`Codex 额度保护：本桥接已发送 ${state.codexUsed} 次（上限 ${CODEX_MAX}），未再发送`);
  const codexEntry = (CODEX_JS && fs.existsSync(CODEX_JS)) ? CODEX_JS : ((CODEX_CMD && fs.existsSync(CODEX_CMD)) ? CODEX_CMD : "");
  if (!codexEntry) throw new Error("本机扫描未找到 Codex CLI（已查进程、PATH 与常见安装目录，未写死默认 npm 路径）");
  const dir = path.join(LOGS, "codex", rec.id); fs.mkdirSync(dir, { recursive: true });
  const last = path.join(dir, "last-message.txt");
  const proxyUp = PROXY_PORT ? await portOpen(PROXY_PORT) : false;
  if (!proxyUp && !rec._force) throw new Error(`本机未发现可用的 HTTP 代理端口` + (PROXY_PORT ? `（上次发现 127.0.0.1:${PROXY_PORT} 当前未监听）` : "") + `，为免空等和浪费额度未发送。请先在代理软件里启动，再点刷新发现后派发`);
  const proxyUrl = proxyUp ? `http://127.0.0.1:${PROXY_PORT}` : "";
  const codexEnv = sanitizeCodexEnv(process.env);
  delete codexEnv.WB_TOKEN;
  if (proxyUp) Object.assign(codexEnv, { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, ALL_PROXY: proxyUrl, NO_PROXY: "localhost,127.0.0.1,::1" });
  rec.evidence = { ...rec.evidence, proxy: proxyUp ? proxyUrl : "none" };
  state.codexUsed += 1; save();
  update(rec, { via: "codex exec（会话持久化，可在 Codex 桌面端按会话打开）", state: "running" }, "spawn codex exec");
  const useNode = /\.js$/i.test(codexEntry);
  // Sandbox: dispatch.sandbox > env CODEX_SANDBOX > CODEX_SANDBOX_DEFAULT (read-only). workspace-write only with -C = per-dispatch cwd.
  const sb = resolveCodexSandbox(rec.sandbox, process.env.CODEX_SANDBOX);
  rec.evidence = { ...rec.evidence, sandbox: sb.value, sandbox_source: sb.source, ...(sb.note ? { sandbox_note: sb.note } : {}) };
  // Run inside the task working directory (-C) so Codex can read what other AIs produced there.
  // The user's config uses windows.sandbox="elevated", whose shell commands hang when codex exec
  // is spawned from this non-elevated bridge, so dispatches always add windows.sandbox="unelevated".
  // With a shared project_dir, -C is project_dir and the per-dispatch dir is added as writable (--add-dir).
  const addDirs = rec.project_dir && dispatchDir && dispatchDir !== cwd ? [dispatchDir] : [];
  const { args, hasCwd } = buildCodexArgs({ entryJs: useNode ? codexEntry : null, lastMessageFile: last, cwd, sandbox: sb.value, model: rec.model, addDirs });
  if (hasCwd) rec.evidence = { ...rec.evidence, codex_cd: cwd, ...(addDirs.length && sb.value === "workspace-write" ? { codex_add_dirs: addDirs } : {}) };
  if (process.platform === "win32") rec.evidence = { ...rec.evidence, windows_sandbox: "unelevated" };
  update(rec, {}, `codex sandbox ${sb.value}（来源 ${sb.source}）`);
  if (rec.model) update(rec, { evidence: { ...rec.evidence, model_requested: rec.model, model_applied: rec.model, model_source: "codex exec -m" } }, "codex 使用模型 " + rec.model);
  const r = await run(useNode ? process.execPath : codexEntry, useNode ? args : args, { cwd: dir, stdin: rec.prompt, env: codexEnv, timeoutMs: CODEX_TIMEOUT_MS, doneFile: last, doneGraceMs: 30000 });
  fs.writeFileSync(path.join(dir, "exec-log.txt"), redact(r.out + "\n--- stderr ---\n" + r.err));
  const m = /session id:\s*([0-9a-fA-F-]{20,})/.exec(r.out + r.err);
  let reply = null; try { reply = fs.readFileSync(last, "utf8").trim(); } catch {}
  const ev = { ...rec.evidence, exit: r.code, session_id: m ? m[1] : null, last_message_file: last, exec_log: path.join(dir, "exec-log.txt"), model_requested: rec.model || rec.evidence?.model_requested || null, model_applied: rec.model || rec.evidence?.model_applied || null, model_source: rec.model ? "codex exec -m" : rec.evidence?.model_source || null };
  if (m) { ev.thread_url = `codex://threads/${m[1]}`; try { spawn("cmd.exe", ["/d", "/c", "start", "", ev.thread_url], { windowsHide: true, detached: true, stdio: "ignore" }).unref(); ev.opened_in_app = true; } catch {} }
  update(rec, { reply, evidence: ev }, `codex exit ${r.code}`);
  if (r.endedAfterDone) ev.ended_after_final_message = true;
  if (r.code !== 0 && !reply) {
    const net = CODEX_NET_FAIL.test(r.err);
    if (net) { state.codexUsed = Math.max(0, state.codexUsed - 1); save(); }
    throw new Error(`codex exec 退出码 ${r.code}${net ? "（网络不通：连不上 chatgpt.com，请求未到达服务器，不计额度；本机 FlClash 在运行但未开代理端口）" : ""}: ${redact(r.err).slice(-300)}`);
  }
  return true;
}

// ---------------- AKILI (Grok Bot webhook) ----------------
// Success = webhook accepted (2xx) -> sent_awaiting_result; the result comes back via POST /bridge/dispatch/<id>/result.
async function adapterAkili(rec) {
  if (!akili.configured()) throw new Error("未录入 AKILI webhook（AKILI_WEBHOOK_URL），未发送");
  update(rec, { via: "AKILI webhook（Grok Bot 例程）", state: "running" }, "POST AKILI webhook");
  const r = await akili.send(akiliPayload(rec));
  update(rec, { evidence: { ...rec.evidence, webhook_status: r.status ?? null, webhook_error: r.error_code ?? null, webhook_key_header: akili.headerName(), webhook_auth_mode: akili.publicConfig().auth_mode } }, `AKILI webhook -> ${r.status ?? r.error_code}`);
  if (!r.ok) throw new Error(r.status ? `AKILI webhook 返回 HTTP ${r.status}` : `AKILI webhook 未送达（${r.error_code}）`);
  rec._awaitingResult = true;
  return true;
}

// ---------------- Doubao ----------------
/**
 * 豆包 CDP 端点。优先用启动时发现的结果；发现为空时，只有在本地 handoff 脚本存在、
 * 且 9225 真的响应 /json/version 的情况下才采用它 —— 这是实测回填，不是假定端口。
 * 意义：桥接比豆包先启动、或豆包中途重启时，不必重启桥接就能恢复豆包通道。
 */
async function resolveDoubaoCdp(timeoutMs = 2000) {
  const candidates = [...new Set([DOUBAO_CDP, "http://127.0.0.1:9225"].filter(Boolean))];
  for (const ep of candidates) {
    try {
      const r = await fetch(ep.replace(/\/+$/, "") + "/json/version", { signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) {
        if (ep !== DOUBAO_CDP) { DOUBAO_CDP = ep; log("doubao cdp 回填 " + ep); }
        return ep;
      }
    } catch {}
  }
  return null;
}

async function adapterDoubao(rec, cwd) {
  const localHandoff = path.join(HERE, "doubao-work-task.mjs");
  const hasLocal = fs.existsSync(localHandoff);
  const hasUpstream = !!(DOUBAO_SERVER && fs.existsSync(DOUBAO_SERVER));
  if (!hasLocal && !hasUpstream) throw new Error("本机没有豆包「新工作任务」脚本，也未找到 dsh-doubao-bridge");
  const cdp = await resolveDoubaoCdp();
  if (!cdp) throw new Error("豆包 CDP 调试口不可用（" + (DOUBAO_CDP || "http://127.0.0.1:9225") + " 无响应）。先运行 node tools\\ensure-doubao.mjs 或双击「启动豆包-调试端口.cmd」把豆包带 9225 拉起来，再重派；豆包重启后会丢掉调试端口，这是最常见原因。");
  const env = { ...process.env, DOUBAO_CDP: cdp }; delete env.WB_TOKEN;
  fs.mkdirSync(cwd, { recursive: true });
  const wantedModel = typeof rec.model === "string" ? rec.model.trim() : "";
  const useLocal = hasLocal;
  const modelForLocal = wantedModel || "自动";
  update(rec, { via: useLocal ? `豆包「新工作任务」handoff（先选官方模型 ${modelForLocal}，CDP ${cdp}）` : `dsh-doubao-bridge handoff（桌面版「新工作任务」，CDP ${cdp}）`, state: "running" }, "doubao handoff " + cwd + (useLocal ? " model " + modelForLocal : (wantedModel ? " model " + wantedModel : "")));
  const a = await run(process.execPath, useLocal ? [localHandoff, "handoff", cwd, rec.prompt, modelForLocal] : [DOUBAO_SERVER, "handoff", cwd, rec.prompt], { env, timeoutMs: 16 * 60 * 1000 });
  let j = null; try { j = JSON.parse(a.out); } catch {}
  const reply = j?.reply ?? (String(a.out || "").trim() || null);
  update(rec, { reply, evidence: { ...rec.evidence, exit: a.code, completed: j?.completed ?? null, needsUserInput: j?.needsUserInput ?? null, timedOut: j?.timedOut ?? null, elapsedMs: j?.elapsedMs ?? null, url: j?.url ?? null, cwd, model_requested: wantedModel || j?.model_requested || null, model_applied: j?.model_applied || null, model_source: useLocal ? "doubao work-task picker" : (wantedModel ? "requested_but_upstream_handoff_has_no_model" : null) } }, `handoff exit ${a.code}`);
  if (a.code !== 0) throw new Error(`doubao handoff 失败：${(j?.error || a.err || a.out).toString().slice(0, 300)}`);
  if (j?.needsUserInput) throw new Error("豆包正在询问用户，请在豆包窗口确认或回复后再继续：" + String(j.question || "").slice(0, 300));
  if (j?.timedOut) throw new Error("豆包工作任务等待超时（未看到结束标记 HANDOFF-DONE）");
  if (j && j.completed === false && !String(reply || "").trim()) throw new Error("豆包工作任务未完成，且没有回复");
  return true;
}

// After a session/prompt timeout WorkBuddy may already have written files, often into its
// host temp dir instead of the declared cwd. Collect files modified during the dispatch
// window so the work can be reviewed instead of being silently lost. Never marks verified.
const WB_HOST_TMP = path.join(os.tmpdir(), "workbuddy-host-cli");
function listRecentFiles(root, sinceMs, untilMs, limit = 200) {
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!["node_modules", ".git"].includes(e.name)) walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs >= sinceMs && st.mtimeMs <= untilMs && st.size <= 50 * 1024 * 1024) out.push({ full, rel: path.relative(root, full), size: st.size, mtime: new Date(st.mtimeMs).toISOString() });
      } catch {}
    }
  };
  walk(root, 0);
  return out;
}
function salvageWorkBuddyArtifacts(rec, cwd) {
  try {
    const since = Date.parse(rec.created_at) - 5000;
    const until = Date.now() + 5000;
    const fallback = path.join(LOGS, "workbuddy", rec.id, "artifacts");
    const artifacts = [];
    for (const f of listRecentFiles(cwd, since, until)) artifacts.push({ path: f.full, source: "cwd", size: f.size, mtime: f.mtime });
    let hosts = [];
    try { hosts = fs.readdirSync(WB_HOST_TMP, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(WB_HOST_TMP, e.name)); } catch {}
    for (const host of hosts) for (const f of listRecentFiles(host, since, until)) {
      let dest = fs.existsSync(cwd) ? path.join(cwd, f.rel) : path.join(fallback, f.rel);
      if (fs.existsSync(dest)) dest = path.join(fallback, path.basename(host), f.rel);
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(f.full, dest);
        artifacts.push({ path: dest, source: f.full, size: f.size, mtime: f.mtime });
      } catch (e) { update(rec, {}, "回收产物失败 " + f.full + "：" + String(e.message || e)); }
    }
    if (artifacts.length) update(rec, { evidence: { ...rec.evidence, salvaged_artifacts: artifacts, salvage_note: "按派发时间窗口从工作目录和 %TEMP%\\workbuddy-host-cli 收集，可能混入同时段其它会话的文件，需人工核对" } }, "超时后回收产物 " + artifacts.length + " 个：" + artifacts.map((a) => path.basename(a.path)).join("、").slice(0, 300));
    return artifacts;
  } catch (e) {
    update(rec, {}, "回收产物出错：" + String(e.message || e));
    return [];
  }
}

async function execute(rec, body) {
  const plan = loadPlan();
  const pt = plan?.tasks?.find((t) => t.task_id === rec.task_id);
  const expect = pt?.expect || null;
  const cwd = dispatchCwd(rec); // per-dispatch dir for new records (rec.cwd); same function kb.ingestSafe uses
  fs.mkdirSync(cwd, { recursive: true });
  const workDir = rec.project_dir || cwd; // where the executor works: shared project_dir if given, else the dispatch dir
  rec.evidence = { ...rec.evidence, cwd, dispatch_dir: cwd, ...(rec.project_dir ? { project_dir: rec.project_dir } : {}) };
  if (expect?.file && !path.isAbsolute(expect.file)) expect.file = path.join(workDir, expect.file);
  rec._force = !!body.force;
  try {
    if (rec.executor === "workbuddy") {
      await ensureDiscover(false);
      const wb = lastDiscover?.interfaces?.find(i => i.kind === 'workbuddy');
      const isKingReport = typeof rec.task_id === "string" && rec.task_id.includes("::king-report");
      // 国王汇报：优先走桌面 Gateway（ACP）。同一个 WorkBuddy 桌面进程，仍属「图形界面执行器」，
      // 区别只是用它的内部通道而不是 workbuddy:// 深链 —— 深链在本机只写 pending store、不建任务，
      // 拿不到回复也回写不了看板，所以只留作兜底。
      const kingNeedsGuiFallback = isKingReport && !(wb?.public_gateway && WB_TOKEN && WB_PORT);
      if (kingNeedsGuiFallback) {
        update(rec, {}, "国王汇报：桌面 Gateway 凭据不可用（WB_PORT/WB_TOKEN 缺失），退回 workbuddy:// 深链交接（只预填提示词，不自动发送、不回写结果）；用 start-board.ps1 启动桥接可拿到凭据");
        await adapterWorkBuddyGui(rec, workDir, { update, exePath: WB_EXE });
      } else if (wb?.public_gateway) {
        if (!WB_TOKEN || !WB_PORT) throw new Error('已发现桌面 Gateway，但会话凭据或端口未就绪；未派发');
        let live;
        try { live = await wbFetch('/api/v1/health', {signal: AbortSignal.timeout(5000)}); }
        catch {
          // WorkBuddy restarts its serve process on a new port + credential; rescan once before giving up.
          update(rec, {}, "WorkBuddy Gateway 连不上，重新扫描端口与凭据");
          await ensureDiscover(true);
          live = await wbFetch('/api/v1/health', {signal: AbortSignal.timeout(5000)});
        }
        if (live.status !== 200 || live.json?.data?.status !== 'ok') throw new Error('桌面 Gateway 身份复核失败，未派发 ACP，也未降级为 GUI');
        if (isKingReport) update(rec, {}, "国王汇报走桌面 Gateway（ACP session/new），结果会自动回写看板");
        await adapterWorkBuddyAcp(rec, workDir, {port:WB_PORT,token:WB_TOKEN,update,redact}); // session/new workingDirectory = project_dir when given
      } else {
        await adapterWorkBuddyGui(rec, workDir, { update, exePath: WB_EXE });
      }
    } else if (rec.executor === "codex") await adapterCodex(rec, workDir, cwd);
    else if (rec.executor === "doubao") await adapterDoubao(rec, workDir);
    else if (rec.executor === "akili") await adapterAkili(rec);
    else throw new Error(`执行器 ${rec.executor} 还没有桥接适配器（待核实）`);
    if (rec._guiDelivered) {
      update(rec, {
        checks: [{ name: "任务交接已请求；桌面接收、发送和回复尚未验证", ok: false }],
        state: "awaiting_user",
        finished_at: null,
      }, "等待你在 WorkBuddy 中检查并手动发送，当前没有模型回复");
    } else if (rec._awaitingResult) {
      delete rec._awaitingResult;
      update(rec, { checks: [{ type: "pending", target: null, ok: false, name: "已发送给 AKILI，等待 POST /bridge/dispatch/<id>/result 回写" }], state: "sent_awaiting_result", finished_at: null }, "已发送给 AKILI，等待结果回写（不算 verified）");
    } else {
      const { checks, allOk: baseOk } = applyChecks(rec, expect, cwd);
      let allOk = baseOk;
      if (rec._partialOutcome) { checks.push({ name: "WorkBuddy 自报部分成功（" + rec._partialOutcome + "），需人工验收", ok: false }); allOk = false; delete rec._partialOutcome; }
      update(rec, { checks, state: allOk ? "verified" : rec.reply ? "replied_unverified" : "failed", finished_at: now() }, allOk ? "校验通过" : "收到结果但校验未通过");
    }
  } catch (e) {
    const { checks } = applyChecks(rec, expect, cwd);
    const msg = String(e.message || e);
    const combined = rec.error && rec.error !== msg ? `${rec.error}；兜底也失败：${msg}` : msg;
    const salvaged = rec.executor === "workbuddy" && /rpc timeout for session\/prompt/.test(msg) ? salvageWorkBuddyArtifacts(rec, cwd) : null;
    if (salvaged?.length) {
      update(rec, { checks: [...checks, { name: `超时后回收到 ${salvaged.length} 个产物，需人工验收`, ok: false }], state: "partial", error: combined, finished_at: now() }, "超时但找到产物，标为部分完成待验收：" + msg);
    } else update(rec, { checks, state: "failed", error: combined, finished_at: now() }, "失败：" + msg);
  }
  delete rec._force;
  // Adapters may write evidence.cwd = workDir; keep evidence.cwd = dispatch dir so kb scans the same dir as rec.cwd.
  if (rec.project_dir) rec.evidence = { ...rec.evidence, cwd, dispatch_dir: cwd, project_dir: rec.project_dir };
  save();
  if (rec.state !== "sent_awaiting_result") kb.ingestSafe(rec, state.dispatches); // KB: idempotent by dispatch_id, never throws (AKILI: ingested when the result arrives)
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
    const h = wb?.public_gateway && WB_PORT ? await wbFetch("/api/v1/health") : null;
    out.workbuddy = {
      public_gateway: wb?.public_gateway === true,
      desktop_detected: !!wb?.found,
      serve_port: wb?.public_gateway ? WB_PORT || null : null,
      token: !!WB_TOKEN,
      health: h?.status ?? null,
      jobs_ok: false,
      jobs_issue: "当前未验证后台 jobs；桌面投递与 Gateway 是不同接入方式",
      acp_ok: h?.status === 200 && !!WB_TOKEN,
      adapter: wb?.public_gateway ? "acp" : "task-deeplink",
      exe_path: WB_EXE || wb?.exe_path || null,
      source: wb?.source || [],
      auth_status: wb?.auth_status || (WB_TOKEN ? "from_env" : "missing"),
    };
  } catch (e) {
    out.workbuddy = { error: String(e), jobs_ok: false, jobs_issue: "后台 job 会与 GUI serve 抢同一端口（EADDRINUSE），待修复", acp_ok: false, adapter: "task-deeplink" };
  }
  const codexCli = (CODEX_JS && fs.existsSync(CODEX_JS)) || (CODEX_CMD && fs.existsSync(CODEX_CMD));
  const sbDefault = resolveCodexSandbox(null, process.env.CODEX_SANDBOX);
  out.codex = { cli: !!codexCli, cli_path: CODEX_JS || CODEX_CMD || null, used: state.codexUsed, max: CODEX_MAX, proxy_port: PROXY_PORT || null, proxy_up: PROXY_PORT ? await portOpen(PROXY_PORT) : false,
    codex_sandbox_default: sbDefault.value, codex_sandbox_default_source: sbDefault.source, codex_sandbox_code_default: CODEX_SANDBOX_DEFAULT, codex_sandbox_allowed: CODEX_SANDBOX_ALLOWED, ...(sbDefault.note ? { codex_sandbox_note: sbDefault.note } : {}) };
  try {
    const cdp = await resolveDoubaoCdp(1200);
    const r = cdp ? await fetch(cdp.replace(/\/+$/, "") + "/json/version", { signal: AbortSignal.timeout(3000) }) : { ok: false };
    const localWorkTask = fs.existsSync(path.join(HERE, "doubao-work-task.mjs"));
    out.doubao = { cdp: !!r.ok, cdp_endpoint: cdp || DOUBAO_CDP || null, bridge_cli: !!(DOUBAO_SERVER && fs.existsSync(DOUBAO_SERVER)), bridge_path: DOUBAO_SERVER || null, adapter: "work-task", local_work_task: localWorkTask };
  } catch {
    const cdp = DOUBAO_CDP || null;
    const localWorkTask = fs.existsSync(path.join(HERE, "doubao-work-task.mjs"));
    out.doubao = { cdp: false, cdp_endpoint: cdp, bridge_cli: !!(DOUBAO_SERVER && fs.existsSync(DOUBAO_SERVER)), bridge_path: DOUBAO_SERVER || null, adapter: "work-task", local_work_task: localWorkTask };
  }
  out.akili = akili.publicConfig(); // booleans + header name only
  out.openai_compatible = (lastDiscover?.interfaces || []).filter((i) => i.transport === "openai-compatible").map((i) => ({ id: i.id, kind: i.kind, endpoint: i.endpoint, listening: i.listening, auth_status: i.auth_status, auth_needed: i.auth_needed }));
  return stripSecrets(out);
}

const STARTED = now();
const scannerHost = createLiveHost();
async function readJsonBody(req) { return readObjectBody(req); }

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
    if (req.method === "POST" && url.pathname === "/bridge/access/acp") {
      const body=await readJsonBody(req);
      try { return send(res,200,await probeAcp(body)); }
      catch { return send(res,400,{error:"仅支持已配置的 ACP 接入项"}); }
    }
    if (req.method === "GET" && url.pathname === "/bridge/access/catalog") return send(res, 200, accessCatalog);
    if (req.method === "POST" && url.pathname === "/bridge/access/probe") {
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 16384) return send(res, 413, {error:"请求过大"}); chunks.push(chunk); }
      try { return send(res, 200, await probeAccess(JSON.parse(Buffer.concat(chunks).toString("utf8")))); }
      catch { return send(res, 400, {error:"请求无效：检查所选接入项、地址和凭据格式"}); }
    }
    if (req.method === "GET" && url.pathname === "/bridge/software") return send(res, 200, await inventory({refresh:url.searchParams.get("refresh")==="1"}));
    if (handleScanHttp(url, req.method, (code, body) => send(res, code, body)) !== null) return;
    if (req.method === "POST" && url.pathname === "/bridge/scan") {
      const b = await readJsonBody(req);
      if (b && b.live === true) return send(res, 400, { error: "live probes are not allowed on /bridge/scan" });
      const records = await scanWithPlugins(scannerHost, { probe: false, scanner_id: b.scanner_id || null });
      const discovered = await ensureDiscover(false);
      for (const iface of discovered.interfaces || []) {
        if (iface.kind === "proxy" || !iface.found || (b.scanner_id && b.scanner_id !== iface.kind)) continue;
        const index = records.findIndex(r => r.scanner_id === iface.kind);
        if (index >= 0 && records[index].status !== "not_found") continue;
        const record = { scanner_id: iface.kind, display_name: iface.display_name, status: "found",
          evidence: { path_hits: [iface.cli_path, iface.exe_path].filter(Boolean), process_names: iface.pid ? [iface.display_name] : [] },
          endpoint: {transport: iface.transport === "cli" ? "cli" : "desktop_bridge", cli_path: iface.cli_path || undefined},
          auth: {mode:"none",needs_user_secret:false}, tools_verified:false, chat_bridge:"unverified",
          notes: (iface.notes || []).join("；") };
        if (index >= 0) records[index] = record; else records.push(record);
      }
      assertScannerNoSecrets(records);
      return send(res, 200, { records, scanned_at: now() });
    }
    if (req.method === "POST" && url.pathname === "/bridge/scan/probe") {
      const b = await readJsonBody(req);
      if (!b.scanner_id) return send(res, 400, { error: "scanner_id required" });
      const records = await scanWithPlugins(scannerHost, { probe: true, scanner_id: b.scanner_id });
      assertScannerNoSecrets(records);
      return send(res, 200, { records, scanned_at: now(), probe: true });
    }
    if (req.method === "POST" && url.pathname === "/bridge/scan/promote") {
      const b = await readJsonBody(req);
      if (!b.scanner_id) return send(res, 400, { error: "scanner_id required" });
      const records = await scanWithPlugins(scannerHost, { probe: false, scanner_id: b.scanner_id });
      const rec = records[0];
      const result = promoteDraft(rec);
      return send(res, result.ok ? 200 : 400, result);
    }
    if (url.pathname.startsWith("/bridge/codex") && await handleCodexHttp(url, req.method, (code, body) => send(res, code, body), { dispatches: () => state.dispatches, used: state.codexUsed, max: CODEX_MAX, bridgePid: process.pid })) return;
    if ((url.pathname === "/bridge/providers" || url.pathname.startsWith("/bridge/provider/")) && await providers.handle(url, req.method, (code, body) => send(res, code, body), { dispatches: () => state.dispatches, bridgePid: process.pid })) return;
    if (url.pathname === "/bridge/health") return send(res, 200, await health());
    if (url.pathname === "/bridge/discover" && req.method === "GET") return send(res, 200, { ...stripSecrets(await ensureDiscover(url.searchParams.get("refresh") === "1")), providers: providers.list() });
    if (url.pathname === "/bridge/discover/refresh" && req.method === "POST") return send(res, 200, { ...stripSecrets(await ensureDiscover(true)), providers: providers.list() });
    if (url.pathname === "/bridge/credentials" && req.method === "POST") {
      const b = await readJsonBody(req);
      const ak = akili.setCredential(b.auth_ref, b.secret); // AKILI_WEBHOOK_URL / _AUTH / _KEY / _KEY_HEADER: memory only
      if (ak) return send(res, ak.ok ? 200 : 400, ak);
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
      await ensureDiscover(false);
      const wb = lastDiscover?.interfaces?.find(i => i.kind === "workbuddy");
      if (!wb?.public_gateway) return send(res, 409, {ok:false,models:[],current:null,error:"当前只发现 WorkBuddy 桌面客户端，未识别公开 Gateway；不要求补填 WB_TOKEN。实时模型目录暂不可用。",source:"desktop_only"});
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
    // AKILI writes its result back here. Re-judged with expect_files / expect_marker; the caller's state is advisory only.
    if (req.method === "POST" && /^\/bridge\/dispatch\/[^/]+\/result$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split("/")[3]);
      const record = state.dispatches.find((d) => d.id === id);
      if (!record) return send(res, 404, { error: "找不到派发记录" });
      const gate = () => record.executor === "akili" && record.state === "sent_awaiting_result";
      if (!gate()) return send(res, 409, { error: "只接受 executor=akili 且状态为 sent_awaiting_result 的派发", executor: record.executor, state: record.state });
      const b = await readJsonBody(req);
      if (!gate()) return send(res, 409, { error: "该派发已处理", executor: record.executor, state: record.state });
      const dDir = dispatchCwd(record);
      const r = validateAkiliResult(b, { projectDir: record.project_dir, dispatchDir: dDir });
      const pt = loadPlan()?.tasks?.find((t) => t.task_id === record.task_id);
      const expect = pt?.expect ? { ...pt.expect } : null;
      if (expect?.file && !path.isAbsolute(expect.file)) expect.file = path.join(record.project_dir || dDir, expect.file);
      record.reply = r.reply != null && String(r.reply).trim() ? redact(r.reply) : null;
      const { checks, allOk } = applyChecks(record, expect, dDir);
      const next = allOk ? "verified" : record.reply ? "replied_unverified" : "failed";
      update(record, { checks, state: next, finished_at: now(), ...(next === "failed" ? { error: "AKILI 回写没有回复内容" } : {}), evidence: { ...record.evidence, cwd: dDir, dispatch_dir: dDir, result_received_at: now(), result_files: r.files, reported_state: r.reported_state } }, `AKILI 回写结果（自报 ${String(r.reported_state || "-").slice(0, 40)}），桥接判定 ${next}`);
      kb.ingestSafe(record, state.dispatches);
      return send(res, 200, { dispatch: publicRec(record) });
    }
    if (req.method === "POST" && url.pathname.startsWith("/bridge/handoff/") && url.pathname.endsWith("/close")) {
      const id = url.pathname.slice("/bridge/handoff/".length, -"/close".length);
      const record = state.dispatches.find(d => d.id === id);
      if (!record) return send(res,404,{error:"找不到交接记录"});
      update(record,closeHandoff(record,now()),"用户结束交接记录；未标记任务成功");
      return send(res,200,{dispatch:publicRec(record)});
    }
    if (url.pathname === "/bridge/kb" || url.pathname.startsWith("/bridge/kb/")) return void (await kb.handle(req, res, url, { dispatches: () => state.dispatches, readBody: readJsonBody }));
    if (url.pathname === "/bridge/dispatches") return send(res, 200, { dispatches: state.dispatches.map(publicRec), codexUsed: state.codexUsed });
    if (url.pathname === "/bridge/dispatch" && req.method === "POST") {
      const b = await readJsonBody(req);
      validateDispatch(b);
      validateDispatchPolicy(b); // sandbox / expect_files / expect_marker -> 400 when invalid
      const kbEntries = kb.resolveRefs(b.kb_refs); // unknown kb id -> 400, nothing dispatched
      const busy = state.dispatches.find((d) => d.task_id && d.task_id === b.task_id && isPendingDispatch(d.state));
      if (busy) return send(res, 409, { error: "该任务已有派发在进行", dispatch: publicRec(busy) });
      // project_dir / cwd: realpath must be under ai-dispatch-test or operator-board-main; else 400 (nothing dispatched).
      b._project_dir = resolveProjectDir(b, { allowedRoots: PROJECT_DIR_ROOTS, autoCreateRoot: PROJECT_DIR_ROOTS[0], forbiddenRoots: PROJECT_DIR_FORBIDDEN });
      const dispatchId = newDispatchId();
      const subCwd = newDispatchCwd(b, dispatchId); // per-dispatch dir, decided before kb copies files into <subCwd>/kb_refs/<id>/
      const kbPrep = kbEntries.length ? kb.prepareDispatch(b, subCwd) : null;
      if (kbPrep) b.prompt = kbPrep.prompt;
      const rec = newRecord(b, dispatchId, subCwd);
      if (kbPrep) update(rec, { kb_refs: kbPrep.kb_refs, evidence: { ...rec.evidence, kb_refs: kbPrep.kb_refs, kb_copies: kbPrep.copies } }, "引用知识库 " + kbPrep.kb_refs.join(","));
      log("dispatch", rec.id, rec.executor, rec.task_id || "");
      execute(rec, b);
      return send(res, 202, { dispatch: publicRec(rec) });
    }
    send(res, 404, { error: "not found" });
  } catch (e) { send(res, e.status || 500, { error: e.status ? e.message : "桥接内部错误，请检查本机日志" }); }
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
