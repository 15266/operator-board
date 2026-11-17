// KB ingest: pure-ish helpers that turn a DispatchRecord into a KbEntry, hash
// artifacts, scrub secrets and build the 前序产物 prompt block for kb_refs.
// Zero dependencies (node: built-ins only). No vendor branches: the executor is
// an opaque channel / scanner id string.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const KB_CONTRACT_VERSION = "kb.entry/1.0";
/** DispatchRecord states that mean "still in flight". Everything else is terminal
 *  and is ingested with its state copied verbatim (no invented states). */
// sent_awaiting_result: akili executor webhook accepted, result comes later via POST /bridge/dispatch/<id>/result
export const NON_TERMINAL_STATES = new Set(["queued", "running", "awaiting_user", "sent_awaiting_result"]);
export const SUCCESS_STATES = new Set(["verified"]); // replied_unverified / partial are NOT success
export const LIMITS = { prompt: 128000, reply: 200000, excerpt: 600, artifacts: 400, cwdArtifacts: 200, projectArtifacts: 200, artifactBytes: 50 * 1024 * 1024, refs: 20, copyBytes: 200 * 1024 * 1024 };
export const ID_RE = /^kb-\d{8}-[0-9a-f]{8}$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "kb_refs", "__pycache__"]);
/** extra dirs skipped in the shared project_dir scan */
const PROJECT_SKIP_DIRS = new Set([...SKIP_DIRS, "dist", ".pnpm-store", "releases", ".vite", ".cache"]);
/** Never scan these even if a record names them. */
const FORBIDDEN_DIRS = ["e:\\ue_test\\fdz_2"];
/** Resolve the base dir of an artifact root. root: cwd | project | board */
export function artifactBase(a, e, boardDir) { return a.root === "board" ? boardDir : a.root === "project" ? e.project_dir || null : e.cwd; }

export class KbInputError extends Error { constructor(msg, status = 400, extra) { super(msg); this.status = status; this.extra = extra; } }

export function isTerminal(state) { return typeof state === "string" && state.length > 0 && !NON_TERMINAL_STATES.has(state); }

/** ISO time in Asia/Shanghai (+08:00). */
export function toShanghai(iso) {
  const t = iso ? Date.parse(iso) : Date.now();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 8 * 3600 * 1000).toISOString().replace("Z", "");
  return d.slice(0, 19) + "+08:00";
}

export function kbIdFor(dispatchId, createdAt) {
  const day = (toShanghai(createdAt) || toShanghai()).slice(0, 10).replace(/-/g, "");
  const short = crypto.createHash("sha256").update(String(dispatchId)).digest("hex").slice(0, 8);
  return `kb-${day}-${short}`;
}
export function normalizeId(ref) {
  const s = String(ref || "").trim().replace(/^kb:\/\//, "");
  return ID_RE.test(s) ? s : null;
}

// ---------------- secrets ----------------
const SECRET_PATTERNS = [
  [/\b(Bearer)\s+[A-Za-z0-9._~+\/=-]{6,}/gi, "$1 <redacted>"],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-<redacted>"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "gh*_<redacted>"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_<redacted>"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "xox*-<redacted>"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA<redacted>"],
  [/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,})/g, "<redacted-jwt>"],
  [/((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret|authorization)["']?\s*[:=]\s*["']?)([^\s"',;}{]{6,})/gi, "$1<redacted>"],
];
const SECRET_KEY_RE = /token|password|passwd|secret|authorization|cookie|api[_-]?key|credential/i;

export function scrubText(s, extraSecrets = []) {
  if (s == null) return s;
  let out = String(s);
  for (const v of extraSecrets) if (typeof v === "string" && v.length >= 6) out = out.split(v).join("<redacted>");
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}
/** env-var NAMES are allowed as values under secret-looking keys (e.g. token_env: "WB_TOKEN") */
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
/** true if any key (recursively) looks secret and carries a non-boolean value, or a known secret value appears. */
export function hasSecretKeyOrValue(obj, known = [], depth = 0) {
  if (obj == null || depth > 20) return false;
  if (typeof obj === "string") return known.some((k) => typeof k === "string" && k.length >= 4 && obj.includes(k));
  if (Array.isArray(obj)) return obj.some((x) => hasSecretKeyOrValue(x, known, depth + 1));
  if (typeof obj === "object") return Object.entries(obj).some(([k, v]) => (SECRET_KEY_RE.test(k) && v != null && typeof v !== "boolean" && v !== "" && !(typeof v === "string" && ENV_NAME_RE.test(v))) || hasSecretKeyOrValue(v, known, depth + 1));
  return false;
}
export function containsSecret(s) {
  const t = String(s ?? "");
  return SECRET_PATTERNS.some(([re]) => { re.lastIndex = 0; const hit = re.test(t); re.lastIndex = 0; return hit; });
}
/** Evidence: keep shape, drop values under secret-looking keys (booleans stay: "token present" is not the token). */
export function scrubEvidence(ev, extraSecrets = [], depth = 0) {
  if (ev == null) return null;
  if (depth > 5) return typeof ev === "object" ? "<truncated:depth>" : (typeof ev === "string" ? scrubText(ev, extraSecrets) : ev);
  if (Array.isArray(ev)) return ev.slice(0, 100).map((x) => scrubEvidence(x, extraSecrets, depth + 1));
  if (typeof ev === "object") {
    const out = {};
    for (const [k, v] of Object.entries(ev)) {
      if (SECRET_KEY_RE.test(k) && typeof v !== "boolean" && v != null) { out[k] = "<redacted>"; continue; }
      out[k] = scrubEvidence(v, extraSecrets, depth + 1);
    }
    return out;
  }
  if (typeof ev === "string") return scrubText(ev.length > 4000 ? ev.slice(0, 4000) + "…" : ev, extraSecrets);
  return ev;
}
function clip(s, n) { if (s == null) return { text: null, truncated: false }; const t = String(s); return t.length > n ? { text: t.slice(0, n), truncated: true } : { text: t, truncated: false }; }

// ---------------- artifacts ----------------
export function sha256File(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try { const buf = Buffer.allocUnsafe(1 << 20); let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest("hex");
}
function toPosix(p) { return p.split(path.sep).join("/"); }

/** Files created/modified in `root` during [sinceMs, untilMs]. Skips kb_refs/ (inputs copied in), node_modules, .git. */
export function scanWindow(root, sinceMs, untilMs, limit = LIMITS.cwdArtifacts, { skip = SKIP_DIRS, excludeDirs = [] } = {}) {
  const excl = excludeDirs.filter(Boolean).map((d) => path.resolve(d).toLowerCase());
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > 6) return;
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name) && !excl.includes(path.resolve(full).toLowerCase())) walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      try { const st = fs.statSync(full); if (st.mtimeMs >= sinceMs && st.mtimeMs <= untilMs && st.size <= LIMITS.artifactBytes) out.push({ full, st }); } catch {}
    }
  };
  walk(root, 0);
  return out;
}

/** symlink / junction guard: realpath(file) must stay inside realpath(base). */
export function insideReal(base, full) {
  try { const r = path.relative(fs.realpathSync(base), fs.realpathSync(full)); return !!r && !r.startsWith("..") && !path.isAbsolute(r); } catch { return false; }
}
function artifactRecord(full, roots, attribution) {
  const st = fs.statSync(full);
  for (const [name, base] of roots) {
    if (!base) continue;
    const rel = path.relative(base, full);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel) && insideReal(base, full)) return { path: toPosix(rel), root: name, size: st.size, sha256: sha256File(full), mtime: toShanghai(new Date(st.mtimeMs).toISOString()), attribution };
  }
  return null; // outside known roots: not recorded (no arbitrary absolute paths)
}

/** Explicit artifact files the adapter itself reported in evidence (generic keys, no vendor branch). */
export function evidenceFiles(ev) {
  const out = [];
  if (!ev || typeof ev !== "object") return out;
  for (const k of ["last_message_file", "prompt_file", "output_file", "result_file"]) if (typeof ev[k] === "string") out.push(ev[k]);
  for (const k of ["salvaged_artifacts", "artifacts"]) if (Array.isArray(ev[k])) for (const a of ev[k]) { const p = typeof a === "string" ? a : a?.path; if (typeof p === "string") out.push(p); }
  return out;
}

/** project_dir is trusted only if absolute, not a drive/filesystem root, not forbidden, and not identical to cwd. */
export function safeProjectDir(dir, cwd) {
  if (typeof dir !== "string" || !dir || !path.isAbsolute(dir)) return null;
  const r = path.resolve(dir); const low = r.toLowerCase();
  if (path.parse(r).root.toLowerCase() === low || low.split(/[\\/]/).filter(Boolean).length < 2) return null;
  if (FORBIDDEN_DIRS.some((f) => low === f || low.startsWith(f + "\\") || low.startsWith(f + "/"))) return null;
  if (cwd && path.resolve(cwd).toLowerCase() === low) return null;
  return r;
}

/**
 * Build a KbEntry from a terminal DispatchRecord.
 * opts: { cwd, boardDir, secrets[], dispatches[] (for overlap detection), prev (existing entry), nowIso }
 */
export function entryFromDispatch(rec, opts = {}) {
  if (!rec || typeof rec.id !== "string") throw new KbInputError("dispatch record without id");
  if (!isTerminal(rec.state)) throw new KbInputError(`dispatch ${rec.id} is not terminal (state=${rec.state})`, 409);
  const secrets = opts.secrets || [];
  const cwd = opts.cwd || (typeof rec.cwd === "string" && rec.cwd) || (typeof rec.evidence?.cwd === "string" ? rec.evidence.cwd : null);
  const projectDir = safeProjectDir(opts.project_dir || (typeof rec.project_dir === "string" && rec.project_dir) || (typeof rec.evidence?.project_dir === "string" ? rec.evidence.project_dir : null), cwd);
  const roots = [["cwd", cwd], ["project", projectDir], ["board", opts.boardDir || null]];
  const since = Date.parse(rec.created_at) - 2000;
  const until = Date.parse(rec.finished_at || rec.updated_at || rec.created_at) + 5000;
  const seen = new Set();
  const artifacts = [];
  const push = (full, attribution) => {
    const key = path.resolve(full).toLowerCase(); if (seen.has(key) || artifacts.length >= LIMITS.artifacts) return; seen.add(key);
    try { const a = artifactRecord(full, roots, attribution); if (a) artifacts.push(a); } catch {}
  };
  for (const f of evidenceFiles(rec.evidence)) if (fs.existsSync(f)) push(f, "reported_by_adapter");
  if (cwd && Number.isFinite(since) && Number.isFinite(until)) for (const f of scanWindow(cwd, since, until)) push(f.full, "time_window");
  // Shared project_dir: only files modified in the dispatch window; excludes the per-dispatch cwd (already scanned) and build/vendor dirs.
  let projectCapped = false;
  if (projectDir && Number.isFinite(since) && Number.isFinite(until)) {
    const found = scanWindow(projectDir, since, until, LIMITS.projectArtifacts + 1, { skip: PROJECT_SKIP_DIRS, excludeDirs: [cwd] });
    projectCapped = found.length > LIMITS.projectArtifacts;
    for (const f of found.slice(0, LIMITS.projectArtifacts)) push(f.full, "project_dir_time_window");
  }
  // Other dispatches that ran in the same cwd at overlapping times: time-window artifacts may belong to them.
  const same = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const inWindow = (d) => Date.parse(d.created_at) <= until && Date.parse(d.finished_at || d.updated_at || d.created_at) >= since;
  const others = (opts.dispatches || []).filter((d) => d.id !== rec.id && inWindow(d));
  const overlapsCwd = others.filter((d) => same(d.cwd || d.evidence?.cwd || null, cwd)).map((d) => d.id);
  const overlapsProject = projectDir ? others.filter((d) => same(d.project_dir || d.evidence?.project_dir || null, projectDir)).map((d) => d.id) : [];
  const overlaps = [...new Set([...overlapsCwd, ...overlapsProject])];
  const notes = [];
  if (overlapsCwd.length) notes.push("time_window artifacts may belong to overlapping dispatches in the same cwd");
  if (overlapsProject.length) notes.push("project_dir_time_window artifacts may belong to overlapping dispatches in the same project_dir");
  if (projectCapped) notes.push(`project_dir scan capped at ${LIMITS.projectArtifacts} files`);
  const prompt = clip(scrubText(rec.prompt, secrets), LIMITS.prompt);
  const reply = clip(scrubText(rec.reply, secrets), LIMITS.reply);
  const id = opts.prev?.id || kbIdFor(rec.id, rec.created_at);
  const entry = {
    contract: KB_CONTRACT_VERSION,
    id, uri: `kb://${id}`,
    dispatch_id: rec.id,
    task_id: rec.task_id ?? null,
    project_id: rec.project_id ?? null,
    title: scrubText(rec.title || "", secrets).slice(0, 1000),
    executor: String(rec.executor || ""),
    model: rec.model ?? rec.evidence?.model_applied ?? null,
    state: rec.state, // verbatim
    success: SUCCESS_STATES.has(rec.state),
    via: rec.via ? scrubText(rec.via, secrets).slice(0, 500) : null,
    prompt: prompt.text, prompt_truncated: prompt.truncated,
    reply: reply.text, reply_truncated: reply.truncated,
    error: rec.error ? scrubText(rec.error, secrets).slice(0, 2000) : null,
    checks: Array.isArray(rec.checks) ? rec.checks.map((c) => ({ name: scrubText(c.name, secrets), ok: !!c.ok })) : [],
    evidence: scrubEvidence(rec.evidence || {}, secrets),
    cwd,
    project_dir: projectDir,
    sandbox: typeof rec.evidence?.sandbox === "string" ? rec.evidence.sandbox : (typeof rec.sandbox === "string" ? rec.sandbox : null),
    sandbox_source: typeof rec.evidence?.sandbox_source === "string" ? rec.evidence.sandbox_source : null,
    artifacts,
    artifacts_note: notes.length ? notes.join("; ") : null,
    overlapping_dispatches: overlaps,
    ...(overlapsProject.length ? { overlapping_dispatches_project_dir: overlapsProject } : {}),
    refs: Array.isArray(rec.kb_refs) ? rec.kb_refs.filter((x) => ID_RE.test(x)) : [],
    tags: [String(rec.executor || ""), rec.state, ...(rec.project_id ? [rec.project_id] : [])].filter(Boolean),
    dispatch_created_at: toShanghai(rec.created_at),
    dispatch_finished_at: rec.finished_at ? toShanghai(rec.finished_at) : null,
    created_at: opts.prev?.created_at || toShanghai(opts.nowIso),
    updated_at: toShanghai(opts.nowIso),
  };
  return entry;
}

export function summarize(e) {
  return { id: e.id, uri: e.uri, dispatch_id: e.dispatch_id, task_id: e.task_id, project_id: e.project_id, title: e.title, executor: e.executor, model: e.model, state: e.state, success: e.success,
    artifact_count: (e.artifacts || []).length, refs: e.refs || [], reply_excerpt: e.reply ? e.reply.slice(0, 200) : null, created_at: e.created_at, dispatch_finished_at: e.dispatch_finished_at };
}

// ---------------- resource passing (kb_refs) ----------------
export function parseRefs(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new KbInputError("kb_refs 必须是字符串数组");
  if (raw.length > LIMITS.refs) throw new KbInputError(`kb_refs 最多 ${LIMITS.refs} 条`);
  const ids = []; const bad = [];
  for (const r of raw) { const id = typeof r === "string" ? normalizeId(r) : null; if (!id) bad.push(String(r).slice(0, 80)); else if (!ids.includes(id)) ids.push(id); }
  if (bad.length) throw new KbInputError("kb_refs 含无效 id（应为 kb-YYYYMMDD-xxxxxxxx 或 kb://…）：" + bad.join(", "), 400, { invalid: bad });
  return ids;
}

/** Copy each referenced artifact to <cwd>/kb_refs/<id>/<path> and verify sha256. Never throws per file. */
export function materializeRefs(entries, cwd, boardDir, blobs = null) {
  const results = [];
  let budget = LIMITS.copyBytes;
  for (const e of entries) for (const a of e.artifacts || []) {
    const base = artifactBase(a, e, boardDir);
    const src = base ? path.resolve(base, a.path) : null;
    const relDest = toPosix(path.join("kb_refs", e.id, ...(a.root === "project" ? ["_project"] : []), a.path)); // project_dir files kept apart from same-named cwd files
    const r = { kb_id: e.id, path: relDest, source: a.path, sha256: a.sha256, size: a.size, copied: false, reason: null, from: null };
    try {
      if (a.blob_reason === "secret_pattern") { r.reason = "secret_pattern"; results.push(r); continue; }
      const blobPath = blobs && a.sha256 && a.blob !== false ? blobs.verifiedPath(a.sha256) : null;
      if (cwd && blobPath && a.size <= budget) {
        const dest = path.resolve(cwd, relDest);
        if (!dest.startsWith(path.resolve(cwd, "kb_refs"))) r.reason = "path_escape";
        else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(blobPath, dest);
          if (sha256File(dest) === a.sha256) { r.copied = true; r.from = "blob"; budget -= a.size; } else r.reason = "hash_mismatch_after_copy"; }
      } else if (!cwd) r.reason = "no_cwd";
      else if (!src || !fs.existsSync(src)) r.reason = "source_missing";
      else if (a.size > budget) r.reason = "copy_budget_exceeded";
      else {
        const dest = path.resolve(cwd, relDest);
        if (!dest.startsWith(path.resolve(cwd, "kb_refs"))) r.reason = "path_escape";
        else {
          const srcHash = sha256File(src);
          if (srcHash !== a.sha256) r.reason = "source_changed_since_ingest";
          else {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
            if (sha256File(dest) === a.sha256) { r.copied = true; r.from = "source"; budget -= a.size; } else r.reason = "hash_mismatch_after_copy";
          }
        }
      }
    } catch (err) { r.reason = "copy_error: " + String(err.message || err).slice(0, 120); }
    results.push(r);
  }
  return results;
}

/** The delimited block appended to the prompt. `copies` = materializeRefs() output (optional). */
export function buildRefsBlock(entries, copies = null) {
  if (!entries.length) return "";
  const lines = [`=== 前序产物（知识库引用，只读参考；共 ${entries.length} 条）===`,
    "说明：以下是此前其他执行器的任务结果。状态原样抄自派发记录；只有 verified 表示已核实，replied_unverified / partial / failed 都不代表成功。"];
  entries.forEach((e, i) => {
    lines.push("", `[${i + 1}] ${e.uri} · ${e.title || "(无标题)"}`);
    lines.push(`    执行器: ${e.executor || "?"} · 模型: ${e.model || "未记录"} · 状态: ${e.state} · 派发: ${e.dispatch_id}`);
    const ex = (e.reply || "").replace(/\s+/g, " ").trim();
    lines.push(`    回复摘录: ${ex ? ex.slice(0, LIMITS.excerpt) + (ex.length > LIMITS.excerpt ? "…" : "") : "(无回复)"}`);
    const arts = e.artifacts || [];
    lines.push(`    产物 (${arts.length}):`);
    for (const a of arts.slice(0, 30)) {
      const c = copies?.find((x) => x.kb_id === e.id && x.source === a.path);
      const where = c ? (c.copied ? c.path : `${a.root}:${a.path}（未复制：${c.reason}）`) : `${a.root}:${a.path}`;
      lines.push(`      - ${where}  sha256=${a.sha256}  ${a.size}B`);
    }
    if (arts.length > 30) lines.push(`      … 另有 ${arts.length - 30} 个，见 GET /bridge/kb/${e.id}`);
  });
  lines.push("=== 前序产物结束 ===");
  return lines.join("\n");
}
export function injectRefs(prompt, block) { return block ? `${prompt}\n\n${block}` : prompt; }
