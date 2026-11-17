import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProviderRegistry } from "./providers/index.mjs";
import { createCodexProvider } from "./providers/codex.mjs";
import { createAkili, akiliPayload, validateAkiliResult, DEFAULT_KEY_HEADER } from "./providers/akili.mjs";
import { sanitizeCodexEnv } from "./procUtil.mjs";
import { validateDispatch, isPendingDispatch } from "./dispatch-validation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
function fakeSend() { const r = { code: 0, body: null }; return { r, send: (c, b) => { r.code = c; r.body = b; } }; }
function fakeServer(handler) {
  return new Promise((resolve) => { const srv = http.createServer(handler); srv.listen(0, "127.0.0.1", () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/hook?k=QUERYSECRET123` })); });
}

test("registry routes: list, GET only, unknown id/action 404", async () => {
  const ak = createAkili({ env: {} });
  const reg = createProviderRegistry([ak.provider]);
  let f = fakeSend(); assert.equal(await reg.handle(new URL("http://x/bridge/providers"), "GET", f.send), true);
  assert.equal(f.r.code, 200); assert.deepEqual(f.r.body.providers.map((p) => p.id), ["akili"]);
  for (const k of ["id", "name", "kind", "capabilities"]) assert.ok(k in f.r.body.providers[0]);
  f = fakeSend(); await reg.handle(new URL("http://x/bridge/provider/akili/status"), "POST", f.send); assert.equal(f.r.code, 405);
  f = fakeSend(); await reg.handle(new URL("http://x/bridge/provider/nope/status"), "GET", f.send); assert.equal(f.r.code, 404);
  f = fakeSend(); await reg.handle(new URL("http://x/bridge/provider/akili/kill"), "GET", f.send); assert.equal(f.r.code, 404);
  assert.equal(await reg.handle(new URL("http://x/bridge/health"), "GET", f.send), false);
});

test("akili unconfigured: available:false with the agreed reason; sessions/processes unavailable", async () => {
  const ak = createAkili({ env: {} });
  const s = await ak.provider.status();
  assert.equal(s.available, false); assert.equal(s.reason, "未录入 AKILI webhook"); assert.deepEqual(s.limits, []);
  assert.equal(s.config.key_header, DEFAULT_KEY_HEADER); assert.equal(s.config.auth_configured, false); assert.equal(s.config.auth_mode, "none");
  assert.equal((await ak.provider.sessions()).available, false);
  assert.equal((await ak.provider.processes()).available, false);
  assert.equal((await ak.send({})).error_code, "not_configured");
});

test("akili secrets: taken from env, removed from env, never exposed", async () => {
  const env = { AKILI_WEBHOOK_URL: "https://hooks.example/abc?key=URLSECRET999", AKILI_WEBHOOK_KEY: "KEYSECRET-777", AKILI_WEBHOOK_KEY_HEADER: "X-Send-Key", OTHER: "1" };
  const ak = createAkili({ env });
  assert.deepEqual(Object.keys(env), ["OTHER"]);
  const s = await ak.provider.status();
  assert.equal(s.available, true);
  const dump = JSON.stringify([s, ak.publicConfig(), ak.provider]);
  for (const secret of ["URLSECRET999", "KEYSECRET-777", "hooks.example"]) assert.ok(!dump.includes(secret), secret);
  assert.equal(ak.publicConfig().key_header, "X-Send-Key");
  const sv = ak.secretValues(); assert.ok(sv.includes("KEYSECRET-777") && sv.some((v) => v.includes("URLSECRET999")));
});

test("credential entry: only AKILI refs handled, validated, memory only", () => {
  const env = {};
  const ak = createAkili({ env });
  assert.equal(ak.setCredential("OPENAI_API_KEY", "x"), null);
  assert.equal(ak.setCredential("AKILI_WEBHOOK_URL", "ftp://x").ok, false);
  assert.equal(ak.setCredential("AKILI_WEBHOOK_KEY_HEADER", "Content-Type").ok, false);
  assert.equal(ak.setCredential("AKILI_WEBHOOK_KEY_HEADER", "bad header").ok, false);
  assert.equal(ak.setCredential("AKILI_WEBHOOK_URL", "https://h.example/x").ok, true);
  assert.equal(ak.configured(), true); assert.equal(ak.publicConfig().url_source, "user");
  assert.equal(env.AKILI_WEBHOOK_URL, undefined);
});

test("akili send against a local fake server: payload, default Bearer header, custom header, non-2xx, network error", async () => {
  const seen = [];
  const { srv, url } = await fakeServer((req, res) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { seen.push({ headers: req.headers, body: JSON.parse(d) }); res.writeHead(seen.length === 3 ? 500 : 202); res.end("{}"); }); });
  try {
    const rec = { id: "d-1", title: "t", prompt: "p", project_id: "orchestrator-dev", task_id: "k1", project_dir: "D:/p", model: "m", expect_files: ["a.js"], expect_marker: "OK", kb_refs: ["kb-20261116-aaaaaaaa"], evidence: { secret: "no" } };
    const a1 = createAkili({ env: { AKILI_WEBHOOK_URL: url, AKILI_WEBHOOK_KEY: "K-123456" } });
    const r1 = await a1.send(akiliPayload(rec));
    assert.deepEqual(r1, { ok: true, status: 202 });
    assert.equal(seen[0].headers.authorization, "Bearer K-123456");
    assert.deepEqual(Object.keys(seen[0].body).sort(), ["dispatch_id", "expect_files", "expect_marker", "kb_refs", "model", "project_dir", "project_id", "prompt", "task_id", "title"]);
    const a2 = createAkili({ env: { AKILI_WEBHOOK_URL: url, AKILI_WEBHOOK_KEY: "K-2", AKILI_WEBHOOK_KEY_HEADER: "X-Webhook-Key" } });
    assert.equal((await a2.send({ dispatch_id: "d-2" })).ok, true);
    assert.equal(seen[1].headers["x-webhook-key"], "K-2"); assert.equal(seen[1].headers.authorization, undefined);
    const r3 = await a2.send({ dispatch_id: "d-3" });
    assert.deepEqual(r3, { ok: false, status: 500 });
  } finally { await new Promise((r) => srv.close(r)); }
  const dead = createAkili({ env: { AKILI_WEBHOOK_URL: url, AKILI_WEBHOOK_KEY: "K" } });
  const r4 = await dead.send({});
  assert.equal(r4.ok, false); assert.ok(r4.error_code && !JSON.stringify(r4).includes("127.0.0.1"));
});

test("AKILI_WEBHOOK_AUTH (primary): sent verbatim as Authorization, wins over KEY/KEY_HEADER, scrubbed, redacted, booleans only", async () => {
  const seen = [];
  const { srv, url } = await fakeServer((req, res) => { req.resume(); req.on("end", () => { seen.push(req.headers); res.writeHead(200); res.end("{}"); }); });
  const AUTH = "Bearer AUTHSECRET-abc.DEF_123";
  try {
    const env = { AKILI_WEBHOOK_URL: url, AKILI_WEBHOOK_AUTH: AUTH, AKILI_WEBHOOK_KEY: "KEYSECRET-9", AKILI_WEBHOOK_KEY_HEADER: "X-Send-Key", OTHER: "1" };
    const a = createAkili({ env });
    assert.deepEqual(Object.keys(env), ["OTHER"]);
    assert.deepEqual(await a.send({ dispatch_id: "d-a" }), { ok: true, status: 200 });
    assert.equal(seen[0].authorization, AUTH); assert.equal(seen[0]["x-send-key"], undefined);
    const cfg = a.publicConfig();
    assert.equal(cfg.auth_configured, true); assert.equal(cfg.auth_source, "env"); assert.equal(cfg.auth_mode, "auth"); assert.equal(cfg.key_header, "Authorization");
    const dump = JSON.stringify([cfg, await a.provider.status()]);
    for (const x of ["AUTHSECRET", "KEYSECRET", "QUERYSECRET"]) assert.ok(!dump.includes(x), x);
    const sv = a.secretValues(); assert.ok(sv.includes(AUTH) && sv.includes("AUTHSECRET-abc.DEF_123"));
    // non-Bearer scheme also verbatim; entered via credentials route (memory only)
    const b = createAkili({ env: {} });
    assert.equal(b.setCredential("AKILI_WEBHOOK_URL", url).ok, true);
    assert.equal(b.setCredential("AKILI_WEBHOOK_AUTH", "a\nb").ok, false);
    assert.equal(b.setCredential("AKILI_WEBHOOK_AUTH", "Token xyz-123456").ok, true);
    assert.equal(b.publicConfig().auth_source, "user");
    await b.send({}); assert.equal(seen[1].authorization, "Token xyz-123456");
    // fallback still works when AUTH unset
    const c = createAkili({ env: { AKILI_WEBHOOK_URL: url, AKILI_WEBHOOK_KEY: "K-fb" } });
    assert.equal(c.publicConfig().auth_mode, "key"); await c.send({}); assert.equal(seen[2].authorization, "Bearer K-fb");
  } finally { await new Promise((r) => srv.close(r)); }
  assert.deepEqual(Object.keys(sanitizeCodexEnv({ AKILI_WEBHOOK_AUTH: "x", PATH: "p" })), ["PATH"]);
});

test("result validation: files must stay inside project_dir / dispatch dir", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ak-")));
  const proj = path.join(base, "proj"), disp = path.join(base, "disp"), out = path.join(base, "out");
  for (const d of [proj, disp, out]) fs.mkdirSync(d);
  fs.writeFileSync(path.join(proj, "game.js"), "x");
  const ok = validateAkiliResult({ reply: "done", files: ["game.js", path.join(disp, "report.md")], state: "verified" }, { projectDir: proj, dispatchDir: disp });
  assert.deepEqual(ok.files, [path.join(proj, "game.js"), path.join(disp, "report.md")]); assert.equal(ok.reported_state, "verified");
  for (const files of [["../out/x"], [path.join(out, "x")], ["a/../../out/x"], [5]]) assert.throws(() => validateAkiliResult({ files }, { projectDir: proj, dispatchDir: disp }), (e) => e.status === 400, JSON.stringify(files));
  assert.throws(() => validateAkiliResult({ reply: 5 }, { dispatchDir: disp }), (e) => e.status === 400);
  assert.deepEqual(validateAkiliResult({ files: ["r.md"] }, { dispatchDir: disp }).files, [path.join(disp, "r.md")]);
  let linked = false; try { fs.symlinkSync(out, path.join(proj, "lnk"), "junction"); linked = true; } catch {}
  if (linked) { fs.writeFileSync(path.join(out, "f"), "x"); assert.throws(() => validateAkiliResult({ files: ["lnk/f"] }, { projectDir: proj, dispatchDir: disp }), (e) => e.status === 400); }
  fs.rmSync(base, { recursive: true, force: true });
});

test("codex provider maps codexMgr data to the contract", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cxp-"));
  const day = path.join(home, "sessions", "2026", "11", "16"); fs.mkdirSync(day, { recursive: true });
  const id = "01a1e018-fbee-7c33-93ea-179e74d3b275";
  fs.writeFileSync(path.join(day, `rollout-2026-11-16T00-44-56-${id}.jsonl`), [JSON.stringify({ type: "session_meta", payload: { id, cwd: "D:\\x" } }), JSON.stringify({ timestamp: "2026-11-15T16:47:00.000Z", type: "event_msg", payload: { type: "token_count", rate_limits: { plan_type: "plus", primary: { used_percent: 26, window_minutes: 300, resets_at: 1794765270 }, secondary: { used_percent: 43, window_minutes: 10080, resets_at: 1794963702 } } } })].join("\n") + "\n");
  fs.writeFileSync(path.join(home, "config.toml"), 'model = "gpt-6.1-sol"\n');
  fs.writeFileSync(path.join(home, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "SECRET-AT" } }));
  const p = createCodexProvider({ home, listProcs: async (pid) => ({ ok: true, bridge_pid: pid, processes: [{ pid: 1, exec: true, owner: "this_bridge" }, { pid: 2, exec: true, owner: "orphan_exec" }, { pid: 3, exec: false, owner: "other" }, { pid: 4, exec: true, owner: "other_bridge" }] }) });
  const s = await p.status();
  assert.equal(s.available, true); assert.equal(s.plan, "plus"); assert.equal(s.model, "gpt-6.1-sol");
  assert.deepEqual(s.limits.map((l) => [l.name, l.used_percent]), [["5h", 26], ["weekly", 43]]);
  assert.ok(!JSON.stringify(s).includes("SECRET-AT"));
  const se = await p.sessions({ dispatches: () => [{ id: "d-9", evidence: { session_id: id } }] }, { limit: 5 });
  assert.equal(se.total, 1); assert.equal(se.items[0].session_id, id); assert.equal(se.items[0].dispatch_id, "d-9"); assert.equal(se.items[0].link, `codex://threads/${id}`);
  const pr = await p.processes({ bridgePid: 99 });
  assert.deepEqual(pr.items.map((i) => i.role), ["bridge", "orphan", "desktop", "other-bridge"]);
  fs.rmSync(home, { recursive: true, force: true });
});

test("AKILI secrets are stripped from Codex child env; akili executor accepted; sent_awaiting_result is pending", () => {
  const env = sanitizeCodexEnv({ AKILI_WEBHOOK_URL: "u", AKILI_WEBHOOK_KEY: "k", AKILI_WEBHOOK_KEY_HEADER: "h", PATH: "p" });
  assert.deepEqual(Object.keys(env), ["PATH"]);
  assert.doesNotThrow(() => validateDispatch({ executor: "akili", prompt: "x" }));
  assert.equal(isPendingDispatch("sent_awaiting_result"), true);
});

test("server.mjs wiring for providers and akili", () => {
  const src = fs.readFileSync(path.join(HERE, "server.mjs"), "utf8");
  for (const needle of ["const akili = createAkili();", "providers.handle(url, req.method", "akili.setCredential(b.auth_ref, b.secret)", "else if (rec.executor === \"akili\") await adapterAkili(rec);", "state: \"sent_awaiting_result\"", "validateAkiliResult(b,", "...akili.secretValues()", "providers: providers.list()", "kb.ingestSafe(record, state.dispatches)"])
    assert.ok(src.includes(needle), needle);
  assert.ok(src.indexOf("akili.setCredential(b.auth_ref") < src.indexOf("setUserSecret(b.auth_ref"));
  assert.ok(src.indexOf("const akili = createAkili();") < src.indexOf("function redact("));
});
