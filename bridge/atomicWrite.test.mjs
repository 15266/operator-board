import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomicSync } from "./atomicWrite.mjs";

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));

test("writes via temp+rename, keeps .bak, leaves no temp files", () => {
  const d = tmpdir(); const f = path.join(d, "dispatches.json");
  fs.writeFileSync(f, '{"v":1}');
  const r = writeFileAtomicSync(f, '{"v":2}', { backup: true });
  assert.equal(r.ok, true); assert.equal(r.fallback, false); assert.equal(r.backup, true);
  assert.equal(fs.readFileSync(f, "utf8"), '{"v":2}');
  assert.equal(fs.readFileSync(f + ".bak", "utf8"), '{"v":1}');
  writeFileAtomicSync(f, '{"v":3}', { backup: true });
  assert.equal(fs.readFileSync(f + ".bak", "utf8"), '{"v":1}', "backup throttled");
  assert.deepEqual(fs.readdirSync(d).filter((n) => n.endsWith(".tmp")), []);
});

test("retries EPERM/EBUSY then succeeds", () => {
  const d = tmpdir(); const f = path.join(d, "s.json"); let fails = 2;
  const ff = { ...fs, renameSync: (a, b) => { if (fails-- > 0) { const e = new Error("busy"); e.code = fails ? "EPERM" : "EBUSY"; throw e; } return fs.renameSync(a, b); } };
  const r = writeFileAtomicSync(f, "x", { fs: ff, delayMs: 1 });
  assert.equal(r.attempts, 3); assert.equal(r.fallback, false); assert.equal(fs.readFileSync(f, "utf8"), "x");
});

test("persistent lock falls back to direct write and cleans temp", () => {
  const d = tmpdir(); const f = path.join(d, "s.json");
  const ff = { ...fs, renameSync: () => { const e = new Error("locked"); e.code = "EPERM"; throw e; } };
  const r = writeFileAtomicSync(f, "y", { fs: ff, retries: 3, delayMs: 1 });
  assert.equal(r.fallback, true); assert.equal(fs.readFileSync(f, "utf8"), "y");
  assert.deepEqual(fs.readdirSync(d).filter((n) => n.endsWith(".tmp")), []);
});

test("non-retryable error is not retried", () => {
  const d = tmpdir(); const f = path.join(d, "s.json"); let n = 0;
  const ff = { ...fs, renameSync: () => { n++; const e = new Error("x"); e.code = "EXDEV"; throw e; } };
  const r = writeFileAtomicSync(f, "z", { fs: ff });
  assert.equal(n, 1); assert.equal(r.fallback, true);
});
