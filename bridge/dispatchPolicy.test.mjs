import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodexSandbox, buildCodexArgs, validateDispatchPolicy, newDispatchDir, evaluateChecks, withSelfReport, resolveProjectDir, isUnder, CODEX_SANDBOX_DEFAULT } from "./dispatchPolicy.mjs";

test("sandbox precedence: dispatch > env > code default (read-only)", () => {
  assert.equal(CODEX_SANDBOX_DEFAULT, "read-only");
  assert.deepEqual(resolveCodexSandbox(undefined, undefined), { value: "read-only", source: "default" });
  assert.deepEqual(resolveCodexSandbox(null, "workspace-write"), { value: "workspace-write", source: "env" });
  assert.deepEqual(resolveCodexSandbox("read-only", "workspace-write"), { value: "read-only", source: "dispatch" });
  assert.deepEqual(resolveCodexSandbox("workspace-write", ""), { value: "workspace-write", source: "dispatch" });
  const bad = resolveCodexSandbox(null, "danger-full-access");
  assert.equal(bad.value, "read-only"); assert.equal(bad.source, "default"); assert.match(bad.note, /无效/);
  assert.throws(() => resolveCodexSandbox("danger-full-access", null), (e) => e.status === 400);
});

test("codex argv keeps -C, unelevated, -m and uses the resolved sandbox", () => {
  const { args } = buildCodexArgs({ lastMessageFile: "L", cwd: "C:/w/d-1", sandbox: "workspace-write", model: "gpt-x", platform: "win32", cwdExists: () => true });
  assert.deepEqual(args, ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "--color", "never", "--output-last-message", "L", "-C", "C:/w/d-1", "-c", 'windows.sandbox="unelevated"', "-m", "gpt-x", "-"]);
  const ro = buildCodexArgs({ entryJs: "codex.js", lastMessageFile: "L", cwd: "C:/w", sandbox: "read-only", platform: "win32", cwdExists: () => true }).args;
  assert.equal(ro[0], "codex.js"); assert.equal(ro[ro.indexOf("--sandbox") + 1], "read-only"); assert.ok(!ro.includes("-m"));
  assert.ok(!args.join(" ").includes("danger"));
});

test("workspace-write without an existing cwd is refused; bad sandbox refused", () => {
  assert.throws(() => buildCodexArgs({ lastMessageFile: "L", cwd: "C:/missing", sandbox: "workspace-write", cwdExists: () => false }), /工作目录/);
  assert.throws(() => buildCodexArgs({ lastMessageFile: "L", cwd: "C:/w", sandbox: "danger-full-access", cwdExists: () => true }), /非法/);
  const ro = buildCodexArgs({ lastMessageFile: "L", cwd: null, sandbox: "read-only", platform: "linux" }).args;
  assert.ok(!ro.includes("-C") && !ro.includes("-c"));
});

test("dispatch policy validation", () => {
  assert.doesNotThrow(() => validateDispatchPolicy({ sandbox: "workspace-write", expect_files: ["out/a.txt"], expect_marker: "OK-1" }));
  assert.doesNotThrow(() => validateDispatchPolicy({}));
  for (const b of [{ sandbox: "danger-full-access" }, { sandbox: "full" }, { expect_files: "a.txt" }, { expect_files: ["../x"] }, { expect_files: ["C:\\x"] }, { expect_files: ["/etc/x"] }, { expect_files: ["a/../../x"] }, { expect_marker: "" }, { expect_marker: 5 }])
    assert.throws(() => validateDispatchPolicy(b), (e) => e.status === 400, JSON.stringify(b));
});

test("per-dispatch dirs: adhoc/<id>, project/task/<id>, plan cwd unchanged, unsafe chars sanitized", () => {
  const A = path.resolve("/akili");
  assert.equal(newDispatchDir({ akili: A, id: "d-1" }), path.join(A, "ai-dispatch-test", "adhoc", "d-1"));
  assert.equal(newDispatchDir({ akili: A, id: "d-2", project_id: "p1", task_id: "t::king-report" }), path.join(A, "ai-dispatch-test", "p1", "t__king-report", "d-2"));
  assert.equal(newDispatchDir({ akili: A, id: "d-3", task_id: "only-task" }), path.join(A, "ai-dispatch-test", "adhoc", "d-3"));
  assert.equal(newDispatchDir({ akili: A, id: "d-4", planCwd: "operator-board" }), path.join(A, "operator-board"));
  const evil = newDispatchDir({ akili: A, id: "d-5", project_id: "../..", task_id: "a/b" });
  assert.ok(evil.startsWith(path.join(A, "ai-dispatch-test") + path.sep), evil);
});

test("verified only with explicit passing checks; no checks or failing check -> not verified", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-"));
  fs.mkdirSync(path.join(dir, "out")); fs.writeFileSync(path.join(dir, "out", "a.txt"), "x");
  let r = evaluateChecks({ reply: "写入失败：只读", cwd: dir });
  assert.equal(r.allOk, false); assert.equal(r.explicit, false); assert.ok(r.checks.some((c) => c.type === "none"));
  r = evaluateChecks({ reply: "done MARK-1", cwd: dir, expect_files: ["out/a.txt"], expect_marker: "MARK-1" });
  assert.equal(r.allOk, true);
  for (const c of r.checks) { assert.ok("type" in c && "target" in c && "ok" in c && typeof c.name === "string"); }
  r = evaluateChecks({ reply: "done", cwd: dir, expect_marker: "MARK-1" }); assert.equal(r.allOk, false);
  r = evaluateChecks({ reply: "MARK-1", cwd: dir, expect_files: ["out/missing.txt"], expect_marker: "MARK-1" }); assert.equal(r.allOk, false);
  assert.equal(r.checks.find((c) => c.target === "out/missing.txt").ok, false);
  // 0-byte deliverable is a false positive: found live on 2026-11-17, an executor only touched the path.
  fs.writeFileSync(path.join(dir, "out", "blank.txt"), "");
  r = evaluateChecks({ reply: "MARK-1", cwd: dir, expect_files: ["out/blank.txt"], expect_marker: "MARK-1" });
  assert.equal(r.allOk, false);
  assert.match(r.checks.find((c) => c.target === "out/blank.txt").detail, /0 字节/);
  r = evaluateChecks({ reply: "MARK-1", cwd: dir, expect_files: ["out/a.txt"] });
  assert.match(r.checks.find((c) => c.target === "out/a.txt").detail, /字节/);
  r = evaluateChecks({ reply: "AKILI-T", cwd: dir, planExpect: { token: "AKILI-T" } }); assert.equal(r.allOk, true);
  r = evaluateChecks({ reply: "", cwd: dir, planExpect: { token: "AKILI-T" } }); assert.equal(r.allOk, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("server.mjs wiring: no hardcoded read-only, sub-cwd before kb copy, hooks preserved", () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "server.mjs"), "utf8");
  assert.ok(!/"--sandbox",\s*"read-only"/.test(src));
  const i = src.indexOf("validateDispatchPolicy(b)"), j = src.indexOf("newDispatchCwd(b, dispatchId)"), k = src.indexOf("kb.prepareDispatch(b, subCwd)"), n = src.indexOf("newRecord(b, dispatchId, subCwd)");
  assert.ok(i > 0 && i < j && j < k && k < n);
  for (const needle of ["kb.ingestSafe(rec, state.dispatches)", "kb.resolveRefs(b.kb_refs)", "handleCodexHttp", "killTree(child)", "sanitizeCodexEnv(process.env)", "writeFileAtomicSync(STATE_FILE", "isKingReport", "doneFile: last", "sandbox_source: sb.source", "cwdFor: dispatchCwd", "resolveProjectDir(b, { allowedRoots: PROJECT_DIR_ROOTS", "adapterWorkBuddyAcp(rec, workDir", "adapterCodex(rec, workDir, cwd)", "dispatch_dir: cwd"])
    assert.ok(src.includes(needle), needle);
});

test("codex argv: --add-dir only for workspace-write, after -C", () => {
  const ex = () => true;
  const ww = buildCodexArgs({ lastMessageFile: "L", cwd: "P", sandbox: "workspace-write", addDirs: ["D"], platform: "win32", cwdExists: ex }).args;
  assert.deepEqual(ww.slice(ww.indexOf("-C"), ww.indexOf("-C") + 4), ["-C", "P", "--add-dir", "D"]);
  const ro = buildCodexArgs({ lastMessageFile: "L", cwd: "P", sandbox: "read-only", addDirs: ["D"], platform: "win32", cwdExists: ex }).args;
  assert.ok(!ro.includes("--add-dir"));
  const same = buildCodexArgs({ lastMessageFile: "L", cwd: "P", sandbox: "workspace-write", addDirs: ["P"], cwdExists: ex }).args;
  assert.ok(!same.includes("--add-dir"));
});

test("project_dir: allowlisted roots, auto-create only under ai-dispatch-test, rejects escapes", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pd-")));
  const adt = path.join(base, "ai-dispatch-test"), board = path.join(base, "operator-board-main"), other = path.join(base, "elsewhere"), forb = path.join(base, "forbidden");
  for (const d of [adt, board, other, forb, path.join(board, "src")]) fs.mkdirSync(d, { recursive: true });
  const opts = { allowedRoots: [adt, board], autoCreateRoot: adt, forbiddenRoots: [forb] };
  const st = (fn) => { try { fn(); return 0; } catch (e) { return e.status || -1; } };
  assert.equal(resolveProjectDir({}, opts), null);
  assert.equal(resolveProjectDir({ project_dir: path.join(board, "src") }, opts), fs.realpathSync(path.join(board, "src")));
  assert.equal(resolveProjectDir({ cwd: board }, opts), fs.realpathSync(board));
  const created = resolveProjectDir({ project_dir: "round2/camelot" }, opts); // relative -> ai-dispatch-test, auto-created
  assert.ok(fs.existsSync(created) && isUnder(created, adt));
  assert.equal(st(() => resolveProjectDir({ project_dir: path.join(board, "missing") }, opts)), 400); // no auto-create in board
  assert.equal(st(() => resolveProjectDir({ project_dir: other }, opts)), 400);
  assert.equal(st(() => resolveProjectDir({ project_dir: forb }, opts)), 400);
  assert.equal(st(() => resolveProjectDir({ project_dir: path.join(adt, "..", "elsewhere") }, opts)), 400);
  assert.equal(st(() => resolveProjectDir({ project_dir: "a/../../elsewhere" }, opts)), 400);
  assert.equal(st(() => resolveProjectDir({ project_dir: adt, cwd: board }, opts)), 400);
  assert.equal(st(() => resolveProjectDir({ project_dir: 5 }, opts)), 400);
  if (process.platform === "win32") assert.equal(resolveProjectDir({ project_dir: board.toUpperCase() }, opts).toLowerCase(), fs.realpathSync(board).toLowerCase());
  // junction / symlink inside an allowed root that points outside -> 400
  let linked = false;
  try { fs.symlinkSync(other, path.join(adt, "link-out"), "junction"); linked = true; } catch {}
  if (linked) {
    assert.equal(st(() => resolveProjectDir({ project_dir: path.join(adt, "link-out") }, opts)), 400);
    assert.equal(st(() => resolveProjectDir({ project_dir: path.join(adt, "link-out", "newdir") }, opts)), 400);
    assert.ok(!fs.existsSync(path.join(other, "newdir")));
  }
  fs.rmSync(base, { recursive: true, force: true });
});

test("expect_files resolve against the dir passed as cwd (project_dir when given)", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "pj-")); fs.writeFileSync(path.join(proj, "game.js"), "x");
  assert.equal(evaluateChecks({ reply: "ok", cwd: proj, expect_files: ["game.js"] }).allOk, true);
  fs.rmSync(proj, { recursive: true, force: true });
});

test("self-reported partial success is advisory: it annotates, never downgrades a clean verdict", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-"));
  fs.writeFileSync(path.join(dir, "out.txt"), "DELIVERED");
  const base = evaluateChecks({ reply: "done MARK-1", cwd: dir, expect_files: ["out.txt"], expect_marker: "MARK-1" });
  assert.equal(base.allOk, true);

  const checks = withSelfReport(base.checks, "PARTIAL_SUCCESS");
  // the advisory row is appended and marked non-blocking + warn so the UI can colour it amber
  const row = checks[checks.length - 1];
  assert.equal(row.type, "self_report");
  assert.equal(row.blocking, false);
  assert.equal(row.warn, true);
  assert.match(row.name, /PARTIAL_SUCCESS/);
  // the objective verdict is untouched — withSelfReport cannot even return allOk
  assert.equal(base.allOk, true);
  // every row still satisfies the UI contract (type + target + ok present)
  for (const c of checks) assert.ok("type" in c && "target" in c && "ok" in c && typeof c.name === "string");
  // no outcome -> no extra row, and the input array is not mutated
  assert.equal(withSelfReport(base.checks, null).length, base.checks.length);
  assert.equal(base.checks.some((c) => c.type === "self_report"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
