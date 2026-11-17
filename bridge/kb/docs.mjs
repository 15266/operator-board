// Document registry: 国王汇报 / 验收报告 / 任务包 / anything (doc_type is an open string).
// Each change in content (sha256) = a new version stored as a blob. Same content = no new version.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { KbInputError, containsSecret, toShanghai } from "./ingest.mjs";
import { makeEvent, eventId, UNASSIGNED } from "./events.mjs";

const SKIP = new Set(["node_modules", ".git", "dist", ".pnpm-store", "data", "kb_refs", "releases", "__pycache__"]);
export const DEFAULT_DOCS_CONFIG = {
  version: 1,
  roots: { board: ".", workspace: ".." },
  rules: [],
  dispatch_rules: [],
  max_files: 500,
};

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") { if (glob[i + 1] === "*") { re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += glob[i + 2] === "/" ? 2 : 1; } else re += "[^/]*"; }
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}
export function docIdFor(projectId, docType, key) { return "doc-" + crypto.createHash("sha256").update([projectId, docType, key].join("\u001f")).digest("hex").slice(0, 12); }

export function loadDocsConfig(file) {
  try { const c = JSON.parse(fs.readFileSync(file, "utf8")); return { ...DEFAULT_DOCS_CONFIG, ...c }; } catch { return { ...DEFAULT_DOCS_CONFIG }; }
}

export function createDocs({ store, blobs, boardDir }) {
  const workspace = path.resolve(boardDir, "..");
  /** Add a version if content differs from the latest. content: Buffer|string, or file: absolute path. */
  function addVersion({ project_id, doc_type, title, key, content, file, at, task_id = null, dispatch_id = null, source = "post", actor = "board", rel = null }) {
    const pid = project_id || UNASSIGNED;
    if (typeof doc_type !== "string" || !/^.{1,60}$/u.test(doc_type)) throw new KbInputError("doc_type 无效");
    const id = docIdFor(pid, doc_type, key || title);
    let put;
    if (file) put = blobs.putFile(file); else put = blobs.putBuffer(content ?? "");
    if (!put.blob) return { status: "skipped", doc_id: id, reason: put.reason };
    const prev = store.getRec("docs", id);
    if (prev && prev.latest_sha256 === put.sha256) return { status: "unchanged", doc_id: id, version: prev.latest_version };
    // re-ingesting the same dispatch must not append a version again (A,B,C,A,B,C… on every reindex)
    if (prev && dispatch_id) { const seen = store.listRecs("doc_versions", { project_id: pid, limit: 0 }).find((v) => v.doc_id === id && v.dispatch_id === dispatch_id); if (seen) return { status: "unchanged", doc_id: id, version: seen.version }; }
    const version = (prev?.latest_version || 0) + 1;
    const when = toShanghai(at);
    const v = { id: `${id}:v${version}`, doc_id: id, project_id: pid, task_id, dispatch_id, kind: "doc_version", doc_type, title: String(title || key || doc_type).slice(0, 300),
      version, sha256: put.sha256, size: put.size, blob: true, at: when, source, path: rel };
    store.putRec("doc_versions", v);
    store.putRec("docs", { id, doc_id: id, project_id: pid, task_id, kind: doc_type, doc_type, title: v.title, source, path: rel, key: key || null,
      latest_version: version, latest_sha256: put.sha256, at: when, created_at: prev?.created_at || when });
    store.putRec("events", makeEvent({ event_id: eventId("doc", id, version), project_id: pid, task_id, dispatch_id, kind: "doc_version", actor, source: "doc",
      at: when, summary: `${doc_type}「${v.title}」第 ${version} 版`, payload: { doc_id: id, version, sha256: put.sha256, size: put.size } }));
    return { status: prev ? "new_version" : "created", doc_id: id, version, sha256: put.sha256 };
  }

  /** POST /bridge/kb/docs body. path must stay inside the board's parent workspace. */
  function postDoc(b) {
    if (!b || typeof b !== "object") throw new KbInputError("需要 JSON 对象");
    if (typeof b.project_id !== "string" || !b.project_id.trim()) throw new KbInputError("缺 project_id");
    if (typeof b.title !== "string" || !b.title.trim()) throw new KbInputError("缺 title");
    const hasPath = typeof b.path === "string" && b.path.trim().length > 0; const hasContent = typeof b.content === "string";
    if (hasPath === hasContent) throw new KbInputError("path 与 content 只能二选一");
    if (hasContent) {
      if (containsSecret(b.content) || containsSecret(b.title)) throw new KbInputError("文档内容疑似包含密钥，已拒绝");
      // whitelist: never let the client set file / rel / source / dispatch_id
      return addVersion({ project_id: b.project_id, doc_type: b.doc_type, title: b.title, task_id: typeof b.task_id === "string" ? b.task_id : null, key: typeof b.key === "string" ? b.key : b.title, content: b.content, source: "post", actor: typeof b.actor === "string" ? b.actor.slice(0, 80) : "board" });
    }
    const full = path.resolve(workspace, b.path);
    const rel = path.relative(workspace, full);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new KbInputError("path 必须在操作台工作区内（operator-board-main 的上级目录）");
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new KbInputError("文件不存在", 404);
    // symlink / junction guard: the real path must also stay inside the real workspace
    const realRel = path.relative(fs.realpathSync(workspace), fs.realpathSync(full));
    if (!realRel || realRel.startsWith("..") || path.isAbsolute(realRel)) throw new KbInputError("path 经链接指向工作区外，已拒绝");
    const text = fs.readFileSync(full);
    if (containsSecret(text.toString("utf8"))) throw new KbInputError("文件疑似包含密钥，已拒绝");
    const posix = rel.split(path.sep).join("/");
    return addVersion({ project_id: b.project_id, doc_type: b.doc_type, title: b.title, task_id: typeof b.task_id === "string" ? b.task_id : null, key: posix, file: full, rel: posix, source: "post", actor: typeof b.actor === "string" ? b.actor.slice(0, 80) : "board" });
  }

  /** Offline / reindex scan by config globs. projectFor(absPath, relPosix) resolves project ids. */
  function scan(config, projectFor = () => null) {
    const results = []; let files = 0;
    for (const rule of config.rules || []) {
      const rootDir = path.resolve(boardDir, config.roots?.[rule.root] ?? rule.root ?? ".");
      const re = globToRegExp(rule.glob);
      const walk = (dir, depth) => {
        if (depth > 8 || files >= (config.max_files || 500)) return;
        let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full, depth + 1); continue; }
          const relRoot = path.relative(rootDir, full).split(path.sep).join("/");
          if (!e.isFile() || !re.test(relRoot)) continue;
          files++;
          const rel = path.relative(workspace, full).split(path.sep).join("/");
          const pid = rule.project_id || projectFor(full, rel) || UNASSIGNED;
          let st; try { st = fs.statSync(full); } catch { continue; }
          const text = st.size < 2 * 1024 * 1024 ? fs.readFileSync(full, "utf8") : "";
          if (containsSecret(text)) { results.push({ path: rel, status: "skipped", reason: "secret_pattern" }); continue; }
          try { results.push({ path: rel, doc_type: rule.doc_type, project_id: pid, ...addVersion({ project_id: pid, doc_type: rule.doc_type, title: path.basename(full), key: rel, file: full, rel, at: new Date(st.mtimeMs).toISOString(), source: "scan", actor: "reindex" }) }); }
          catch (err) { results.push({ path: rel, status: "error", error: String(err.message || err) }); }
        }
      };
      walk(rootDir, 0);
    }
    return results;
  }

  /** Documents carried inside dispatch records (e.g. a king report is the prompt of a ::king-report task). */
  function fromDispatch(rec, config, scrub = (s) => s) {
    const out = [];
    for (const r of config.dispatch_rules || []) {
      const tid = String(rec.task_id || "");
      if (r.task_id_suffix && !tid.endsWith(r.task_id_suffix)) continue;
      if (r.task_id_prefix && !tid.startsWith(r.task_id_prefix)) continue;
      const text = rec[r.field || "prompt"];
      if (typeof text !== "string" || !text.trim()) continue;
      out.push(addVersion({ project_id: rec.project_id, doc_type: r.doc_type, title: r.title || `${r.doc_type} · ${tid}`, key: `dispatch_rule:${tid}:${r.field || "prompt"}`,
        content: scrub(text), at: rec.created_at, task_id: rec.task_id, dispatch_id: rec.id, source: "dispatch", actor: "bridge" }));
    }
    return out;
  }
  return { addVersion, postDoc, scan, fromDispatch };
}
