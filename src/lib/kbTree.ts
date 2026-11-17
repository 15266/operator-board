// Knowledge-base progress tree. Types mirror 模块化官's final bridge\kb\types.ts (v2, contract.md §7–14);
// copied here, never imported from bridge/.
// Interaction model: VS Code TreeDataProvider.getChildren (has_children drives the drill affordance),
// react-arborist / react-complex-tree async children, and okf-studio IndexTree
// (src/features/navigation/components/IndexTree.tsx: expand on click, breadcrumbs, lazy per-level loading).
// Primary:  GET /bridge/kb/tree?node=&depth=1&limit=100&cursor=  → { node, children, total, next_cursor }
//           GET /bridge/kb/node/<id>                             → { node, breadcrumbs, detail, children }
// Fallback: compat tree built client-side from GET /bridge/kb?limit=500 (project → task(n levels) → dispatch).
import {
  BRIDGE_URL,
  DISPATCH_LABEL,
  fetchKbEntries,
  fetchKbEntry,
  type DispatchState,
  type KbEntry,
  type KbEntrySummary,
} from "./bridge";

// ---------- final v2 types (mirror of bridge\kb\types.ts) ----------

export type KbRollupState = "verified" | "failed" | "running" | "needs_check" | "in_progress" | "not_started" | "empty";

export interface KbRollupCounts {
  verified: number;
  failed: number;
  running: number;
  needs_check: number;
  not_started: number;
  total: number;
}

export interface KbRollup {
  state: KbRollupState | string;
  counts: KbRollupCounts;
}

/** Open string; unknown kinds render as a generic node. */
export type KbNodeKind = "project" | "phase" | "task" | "subtask" | "dispatch" | "artifact" | "doc_group" | "doc" | "doc_version" | (string & {});

export interface KbTreeNode {
  /** p:<pid> | ph:<pid>:<phase> | t:<pid>:<task_id> | d:<dispatch_id> | a:<kb_id>:<n> | docs:<pid> | doc:<doc_id> | dv:<doc_id>:<n> */
  id: string;
  parent_id: string | null;
  kind: KbNodeKind;
  title: string;
  project_id: string;
  task_id: string | null;
  /** Leaf state verbatim (dispatch state / latest dispatch for a task); null for containers. */
  state: string | null;
  rollup: KbRollup | null;
  summary: string | null;
  has_children: boolean;
  child_count: number;
  refs: { dispatch_id?: string; kb_id?: string; artifact_index?: number; doc_id?: string; version?: number; sha256?: string; blob?: boolean };
  executor?: string;
  model?: string;
  source?: string;
  at: string | null;
  links: { self: string; children: string | null; content?: string };
  children?: KbTreeNode[];
  children_truncated?: boolean;
  /** Declared parent chain loops or exceeds 64 levels; the node is re-rooted under the project. */
  tree_issue?: "cycle" | "too_deep" | (string & {});
  declared_parent_task_id?: string | null;
}

export interface KbTreePage {
  node: KbTreeNode | null;
  children: KbTreeNode[];
  total: number | null;
  next_cursor: string | null;
}

export interface KbCrumb {
  id: string;
  kind: KbNodeKind;
  title: string;
}

export interface KbNodeResponse {
  node: KbTreeNode;
  breadcrumbs: KbCrumb[];
  detail: Record<string, unknown>;
  children: KbTreeNode[];
}

/** Event / timeline row as it may appear in detail.events (tolerant: every field optional). */
export interface KbDetailEvent {
  at?: string;
  kind?: string;
  summary?: string;
  title?: string;
  to_state?: string | null;
  state?: string | null;
  actor?: string | null;
}

export interface KbDetailDocVersion {
  version?: number;
  title?: string;
  sha256?: string;
  size?: number;
  at?: string;
}

/** Detail by kind (contract §2 of FRONTEND-INTEGRATION): entry/dispatch, doc+versions, task+events. */
export type KbNodeDetail = {
  entry?: KbEntry;
  dispatch?: Record<string, unknown>;
  doc?: Record<string, unknown>;
  versions?: KbDetailDocVersion[];
  task?: Record<string, unknown>;
  events?: KbDetailEvent[];
  [k: string]: unknown;
} | null;

// ---------- labels (text always accompanies color) ----------

export const KB_KIND_LABEL: Record<string, string> = {
  project: "项目",
  phase: "阶段",
  task: "任务",
  subtask: "分工",
  dispatch: "派发",
  artifact: "产物",
  doc_group: "文档",
  doc: "文档",
  doc_version: "文档版本",
  _unassigned: "未归属",
};

export function kindLabel(kind: string): string {
  return KB_KIND_LABEL[kind] ?? `节点（${kind}）`;
}

export const ROLLUP_LABEL: Record<KbRollupState, { text: string; tone: string }> = {
  failed: { text: "有失败", tone: "bad" },
  running: { text: "进行中", tone: "warn" },
  needs_check: { text: "待核实", tone: "unverified" },
  verified: { text: "已核实", tone: "ok" },
  in_progress: { text: "部分核实", tone: "info" },
  not_started: { text: "未开始", tone: "neutral" },
  empty: { text: "暂无进度", tone: "neutral" },
};

export function rollupLabel(state: string): { text: string; tone: string } {
  return ROLLUP_LABEL[state as KbRollupState] ?? { text: state, tone: "neutral" };
}

/** Node's own state; dispatch states go through DISPATCH_LABEL, unknown ones verbatim. */
export function stateLabel(state: string): { text: string; tone: string } {
  return DISPATCH_LABEL[state as DispatchState] ?? { text: state, tone: "neutral" };
}

export const TREE_ISSUE_LABEL: Record<string, string> = {
  cycle: "父链成环，已挂到项目根",
  too_deep: "层级过深（>64），已挂到项目根",
};

export function treeIssueLabel(issue: string): string {
  return TREE_ISSUE_LABEL[issue] ?? `树结构异常（${issue}），已挂到项目根`;
}

export const UNASSIGNED_PROJECT = "未归属项目";
export const UNASSIGNED_TASK = "未归属任务";
export const TREE_NOT_PROVIDED = "树接口尚未提供";
export const ARTIFACT_SECRET_BLOCKED = "已按安全规则不提供";

/** Node id of a project root (final v2 format). */
export function projectNodeId(projectId: string): string {
  return `p:${projectId}`;
}

// ---------- provider ----------

export type KbTreeMode = "tree" | "compat";

export const KB_TREE_SOURCE_LABEL: Record<KbTreeMode, string> = {
  tree: "/bridge/kb/tree",
  compat: "/bridge/kb（按 项目→任务→派发 拼树，兼容模式）",
};

export interface KbChildrenPage {
  children: KbTreeNode[];
  next_cursor: string | null;
  total: number | null;
  error: string | null;
}

export interface KbNodePage {
  node: KbTreeNode | null;
  breadcrumbs: KbCrumb[];
  detail: KbNodeDetail;
  error: string | null;
}

/** getChildren(null) lists project roots, like TreeDataProvider.getChildren(undefined). */
export interface KbTreeProvider {
  mode: KbTreeMode;
  /** Why the primary route isn't used (compat only). */
  note: string | null;
  getChildren(nodeId: string | null, cursor?: string | null): Promise<KbChildrenPage>;
  getNode(nodeId: string): Promise<KbNodePage>;
}

async function getJson<T>(path: string): Promise<{ status: number | null; body: T | null; error: string | null }> {
  try {
    const r = await fetch(`${BRIDGE_URL}${path}`);
    const body = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    return { status: r.status, body: r.ok ? body : null, error: r.ok ? (body ? null : "响应不是 JSON") : body?.error ?? `HTTP ${r.status}` };
  } catch (e) {
    return { status: null, body: null, error: (e as Error).message };
  }
}

function httpProvider(): KbTreeProvider {
  return {
    mode: "tree",
    note: null,
    async getChildren(nodeId, cursor) {
      const q = new URLSearchParams({ depth: "1", limit: "100" });
      if (nodeId) q.set("node", nodeId);
      if (cursor) q.set("cursor", cursor);
      const r = await getJson<KbTreePage>(`/bridge/kb/tree?${q.toString()}`);
      if (!r.body) return { children: [], next_cursor: null, total: null, error: r.error };
      return {
        children: Array.isArray(r.body.children) ? r.body.children : [],
        next_cursor: r.body.next_cursor ?? null,
        total: typeof r.body.total === "number" ? r.body.total : null,
        error: null,
      };
    },
    async getNode(nodeId) {
      const r = await getJson<KbNodeResponse>(`/bridge/kb/node/${encodeURIComponent(nodeId)}`);
      if (!r.body) return { node: null, breadcrumbs: [], detail: null, error: r.error };
      return { node: r.body.node, breadcrumbs: r.body.breadcrumbs ?? [], detail: (r.body.detail as KbNodeDetail) ?? null, error: null };
    },
  };
}

// ---------- compat: build v2-shaped nodes from /bridge/kb ----------

interface BoardTask {
  task_id: string;
  title?: string;
  parent_task_id?: string | null;
}
interface BoardProject {
  project_id: string;
  name?: string;
  tasks?: BoardTask[];
}

/** Titles come from the board's own localStorage (operator-board-projects); ids otherwise. */
function readBoardProjects(): BoardProject[] {
  try {
    const raw = window.localStorage.getItem("operator-board-projects");
    const j = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(j) ? (j as BoardProject[]).filter((p) => p && typeof p.project_id === "string") : [];
  } catch {
    return [];
  }
}

const RUNNING_STATES = new Set(["queued", "running", "awaiting_user", "sent_awaiting_result"]);
const NEEDS_CHECK_STATES = new Set(["replied_unverified", "partial", "handoff_closed"]);

/**
 * Final v2 rollup rule (FRONTEND-INTEGRATION §3): failed > running > needs_check > verified (all);
 * in_progress = some verified, rest not started; not_started; empty when nothing below.
 * Only `verified` counts as verified — sent_awaiting_result is running, never verified.
 */
export function rollupFromStates(states: string[]): KbRollup {
  const counts: KbRollupCounts = { verified: 0, failed: 0, running: 0, needs_check: 0, not_started: 0, total: states.length };
  for (const s of states) {
    if (s === "verified") counts.verified++;
    else if (s === "failed") counts.failed++;
    else if (RUNNING_STATES.has(s)) counts.running++;
    else if (NEEDS_CHECK_STATES.has(s)) counts.needs_check++;
    else counts.not_started++;
  }
  const state: KbRollupState = !counts.total
    ? "empty"
    : counts.failed
      ? "failed"
      : counts.running
        ? "running"
        : counts.needs_check
          ? "needs_check"
          : counts.verified === counts.total
            ? "verified"
            : counts.verified
              ? "in_progress"
              : "not_started";
  return { state, counts };
}

interface CompatNode extends KbTreeNode {
  _children: CompatNode[];
  _entry_id?: string;
}

function mk(id: string, parent_id: string | null, project_id: string, kind: string, title: string): CompatNode {
  return {
    id, parent_id, project_id, kind, title, task_id: null, summary: null, state: null, rollup: null,
    has_children: false, child_count: 0, at: null, refs: {}, links: { self: "", children: null },
    source: "compat", _children: [],
  };
}

export function buildCompatNodes(entries: KbEntrySummary[], board: BoardProject[] = readBoardProjects()): { roots: CompatNode[]; byId: Map<string, CompatNode> } {
  const byId = new Map<string, CompatNode>();
  const roots: CompatNode[] = [];
  const boardProject = new Map(board.map((p) => [p.project_id, p]));
  const add = (n: CompatNode, parent: CompatNode | null) => {
    byId.set(n.id, n);
    if (parent) parent._children.push(n);
    else roots.push(n);
    return n;
  };
  const projectNode = (pid: string | null) => {
    const key = pid || "_unassigned";
    const id = projectNodeId(key);
    return byId.get(id) ?? add(mk(id, null, key, pid ? "project" : "_unassigned", pid ? boardProject.get(pid)?.name || pid : UNASSIGNED_PROJECT), null);
  };
  const taskNode = (pid: string | null, tid: string | null, seen: Set<string> = new Set()): CompatNode => {
    const proj = projectNode(pid);
    const id = `t:${proj.project_id}:${tid || "_unassigned"}`;
    const hit = byId.get(id);
    if (hit) return hit;
    if (!tid) return add(mk(id, proj.id, proj.project_id, "_unassigned", UNASSIGNED_TASK), proj);
    const bt = boardProject.get(pid ?? "")?.tasks?.find((t) => t.task_id === tid);
    const parentTid = bt?.parent_task_id || null;
    seen.add(tid);
    // Nest under the parent task (n levels) when the board knows it. Loops / >64 levels are re-rooted
    // under the project and labelled, mirroring the server's tree_issue.
    let issue: "cycle" | "too_deep" | undefined;
    let parent: CompatNode = proj;
    if (parentTid) {
      if (seen.has(parentTid)) issue = "cycle";
      else if (seen.size >= 64) issue = "too_deep";
      else parent = taskNode(pid, parentTid, seen);
    }
    const n = mk(id, parent.id, proj.project_id, parent === proj ? "task" : "subtask", bt?.title || tid);
    n.task_id = tid;
    if (issue) {
      n.tree_issue = issue;
      n.declared_parent_task_id = parentTid;
    }
    return byId.get(id) ?? add(n, parent);
  };
  const sorted = [...entries].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const e of sorted) {
    const parent = taskNode(e.project_id, e.task_id);
    const n = mk(`d:${e.dispatch_id}`, parent.id, parent.project_id, "dispatch", e.title || e.dispatch_id);
    n.task_id = e.task_id;
    n.state = e.state;
    n.at = e.dispatch_finished_at || e.created_at;
    n.executor = e.executor;
    n.model = e.model ?? undefined;
    n.summary = e.reply_excerpt ? e.reply_excerpt.slice(0, 80) : null;
    n.refs = { dispatch_id: e.dispatch_id, kb_id: e.id };
    n._entry_id = e.id;
    if (!byId.has(n.id)) add(n, parent);
  }
  const roll = (n: CompatNode): string[] => {
    const states = n.kind === "dispatch" && n.state ? [n.state] : [];
    for (const c of n._children) states.push(...roll(c));
    n.rollup = rollupFromStates(states);
    n.child_count = n._children.length;
    n.has_children = n._children.length > 0;
    return states;
  };
  roots.sort((a, b) => Number(a.kind === "_unassigned") - Number(b.kind === "_unassigned"));
  roots.forEach((r) => roll(r));
  return { roots, byId };
}

function strip(n: CompatNode): KbTreeNode {
  const node: Partial<CompatNode> = { ...n };
  delete node._children;
  delete node._entry_id;
  return node as KbTreeNode;
}

function compatProvider(entries: KbEntrySummary[], note: string): KbTreeProvider {
  const { roots, byId } = buildCompatNodes(entries);
  return {
    mode: "compat",
    note,
    async getChildren(nodeId) {
      if (!nodeId) return { children: roots.map(strip), next_cursor: null, total: roots.length, error: null };
      const n = byId.get(nodeId);
      if (!n) return { children: [], next_cursor: null, total: null, error: `未知节点 ${nodeId}` };
      return { children: n._children.map(strip), next_cursor: null, total: n._children.length, error: null };
    },
    async getNode(nodeId) {
      const n = byId.get(nodeId);
      if (!n) return { node: null, breadcrumbs: [], detail: null, error: `未知节点 ${nodeId}` };
      const crumbs: KbCrumb[] = [];
      for (let cur: CompatNode | undefined = n, i = 0; cur && i < 70; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, i++) {
        crumbs.unshift({ id: cur.id, kind: cur.kind, title: cur.title });
      }
      const entry = n._entry_id ? await fetchKbEntry(n._entry_id) : null;
      return {
        node: strip(n),
        breadcrumbs: crumbs,
        detail: entry ? { entry } : null,
        error: n._entry_id && !entry ? "读不到该派发的知识库条目详情" : null,
      };
    },
  };
}

/** Pick the data source: tree route first (no params = project list); compat fallback when it fails / 404s. */
export async function loadKbTreeProvider(): Promise<{ provider: KbTreeProvider | null; error: string | null }> {
  const probe = await getJson<KbTreePage>("/bridge/kb/tree?limit=1");
  if (probe.body && Array.isArray(probe.body.children)) return { provider: httpProvider(), error: null };
  const r = await fetchKbEntries({ limit: 500 });
  if (r.error) return { provider: null, error: `${TREE_NOT_PROVIDED}；${r.error}` };
  return { provider: compatProvider(r.entries, TREE_NOT_PROVIDED), error: null };
}

/** Artifact content URL: node links.content (relative to the bridge) or the kb artifact route. */
export function bridgeUrl(pathOrUrl: string): string {
  return pathOrUrl.startsWith("/") ? `${BRIDGE_URL}${pathOrUrl}` : pathOrUrl;
}

export type ArtifactCheck =
  | { ok: true; objectUrl: string; fromBlob: boolean }
  | { ok: false; message: string };

/** Fetch an artifact before offering it: 403 = looks secret, 409/410 = changed / gone. */
export async function fetchArtifact(url: string): Promise<ArtifactCheck> {
  try {
    const r = await fetch(bridgeUrl(url));
    if (r.status === 403) return { ok: false, message: ARTIFACT_SECRET_BLOCKED };
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      const why = r.status === 409 ? "原文件入库后已被改动，且没有副本" : r.status === 410 ? "原文件已不在" : `HTTP ${r.status}`;
      return { ok: false, message: j?.error ? `${why}：${j.error}` : why };
    }
    const blob = await r.blob();
    return { ok: true, objectUrl: URL.createObjectURL(blob), fromBlob: r.headers.get("X-KB-Source") === "blob" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
