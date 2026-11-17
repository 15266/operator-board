// Progress events (contract kb.event/1.0). Deterministic event_id => idempotent writes.
import crypto from "node:crypto";
import { KbInputError, containsSecret, hasSecretKeyOrValue, scrubEvidence, scrubText, toShanghai } from "./ingest.mjs";

export const EVENT_CONTRACT = "kb.event/1.0";
export const UNASSIGNED = "_unassigned";
/** Suggested kinds; `kind` is an open string (lowercase id), not a vendor enum. */
export const KNOWN_KINDS = ["project_created", "task_created", "task_split", "task_updated", "task_removed", "assigned", "dispatched", "state_changed", "completed", "failed", "handoff_closed", "doc_version", "note"];
const KIND_RE = /^[a-z][a-z0-9_.-]{0,47}$/;
export const EVENT_LIMITS = { batch: 500, summary: 1000, payloadBytes: 16 * 1024 };

export function eventId(source, ...keys) {
  return "ev-" + crypto.createHash("sha256").update([source, ...keys.map((k) => (k == null ? "" : String(k)))].join("\u001f")).digest("hex").slice(0, 16);
}

function nz(v) { return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null; }

/** Build a normalized event (no validation of secrets; callers that accept external input use validateEventInput). */
export function makeEvent(e) {
  const at = toShanghai(e.at) || toShanghai();
  const source = nz(e.source) || "unknown";
  const ev = {
    contract: EVENT_CONTRACT,
    id: e.event_id || eventId(source, e.project_id, e.task_id, e.dispatch_id, e.kind, e.from_state, e.to_state, at, e.key),
    project_id: nz(e.project_id) || UNASSIGNED,
    task_id: nz(e.task_id),
    parent_task_id: nz(e.parent_task_id),
    dispatch_id: nz(e.dispatch_id),
    kind: e.kind,
    from_state: nz(e.from_state),
    to_state: nz(e.to_state),
    actor: nz(e.actor) || "bridge",
    at,
    summary: String(e.summary || "").slice(0, EVENT_LIMITS.summary),
    payload: e.payload && typeof e.payload === "object" ? e.payload : null,
    source,
  };
  ev.event_id = ev.id;
  return ev;
}

/** Validate POST /bridge/kb/events input (single object or array). Rejects (400) anything that looks like a secret. */
export function validateEventInput(body, known = []) {
  const list = Array.isArray(body?.events) ? body.events : body && typeof body === "object" && !Array.isArray(body) && body.kind ? [body] : null;
  if (!list) throw new KbInputError("需要 {events:[…]} 或单个事件对象");
  if (list.length === 0) throw new KbInputError("events 为空");
  if (list.length > EVENT_LIMITS.batch) throw new KbInputError(`一次最多 ${EVENT_LIMITS.batch} 条事件`, 413);
  return list.map((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new KbInputError(`第 ${i} 条不是对象`);
    if (typeof raw.kind !== "string" || !KIND_RE.test(raw.kind)) throw new KbInputError(`第 ${i} 条 kind 无效（小写字母开头，最多 48 字符）`);
    if (!nz(raw.project_id)) throw new KbInputError(`第 ${i} 条缺 project_id`);
    if (raw.at != null && !Number.isFinite(Date.parse(raw.at))) throw new KbInputError(`第 ${i} 条 at 不是时间`);
    const pl = raw.payload == null ? "" : JSON.stringify(raw.payload);
    if (pl.length > EVENT_LIMITS.payloadBytes) throw new KbInputError(`第 ${i} 条 payload 过大`, 413);
    if (containsSecret(JSON.stringify(raw)) || hasSecretKeyOrValue(raw, known)) throw new KbInputError(`第 ${i} 条疑似包含密钥，已拒绝（只能写环境变量名）`);
    return makeEvent({ ...raw, actor: raw.actor || "board", source: raw.source || "board", payload: raw.payload ?? null });
  });
}

const TERMINAL_KIND = { verified: "completed", failed: "failed", handoff_closed: "handoff_closed" };

/** Lifecycle events derived from a DispatchRecord (no server hook needed). */
export function eventsFromDispatch(rec, secrets = [], prevState = null) {
  if (!rec?.id) return [];
  const base = { project_id: rec.project_id, task_id: rec.task_id, dispatch_id: rec.id, actor: "bridge", source: "dispatch" };
  const out = [makeEvent({ ...base, kind: "dispatched", to_state: "queued", at: rec.created_at, key: "created",
    summary: `派发给 ${rec.executor}${rec.model ? " · " + rec.model : ""}：${scrubText(rec.title || "", secrets).slice(0, 200)}`,
    payload: { executor: rec.executor, model: rec.model ?? null, kb_refs: rec.kb_refs || [] } })];
  (rec.events || []).forEach((e, i) => {
    out.push(makeEvent({ ...base, kind: "note", at: e.ts, key: `log:${i}:${e.msg}`, summary: scrubText(String(e.msg || ""), secrets).slice(0, 500), source: "dispatch_log" }));
  });
  if (rec.state && rec.state !== "queued") {
    const kind = TERMINAL_KIND[rec.state] || "state_changed";
    const at = rec.finished_at || rec.updated_at || rec.created_at;
    out.push(makeEvent({ ...base, kind, from_state: prevState && prevState !== rec.state ? prevState : "queued", to_state: rec.state, at,
      event_id: eventId("dispatch", rec.id, "state", rec.state),
      summary: `状态 ${rec.state}${rec.error ? "：" + scrubText(rec.error, secrets).slice(0, 300) : ""}`,
      payload: { state: rec.state, checks: (rec.checks || []).map((c) => ({ name: scrubText(c.name, secrets), ok: !!c.ok })), evidence: scrubEvidence({ sandbox: rec.evidence?.sandbox ?? null, cwd: rec.cwd || rec.evidence?.cwd || null }, secrets) } }));
  }
  return out;
}
