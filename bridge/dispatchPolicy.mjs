// Per-dispatch policy helpers for the Operator Board bridge (pure functions, unit-tested).
//  - Codex sandbox: dispatch.sandbox > env CODEX_SANDBOX > CODEX_SANDBOX_DEFAULT; only read-only | workspace-write.
//  - Per-dispatch working directory, so outputs (and kb artifact scans) of different dispatches never mix.
//  - Verification: "verified" only when explicit checks exist and all pass.
import path from "node:path";
import fs from "node:fs";
import { HttpInputError } from "./dispatch-validation.mjs";

/** Code default. One line to flip if Host decides otherwise. start-bridge.ps1 does not set CODEX_SANDBOX. */
export const CODEX_SANDBOX_DEFAULT = "read-only";
export const CODEX_SANDBOX_ALLOWED = Object.freeze(["read-only", "workspace-write"]);

/** Returns { value, source: "dispatch"|"env"|"default", note? }. Invalid env values are ignored (reported in note). */
export function resolveCodexSandbox(dispatchValue, envValue, codeDefault = CODEX_SANDBOX_DEFAULT) {
  if (dispatchValue != null && dispatchValue !== "") {
    if (!CODEX_SANDBOX_ALLOWED.includes(dispatchValue)) throw new HttpInputError(`sandbox 只允许 ${CODEX_SANDBOX_ALLOWED.join(" / ")}（拒绝 ${String(dispatchValue).slice(0, 40)}）`);
    return { value: dispatchValue, source: "dispatch" };
  }
  const env = typeof envValue === "string" ? envValue.trim() : "";
  if (env) {
    if (CODEX_SANDBOX_ALLOWED.includes(env)) return { value: env, source: "env" };
    return { value: codeDefault, source: "default", note: `环境变量 CODEX_SANDBOX=${env.slice(0, 40)} 无效，已忽略` };
  }
  return { value: codeDefault, source: "default" };
}

/**
 * Codex exec argv. workspace-write needs an existing per-dispatch cwd, passed as -C (the only project root Codex may write).
 * Codex's own default writable roots for workspace-write also include the system temp dir; excluding it breaks
 * shell writes under windows.sandbox="unelevated" (tested 2026-11-16), so it is left as Codex's default.
 */
export function buildCodexArgs({ entryJs = null, lastMessageFile, cwd, sandbox, model = null, addDirs = [], platform = process.platform, cwdExists = (p) => fs.existsSync(p) }) {
  if (!CODEX_SANDBOX_ALLOWED.includes(sandbox)) throw new Error("非法 sandbox：" + sandbox);
  const hasCwd = !!(cwd && cwdExists(cwd));
  if (sandbox === "workspace-write" && !hasCwd) throw new Error("workspace-write 需要存在的派发工作目录（-C），未发送");
  const args = [...(entryJs ? [entryJs] : []), "exec", "--skip-git-repo-check", "--sandbox", sandbox, "--color", "never", "--output-last-message", lastMessageFile];
  if (hasCwd) args.push("-C", cwd);
  // Extra writable roots (the per-dispatch dir when -C is a shared project_dir). Only meaningful for workspace-write;
  // verified 2026-11-16 that --add-dir works under windows.sandbox="unelevated".
  if (sandbox === "workspace-write") for (const d of addDirs || []) if (d && d !== cwd && cwdExists(d)) args.push("--add-dir", d);
  if (platform === "win32") args.push("-c", 'windows.sandbox="unelevated"');
  if (model) args.push("-m", model);
  args.push("-");
  return { args, hasCwd };
}

const MAX_EXPECT_FILES = 20;
/** Validates the optional dispatch fields added for per-dispatch policy. Throws HttpInputError(400). */
export function validateDispatchPolicy(body) {
  if (body.sandbox != null && !CODEX_SANDBOX_ALLOWED.includes(body.sandbox)) throw new HttpInputError(`sandbox 只允许 ${CODEX_SANDBOX_ALLOWED.join(" / ")}`);
  if (body.expect_marker != null && (typeof body.expect_marker !== "string" || !body.expect_marker.trim() || body.expect_marker.length > 500)) throw new HttpInputError("expect_marker 必须是 1-500 字的文本");
  if (body.expect_files != null) {
    if (!Array.isArray(body.expect_files) || body.expect_files.length > MAX_EXPECT_FILES) throw new HttpInputError(`expect_files 必须是最多 ${MAX_EXPECT_FILES} 个相对路径的数组`);
    for (const f of body.expect_files) {
      if (typeof f !== "string" || !f.trim() || f.length > 300) throw new HttpInputError("expect_files 每项必须是非空相对路径");
      if (path.isAbsolute(f) || path.win32.isAbsolute(f) || /^[a-zA-Z]:/.test(f) || f.split(/[\\/]+/).includes("..")) throw new HttpInputError("expect_files 只能是派发目录内的相对路径：" + f.slice(0, 80));
    }
  }
  return body;
}

function safeSegment(s, max = 64) {
  const t = String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.\.+/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, max);
  return t || "_";
}

/**
 * Working dir for a NEW dispatch.
 *  - plan task with cwd: that configured dir, unchanged (it may be a real repo, e.g. operator-board)
 *  - project_id + task_id: <AKILI>/ai-dispatch-test/<project>/<task>/<dispatch_id>
 *  - otherwise:            <AKILI>/ai-dispatch-test/adhoc/<dispatch_id>
 */
export function newDispatchDir({ akili, planCwd = null, id, project_id = null, task_id = null }) {
  if (planCwd) return path.resolve(akili, planCwd);
  const base = path.join(akili, "ai-dispatch-test");
  if (project_id && task_id) return path.join(base, safeSegment(project_id), safeSegment(task_id), safeSegment(id));
  return path.join(base, "adhoc", safeSegment(id));
}

/**
 * checks:[{type,target,ok,name,detail?}] (name/detail kept for the existing UI).
 * verified only if at least one explicit check (expect_files / expect_marker / plan expect) exists and all pass.
 */
export function evaluateChecks({ reply, cwd, expect_files = null, expect_marker = null, planExpect = null, exists = (p) => fs.existsSync(p), readFile = (p) => fs.readFileSync(p, "utf8") }) {
  const text = reply || "";
  const checks = [];
  if (planExpect?.token) checks.push({ type: "marker", target: planExpect.token, ok: text.includes(planExpect.token), name: `回复包含 ${planExpect.token}` });
  if (planExpect?.file) {
    const f = path.isAbsolute(planExpect.file) ? planExpect.file : path.join(cwd || "", planExpect.file);
    let ok = false, detail = "";
    try { const c = readFile(f); ok = planExpect.token ? c.includes(planExpect.token) : true; detail = c.slice(0, 200); } catch { detail = "文件不存在"; }
    checks.push({ type: "file", target: f, ok, name: `文件 ${f}`, detail });
  }
  if (expect_marker) checks.push({ type: "marker", target: expect_marker, ok: text.includes(expect_marker), name: `回复包含 ${expect_marker}` });
  for (const rel of expect_files || []) {
    const f = cwd ? path.resolve(cwd, rel) : null;
    const inside = !!(f && (f === path.resolve(cwd) || f.startsWith(path.resolve(cwd) + path.sep)));
    const ok = inside && exists(f);
    checks.push({ type: "file", target: rel, ok, name: `文件 ${rel}`, detail: ok ? f : (inside ? "文件不存在：" + f : "路径越出派发目录") });
  }
  const explicit = checks.length > 0;
  if (!explicit) checks.push({ type: "none", target: null, ok: false, name: "未设置校验（expect_files / expect_marker），不判定为已验证" });
  checks.push({ type: "reply_nonempty", target: null, ok: text.trim().length > 0, name: "收到非空回复（仅参考，不计入判定）" });
  const allOk = explicit && checks.filter((c) => c.type !== "reply_nonempty").every((c) => c.ok);
  return { checks, allOk, explicit };
}

// ---------------- shared project dir (project_dir / cwd alias) ----------------
const isWin = (platform) => platform === "win32";
function norm(p, platform) { const r = path.resolve(p); return isWin(platform) ? r.toLowerCase() : r; }
/** true when child is root or inside root (case-insensitive on Windows, separator-bounded). */
export function isUnder(child, root, platform = process.platform) {
  const c = norm(child, platform), r = norm(root, platform).replace(/[\\/]+$/, "");
  return c === r || c.startsWith(r + path.sep);
}

/**
 * Validates and resolves dispatch.project_dir (alias dispatch.cwd). Returns the realpath or null when not given.
 *  - absolute path, or relative to the ai-dispatch-test root; any ".." segment is refused
 *  - realpath (symlinks/junctions resolved) must be inside one of allowedRoots (realpath'd too); forbidden roots always refused
 *  - missing dirs are auto-created ONLY inside autoCreateRoot (ai-dispatch-test); elsewhere they must already exist
 */
export function resolveProjectDir(body, { allowedRoots, autoCreateRoot, forbiddenRoots = [], relativeBase = autoCreateRoot, platform = process.platform, fsImpl = fs } = {}) {
  const a = body?.project_dir, b = body?.cwd;
  if (a == null && b == null) return null;
  if (a != null && b != null && a !== b) throw new HttpInputError("project_dir 与 cwd 同时给出且不一致");
  const raw = a ?? b;
  if (typeof raw !== "string" || !raw.trim() || raw.length > 500 || raw.includes("\0")) throw new HttpInputError("project_dir 必须是非空路径文本");
  if (raw.split(/[\\/]+/).includes("..")) throw new HttpInputError("project_dir 不允许包含 ..");
  const lexical = path.isAbsolute(raw) || path.win32.isAbsolute(raw) ? path.resolve(raw) : path.resolve(relativeBase, raw);
  const real = (p) => (fsImpl.realpathSync.native ? fsImpl.realpathSync.native(p) : fsImpl.realpathSync(p));
  const roots = (allowedRoots || []).filter((r) => r && fsImpl.existsSync(r)).map(real);
  const forbidden = forbiddenRoots.map((r) => { try { return real(r); } catch { return path.resolve(r); } });
  const refuse = (p) => forbidden.some((f) => isUnder(p, f, platform));
  for (const f of forbiddenRoots) if (isUnder(lexical, f, platform)) throw new HttpInputError("project_dir 位于禁止目录");
  if (!roots.some((r) => isUnder(lexical, r, platform)) && !(allowedRoots || []).some((r) => isUnder(lexical, r, platform))) throw new HttpInputError("project_dir 不在允许的根目录下（ai-dispatch-test / operator-board-main）");
  if (!fsImpl.existsSync(lexical)) {
    // Auto-create only under ai-dispatch-test, and only if the nearest existing ancestor really lives there.
    if (!autoCreateRoot || !isUnder(lexical, autoCreateRoot, platform)) throw new HttpInputError("project_dir 不存在（只在 ai-dispatch-test 下自动创建）");
    let anc = path.dirname(lexical); while (!fsImpl.existsSync(anc) && path.dirname(anc) !== anc) anc = path.dirname(anc);
    if (!isUnder(real(anc), real(autoCreateRoot), platform)) throw new HttpInputError("project_dir 的上级目录经链接指向允许范围之外");
    fsImpl.mkdirSync(lexical, { recursive: true });
  }
  const resolved = real(lexical);
  if (!fsImpl.statSync(resolved).isDirectory()) throw new HttpInputError("project_dir 不是目录");
  if (refuse(resolved)) throw new HttpInputError("project_dir 位于禁止目录");
  if (!roots.some((r) => isUnder(resolved, r, platform))) throw new HttpInputError("project_dir 经符号链接/联接指向允许范围之外");
  return resolved;
}
