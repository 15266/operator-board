// Offline (bridge not involved) backfill of an operator-board's KB. Reads logs/dispatches.json read-only.
//   node bridge/kb/reindex-offline.mjs <boardRoot> [--projects-json=<exported operator-board-projects.json>] [--evidence-dir=<dir>] [--no-dryrun]
// Writes: dispatch entries (+ blob copies), lifecycle events, doc versions (docs.config.json), optional project snapshots.
// sqlite backend runs in WAL with busy_timeout, so it is safe while the bridge holds the same file. Do NOT use with KB_BACKEND=json while the bridge runs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createKb, oldestFirst } from "./routes.mjs";
import { containsSecret } from "./ingest.mjs";

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=").slice(1).join("=") || null;
const board = path.resolve(process.argv[2] || ".");
const evDir = arg("evidence-dir") || path.join(board, "logs");
const akili = path.resolve(board, "..");
const plan = (() => { try { return JSON.parse(fs.readFileSync(path.join(board, "bridge", "test-plan.json"), "utf8")); } catch { return null; } })();
const cwdFor = (r) => { if (r?.cwd) return r.cwd; const pt = plan?.tasks?.find((t) => t.task_id === r?.task_id); return pt?.cwd ? path.resolve(akili, pt.cwd) : path.join(akili, "ai-dispatch-test", "adhoc"); };
const dispatches = JSON.parse(fs.readFileSync(path.join(board, "logs", "dispatches.json"), "utf8")).dispatches || [];
const kb = createKb({ dataDir: arg("data-dir") || path.join(board, "bridge", "kb", "data"), boardDir: board, cwdFor, secrets: [process.env.WB_TOKEN] });
if (kb.backend !== "sqlite" && !process.argv.includes("--allow-json")) { console.error("json backend: stop the bridge first, then pass --allow-json"); process.exit(2); }
const at = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19) + "+08:00";

// --rebuild-dispatch-docs: drop docs derived from dispatch_rules (+ their versions and doc_version events) and rebuild them in time order.
let rebuilt = null;
if (process.argv.includes("--rebuild-dispatch-docs")) {
  const ds = kb.store.listRecs("docs", { limit: 0 }).filter((d) => d.source === "dispatch"); const ids = new Set(ds.map((d) => d.id)); let v = 0, ev = 0;
  for (const x of kb.store.listRecs("doc_versions", { limit: 0 })) if (ids.has(x.doc_id)) { kb.store.delRec("doc_versions", x.id); v++; }
  for (const x of kb.store.listRecs("events", { kind: "doc_version", limit: 0 })) if (ids.has(x.payload?.doc_id)) { kb.store.delRec("events", x.id); ev++; }
  for (const d of ds) kb.store.delRec("docs", d.id);
  rebuilt = { docs: ds.length, versions_removed: v, events_removed: ev };
}
const results = oldestFirst(dispatches).map((d) => { try { return { dispatch_id: d.id, project_id: d.project_id, state: d.state, ...kb.ingest(d, dispatches) }; } catch (e) { return { dispatch_id: d.id, state: d.state, status: "error", error: String(e.message || e) }; } });
let snapshot = null;
const pj = arg("projects-json");
if (pj) { const raw = JSON.parse(fs.readFileSync(pj, "utf8")); snapshot = kb.postSnapshot({ projects: Array.isArray(raw) ? raw : raw.projects, actor: "reindex" }); }
const docs = kb.scanDocs();

const entries = kb.store.list({ limit: 500 });
const arts = entries.flatMap((e) => e.artifacts.map((a) => ({ kb_id: e.id, ...a })));
const skipped = arts.filter((a) => !a.blob);
const reasons = {}; for (const a of skipped) { const r = String(a.blob_reason || "?").replace(/\(.*$/, ""); reasons[r] = (reasons[r] || 0) + 1; }
const blobCount = (() => { let n = 0; const d = kb.blobs.dir; for (const s of fs.existsSync(d) ? fs.readdirSync(d) : []) n += fs.readdirSync(path.join(d, s)).filter((x) => /^[0-9a-f]{64}$/.test(x)).length; return n; })();
const projects = kb.projectsView({ dispatches: () => dispatches });
const leaks = [...entries, ...kb.store.listRecs("events", { limit: 0 }), ...kb.store.listRecs("docs", { limit: 0 })].filter((x) => containsSecret(JSON.stringify(x))).map((x) => x.id);
const report = {
  at, backend: kb.backend, dispatch_records: dispatches.length, rebuilt_dispatch_docs: rebuilt,
  ingest: results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}),
  entries: entries.length, events_total: kb.store.countRecs("events", {}), events_by_kind: kb.store.listRecs("events", { limit: 0 }).reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), {}),
  artifacts: { total: arts.length, blob_stored: arts.length - skipped.length, blob_skipped: skipped.length, skipped_reasons: reasons, unique_blobs_on_disk: blobCount },
  skipped_artifacts: skipped.map((a) => ({ kb_id: a.kb_id, root: a.root, path: a.path, recorded_sha256: a.sha256, reason: a.blob_reason })),
  docs: docs.map(({ path: p, doc_type, project_id, status, doc_id, version, reason }) => ({ path: p, doc_type, project_id, status, doc_id, version, reason })),
  dispatch_docs: kb.store.listRecs("docs", { limit: 0 }).filter((d) => d.source === "dispatch").map((d) => ({ doc_id: d.id, project_id: d.project_id, doc_type: d.doc_type, title: d.title, versions: d.latest_version })),
  snapshot: snapshot || "no --projects-json given: board projects live only in browser localStorage ('operator-board-projects'); tree uses dispatch-derived tasks until the board posts /bridge/kb/projects/snapshot",
  projects: projects.map((p) => ({ project_id: p.project_id, name: p.name, rollup: p.rollup, counts: p.counts, last_activity: p.last_activity })),
  secret_pattern_hits: leaks,
};
fs.writeFileSync(path.join(evDir, "kb-reindex-v2.json"), JSON.stringify(report, null, 2));

if (!process.argv.includes("--no-dryrun")) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-refs-dryrun-"));
  const pick = entries.find((e) => e.state === "verified" && e.artifacts.some((a) => a.blob && a.root === "cwd")) || entries[0];
  let unknown; try { kb.prepareDispatch({ prompt: "x", kb_refs: ["kb-20990101-deadbeef"] }, tmp); unknown = { status: 202 }; } catch (e) { unknown = { status: e.status, error: e.message }; }
  const ok = pick ? kb.prepareDispatch({ prompt: "（dry run）基于前序产物继续。", kb_refs: [pick.uri] }, tmp) : null;
  fs.writeFileSync(path.join(evDir, "kb-refs-dryrun-v2.json"), JSON.stringify({ at, unknown_kb_ref: unknown, referenced: pick?.id, copies: ok?.copies, prompt_sent: ok?.prompt }, null, 2));
  fs.rmSync(tmp, { recursive: true, force: true });
  report.dryrun = { unknown_status: unknown.status, referenced: pick?.id, copies: ok?.copies.length, from_blob: ok?.copies.filter((c) => c.from === "blob").length, all_copied: ok?.copies.every((c) => c.copied) };
}
console.log(JSON.stringify({ ingest: report.ingest, entries: report.entries, events_total: report.events_total, events_by_kind: report.events_by_kind, artifacts: report.artifacts, docs: report.docs.length, dispatch_docs: report.dispatch_docs.length, projects: report.projects.map((p) => `${p.project_id}:${p.rollup.state}:${p.counts.tasks}t/${p.counts.dispatches}d`), secret_pattern_hits: leaks.length, dryrun: report.dryrun }, null, 1));
