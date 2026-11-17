// KB facade for the operator-board bridge. server.mjs only needs (unchanged since round 1):
//   const kb = createKb({ dataDir, boardDir, cwdFor, secrets, log });
//   kb.ingestSafe(rec, state.dispatches)            // at the dispatch terminal point
//   kb.resolveRefs(b.kb_refs) / kb.prepareDispatch(b, cwd)   // at POST /bridge/dispatch
//   if (url.pathname === "/bridge/kb" || url.pathname.startsWith("/bridge/kb/")) return kb.handle(req, res, url, { dispatches, readBody })
// Round 2 (per-project progress) adds events / snapshots / blobs / docs / timeline / tree, all behind the same prefix.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.mjs";
import { createBlobStore, blobMax } from "./blobs.mjs";
import { KbInputError, artifactBase, insideReal, containsSecret, entryFromDispatch, isTerminal, summarize, parseRefs, materializeRefs, buildRefsBlock, injectRefs, sha256File, normalizeId, scrubText, toShanghai, LIMITS } from "./ingest.mjs";
import { eventsFromDispatch, validateEventInput, UNASSIGNED } from "./events.mjs";
import { validateSnapshotInput, diffProject, projectHash } from "./snapshot.mjs";
import { createDocs, loadDocsConfig } from "./docs.mjs";
import { buildProjectTree, childrenPage, publicNode, breadcrumbs } from "./tree.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Ingest oldest first so doc versions / state events are numbered in time order. */
export const oldestFirst = (list) => [...list].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
const INGEST_VERSION = 4; // 3: project_dir artifacts + sandbox fields; 4: secret-looking files are not copied
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const MIME = { ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".json": "application/json; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

export function createKb({ dataDir, boardDir, cwdFor, secrets = () => [], backend, log = () => {}, docsConfigFile = path.join(HERE, "docs.config.json"), syncIntervalMs = 10000 }) {
  const store = openStore(dataDir, backend);
  const blobs = createBlobStore(path.join(dataDir, "blobs"));
  const docs = createDocs({ store, blobs, boardDir });
  // secrets: array or () => array (server.mjs passes WB_TOKEN, CODEBUDDY_GATEWAY_PASSWORD, ...akili.secretValues()). Only non-trivial strings are used.
  let callSecrets = [];
  const secretList = () => { let base = []; try { base = typeof secrets === "function" ? secrets() : secrets; } catch {} return [...(Array.isArray(base) ? base : []), ...callSecrets].filter((x) => typeof x === "string" && x.length >= 4); };
  const scrub = (s) => scrubText(s, secretList());
  const docsConfig = () => loadDocsConfig(docsConfigFile);
  const recCwd = (rec) => (typeof rec.cwd === "string" && rec.cwd) || (typeof rec.evidence?.cwd === "string" && rec.evidence.cwd) || (cwdFor ? cwdFor(rec) : null);
  function stateHash(rec) { return [INGEST_VERSION, rec.state, rec.finished_at || "", (rec.reply || "").length, (rec.error || "").length].join("|"); }

  /** Copies are permanent and downloadable, so a file that looks like it holds a secret is not copied (blob:false, secret_pattern). */
  function secretInFile(src) {
    try { const st = fs.statSync(src); if (st.size > blobMax()) return null; const t = fs.readFileSync(src).toString("utf8");
      const known = secretList(); if (containsSecret(t) || known.some((k) => t.includes(k))) return { blob: false, reason: "secret_pattern" }; } catch {}
    return null;
  }
  /** Copy artifacts into the blob store; keep earlier-recorded artifacts that left the time window (overwritten later). */
  function attachBlobs(e, prev) {
    const base = (a) => artifactBase(a, e, boardDir);
    for (const a of e.artifacts) {
      const src = base(a) ? path.resolve(base(a), a.path) : null;
      const r = !src ? { blob: false, reason: "no_root" } : secretInFile(src) || blobs.putFile(src, a.sha256);
      a.blob = r.blob; if (!r.blob) a.blob_reason = r.reason;
    }
    for (const old of prev?.artifacts || []) {
      if (e.artifacts.some((a) => a.root === old.root && a.path === old.path)) continue;
      const src = base(old) ? path.resolve(base(old), old.path) : null;
      const r = blobs.has(old.sha256) ? { blob: true } : src ? (secretInFile(src) || blobs.putFile(src, old.sha256)) : { blob: false, reason: "no_root" };
      e.artifacts.push({ ...old, blob: r.blob, ...(r.blob ? {} : { blob_reason: r.reason === "changed_since_ingest" ? `overwritten_since_dispatch(sha256_now=${r.sha256_now})` : r.reason }), carried_from_previous_ingest: true });
    }
  }

  function writeEvents(list) { let n = 0; for (const ev of list) if (!store.getRec("events", ev.id)) { store.putRec("events", ev); n++; } return n; }

  function ingest(rec, dispatches = [], { force = false } = {}) {
    // lifecycle events are recorded for every state (incl. in-flight), idempotent by event_id
    const prevState = store.listRecs("events", { project_id: rec?.project_id || UNASSIGNED, limit: 0 }).find((e) => e.dispatch_id === rec?.id && e.to_state && e.kind !== "dispatched")?.to_state || null;
    const events = rec?.id ? writeEvents(eventsFromDispatch(rec, secretList(), prevState)) : 0;
    try { docs.fromDispatch(rec, docsConfig(), scrub); } catch (e) { log(`kb doc-from-dispatch ${rec?.id}: ${String(e.message || e).slice(0, 120)}`); }
    if (!isTerminal(rec?.state)) return { status: "skipped_non_terminal", dispatch_id: rec?.id, state: rec?.state, events };
    const prev = store.getByDispatch(rec.id);
    if (prev && !force && prev.state_hash === stateHash(rec)) return { status: "unchanged", id: prev.id, events };
    const e = entryFromDispatch(rec, { cwd: recCwd(rec), boardDir, secrets: secretList(), dispatches, prev, nowIso: new Date().toISOString() });
    e.state_hash = stateHash(rec);
    e.ingest_version = INGEST_VERSION;
    attachBlobs(e, prev);
    store.put(e);
    return { status: prev ? "updated" : "ingested", id: e.id, state: e.state, artifacts: e.artifacts.length, blobs: e.artifacts.filter((a) => a.blob).length, events };
  }

  /** extraSecrets (optional): per-call secret values, redacted in addition to createKb's list. */
  function ingestSafe(rec, dispatches, extraSecrets = []) {
    callSecrets = Array.isArray(extraSecrets) ? extraSecrets : [];
    try { const r = ingest(rec, dispatches); if (r.status !== "skipped_non_terminal") log(`kb ${r.status} ${rec.id} -> ${r.id || "-"}`); return r; }
    catch (e) { log(`kb ingest failed ${rec?.id}: ${String(e.message || e).slice(0, 200)}`); return { status: "error", error: String(e.message || e) }; }
    finally { callSecrets = []; }
  }

  /** Lazy sync from live dispatch records (covers handoff_closed and in-flight states without a server hook). */
  let lastSync = 0;
  function sync(ctx, force = false) {
    if (!ctx?.dispatches) return;
    if (!force && Date.now() - lastSync < syncIntervalMs) return;
    lastSync = Date.now();
    const all = ctx.dispatches();
    for (const rec of oldestFirst(all)) { try { ingest(rec, all); } catch (e) { log(`kb sync ${rec?.id}: ${String(e.message || e).slice(0, 120)}`); } }
  }

  function resolveRefs(raw) {
    const ids = parseRefs(raw);
    const entries = []; const missing = [];
    for (const id of ids) { const e = store.get(id); if (e) entries.push(e); else missing.push(id); }
    if (missing.length) throw new KbInputError("知识库里找不到这些条目，未派发：" + missing.join(", "), 400, { unknown_kb_refs: missing });
    return entries;
  }
  function prepareDispatch(body, cwd) {
    const entries = resolveRefs(body?.kb_refs);
    if (!entries.length) return { prompt: body.prompt, kb_refs: [], copies: [] };
    const copies = body.kb_copy_artifacts === false || !cwd ? [] : materializeRefs(entries, cwd, boardDir, blobs);
    const prompt = injectRefs(body.prompt, buildRefsBlock(entries, body.kb_copy_artifacts === false ? null : copies));
    if (prompt.length > 128000) throw new KbInputError("引用知识库后任务内容过长", 413);
    return { prompt, kb_refs: entries.map((e) => e.id), copies };
  }

  // ---------------- snapshots ----------------
  function postSnapshot(body) {
    const projects = validateSnapshotInput(body, secretList());
    const actor = typeof body?.actor === "string" ? body.actor.slice(0, 80) : "board";
    const out = [];
    for (const p of projects) {
      const sha = projectHash(p);
      const prev = store.getRec("snapshots", p.project_id);
      if (prev && prev.sha256 === sha) { out.push({ project_id: p.project_id, status: "unchanged", version: prev.version }); continue; }
      const version = (prev?.version || 0) + 1;
      const at = toShanghai();
      const blob = blobs.putBuffer(JSON.stringify(p));
      const events = diffProject(prev?.project || null, p, { version, actor, at: new Date().toISOString() });
      const written = writeEvents(events);
      store.putRec("snapshot_versions", { id: `${p.project_id}:v${version}`, project_id: p.project_id, kind: "snapshot_version", at, version, sha256: sha, blob_sha256: blob.sha256 || null, task_count: (p.tasks || []).length, actor });
      store.putRec("snapshots", { id: p.project_id, project_id: p.project_id, kind: "snapshot", at, version, sha256: sha, project: p });
      out.push({ project_id: p.project_id, status: prev ? "new_version" : "created", version, events: written });
    }
    return { projects: out };
  }

  // ---------------- views ----------------
  const allEntries = () => store.list({ limit: 500 });
  function projectIds(ctx) {
    const ids = new Set();
    for (const s of store.listRecs("snapshots", { limit: 0 })) ids.add(s.project_id);
    for (const e of allEntries()) ids.add(e.project_id || UNASSIGNED);
    for (const d of ctx?.dispatches?.() || []) ids.add(d.project_id || UNASSIGNED);
    for (const d of store.listRecs("docs", { limit: 0 })) ids.add(d.project_id);
    for (const e of store.listRecs("events", { limit: 0 })) ids.add(e.project_id);
    return [...ids];
  }
  function projectModel(pid, ctx) {
    const snap = store.getRec("snapshots", pid);
    const live = (ctx?.dispatches?.() || []).filter((d) => (d.project_id || UNASSIGNED) === pid);
    const ents = allEntries().filter((e) => (e.project_id || UNASSIGNED) === pid);
    const entries = new Map(ents.map((e) => [e.dispatch_id, e]));
    const seen = new Set(live.map((d) => d.id));
    // dispatches that fell out of the bridge's 200-record window still exist as kb entries
    const fromEntries = ents.filter((e) => !seen.has(e.dispatch_id)).map((e) => ({ id: e.dispatch_id, task_id: e.task_id, executor: e.executor, model: e.model, state: e.state, title: e.title, reply: e.reply, created_at: e.dispatch_created_at }));
    const dispatches = [...live, ...fromEntries].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const docList = store.listRecs("docs", { project_id: pid, limit: 0 });
    const docVersions = new Map(docList.map((d) => [d.id, store.listRecs("doc_versions", { project_id: pid, limit: 0 }).filter((v) => v.doc_id === d.id)]));
    return buildProjectTree({ pid, snapshot: snap?.project || null, dispatches, entries, docs: docList, docVersions });
  }
  function nodeProject(id, ctx) {
    const [k, ...rest] = id.split(":"); const tail = rest.join(":");
    if (k === "p" || k === "docs") return tail;
    if (k === "t" || k === "ph") { for (const pid of projectIds(ctx)) if (tail.startsWith(pid + ":")) return pid; return null; }
    if (k === "d") { const live = (ctx?.dispatches?.() || []).find((d) => d.id === tail); return live ? live.project_id || UNASSIGNED : (store.getByDispatch(tail)?.project_id ?? null) || (store.getByDispatch(tail) ? UNASSIGNED : null); }
    if (k === "a") { const e = store.get(rest[0]); return e ? e.project_id || UNASSIGNED : null; }
    if (k === "doc" || k === "dv") return store.getRec("docs", rest[0])?.project_id || null;
    return null;
  }

  function timeline(q) {
    const f = { project_id: q.project_id, task_id: q.task_id, kind: q.kind, since: q.since, until: q.until, limit: 0 };
    const items = store.listRecs("events", f).map((e) => ({ at: e.at, kind: e.kind, project_id: e.project_id, task_id: e.task_id, dispatch_id: e.dispatch_id, event_id: e.id,
      kb_id: null, doc_id: e.payload?.doc_id || null, title: e.summary, summary: e.summary, state: e.to_state, actor: e.actor, source: e.source,
      links: { ...(e.dispatch_id ? { node: `/bridge/kb/node/${encodeURIComponent("d:" + e.dispatch_id)}` } : {}), ...(e.payload?.doc_id ? { doc: `/bridge/kb/docs/${e.payload.doc_id}/versions` } : {}) } }));
    if (!q.kind || q.kind === "kb_entry") for (const e of allEntries()) {
      const pid = e.project_id || UNASSIGNED; const at = e.dispatch_finished_at || e.dispatch_created_at;
      if (q.project_id && pid !== q.project_id) continue; if (q.task_id && e.task_id !== q.task_id) continue;
      if (q.since && at < q.since) continue; if (q.until && at > q.until) continue;
      items.push({ at, kind: "kb_entry", project_id: pid, task_id: e.task_id, dispatch_id: e.dispatch_id, kb_id: e.id, doc_id: null, title: e.title, summary: (e.reply || e.error || "").slice(0, 200),
        state: e.state, actor: e.executor, source: "kb", links: { entry: `/bridge/kb/${e.id}`, node: `/bridge/kb/node/${encodeURIComponent("d:" + e.dispatch_id)}` }, artifact_count: e.artifacts.length });
    }
    const asc = q.order === "asc";
    items.sort((a, b) => (asc ? 1 : -1) * String(a.at || "").localeCompare(String(b.at || "")) || String(a.event_id || a.kb_id).localeCompare(String(b.event_id || b.kb_id)));
    const lim = Math.min(500, Math.max(1, Number(q.limit) || 100)); const off = Math.max(0, Number(q.cursor) || 0);
    return { total: items.length, count: Math.min(lim, Math.max(0, items.length - off)), items: items.slice(off, off + lim), next_cursor: off + lim < items.length ? String(off + lim) : null };
  }

  function projectsView(ctx) {
    return projectIds(ctx).map((pid) => {
      const nodes = projectModel(pid, ctx); const root = nodes.get(`p:${pid}`);
      const ev = store.listRecs("events", { project_id: pid, limit: 1 })[0];
      const snap = store.getRec("snapshots", pid);
      return { project_id: pid, name: root.title, rollup: root.rollup, snapshot_version: snap?.version || null,
        counts: { tasks: [...nodes.values()].filter((n) => n.kind === "task" || n.kind === "subtask").length, dispatches: [...nodes.values()].filter((n) => n.kind === "dispatch").length,
          entries: allEntries().filter((e) => (e.project_id || UNASSIGNED) === pid).length, events: store.countRecs("events", { project_id: pid }), docs: store.countRecs("docs", { project_id: pid }) },
        last_activity: ev?.at || null, links: { tree: `/bridge/kb/tree?project_id=${encodeURIComponent(pid)}`, timeline: `/bridge/kb/timeline?project_id=${encodeURIComponent(pid)}` } };
    }).sort((a, b) => String(b.last_activity || "").localeCompare(String(a.last_activity || "")));
  }

  function sendJson(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...CORS }); res.end(JSON.stringify(obj)); }
  function sendFile(res, file, sha, name, extra = {}) { res.writeHead(200, { "Content-Type": MIME[path.extname(name).toLowerCase()] || "application/octet-stream", "X-KB-SHA256": sha, ...extra, ...CORS }); fs.createReadStream(file).pipe(res); }
  const qp = (url, keys) => Object.fromEntries(keys.map((k) => [k, url.searchParams.get(k) || undefined]));

  async function handle(req, res, url, ctx = {}) {
    const p = url.pathname;
    if (!(p === "/bridge/kb" || p.startsWith("/bridge/kb/"))) return false;
    try {
      const body = async () => (ctx.readBody ? await ctx.readBody(req) : {});
      // ---- round 2 routes (checked first so ids never shadow them) ----
      if (p === "/bridge/kb/events") {
        if (req.method === "POST") { const list = validateEventInput(await body(), secretList()); const written = writeEvents(list); sendJson(res, 200, { accepted: list.length, written, duplicates: list.length - written, ids: list.map((e) => e.id) }); return true; }
        if (req.method === "GET") { sync(ctx); const q = qp(url, ["project_id", "task_id", "kind", "since", "until", "limit", "cursor"]); const events = store.listRecs("events", { ...q, limit: Math.min(500, Number(q.limit) || 100), offset: Number(q.cursor) || 0 }); sendJson(res, 200, { total: store.countRecs("events", q), count: events.length, events }); return true; }
      }
      if (p === "/bridge/kb/projects/snapshot" && req.method === "POST") { sendJson(res, 200, postSnapshot(await body())); return true; }
      if (p === "/bridge/kb/projects" && req.method === "GET") { sync(ctx); sendJson(res, 200, { projects: projectsView(ctx) }); return true; }
      if (p === "/bridge/kb/timeline" && req.method === "GET") { sync(ctx); sendJson(res, 200, timeline(qp(url, ["project_id", "task_id", "kind", "since", "until", "limit", "cursor", "order"]))); return true; }
      if (p === "/bridge/kb/tree" && req.method === "GET") {
        sync(ctx);
        const q = qp(url, ["project_id", "node", "depth", "limit", "cursor"]);
        if (!q.node && !q.project_id) { sendJson(res, 200, { node: null, children: projectsView(ctx).map((x) => ({ id: `p:${x.project_id}`, parent_id: null, kind: "project", title: x.name, project_id: x.project_id, rollup: x.rollup, has_children: true, links: { self: `/bridge/kb/node/${encodeURIComponent("p:" + x.project_id)}`, children: `/bridge/kb/tree?node=${encodeURIComponent("p:" + x.project_id)}` } })), total: null, next_cursor: null }); return true; }
        const id = q.node || `p:${q.project_id}`;
        const pid = q.project_id || nodeProject(id, ctx);
        const page = pid ? childrenPage(projectModel(pid, ctx), id, q) : null;
        if (!page) { sendJson(res, 404, { error: "节点不存在", node: id }); return true; }
        sendJson(res, 200, page); return true;
      }
      const nm = /^\/bridge\/kb\/node\/(.+)$/.exec(p);
      if (nm && req.method === "GET") {
        sync(ctx);
        const id = decodeURIComponent(nm[1]); const pid = nodeProject(id, ctx);
        const nodes = pid ? projectModel(pid, ctx) : null; const n = nodes?.get(id);
        if (!n) { sendJson(res, 404, { error: "节点不存在", node: id }); return true; }
        const detail = {};
        if (n.refs?.kb_id) { const e = store.get(n.refs.kb_id); if (e) detail.entry = n.kind === "artifact" ? { id: e.id, artifact: e.artifacts[n.refs.artifact_index] } : e; }
        if (n.refs?.dispatch_id) { const live = (ctx.dispatches?.() || []).find((d) => d.id === n.refs.dispatch_id); if (live) detail.dispatch = { id: live.id, state: live.state, executor: live.executor, model: live.model, created_at: live.created_at, finished_at: live.finished_at, error: live.error ? scrub(live.error) : null }; }
        if (n.refs?.doc_id) { detail.doc = store.getRec("docs", n.refs.doc_id); detail.versions = store.listRecs("doc_versions", { project_id: detail.doc?.project_id, limit: 0 }).filter((v) => v.doc_id === n.refs.doc_id); }
        if (n.kind === "task" || n.kind === "subtask") { const snap = store.getRec("snapshots", pid); detail.task = (snap?.project?.tasks || []).find((t) => t.task_id === n.task_id) || null; detail.events = store.listRecs("events", { project_id: pid, task_id: n.task_id, limit: 50 }); }
        if (n.kind === "project") detail.events = store.listRecs("events", { project_id: pid, limit: 20 });
        sendJson(res, 200, { node: publicNode(n, nodes), breadcrumbs: breadcrumbs(nodes, id), detail, children: childrenPage(nodes, id, { limit: 50 }).children }); return true;
      }
      if (p === "/bridge/kb/docs") {
        if (req.method === "POST") { sendJson(res, 200, docs.postDoc(await body())); return true; }
        if (req.method === "GET") { const q = qp(url, ["project_id", "doc_type", "limit", "cursor"]); const list = store.listRecs("docs", { project_id: q.project_id, kind: q.doc_type, limit: Math.min(500, Number(q.limit) || 100), offset: Number(q.cursor) || 0 }); sendJson(res, 200, { total: store.countRecs("docs", { project_id: q.project_id, kind: q.doc_type }), count: list.length, docs: list }); return true; }
      }
      const dm = /^\/bridge\/kb\/docs\/(doc-[0-9a-f]{12})\/versions(?:\/(\d+)\/content)?$/.exec(p);
      if (dm && req.method === "GET") {
        const doc = store.getRec("docs", dm[1]); if (!doc) { sendJson(res, 404, { error: "文档不存在", doc_id: dm[1] }); return true; }
        const versions = store.listRecs("doc_versions", { project_id: doc.project_id, limit: 0 }).filter((v) => v.doc_id === doc.id).sort((a, b) => b.version - a.version);
        if (!dm[2]) { sendJson(res, 200, { doc, versions }); return true; }
        const v = versions.find((x) => x.version === Number(dm[2])); if (!v) { sendJson(res, 404, { error: "版本不存在" }); return true; }
        const f = blobs.verifiedPath(v.sha256); if (!f) { sendJson(res, 410, { error: "副本缺失或损坏", version: v }); return true; }
        sendFile(res, f, v.sha256, v.path || ".md"); return true;
      }
      if (p === "/bridge/kb/reindex" && req.method === "POST") {
        const b = await body();
        const all = ctx.dispatches ? ctx.dispatches() : [];
        const only = Array.isArray(b.dispatch_ids) ? new Set(b.dispatch_ids.map(String)) : null;
        const out = { ingested: [], updated: [], unchanged: 0, skipped_non_terminal: [], errors: [], events_written: 0 };
        for (const rec of oldestFirst(all)) {
          if (only && !only.has(rec.id)) continue;
          try {
            const r = ingest(rec, all, { force: !!b.force }); out.events_written += r.events || 0;
            if (r.status === "ingested") out.ingested.push(r.id); else if (r.status === "updated") out.updated.push(r.id);
            else if (r.status === "unchanged") out.unchanged++; else out.skipped_non_terminal.push({ dispatch_id: rec.id, state: rec.state });
          } catch (e) { out.errors.push({ dispatch_id: rec.id, error: String(e.message || e).slice(0, 200) }); }
        }
        if (b.scan_docs) out.docs = docs.scan(docsConfig(), projectForFile()).map(({ path: pth, status, doc_id, version }) => ({ path: pth, status, doc_id, version }));
        sendJson(res, 200, { backend: store.backend, total: store.count(), ...out }); return true;
      }
      // ---- round 1 routes ----
      if (req.method === "GET" && p === "/bridge/kb") {
        const q = qp(url, ["q", "executor", "project_id", "task_id", "state", "limit"]);
        const entries = store.list(q).map(summarize);
        sendJson(res, 200, { backend: store.backend, total: store.count(), count: entries.length, entries }); return true;
      }
      const m = /^\/bridge\/kb\/([^/]+)(?:\/artifacts\/(\d+))?$/.exec(p);
      if (req.method === "GET" && m) {
        const id = normalizeId(decodeURIComponent(m[1]));
        const e = id ? store.get(id) : null;
        if (!e) { sendJson(res, 404, { error: "知识库条目不存在", id: m[1] }); return true; }
        if (m[2] == null) { sendJson(res, 200, { entry: e }); return true; }
        const a = (e.artifacts || [])[Number(m[2])];
        if (!a) { sendJson(res, 404, { error: "产物序号不存在", id: e.id, n: Number(m[2]) }); return true; }
        if (a.blob_reason === "secret_pattern") { sendJson(res, 403, { error: "该产物疑似包含密钥，知识库不提供内容", artifact: { path: a.path, root: a.root, sha256: a.sha256 } }); return true; }
        const bf = a.sha256 && a.blob !== false ? blobs.verifiedPath(a.sha256) : null;
        if (bf) { sendFile(res, bf, a.sha256, a.path, { "X-KB-Source": "blob" }); return true; }
        const base = artifactBase(a, e, boardDir);
        const full = base ? path.resolve(base, a.path) : null;
        if (!full || path.relative(path.resolve(base), full).startsWith("..") || !fs.existsSync(full) || !insideReal(base, full)) { sendJson(res, 410, { error: "产物源文件已不在原位置，且没有副本", artifact: a }); return true; }
        const now = sha256File(full);
        if (now !== a.sha256) { sendJson(res, 409, { error: "产物已在入库后被修改（sha256 不符），且没有副本，未返回内容", artifact: a, sha256_now: now }); return true; }
        sendFile(res, full, a.sha256, a.path, { "X-KB-Source": "original" }); return true;
      }
      sendJson(res, req.method === "GET" || req.method === "POST" ? 404 : 405, { error: "知识库接口不存在（只读为主，无删除）" }); return true;
    } catch (e) {
      sendJson(res, e.status || 500, { error: e.status ? e.message : "知识库内部错误", ...(e.extra || {}) }); if (!e.status) log(`kb route error ${p}: ${String(e.stack || e).slice(0, 300)}`); return true;
    }
  }

  /** project resolution for scanned files: ai-dispatch-test/<known project>/… , else an artifact with the same path. */
  function projectForFile() {
    const known = new Set(projectIds({}));
    const byPath = new Map();
    for (const e of allEntries()) for (const a of e.artifacts || []) { const base = artifactBase(a, e, boardDir); if (base) byPath.set(path.resolve(base, a.path).toLowerCase(), e.project_id || UNASSIGNED); }
    return (full, rel) => {
      const seg = rel.split("/"); if (seg[0] === "ai-dispatch-test" && known.has(seg[1])) return seg[1];
      return byPath.get(path.resolve(full).toLowerCase()) || null;
    };
  }

  return { store, blobs, docs, backend: store.backend, ingest, ingestSafe, sync, resolveRefs, prepareDispatch, postSnapshot, timeline, projectsView, projectModel, scanDocs: () => docs.scan(docsConfig(), projectForFile()), handle, limits: LIMITS };
}
export { KbInputError };
