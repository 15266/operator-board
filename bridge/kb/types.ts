// KB contract types (TypeScript copy). Keep in sync with kb.schema.json and contract.md.
/** project = shared rec.project_dir (v2.1) */
export type KbArtifactRoot = "cwd" | "project" | "board";
export type KbAttribution = "reported_by_adapter" | "time_window" | "project_dir_time_window";

export interface KbArtifact {
  /** POSIX path relative to `root`. */
  path: string;
  root: KbArtifactRoot;
  size: number;
  sha256: string;
  mtime?: string | null;
  attribution: KbAttribution;
  /** v2: content-addressed copy in data/blobs/<sha[0:2]>/<sha256>. false => see blob_reason. */
  blob?: boolean;
  /** e.g. "secret_pattern" (not copied, route 403), "source_missing", "too_large(>52428800B)", "changed_since_ingest(sha256_now=…)", "overwritten_since_dispatch(sha256_now=…)". */
  blob_reason?: string | null;
  /** v2: artifact was recorded by an earlier ingest and has since left the time window. */
  carried_from_previous_ingest?: boolean;
}

export interface KbEntry {
  contract: "kb.entry/1.0";
  id: string; // kb-YYYYMMDD-xxxxxxxx
  uri: string; // kb://<id>
  dispatch_id: string;
  task_id: string | null;
  project_id: string | null;
  title: string;
  /** Channel / scanner id string. Not a vendor enum. */
  executor: string;
  model: string | null;
  /** DispatchRecord.state verbatim. */
  state: string;
  /** true only when state === "verified". */
  success: boolean;
  via?: string | null;
  prompt: string | null;
  prompt_truncated: boolean;
  reply: string | null;
  reply_truncated: boolean;
  error: string | null;
  checks: { name: string; ok: boolean }[];
  evidence: Record<string, unknown>;
  cwd: string | null;
  /** v2.1: shared project dir (rec.project_dir / evidence.project_dir), null when absent */
  project_dir?: string | null;
  sandbox?: string | null;
  sandbox_source?: string | null;
  overlapping_dispatches_project_dir?: string[];
  artifacts: KbArtifact[];
  artifacts_note?: string | null;
  overlapping_dispatches?: string[];
  refs: string[];
  tags: string[];
  dispatch_created_at: string | null;
  dispatch_finished_at: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /bridge/kb list item. */
export interface KbEntrySummary {
  id: string;
  uri: string;
  dispatch_id: string;
  task_id: string | null;
  project_id: string | null;
  title: string;
  executor: string;
  model: string | null;
  state: string;
  success: boolean;
  artifact_count: number;
  refs: string[];
  reply_excerpt: string | null;
  created_at: string;
  dispatch_finished_at: string | null;
}

export interface KbListResponse {
  backend: "sqlite" | "json";
  total: number;
  count: number;
  entries: KbEntrySummary[];
}

/** Additive fields accepted by POST /bridge/dispatch. */
export interface DispatchKbExtension {
  kb_refs?: string[];
  kb_copy_artifacts?: boolean;
}

// ---------------- v2: progress KB (contract.md §7–§12) ----------------
export const KB_UNASSIGNED = "_unassigned";

/** Open string; known values listed. */
export type KbEventKind =
  | "project_created" | "task_created" | "task_split" | "task_updated" | "task_removed" | "assigned"
  | "dispatched" | "state_changed" | "completed" | "failed" | "handoff_closed" | "doc_version" | "note"
  | (string & {});

export interface KbEvent {
  contract: "kb.event/1.0";
  /** deterministic: "ev-" + 16 hex. Re-posting the same event is a no-op. `id` === `event_id`. */
  event_id: string;
  id: string;
  project_id: string; // "_unassigned" when unknown
  task_id?: string | null;
  parent_task_id?: string | null;
  dispatch_id?: string | null;
  kind: KbEventKind;
  from_state?: string | null;
  to_state?: string | null;
  actor: string;
  /** ISO with +08:00 */
  at: string;
  summary: string;
  payload: Record<string, unknown>;
  source: "board" | "dispatch" | "dispatch_log" | "snapshot" | "docs" | string;
}

/** POST /bridge/kb/events body: one event or {events:[...]} (≤500). project_id + kind required. */
export interface KbEventInput {
  event_id?: string;
  project_id: string;
  task_id?: string; parent_task_id?: string; dispatch_id?: string;
  kind: KbEventKind;
  from_state?: string; to_state?: string;
  actor?: string; at?: string; summary?: string; // ≤1000 chars
  payload?: Record<string, unknown>; // ≤16KB JSON
  source?: string;
}
export interface KbEventsPostResponse { accepted: number; written: number; duplicates: number; ids: string[]; }
export interface KbEventsListResponse { total: number; count: number; events: KbEvent[]; }

/** POST /bridge/kb/projects/snapshot body. `projects` = the board's Project[] (localStorage 'operator-board-projects'). */
export interface KbSnapshotInput { projects: Array<{ project_id: string; name?: string; tasks?: Array<{ task_id: string; parent_task_id?: string | null; [k: string]: unknown }>; [k: string]: unknown }>; actor?: string; }
export interface KbSnapshotResponse { projects: Array<{ project_id: string; status: "created" | "new_version" | "unchanged"; version: number; events?: number }>; }

export interface KbDoc {
  id: string; // doc-<12 hex>
  project_id: string;
  doc_type: "国王汇报" | "国王回复" | "验收报告" | "任务包" | "设计文档" | "项目说明" | (string & {});
  title: string;
  path: string | null;
  source: "post" | "scan" | "dispatch";
  latest_version: number;
  latest_sha256: string;
  doc_id: string; kind: string; key: string | null; task_id: string | null;
  at: string; created_at: string;
}
export interface KbDocVersion { id: string; doc_id: string; project_id: string; task_id: string | null; dispatch_id: string | null; kind: "doc_version"; doc_type: string; title: string; version: number; sha256: string; size: number; blob: true; path: string | null; at: string; source: "post" | "scan" | "dispatch"; }
export interface KbDocPostInput { project_id: string; doc_type: string; title: string; path?: string; content?: string; actor?: string; }
export interface KbDocPostResponse { status: "created" | "new_version" | "unchanged" | "skipped"; doc_id: string; version?: number; sha256?: string; reason?: string; }
export interface KbDocsListResponse { total: number; count: number; docs: KbDoc[]; }
export interface KbDocVersionsResponse { doc: KbDoc; versions: KbDocVersion[]; }

export interface KbTimelineItem {
  at: string;
  kind: KbEventKind | "kb_entry";
  project_id: string;
  task_id: string | null;
  dispatch_id: string | null;
  event_id?: string;
  kb_id: string | null;
  doc_id: string | null;
  title: string;
  summary: string;
  state: string | null;
  actor: string | null;
  source: string;
  artifact_count?: number;
  links: { node?: string; entry?: string; doc?: string };
}
export interface KbTimelineResponse { total: number; count: number; items: KbTimelineItem[]; next_cursor: string | null; }

export type KbRollupState = "verified" | "failed" | "running" | "needs_check" | "in_progress" | "not_started" | "empty";
export interface KbRollup { state: KbRollupState; counts: { verified: number; failed: number; running: number; needs_check: number; not_started: number; total: number }; }

export type KbNodeKind = "project" | "phase" | "task" | "subtask" | "dispatch" | "artifact" | "doc_group" | "doc" | "doc_version" | (string & {});
export interface KbTreeNode {
  /** p:<pid> | ph:<pid>:<phase> | t:<pid>:<task_id> | d:<dispatch_id> | a:<kb_id>:<n> | docs:<pid> | doc:<doc_id> | dv:<doc_id>:<n> */
  id: string;
  parent_id: string | null;
  kind: KbNodeKind;
  title: string;
  project_id: string;
  task_id: string | null;
  /** leaf state verbatim (dispatch state / latest dispatch for a task); null for containers */
  state: string | null;
  rollup: KbRollup;
  summary: string | null;
  has_children: boolean;
  child_count: number;
  refs: { dispatch_id?: string; kb_id?: string; artifact_index?: number; doc_id?: string; version?: number; sha256?: string; blob?: boolean };
  executor?: string; model?: string; source?: string;
  at: string | null;
  links: { self: string; children: string | null; content?: string };
  /** present only when depth > 1 */
  children?: KbTreeNode[];
  children_truncated?: boolean;
  /** set when the declared parent chain loops or exceeds 64 levels; node is re-rooted under the project */
  tree_issue?: "cycle" | "too_deep";
  declared_parent_task_id?: string | null;
}
export interface KbTreePage { node: KbTreeNode | null; children: KbTreeNode[]; total: number | null; next_cursor: string | null; }
export interface KbNodeResponse { node: KbTreeNode; breadcrumbs: Array<{ id: string; kind: KbNodeKind; title: string }>; detail: Record<string, unknown>; children: KbTreeNode[]; }

export interface KbProjectSummary {
  project_id: string;
  name: string;
  rollup: KbRollup;
  snapshot_version: number | null;
  counts: { tasks: number; dispatches: number; entries: number; events: number; docs: number };
  last_activity: string | null;
  links: { tree: string; timeline: string };
}
export interface KbProjectsResponse { projects: KbProjectSummary[]; }
