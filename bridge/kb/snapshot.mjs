// Board project snapshots -> versioned copies + diff events. Projects live in the browser
// (localStorage 'operator-board-projects'); the board POSTs them here. No vendor fields assumed:
// unknown task fields are kept verbatim in the snapshot, only well-known ones are diffed.
import crypto from "node:crypto";
import { KbInputError, containsSecret, hasSecretKeyOrValue, toShanghai } from "./ingest.mjs";
import { makeEvent, eventId } from "./events.mjs";

export const SNAPSHOT_LIMITS = { projects: 200, tasksPerProject: 2000, projectBytes: 400 * 1024 };
const DIFF_FIELDS = ["title", "description", "priority", "model", "parent_task_id", "role_name", "duty", "phase", "status"];
const PID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",")}}`;
  return JSON.stringify(v ?? null);
}
export const projectHash = (p) => crypto.createHash("sha256").update(canonical(p)).digest("hex");

export function validateSnapshotInput(body, known = []) {
  const list = Array.isArray(body?.projects) ? body.projects : Array.isArray(body) ? body : null;
  if (!list) throw new KbInputError("需要 {projects:[…]}（operator-board-projects 的内容）");
  if (list.length > SNAPSHOT_LIMITS.projects) throw new KbInputError(`最多 ${SNAPSHOT_LIMITS.projects} 个项目`, 413);
  const pids = new Set();
  return list.map((p, i) => {
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new KbInputError(`第 ${i} 个项目不是对象`);
    if (typeof p.project_id !== "string" || !PID_RE.test(p.project_id)) throw new KbInputError(`第 ${i} 个项目 project_id 无效`);
    if (p.tasks != null && !Array.isArray(p.tasks)) throw new KbInputError(`项目 ${p.project_id} 的 tasks 不是数组`);
    if ((p.tasks || []).length > SNAPSHOT_LIMITS.tasksPerProject) throw new KbInputError(`项目 ${p.project_id} 任务过多`, 413);
    const text = JSON.stringify(p);
    if (text.length > SNAPSHOT_LIMITS.projectBytes) throw new KbInputError(`项目 ${p.project_id} 过大`, 413);
    if (containsSecret(text) || hasSecretKeyOrValue(p, known)) throw new KbInputError(`项目 ${p.project_id} 疑似包含密钥，已拒绝整个快照（只能写环境变量名）`);
    const tids = new Set();
    for (const [j, t] of (p.tasks || []).entries()) {
      if (!t || typeof t.task_id !== "string" || !t.task_id) throw new KbInputError(`项目 ${p.project_id} 第 ${j} 个任务缺 task_id`);
      if (tids.has(t.task_id)) throw new KbInputError(`项目 ${p.project_id} 的 task_id 重复：${t.task_id}`); tids.add(t.task_id);
    }
    if (pids.has(p.project_id)) throw new KbInputError(`project_id 重复：${p.project_id}`); pids.add(p.project_id);
    return p;
  });
}

/** Diff prev (project object or null) -> next. Returns events (deterministic ids per version). */
export function diffProject(prev, next, { version, actor = "board", at } = {}) {
  const pid = next.project_id; const now = toShanghai(at);
  const ev = (kind, task, extra = {}) => makeEvent({
    event_id: eventId("snapshot", pid, task?.task_id, kind, version, extra.key), project_id: pid, task_id: task?.task_id ?? null,
    parent_task_id: task?.parent_task_id ?? null, kind, actor, source: "snapshot", at: extra.at || now, ...extra,
  });
  const out = [];
  const prevTasks = new Map((prev?.tasks || []).map((t) => [t.task_id, t]));
  const nextTasks = new Map((next.tasks || []).map((t) => [t.task_id, t]));
  if (!prev) out.push(ev("project_created", null, { at: next.created_at || now, summary: `项目「${next.name || pid}」`, payload: { name: next.name ?? null } }));
  const splits = new Map();
  for (const [id, t] of nextTasks) {
    const old = prevTasks.get(id);
    if (!old) {
      out.push(ev("task_created", t, { at: prev ? now : t.created_at || now, summary: `新任务「${t.title}」`, payload: { priority: t.priority ?? null, parent_task_id: t.parent_task_id ?? null } }));
      if (t.parent_task_id) { if (!splits.has(t.parent_task_id)) splits.set(t.parent_task_id, []); splits.get(t.parent_task_id).push(id); }
      if (t.executor_channel_id) out.push(ev("assigned", t, { to_state: t.executor_channel_id, summary: `指派给 ${t.executor_channel_id}` }));
      continue;
    }
    if ((old.executor_channel_id || null) !== (t.executor_channel_id || null))
      out.push(ev("assigned", t, { from_state: old.executor_channel_id || null, to_state: t.executor_channel_id || null, key: `${old.executor_channel_id}>${t.executor_channel_id}`,
        summary: t.executor_channel_id ? `执行器 ${old.executor_channel_id || "（无）"} → ${t.executor_channel_id}` : "取消指派" }));
    const changed = DIFF_FIELDS.filter((f) => canonical(old[f]) !== canonical(t[f]));
    if (changed.length) out.push(ev("task_updated", t, { key: changed.join(","), summary: `更新 ${changed.join("、")}`, payload: { changed, after: Object.fromEntries(changed.map((f) => [f, typeof t[f] === "string" ? t[f].slice(0, 500) : t[f] ?? null])) } }));
  }
  for (const [parent, kids] of splits) {
    const pt = nextTasks.get(parent) || { task_id: parent };
    out.push(ev("task_split", pt, { key: kids.join(","), summary: `拆成 ${kids.length} 个子任务`, payload: { children: kids } }));
  }
  for (const [id, t] of prevTasks) if (!nextTasks.has(id)) out.push(ev("task_removed", t, { summary: `删除任务「${t.title}」` }));
  return out;
}
