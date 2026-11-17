// Atomic file write for bridge state (logs/dispatches.json).
// Pattern from MmCodexMgr SettingsStore.AtomicWrite (Source/Models.cs:80-102): write a temp file
// next to the target, then rename over it. On Windows rename can fail with EPERM/EBUSY/EACCES while
// another process (antivirus, indexer, an editor) has the file open, so retry briefly.
import fs from "node:fs";
import path from "node:path";

const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
const lastBackup = new Map();

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const end = Date.now() + ms; while (Date.now() < end) {} }
}

/**
 * Write `data` to `file` atomically. Options:
 *  backup: copy the current file to `<file>.bak` first (at most once per backupEveryMs, default 60s)
 *  retries / delayMs: rename retry policy for EPERM/EBUSY/EACCES (default 8 tries, 25ms growing)
 *  fs: injectable for tests
 * Returns { ok, attempts, fallback, backup }. If every rename fails it falls back to a direct
 * write so the bridge keeps its state (same as the old behavior) and reports fallback: true.
 */
export function writeFileAtomicSync(file, data, { backup = false, backupEveryMs = 60000, retries = 8, delayMs = 25, fs: f = fs } = {}) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`);
  let didBackup = false;
  if (backup && f.existsSync(file) && Date.now() - (lastBackup.get(file) || 0) >= backupEveryMs) {
    try { f.copyFileSync(file, file + ".bak"); lastBackup.set(file, Date.now()); didBackup = true; } catch {}
  }
  const fd = f.openSync(tmp, "w");
  try { f.writeSync(fd, typeof data === "string" ? data : String(data), null, "utf8"); try { f.fsyncSync(fd); } catch {} }
  finally { f.closeSync(fd); }
  let attempt = 0;
  for (;;) {
    attempt++;
    try { f.renameSync(tmp, file); return { ok: true, attempts: attempt, fallback: false, backup: didBackup }; }
    catch (e) {
      if (!RETRY_CODES.has(e?.code) || attempt >= retries) {
        try { f.writeFileSync(file, data); } catch (e2) { try { f.unlinkSync(tmp); } catch {} throw e2; }
        try { f.unlinkSync(tmp); } catch {}
        return { ok: true, attempts: attempt, fallback: true, error: e?.code || String(e), backup: didBackup };
      }
      sleepSync(delayMs * attempt);
    }
  }
}
