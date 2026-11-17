// Run: node --test kb/test_kb.mjs   (or: node kb/test_kb.mjs)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { openStore } from "./store.mjs";
import { createKb } from "./routes.mjs";
import { entryFromDispatch, buildRefsBlock, parseRefs, scrubText, KbInputError, kbIdFor, isTerminal } from "./ingest.mjs";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "kbtest-")); }
function setup() {
  const root = tmp(); const board = path.join(root, "board"); const cwd = path.join(root, "adhoc");
  fs.mkdirSync(path.join(board, "logs", "codex", "d-1"), { recursive: true }); fs.mkdirSync(cwd, { recursive: true });
  const t0 = Date.now() - 60000; const tEnd = new Date(Date.now() + 1000).toISOString();
  const old = path.join(cwd, "OLD.md"); fs.writeFileSync(old, "old"); fs.utimesSync(old, new Date(t0 - 3600e3), new Date(t0 - 3600e3));
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "game.js"), "console.log(1)");
  fs.mkdirSync(path.join(cwd, "kb_refs", "kb-x"), { recursive: true }); fs.writeFileSync(path.join(cwd, "kb_refs", "kb-x", "in.md"), "copied input");
  const last = path.join(board, "logs", "codex", "d-1", "last-message.txt"); fs.writeFileSync(last, "final");
  const rec = (over = {}) => ({ id: "d-1", executor: "some-channel", task_id: "t1", project_id: "p1", title: "做竖切", model: "m1", prompt: "写 game.js Authorization: Bearer abcdefghijkl123",
    state: "verified", via: "x", created_at: new Date(t0).toISOString(), updated_at: tEnd, finished_at: tEnd,
    reply: "完成 sk-ABCDEFGHIJKLMNOPQRST ghp_ABCDEFGHIJKLMNOPQRSTUV", evidence: { cwd, last_message_file: last, wb_token: "s3cr3t-value", token: true, session_id: "abc" }, checks: [{ name: "ok", ok: true }], error: null, events: [], ...over });
  return { root, board, cwd, rec };
}

for (const backend of ["json", "sqlite"]) test(`store ${backend}: upsert by dispatch_id, filters, q`, () => {
  const s = openStore(tmp(), backend);
  assert.equal(s.backend, backend);
  const e = (id, d, ex, st, t) => ({ id, uri: `kb://${id}`, dispatch_id: d, executor: ex, state: st, project_id: "p", task_id: "t", title: t, reply: "r", dispatch_created_at: `2026-11-1${id.slice(-1)}T00:00:00+08:00`, tags: [] });
  s.put(e("kb-20261111-0000000a", "d-a", "codex", "verified", "Alpha"));
  s.put(e("kb-20261112-0000000b", "d-b", "workbuddy", "failed", "Beta"));
  s.put({ ...e("kb-20261112-0000000b", "d-b", "workbuddy", "replied_unverified", "Beta2") });
  assert.equal(s.count(), 2);
  assert.equal(s.list()[0].id, "kb-20261112-0000000b");
  assert.equal(s.getByDispatch("d-b").state, "replied_unverified");
  assert.equal(s.list({ executor: "codex" }).length, 1);
  assert.equal(s.list({ q: "beta2" }).length, 1);
  assert.equal(s.list({ state: "failed" }).length, 0);
  assert.equal(s.list({ limit: 1 }).length, 1);
  s.close();
});

test("entryFromDispatch: state verbatim, window artifacts with sha256, kb_refs skipped, secrets scrubbed", () => {
  const { board, rec } = setup();
  const e = entryFromDispatch(rec({ state: "replied_unverified" }), { boardDir: board, secrets: ["s3cr3t-value"] });
  assert.equal(e.state, "replied_unverified"); assert.equal(e.success, false);
  assert.match(e.id, /^kb-\d{8}-[0-9a-f]{8}$/); assert.equal(e.uri, "kb://" + e.id); assert.equal(e.id, kbIdFor("d-1", rec().created_at));
  const paths = e.artifacts.map((a) => `${a.root}:${a.path}`).sort();
  assert.deepEqual(paths, ["board:logs/codex/d-1/last-message.txt", "cwd:src/game.js"]);
  assert.equal(e.artifacts.find((a) => a.path === "src/game.js").sha256, sha("console.log(1)"));
  const blob = JSON.stringify(e);
  for (const bad of ["abcdefghijkl123", "ABCDEFGHIJKLMNOPQRST", "ghp_ABCDEFGHIJKLMNOPQRSTUV", "s3cr3t-value"]) assert.ok(!blob.includes(bad), "leaked " + bad);
  assert.equal(e.evidence.token, true); assert.equal(e.evidence.wb_token, "<redacted>"); assert.equal(e.evidence.session_id, "abc");
  assert.match(e.created_at, /\+08:00$/);
  assert.throws(() => entryFromDispatch(rec({ state: "running" })), /not terminal/);
  assert.ok(!isTerminal("awaiting_user")); assert.ok(isTerminal("handoff_closed")); assert.ok(isTerminal("partial"));
});

test("kb ingest: idempotent by dispatch_id, failed still ingested, non-terminal skipped", () => {
  const { root, board, rec } = setup();
  const kb = createKb({ dataDir: path.join(root, "kbdata"), boardDir: board });
  assert.equal(kb.ingest(rec({ state: "running" })).status, "skipped_non_terminal");
  const a = kb.ingest(rec({ state: "failed", reply: null, error: "boom" }));
  assert.equal(a.status, "ingested");
  assert.equal(kb.ingest(rec({ state: "failed", reply: null, error: "boom" })).status, "unchanged");
  const b = kb.ingest(rec());
  assert.equal(b.status, "updated"); assert.equal(b.id, a.id);
  assert.equal(kb.store.count(), 1); assert.equal(kb.store.get(a.id).state, "verified");
  const r = kb.ingestSafe({ id: "bad", state: "verified", created_at: "x" });
  assert.ok(["ingested", "error"].includes(r.status));
});

test("kb_refs: unknown -> 400 no dispatch; known -> prompt block + verified copies", () => {
  const { root, board, rec } = setup();
  const kb = createKb({ dataDir: path.join(root, "kbdata"), boardDir: board });
  const { id } = kb.ingest(rec());
  let dispatched = 0;
  const route = (body, cwd) => { try { const p = kb.prepareDispatch(body, cwd); dispatched++; return { code: 202, p }; } catch (e) { return { code: e.status, error: e.message, extra: e.extra }; } };
  const bad = route({ prompt: "x", kb_refs: ["kb-20990101-deadbeef"] });
  assert.equal(bad.code, 400); assert.deepEqual(bad.extra.unknown_kb_refs, ["kb-20990101-deadbeef"]); assert.equal(dispatched, 0);
  assert.equal(route({ prompt: "x", kb_refs: ["../etc"] }).code, 400);
  assert.equal(route({ prompt: "x", kb_refs: "kb-1" }).code, 400);
  assert.equal(dispatched, 0);
  const newCwd = path.join(root, "next"); fs.mkdirSync(newCwd);
  const ok = route({ prompt: "继续做", kb_refs: [`kb://${id}`] }, newCwd);
  assert.equal(ok.code, 202); assert.deepEqual(ok.p.kb_refs, [id]);
  assert.ok(ok.p.prompt.startsWith("继续做\n\n=== 前序产物"));
  assert.ok(ok.p.prompt.includes(`kb://${id}`)); assert.ok(ok.p.prompt.includes("状态: verified")); assert.ok(ok.p.prompt.includes("=== 前序产物结束 ==="));
  assert.ok(ok.p.copies.every((c) => c.copied), JSON.stringify(ok.p.copies));
  const copied = path.join(newCwd, "kb_refs", id, "src", "game.js");
  assert.equal(fs.readFileSync(copied, "utf8"), "console.log(1)");
  assert.ok(ok.p.prompt.includes(`kb_refs/${id}/src/game.js  sha256=${sha("console.log(1)")}`));
  const noCopy = kb.prepareDispatch({ prompt: "y", kb_refs: [id], kb_copy_artifacts: false }, newCwd);
  assert.equal(noCopy.copies.length, 0); assert.ok(noCopy.prompt.includes("cwd:src/game.js"));
  assert.equal(kb.prepareDispatch({ prompt: "z" }, newCwd).prompt, "z");
});

test("HTTP routes: list / entry / artifact (hash-checked) / reindex / 404", async () => {
  const { root, board, cwd, rec } = setup();
  const kb = createKb({ dataDir: path.join(root, "kbdata"), boardDir: board });
  const dispatches = [rec(), rec({ id: "d-2", state: "awaiting_user" }), rec({ id: "d-3", state: "failed", reply: null })];
  const srv = http.createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (!(await kb.handle(req, res, url, { dispatches: () => dispatches, readBody: async () => ({}) }))) { res.writeHead(418); res.end(); } });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    let j = await (await fetch(base + "/bridge/kb")).json(); assert.equal(j.total, 0);
    j = await (await fetch(base + "/bridge/kb/reindex", { method: "POST", body: "{}" })).json();
    assert.equal(j.ingested.length, 2); assert.equal(j.skipped_non_terminal[0].state, "awaiting_user");
    j = await (await fetch(base + "/bridge/kb/reindex", { method: "POST", body: "{}" })).json(); assert.equal(j.unchanged, 2);
    j = await (await fetch(base + "/bridge/kb?state=verified")).json(); assert.equal(j.count, 1);
    const id = j.entries[0].id; assert.ok(j.entries[0].artifact_count >= 2); assert.equal(j.entries[0].prompt, undefined);
    j = await (await fetch(base + "/bridge/kb/" + id)).json(); assert.equal(j.entry.dispatch_id, "d-1");
    const n = j.entry.artifacts.findIndex((a) => a.path === "src/game.js");
    let r = await fetch(`${base}/bridge/kb/${id}/artifacts/${n}`); assert.equal(r.status, 200); assert.equal(await r.text(), "console.log(1)"); assert.equal(r.headers.get("x-kb-sha256"), sha("console.log(1)"));
    // round 2: the blob copy is served even after the original is overwritten; 409 only when no copy exists
    fs.writeFileSync(path.join(cwd, "src", "game.js"), "changed");
    r = await fetch(`${base}/bridge/kb/${id}/artifacts/${n}`); assert.equal(r.status, 200); assert.equal(await r.text(), "console.log(1)"); assert.equal(r.headers.get("x-kb-source"), "blob");
    fs.rmSync(kb.blobs.fileFor(sha("console.log(1)")));
    r = await fetch(`${base}/bridge/kb/${id}/artifacts/${n}`); assert.equal(r.status, 409);
    assert.equal((await fetch(base + "/bridge/kb/kb-20990101-deadbeef")).status, 404);
    assert.equal((await fetch(base + "/bridge/kb/x/y/z")).status, 404);
    assert.equal((await fetch(base + "/bridge/kbx")).status, 418);
  } finally { srv.close(); }
});

test("buildRefsBlock / parseRefs / scrubText basics", () => {
  assert.deepEqual(parseRefs(["kb://kb-20261116-0123abcd", "kb-20261116-0123abcd"]), ["kb-20261116-0123abcd"]);
  assert.throws(() => parseRefs(["nope"]), KbInputError);
  assert.equal(buildRefsBlock([]), "");
  assert.equal(scrubText("api_key=abcdef123456"), "api_key=<redacted>");
});

// ---------------- round 2: per-project progress ----------------
import { diffProject, validateSnapshotInput } from "./snapshot.mjs";
import { validateEventInput, eventsFromDispatch } from "./events.mjs";
import { createBlobStore } from "./blobs.mjs";
import { buildProjectTree, rollupState, bucketOf } from "./tree.mjs";

async function serve(kb, ctx) {
  const srv = http.createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (!(await kb.handle(req, res, url, ctx))) { res.writeHead(418); res.end(); } });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.closeAllConnections?.(); srv.close(); } };
}
const post = (u, b) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const bodyCtx = (dispatches) => ({ dispatches: () => dispatches, readBody: async (req) => { const c = []; for await (const x of req) c.push(x); return JSON.parse(Buffer.concat(c).toString("utf8") || "{}"); } });

test("blob store: dedupe, refuse changed source, serve after overwrite", () => {
  const dir = tmp(); const b = createBlobStore(path.join(dir, "blobs"));
  const f = path.join(dir, "a.txt"); fs.writeFileSync(f, "hello");
  const r1 = b.putFile(f); assert.equal(r1.blob, true); assert.equal(r1.sha256, sha("hello")); assert.equal(r1.dedup, false);
  const f2 = path.join(dir, "b.txt"); fs.writeFileSync(f2, "hello");
  assert.equal(b.putFile(f2).dedup, true);
  fs.writeFileSync(f2, "other");
  assert.equal(b.putFile(f2, sha("nothing")).reason, "changed_since_ingest");
  assert.equal(fs.readFileSync(b.verifiedPath(sha("hello")), "utf8"), "hello");
  process.env.KB_BLOB_MAX = "3"; assert.match(b.putFile(f).blob ? "x" : b.putFile(f).reason, /too_large/); delete process.env.KB_BLOB_MAX;
});

test("events: validation, secret rejection, idempotent ids, dispatch lifecycle", async () => {
  assert.throws(() => validateEventInput({ events: [{ kind: "Bad Kind", project_id: "p" }] }), /kind/);
  assert.throws(() => validateEventInput({ kind: "note", project_id: "p", summary: "key Bearer abcdefghijklmnop" }), /密钥/);
  assert.throws(() => validateEventInput({ events: [] }), /为空/);
  const a = validateEventInput({ kind: "note", project_id: "p", summary: "x", at: "2026-11-16T01:00:00+08:00" });
  const b = validateEventInput({ kind: "note", project_id: "p", summary: "x", at: "2026-11-16T01:00:00+08:00" });
  assert.equal(a[0].id, b[0].id);
  const { root, board, rec } = setup();
  const kb = createKb({ dataDir: path.join(root, "kbdata"), boardDir: board });
  const ctx = bodyCtx([]);
  const { base, close } = await serve(kb, ctx);
  try {
    let j = await (await post(base + "/bridge/kb/events", { events: [{ kind: "note", project_id: "p1", summary: "hi", at: "2026-11-16T01:00:00+08:00" }] })).json();
    assert.equal(j.written, 1);
    j = await (await post(base + "/bridge/kb/events", { events: [{ kind: "note", project_id: "p1", summary: "hi", at: "2026-11-16T01:00:00+08:00" }] })).json();
    assert.equal(j.written, 0); assert.equal(j.duplicates, 1);
    const r = await post(base + "/bridge/kb/events", { kind: "note", project_id: "p1", payload: { api_key: "sk-ABCDEFGHIJKLMNOPQRSTUV" } });
    assert.equal(r.status, 400); assert.ok(!(await r.text()).includes("ABCDEFGHIJKLMNOP"));
  } finally { close(); }
  const evs = eventsFromDispatch(rec({ events: [{ ts: rec().created_at, msg: "spawn" }] }));
  assert.deepEqual(evs.map((e) => e.kind), ["dispatched", "note", "completed"]);
  assert.equal(evs.at(-1).to_state, "verified");
  assert.deepEqual(eventsFromDispatch(rec()).map((e) => e.id), eventsFromDispatch(rec()).map((e) => e.id));
  const ho = eventsFromDispatch(rec({ state: "handoff_closed" })).at(-1); assert.equal(ho.kind, "handoff_closed");
  assert.equal(eventsFromDispatch(rec({ state: "replied_unverified" })).at(-1).kind, "state_changed");
});

test("snapshot: versioning, diff events (created/split/assigned/updated/removed), unchanged re-post", async () => {
  const { root, board } = setup();
  const kb = createKb({ dataDir: path.join(root, "kbdata"), boardDir: board });
  const p1 = { project_id: "camelot", name: "卡美洛", tasks: [{ task_id: "t1", title: "根", priority: "P1", executor_channel_id: null }] };
  let r = kb.postSnapshot({ projects: [p1] });
  assert.equal(r.projects[0].status, "created"); assert.equal(r.projects[0].version, 1);
  assert.equal(kb.postSnapshot({ projects: [p1] }).projects[0].status, "unchanged");
  const p2 = { ...p1, tasks: [{ ...p1.tasks[0], executor_channel_id: "codex", title: "根（改）" }, { task_id: "t1a", title: "子 A", parent_task_id: "t1" }, { task_id: "t1b", title: "子 B", parent_task_id: "t1", executor_channel_id: "workbuddy" }] };
  r = kb.postSnapshot({ projects: [p2] }); assert.equal(r.projects[0].version, 2);
  const kinds = kb.store.listRecs("events", { project_id: "camelot", limit: 0 }).map((e) => e.kind).sort();
  for (const k of ["project_created", "task_created", "task_split", "assigned", "task_updated"]) assert.ok(kinds.includes(k), k + " missing: " + kinds);
  const split = kb.store.listRecs("events", { project_id: "camelot", kind: "task_split", limit: 0 })[0];
  assert.deepEqual(split.payload.children.sort(), ["t1a", "t1b"]);
  kb.postSnapshot({ projects: [{ ...p2, tasks: p2.tasks.filter((t) => t.task_id !== "t1b") }] });
  assert.equal(kb.store.listRecs("events", { project_id: "camelot", kind: "task_removed", limit: 0 }).length, 1);
  assert.throws(() => validateSnapshotInput({ projects: [{ project_id: "x", tasks: [{ task_id: "a", description: "password=hunter2hunter2" }] }] }), /密钥/);
  assert.throws(() => validateSnapshotInput({ projects: [{ project_id: "bad id with spaces" }] }), /project_id/);
  assert.equal(diffProject(null, { project_id: "z", tasks: [] }, { version: 1 }).length, 1);
});

test("docs: versions only on sha change, path confined, dispatch rule (king report)", () => {
  const { root, board } = setup();
  const kb = createKb({ dataDir: path.join(root, "kbdata"), boardDir: board, docsConfigFile: path.join(root, "docs.config.json") });
  fs.writeFileSync(path.join(root, "docs.config.json"), JSON.stringify({ roots: { workspace: ".." }, rules: [{ root: "workspace", glob: "ai-dispatch-test/**/ACCEPTANCE*.md", doc_type: "验收报告" }],
    dispatch_rules: [{ task_id_suffix: "::king-report", field: "prompt", doc_type: "国王汇报" }] }));
  const acc = path.join(root, "ai-dispatch-test", "camelot", "ACCEPTANCE.md"); fs.mkdirSync(path.dirname(acc), { recursive: true }); fs.writeFileSync(acc, "v1");
  let r = kb.scanDocs(); assert.equal(r.length, 1); assert.equal(r[0].status, "created"); assert.equal(r[0].doc_type, "验收报告");
  assert.equal(kb.scanDocs()[0].status, "unchanged");
  fs.writeFileSync(acc, "v2"); r = kb.scanDocs(); assert.equal(r[0].status, "new_version"); assert.equal(r[0].version, 2);
  fs.writeFileSync(acc, "v3-overwritten");
  const vers = kb.store.listRecs("doc_versions", { limit: 0 }).filter((v) => v.doc_id === r[0].doc_id).sort((a, b) => a.version - b.version);
  assert.equal(fs.readFileSync(kb.blobs.verifiedPath(vers[0].sha256), "utf8"), "v1");
  assert.throws(() => kb.docs.postDoc({ project_id: "p", title: "x", path: "../../etc/passwd" }), /工作区/);
  assert.throws(() => kb.docs.postDoc({ project_id: "p", title: "x", content: "token: abcdefghijkl" }), /密钥/);
  assert.equal(kb.docs.postDoc({ project_id: "p", doc_type: "任务包", title: "包", content: "内容" }).status, "created");
  kb.ingest({ id: "d-k", executor: "wb", task_id: "camelot::king-report", project_id: "camelot", title: "汇报", prompt: "本轮汇报正文", state: "awaiting_user", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), evidence: {}, events: [] });
  assert.equal(kb.store.listRecs("docs", { project_id: "camelot", kind: "国王汇报", limit: 0 }).length, 1);
});

test("timeline + tree + node: ordering, filters, rollup, lazy children, breadcrumbs, pagination", async () => {
  const { root, board, cwd, rec } = setup();
  const kb = createKb({ dataDir: path.join(root, "kbdata"), boardDir: board, syncIntervalMs: 0 });
  kb.postSnapshot({ projects: [{ project_id: "p1", name: "卡美洛", tasks: [
    { task_id: "t1", title: "根" }, { task_id: "t1a", title: "子 A", parent_task_id: "t1" }, { task_id: "t1b", title: "子 B", parent_task_id: "t1" },
    { task_id: "t1a1", title: "孙", parent_task_id: "t1a" }, { task_id: "t2", title: "二", phase: "M1" }] }] });
  const d1 = rec({ id: "d-a", task_id: "t1a1", state: "verified" });
  const d2 = rec({ id: "d-b", task_id: "t1b", state: "running", finished_at: null, reply: null });
  const dispatches = [d2, d1];
  const { base, close } = await serve(kb, bodyCtx(dispatches));
  try {
    let j = await (await fetch(base + "/bridge/kb/timeline?project_id=p1&order=asc")).json();
    const ats = j.items.map((x) => x.at); assert.deepEqual(ats, [...ats].sort());
    assert.ok(j.items.some((x) => x.kind === "kb_entry" && x.dispatch_id === "d-a"));
    assert.ok(j.items.some((x) => x.kind === "dispatched" && x.dispatch_id === "d-b"));
    j = await (await fetch(base + "/bridge/kb/timeline?project_id=p1&kind=task_created")).json();
    assert.ok(j.items.length === 5 && j.items.every((x) => x.kind === "task_created"));
    j = await (await fetch(base + "/bridge/kb/timeline?project_id=p1&limit=2")).json(); assert.equal(j.items.length, 2); assert.equal(j.next_cursor, "2");
    j = await (await fetch(base + "/bridge/kb/projects")).json();
    const p1 = j.projects.find((x) => x.project_id === "p1"); assert.equal(p1.name, "卡美洛"); assert.equal(p1.counts.tasks, 5);
    j = await (await fetch(base + "/bridge/kb/tree?project_id=p1")).json();
    assert.equal(j.node.kind, "project"); assert.equal(j.node.rollup.state, "running");
    assert.deepEqual(j.children.map((c) => c.kind), ["phase", "task"]);
    const t1 = j.children.find((c) => c.id === "t:p1:t1");
    assert.deepEqual(t1.rollup.counts, { verified: 1, failed: 0, running: 1, needs_check: 0, not_started: 0, total: 2 });
    j = await (await fetch(base + "/bridge/kb/tree?node=" + encodeURIComponent("t:p1:t1") + "&depth=3")).json();
    const a = j.children.find((c) => c.id === "t:p1:t1a"); assert.equal(a.kind, "subtask"); assert.equal(a.children[0].id, "t:p1:t1a1");
    assert.equal(a.children[0].children[0].kind, "dispatch"); assert.equal(a.rollup.state, "verified");
    j = await (await fetch(base + "/bridge/kb/tree?node=" + encodeURIComponent("t:p1:t1") + "&limit=1")).json(); assert.equal(j.children.length, 1); assert.equal(j.next_cursor, "1");
    const entry = kb.store.getByDispatch("d-a");
    j = await (await fetch(base + "/bridge/kb/node/" + encodeURIComponent(`a:${entry.id}:0`))).json();
    assert.deepEqual(j.breadcrumbs.map((b) => b.kind), ["project", "task", "subtask", "subtask", "dispatch", "artifact"]);
    j = await (await fetch(base + "/bridge/kb/node/" + encodeURIComponent("d:d-b"))).json(); assert.equal(j.node.state, "running"); assert.equal(j.detail.dispatch.state, "running");
    assert.equal((await fetch(base + "/bridge/kb/node/nope")).status, 404);
    // handoff_closed / later state reaches the KB via lazy sync without a server hook
    d2.state = "failed"; d2.finished_at = new Date().toISOString(); d2.error = "boom";
    j = await (await fetch(base + "/bridge/kb/tree?project_id=p1")).json(); assert.equal(j.node.rollup.state, "failed");
    assert.equal(kb.store.getByDispatch("d-b").state, "failed");
    // kb_refs copy prefers the blob after the original was overwritten
    fs.writeFileSync(path.join(cwd, "src", "game.js"), "overwritten");
    const next = path.join(root, "next2"); fs.mkdirSync(next);
    const prep = kb.prepareDispatch({ prompt: "go", kb_refs: [entry.id] }, next);
    const c = prep.copies.find((x) => x.source === "src/game.js"); assert.equal(c.copied, true); assert.equal(c.from, "blob");
    assert.equal(fs.readFileSync(path.join(next, c.path), "utf8"), "console.log(1)");
  } finally { close(); }
  assert.equal(bucketOf("replied_unverified"), "needs_check"); assert.equal(rollupState({ verified: 1, not_started: 1, total: 2, failed: 0, running: 0, needs_check: 0 }), "in_progress");
  const cyc = buildProjectTree({ pid: "c", snapshot: { tasks: [{ task_id: "x", parent_task_id: "y" }, { task_id: "y", parent_task_id: "x" }] }, dispatches: [], entries: new Map(), docs: [], docVersions: new Map() });
  assert.equal(cyc.get("t:c:x").parent_id, "p:c");
});

test("sent_awaiting_result is non-terminal; project_dir scanned (window only, skips, overlap, blob, sandbox fields)", async () => {
  const { root, board, cwd, rec } = setup();
  const { bucketOf } = await import("./tree.mjs");
  assert.equal(isTerminal("sent_awaiting_result"), false);
  assert.equal(bucketOf("sent_awaiting_result"), "running");
  const proj = path.join(root, "shared-proj"); fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  for (const d of ["node_modules", "dist", ".git", "kb_refs"]) { fs.mkdirSync(path.join(proj, d), { recursive: true }); fs.writeFileSync(path.join(proj, d, "x.js"), "skip"); }
  fs.writeFileSync(path.join(proj, "src", "main.js"), "new code");
  const stale = path.join(proj, "OLDCODE.js"); fs.writeFileSync(stale, "old"); fs.utimesSync(stale, new Date(Date.now() - 7200e3), new Date(Date.now() - 7200e3));
  const kb = createKb({ dataDir: path.join(root, "data"), boardDir: board, secrets: [] });
  const r0 = kb.ingest(rec({ state: "sent_awaiting_result", finished_at: null, project_dir: proj }), []);
  assert.equal(r0.status, "skipped_non_terminal");
  const other = rec({ id: "d-2", project_dir: proj, evidence: { cwd: path.join(root, "other") } });
  const full = rec({ project_dir: proj, evidence: { ...rec().evidence, project_dir: proj, sandbox: "workspace-write", sandbox_source: "dispatch" } });
  const r = kb.ingest(full, [full, other]);
  assert.equal(r.status, "ingested");
  const e = kb.store.getByDispatch("d-1");
  assert.equal(e.project_dir, path.resolve(proj));
  assert.equal(e.sandbox, "workspace-write"); assert.equal(e.sandbox_source, "dispatch");
  const pa = e.artifacts.filter((a) => a.root === "project");
  assert.deepEqual(pa.map((a) => a.path), ["src/main.js"]);
  assert.equal(pa[0].attribution, "project_dir_time_window"); assert.equal(pa[0].blob, true);
  assert.ok(e.artifacts.some((a) => a.root === "cwd" && a.path === "src/game.js"));
  assert.ok(e.overlapping_dispatches.includes("d-2")); assert.deepEqual(e.overlapping_dispatches_project_dir, ["d-2"]);
  // serve from blob even after the shared file changes
  fs.writeFileSync(path.join(proj, "src", "main.js"), "overwritten by later dispatch");
  const n = e.artifacts.findIndex((a) => a.root === "project");
  const res = { headers: null, body: "", writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { if (b) this.body += b; } };
  const { PassThrough } = await import("node:stream");
  const pt = new PassThrough(); Object.assign(pt, { writeHead: res.writeHead, code: 0 }); let body = ""; pt.on("data", (c) => (body += c));
  await kb.handle({ method: "GET" }, pt, new URL(`http://x/bridge/kb/${e.id}/artifacts/${n}`), {});
  await new Promise((ok) => pt.on("end", ok));
  assert.equal(body, "new code"); assert.equal(pt.headers["X-KB-Source"], "blob");
  // unsafe project_dir ignored
  const { safeProjectDir } = await import("./ingest.mjs");
  assert.equal(safeProjectDir("C:\\", null), null); assert.equal(safeProjectDir("relative/dir", null), null); assert.equal(safeProjectDir(cwd, cwd), null);
});

test("tree guards: parent cycle and over-deep chain re-rooted; secrets fn + per-call extras redacted", async () => {
  const { buildProjectTree, breadcrumbs, MAX_TREE_DEPTH } = await import("./tree.mjs");
  const tasks = [{ task_id: "a", parent_task_id: "b" }, { task_id: "b", parent_task_id: "a" }, { task_id: "c", parent_task_id: "c" }];
  for (let i = 0; i <= MAX_TREE_DEPTH + 2; i++) tasks.push({ task_id: `n${i}`, parent_task_id: i ? `n${i - 1}` : null });
  const nodes = buildProjectTree({ pid: "p", snapshot: { project_id: "p", tasks }, dispatches: [{ id: "d-a", task_id: "a", state: "failed", executor: "x", created_at: "2026-11-16T00:00:00Z" }], entries: new Map(), docs: [], docVersions: new Map() });
  for (const id of ["a", "b", "c"]) { const n = nodes.get(`t:p:${id}`); assert.equal(n.parent_id, "p:p"); assert.equal(n.tree_issue, "cycle"); }
  const deep = nodes.get(`t:p:n${MAX_TREE_DEPTH + 2}`); assert.equal(deep.tree_issue, "too_deep"); assert.equal(deep.parent_id, "p:p");
  assert.ok(breadcrumbs(nodes, `t:p:n${MAX_TREE_DEPTH}`).length <= 66);
  assert.equal(nodes.get("p:p").rollup.state, "failed");
  const { root, board, rec } = setup();
  let secretsFn = () => ["fn-secret-value-123", undefined, 42];
  const kb = createKb({ dataDir: path.join(root, "data"), boardDir: board, secrets: () => secretsFn() });
  kb.ingestSafe(rec({ reply: "x fn-secret-value-123 y call-secret-xyz z" }), [], ["call-secret-xyz"]);
  const e = kb.store.getByDispatch("d-1");
  assert.ok(!JSON.stringify(e).includes("fn-secret-value-123")); assert.ok(!JSON.stringify(e).includes("call-secret-xyz"));
});

test("docs from dispatch: re-ingesting the same dispatches never appends versions", () => {
  const { root, board, rec } = setup();
  const kb = createKb({ dataDir: path.join(root, "data"), boardDir: board, secrets: [] });
  const mk = (id, prompt, t) => rec({ id, task_id: "proj::king-report", project_id: "proj", prompt, created_at: t, finished_at: t, updated_at: t, reply: null });
  const ds = [mk("d-k1", "汇报一", "2026-11-15T10:00:00Z"), mk("d-k2", "汇报二", "2026-11-15T11:00:00Z")];
  for (let i = 0; i < 3; i++) for (const d of ds) kb.ingest(d, ds, { force: true });
  const docs = kb.store.listRecs("docs", { limit: 0 }).filter((d) => d.doc_type === "国王汇报");
  assert.equal(docs.length, 1); assert.equal(docs[0].latest_version, 2);
  assert.equal(kb.store.listRecs("doc_versions", { limit: 0 }).filter((v) => v.doc_id === docs[0].id).length, 2);
});

test("review fixes: postDoc ignores client file/source, path xor content, secret keys rejected, dup task_id, secret files not copied, parent task own failure", async () => {
  const { root, board, cwd, rec } = setup();
  const kb = createKb({ dataDir: path.join(root, "data"), boardDir: board, secrets: ["KNOWN-secret-1234"] });
  const outside = path.join(os.tmpdir(), `kb-outside-${Date.now()}.txt`); fs.writeFileSync(outside, "outside content");
  const r = kb.docs.postDoc({ project_id: "p", doc_type: "note", title: "t", content: "inside", file: outside, source: "scan" });
  const v = kb.store.listRecs("doc_versions", { limit: 0 }).find((x) => x.doc_id === r.doc_id);
  assert.equal(v.source, "post"); assert.equal(v.sha256, sha("inside"));
  assert.throws(() => kb.docs.postDoc({ project_id: "p", doc_type: "note", title: "t", content: "x", path: "board/a.md" }), /二选一/);
  assert.throws(() => kb.docs.postDoc({ project_id: "p", doc_type: "note", title: "t", path: "" }), /二选一/);
  const { validateEventInput } = await import("./events.mjs");
  assert.throws(() => validateEventInput({ kind: "note", project_id: "p", payload: { token: "abc" } }), /密钥/);
  assert.throws(() => validateEventInput({ kind: "note", project_id: "p", summary: "x KNOWN-secret-1234" }, ["KNOWN-secret-1234"]), /密钥/);
  assert.equal(validateEventInput({ kind: "note", project_id: "p", payload: { token_env: "WB_TOKEN" } }).length, 1);
  const { validateSnapshotInput } = await import("./snapshot.mjs");
  assert.throws(() => validateSnapshotInput({ projects: [{ project_id: "p", tasks: [{ task_id: "a" }, { task_id: "a" }] }] }), /重复/);
  fs.writeFileSync(path.join(cwd, "src", "leak.env"), "API_KEY=abcdef123456789");
  kb.ingest(rec(), []);
  const leak = kb.store.getByDispatch("d-1").artifacts.find((a) => a.path === "src/leak.env");
  assert.equal(leak.blob, false); assert.equal(leak.blob_reason, "secret_pattern");
  const { buildProjectTree } = await import("./tree.mjs");
  const nodes = buildProjectTree({ pid: "q", snapshot: { project_id: "q", tasks: [{ task_id: "parent" }, { task_id: "kid", parent_task_id: "parent" }] },
    dispatches: [{ id: "d-p", task_id: "parent", state: "failed", executor: "x", created_at: "2026-11-16T00:00:00Z" }, { id: "d-k", task_id: "kid", state: "verified", executor: "x", created_at: "2026-11-16T00:00:00Z" }], entries: new Map(), docs: [], docVersions: new Map() });
  assert.equal(nodes.get("t:q:parent").rollup.state, "failed"); assert.equal(nodes.get("p:q").rollup.state, "failed");
  fs.rmSync(outside, { force: true });
});
