// Project progress tree (kb.tree/1.0). Built on demand from: latest board snapshot (tasks, any depth via
// parent_task_id, optional `phase`), dispatch records / kb entries, artifacts (blobs) and docs.
// Lazy loading like VS Code TreeDataProvider.getChildren / react-arborist: ask for one node's children.
import { UNASSIGNED } from "./events.mjs";

export const BUCKETS = ["verified", "failed", "running", "needs_check", "not_started"];
/** Hard cap on task nesting (parent chain length); deeper chains are re-rooted and flagged. */
export const MAX_TREE_DEPTH = 64;

export function bucketOf(state) {
  if (!state) return "not_started";
  if (state === "verified") return "verified";
  if (state === "failed") return "failed";
  if (["queued", "running", "awaiting_user", "sent_awaiting_result"].includes(state)) return "running";
  return "needs_check"; // replied_unverified, partial, handoff_closed, anything new: never upgraded to success
}
export function rollupState(c) {
  if (c.total === 0) return "empty";
  if (c.failed) return "failed";
  if (c.running) return "running";
  if (c.needs_check) return "needs_check";
  if (c.verified === c.total) return "verified";
  if (c.verified) return "in_progress";
  return "not_started";
}
const zero = () => ({ verified: 0, failed: 0, running: 0, needs_check: 0, not_started: 0, total: 0 });
const add = (a, b) => { for (const k of Object.keys(a)) a[k] += b[k] || 0; return a; };
const byTime = (x, y) => String(y.at || "").localeCompare(String(x.at || ""));

/**
 * input: { pid, snapshot (project obj|null), dispatches: DispatchRecord-like (live + entries merged, newest first),
 *          entries: Map dispatch_id -> KbEntry, docs: doc recs, docVersions: Map doc_id -> versions[] }
 * returns Map id -> node (with children ids). Node ids are stable strings.
 */
export function buildProjectTree({ pid, snapshot, dispatches, entries, docs, docVersions }) {
  const nodes = new Map();
  const put = (n) => { nodes.set(n.id, { children: [], ...n }); return nodes.get(n.id); };
  const root = put({ id: `p:${pid}`, parent_id: null, kind: "project", title: snapshot?.name || (pid === UNASSIGNED ? "未归属项目" : pid), project_id: pid, state: null, summary: snapshot?.notes || null, refs: {}, at: snapshot?.created_at || null });
  const tasks = new Map();
  for (const t of snapshot?.tasks || []) tasks.set(t.task_id, { ...t, _source: "snapshot" });
  for (const d of dispatches) if (d.task_id && !tasks.has(d.task_id)) tasks.set(d.task_id, { task_id: d.task_id, title: d.title || d.task_id, parent_task_id: null, _source: "dispatch" });
  const phases = new Map();
  // Guards (after MmCodexMgr RelayPolicy.Apply: ancestor HashSet cycle check + MaxDepth): a task whose parent chain
  // loops, or is deeper than MAX_TREE_DEPTH, is attached to the project root and flagged instead of hanging the tree.
  const chainIssue = (t) => { const seen = new Set([t.task_id]); let cur = t; for (let i = 0; cur?.parent_task_id; i++) { if (seen.has(cur.parent_task_id)) return "cycle"; if (i >= MAX_TREE_DEPTH) return "too_deep"; seen.add(cur.parent_task_id); cur = tasks.get(cur.parent_task_id); } return null; };
  for (const t of tasks.values()) {
    const issue = t.parent_task_id && tasks.has(t.parent_task_id) ? chainIssue(t) : null;
    const parent = t.parent_task_id && tasks.has(t.parent_task_id) && !issue ? `t:${pid}:${t.parent_task_id}` : null;
    if (issue) t._tree_issue = issue;
    let parentId = parent;
    if (!parentId && t.phase) {
      const ph = `ph:${pid}:${t.phase}`;
      if (!phases.has(ph)) phases.set(ph, put({ id: ph, parent_id: root.id, kind: "phase", title: String(t.phase), project_id: pid, state: null, summary: null, refs: {}, at: null }));
      parentId = ph;
    }
    put({ id: `t:${pid}:${t.task_id}`, parent_id: parentId || root.id, kind: parent ? "subtask" : "task", title: t.title || t.task_id, project_id: pid, task_id: t.task_id,
      state: null, summary: t.description ? String(t.description).slice(0, 300) : null, refs: { task_id: t.task_id }, executor: t.executor_channel_id ?? null, model: t.model ?? null,
      source: t._source, at: t.created_at || null, ...(t._tree_issue ? { tree_issue: t._tree_issue, declared_parent_task_id: t.parent_task_id } : {}) });
  }
  const latestByTask = new Map();
  for (const d of dispatches) {
    const parent = d.task_id ? `t:${pid}:${d.task_id}` : root.id;
    const e = entries.get(d.id);
    const n = put({ id: `d:${d.id}`, parent_id: parent, kind: "dispatch", title: `${d.executor}${d.model ? " · " + d.model : ""}`, project_id: pid, task_id: d.task_id || null,
      state: d.state, summary: (d.reply || e?.reply || d.error || "").slice(0, 300) || null, refs: { dispatch_id: d.id, kb_id: e?.id || null }, at: d.created_at_sh || d.created_at });
    if (d.task_id && !latestByTask.has(d.task_id)) latestByTask.set(d.task_id, d);
    (e?.artifacts || []).forEach((a, i) => put({ id: `a:${e.id}:${i}`, parent_id: n.id, kind: "artifact", title: a.path, project_id: pid, task_id: d.task_id || null, state: null,
      summary: `${a.size}B · sha256 ${a.sha256.slice(0, 12)}${a.blob === false ? " · 未存副本：" + (a.blob_reason || "") : ""}`, refs: { kb_id: e.id, artifact_index: i, sha256: a.sha256, blob: a.blob === true },
      links: { content: `/bridge/kb/${e.id}/artifacts/${i}` }, at: a.mtime || null }));
  }
  let docsGroup = null;
  for (const doc of docs) {
    const tnode = doc.task_id && nodes.has(`t:${pid}:${doc.task_id}`) ? `t:${pid}:${doc.task_id}` : null;
    let parent = tnode;
    if (!parent) { docsGroup ||= put({ id: `docs:${pid}`, parent_id: root.id, kind: "doc_group", title: "文档", project_id: pid, state: null, summary: null, refs: {}, at: null }); parent = docsGroup.id; }
    const dn = put({ id: `doc:${doc.id}`, parent_id: parent, kind: "doc", title: `${doc.doc_type} · ${doc.title}`, project_id: pid, task_id: doc.task_id || null, state: null,
      summary: `第 ${doc.latest_version} 版`, refs: { doc_id: doc.id }, at: doc.at });
    for (const v of docVersions.get(doc.id) || []) put({ id: `dv:${doc.id}:${v.version}`, parent_id: dn.id, kind: "doc_version", title: `v${v.version}`, project_id: pid, state: null,
      summary: `${v.size}B · sha256 ${v.sha256.slice(0, 12)}`, refs: { doc_id: doc.id, version: v.version, sha256: v.sha256, blob: true }, links: { content: `/bridge/kb/docs/${doc.id}/versions/${v.version}/content` }, at: v.at });
  }
  for (const n of nodes.values()) if (n.parent_id && nodes.has(n.parent_id)) nodes.get(n.parent_id).children.push(n.id);
  // task own state = latest dispatch state (verbatim); rollup bottom-up
  const rollup = (id) => {
    const n = nodes.get(id);
    if (n.rollup) return n.rollup;
    if (n._visiting) return { state: "empty", counts: zero() }; // cycle guard: never recurse into an ancestor
    n._visiting = true;
    const c = zero();
    if (n.kind === "dispatch") { c[bucketOf(n.state)]++; c.total++; }
    else if (n.kind === "task" || n.kind === "subtask") {
      const latest = latestByTask.get(n.task_id); n.state = latest ? latest.state : null;
      const subtasks = n.children.filter((k) => nodes.get(k).kind === "subtask");
      if (subtasks.length) { for (const k of subtasks) add(c, rollup(k).counts); if (latest) { c[bucketOf(n.state)]++; c.total++; } } // own latest dispatch counts too (a failed parent is not hidden by verified children)
      else { c[bucketOf(n.state)]++; c.total++; }
      for (const k of n.children) if (nodes.get(k).kind !== "subtask") rollup(k);
    } else if (n.kind === "project" || n.kind === "phase") {
      for (const k of n.children) { const r = rollup(k); if (["task", "subtask", "phase"].includes(nodes.get(k).kind)) add(c, r.counts); }
      // dispatches attached directly to the project (no task_id) still count
      for (const k of n.children) if (nodes.get(k).kind === "dispatch") add(c, rollup(k).counts);
    } else for (const k of n.children) rollup(k);
    n.rollup = { state: rollupState(c), counts: c }; delete n._visiting;
    return n.rollup;
  };
  rollup(root.id);
  for (const n of nodes.values()) {
    if (!n.rollup) rollup(n.id);
    n.children.sort((a, b) => kindOrder(nodes.get(a).kind) - kindOrder(nodes.get(b).kind) || byTime(nodes.get(a), nodes.get(b)));
  }
  return nodes;
}
function kindOrder(k) { return { phase: 0, task: 1, subtask: 1, doc_group: 2, dispatch: 3, doc: 4, artifact: 5, doc_version: 6 }[k] ?? 9; }

export function publicNode(n, nodes) {
  return { id: n.id, parent_id: n.parent_id, kind: n.kind, title: n.title, project_id: n.project_id, task_id: n.task_id ?? null, state: n.state ?? null,
    rollup: n.rollup, summary: n.summary ?? null, has_children: n.children.length > 0, child_count: n.children.length, refs: n.refs || {},
    executor: n.executor ?? undefined, model: n.model ?? undefined, source: n.source ?? undefined, at: n.at ?? null, ...(n.tree_issue ? { tree_issue: n.tree_issue, declared_parent_task_id: n.declared_parent_task_id } : {}),
    links: { self: `/bridge/kb/node/${encodeURIComponent(n.id)}`, children: n.children.length ? `/bridge/kb/tree?node=${encodeURIComponent(n.id)}` : null, ...(n.links || {}) } };
}

/** children page with optional nested depth. */
export function childrenPage(nodes, id, { depth = 1, limit = 100, cursor = 0 } = {}) {
  const n = nodes.get(id); if (!n) return null;
  const off = Math.max(0, Number(cursor) || 0); const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  const ids = n.children.slice(off, off + lim);
  const expand = (cid, d) => { const c = nodes.get(cid); const p = publicNode(c, nodes); if (d > 1 && c.children.length) { p.children = c.children.slice(0, lim).map((k) => expand(k, d - 1)); p.children_truncated = c.children.length > lim; } return p; };
  return { node: publicNode(n, nodes), children: ids.map((k) => expand(k, Math.min(3, Math.max(1, Number(depth) || 1)))), total: n.children.length, next_cursor: off + lim < n.children.length ? String(off + lim) : null };
}
export function breadcrumbs(nodes, id) {
  const out = []; let cur = nodes.get(id); let guard = 0;
  while (cur && guard++ < 64) { out.unshift({ id: cur.id, kind: cur.kind, title: cur.title }); cur = cur.parent_id ? nodes.get(cur.parent_id) : null; }
  return out;
}
