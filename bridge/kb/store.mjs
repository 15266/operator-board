// KB storage backends behind one small interface (replaceable):
//   put(entry) upsert by id (dispatch_id unique) · get(id) · getByDispatch(dispatchId)
//   list({q, executor, project_id, task_id, state, limit}) -> full entries, newest first
//   count() · backend · close()
// "sqlite": built-in node:sqlite (Node >= 22.13 unflagged), single file data/kb.sqlite.
// "json":   one JSON per entry under data/entries/<id>.json + data/index.json (atomic rename).
// "auto":   sqlite if node:sqlite loads, else json. Override with KB_BACKEND=json|sqlite.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MAX_LIMIT = 500;

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function searchText(e) { return [e.title, e.prompt, e.reply, e.executor, e.model, e.task_id, e.project_id, ...(e.tags || []), ...(e.artifacts || []).map((a) => a.path)].filter(Boolean).join("\n").toLowerCase(); }
function matches(e, f) {
  if (f.executor && e.executor !== f.executor) return false;
  if (f.project_id && e.project_id !== f.project_id) return false;
  if (f.task_id && e.task_id !== f.task_id) return false;
  if (f.state && e.state !== f.state) return false;
  if (f.q && !searchText(e).includes(String(f.q).toLowerCase())) return false;
  return true;
}
function clampLimit(n) { const v = Number(n); return Number.isFinite(v) && v > 0 ? Math.min(MAX_LIMIT, Math.floor(v)) : 50; }

export function jsonStore(dir) {
  const entriesDir = path.join(dir, "entries");
  const indexFile = path.join(dir, "index.json");
  fs.mkdirSync(entriesDir, { recursive: true });
  let index = [];
  try { index = JSON.parse(fs.readFileSync(indexFile, "utf8")).entries || []; } catch {}
  const file = (id) => path.join(entriesDir, `${id}.json`);
  const read = (id) => { try { return JSON.parse(fs.readFileSync(file(id), "utf8")); } catch { return null; } };
  const saveIndex = () => writeAtomic(indexFile, JSON.stringify({ version: 1, entries: index }, null, 1));
  return {
    backend: "json",
    location: dir,
    put(e) {
      writeAtomic(file(e.id), JSON.stringify(e, null, 1));
      const row = { id: e.id, dispatch_id: e.dispatch_id, created_at: e.created_at, dispatch_created_at: e.dispatch_created_at };
      index = [row, ...index.filter((r) => r.id !== e.id && r.dispatch_id !== e.dispatch_id)];
      index.sort((a, b) => String(b.dispatch_created_at).localeCompare(String(a.dispatch_created_at)));
      saveIndex();
      return e;
    },
    get: (id) => (index.some((r) => r.id === id) ? read(id) : null),
    getByDispatch(dispatchId) { const r = index.find((x) => x.dispatch_id === dispatchId); return r ? read(r.id) : null; },
    list(f = {}) {
      const limit = clampLimit(f.limit); const out = [];
      for (const r of index) { const e = read(r.id); if (e && matches(e, f)) out.push(e); if (out.length >= limit) break; }
      return out;
    },
    count: () => index.length,
    ...jsonCollections(dir),
    close() {},
  };
}

// ---- generic record collections (events, docs, doc_versions, snapshots, ...) ----
// Each record: { id, project_id?, task_id?, kind?, at? , ...}. Filter: project_id, task_id, kind, since, until (ISO strings compare lexically; all +08:00).
function recMatches(r, f) {
  if (f.project_id && r.project_id !== f.project_id) return false;
  if (f.task_id && r.task_id !== f.task_id) return false;
  if (f.kind && r.kind !== f.kind) return false;
  if (f.since && String(r.at || "") < f.since) return false;
  if (f.until && String(r.at || "") > f.until) return false;
  return true;
}
function jsonCollections(dir) {
  const cache = new Map();
  const colDir = (c) => { if (!/^[a-z_]+$/.test(c)) throw new Error("bad collection"); const d = path.join(dir, "col", c); fs.mkdirSync(d, { recursive: true }); return d; };
  const load = (c) => {
    if (cache.has(c)) return cache.get(c);
    const m = new Map(); const d = colDir(c);
    for (const n of fs.readdirSync(d)) if (n.endsWith(".json")) { try { const r = JSON.parse(fs.readFileSync(path.join(d, n), "utf8")); m.set(r.id, r); } catch {} }
    cache.set(c, m); return m;
  };
  const fname = (id) => Buffer.from(id).toString("base64url") + ".json";
  return {
    putRec(c, r) { const m = load(c); writeAtomic(path.join(colDir(c), fname(r.id)), JSON.stringify(r)); m.set(r.id, r); return r; },
    /** internal maintenance only (no HTTP delete route) */
    delRec(c, id) { const m = load(c); try { fs.rmSync(path.join(colDir(c), fname(id)), { force: true }); } catch {} return m.delete(id); },
    getRec: (c, id) => load(c).get(id) || null,
    listRecs(c, f = {}) {
      const all = [...load(c).values()].filter((r) => recMatches(r, f)).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
      const off = Math.max(0, Number(f.offset) || 0); return f.limit === 0 ? all : all.slice(off, off + clampLimit(f.limit ?? MAX_LIMIT));
    },
    countRecs: (c, f = {}) => [...load(c).values()].filter((r) => recMatches(r, f)).length,
  };
}

function recWhere(c, f) {
  const where = ["col=?"]; const args = [c];
  for (const k of ["project_id", "task_id", "kind"]) if (f[k]) { where.push(`${k}=?`); args.push(String(f[k])); }
  if (f.since) { where.push("at>=?"); args.push(String(f.since)); }
  if (f.until) { where.push("at<=?"); args.push(String(f.until)); }
  return { where: where.join(" AND "), args };
}

export function sqliteStore(dir) {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "kb.sqlite"));
  // WAL + busy timeout: the live bridge and an offline reindex may hold the file at the same time.
  try { db.exec("PRAGMA busy_timeout=5000"); db.exec("PRAGMA journal_mode=WAL"); } catch {}
  db.exec(`CREATE TABLE IF NOT EXISTS records (col TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT, task_id TEXT, kind TEXT, at TEXT, json TEXT NOT NULL, PRIMARY KEY(col, id));
    CREATE INDEX IF NOT EXISTS records_proj ON records(col, project_id, at);`);
  db.exec(`CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY, dispatch_id TEXT NOT NULL UNIQUE, executor TEXT, project_id TEXT, task_id TEXT,
    state TEXT, dispatch_created_at TEXT, search TEXT, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS entries_created ON entries(dispatch_created_at DESC);`);
  const up = db.prepare(`INSERT INTO entries(id,dispatch_id,executor,project_id,task_id,state,dispatch_created_at,search,json)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(dispatch_id) DO UPDATE SET executor=excluded.executor, project_id=excluded.project_id,
    task_id=excluded.task_id, state=excluded.state, dispatch_created_at=excluded.dispatch_created_at, search=excluded.search, json=excluded.json`);
  const parse = (row) => (row ? JSON.parse(row.json) : null);
  return {
    backend: "sqlite",
    location: path.join(dir, "kb.sqlite"),
    put(e) { up.run(e.id, e.dispatch_id, e.executor, e.project_id, e.task_id, e.state, e.dispatch_created_at, searchText(e), JSON.stringify(e)); return e; },
    get: (id) => parse(db.prepare("SELECT json FROM entries WHERE id=?").get(id)),
    getByDispatch: (d) => parse(db.prepare("SELECT json FROM entries WHERE dispatch_id=?").get(d)),
    list(f = {}) {
      const where = []; const args = [];
      for (const k of ["executor", "project_id", "task_id", "state"]) if (f[k]) { where.push(`${k}=?`); args.push(String(f[k])); }
      if (f.q) { where.push("instr(search, ?) > 0"); args.push(String(f.q).toLowerCase()); }
      const sql = `SELECT json FROM entries ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY dispatch_created_at DESC LIMIT ${clampLimit(f.limit)}`;
      return db.prepare(sql).all(...args).map(parse);
    },
    count: () => db.prepare("SELECT COUNT(*) AS n FROM entries").get().n,
    putRec(c, r) {
      db.prepare(`INSERT INTO records(col,id,project_id,task_id,kind,at,json) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(col,id) DO UPDATE SET project_id=excluded.project_id, task_id=excluded.task_id, kind=excluded.kind, at=excluded.at, json=excluded.json`)
        .run(c, r.id, r.project_id ?? null, r.task_id ?? null, r.kind ?? null, r.at ?? null, JSON.stringify(r));
      return r;
    },
    /** internal maintenance only (no HTTP delete route) */
    delRec: (c, id) => db.prepare("DELETE FROM records WHERE col=? AND id=?").run(c, id).changes > 0,
    getRec: (c, id) => parse(db.prepare("SELECT json FROM records WHERE col=? AND id=?").get(c, id)),
    listRecs(c, f = {}) {
      const { where, args } = recWhere(c, f);
      const lim = f.limit === 0 ? "" : ` LIMIT ${clampLimit(f.limit ?? MAX_LIMIT)} OFFSET ${Math.max(0, Number(f.offset) || 0)}`;
      return db.prepare(`SELECT json FROM records WHERE ${where} ORDER BY at DESC${lim}`).all(...args).map(parse);
    },
    countRecs(c, f = {}) { const { where, args } = recWhere(c, f); return db.prepare(`SELECT COUNT(*) AS n FROM records WHERE ${where}`).get(...args).n; },
    close: () => db.close(),
  };
}

export function openStore(dir, backend = process.env.KB_BACKEND || "auto") {
  if (backend === "json") return jsonStore(dir);
  if (backend === "sqlite") return sqliteStore(dir);
  try { return sqliteStore(dir); } catch (e) { const s = jsonStore(dir); s.fallback_reason = String(e.message || e).slice(0, 200); return s; }
}
