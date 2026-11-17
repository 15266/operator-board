// Content-addressed blob store (git-object style): <dir>/<sha[0:2]>/<sha256>. Dedupe by hash,
// atomic write (tmp + rename), hash verified after write. Size cap KB_BLOB_MAX (bytes, default 50 MB).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SHA_RE = /^[0-9a-f]{64}$/;
export function blobMax() { const v = Number(process.env.KB_BLOB_MAX); return Number.isFinite(v) && v > 0 ? v : 50 * 1024 * 1024; }

export function createBlobStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fileFor = (sha) => { if (!SHA_RE.test(sha)) throw new Error("bad sha256"); return path.join(dir, sha.slice(0, 2), sha); };
  const has = (sha) => SHA_RE.test(sha || "") && fs.existsSync(fileFor(sha));
  function hashFile(file) {
    const h = crypto.createHash("sha256"); const fd = fs.openSync(file, "r");
    try { const buf = Buffer.allocUnsafe(1 << 20); let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
    return h.digest("hex");
  }
  /** Copy a file into the store. expectSha: refuse if the file no longer has that hash (overwritten since). */
  function putFile(src, expectSha = null) {
    let st; try { st = fs.statSync(src); } catch { return { blob: false, reason: "source_missing" }; }
    if (!st.isFile()) return { blob: false, reason: "not_a_file" };
    if (st.size > blobMax()) return { blob: false, reason: `too_large(>${blobMax()}B)`, size: st.size };
    if (expectSha && has(expectSha)) return { blob: true, sha256: expectSha, size: st.size, dedup: true };
    const sha = hashFile(src);
    if (expectSha && sha !== expectSha) return { blob: false, reason: "changed_since_ingest", sha256_now: sha, size: st.size };
    if (has(sha)) return { blob: true, sha256: sha, size: st.size, dedup: true };
    const dest = fileFor(sha); fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
    fs.copyFileSync(src, tmp);
    if (hashFile(tmp) !== sha) { fs.rmSync(tmp, { force: true }); return { blob: false, reason: "changed_during_copy" }; }
    fs.renameSync(tmp, dest);
    return { blob: true, sha256: sha, size: st.size, dedup: false };
  }
  function putBuffer(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), "utf8");
    if (b.length > blobMax()) return { blob: false, reason: `too_large(>${blobMax()}B)`, size: b.length };
    const sha = crypto.createHash("sha256").update(b).digest("hex");
    if (has(sha)) return { blob: true, sha256: sha, size: b.length, dedup: true };
    const dest = fileFor(sha); fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`; fs.writeFileSync(tmp, b); fs.renameSync(tmp, dest);
    return { blob: true, sha256: sha, size: b.length, dedup: false };
  }
  /** Path of a blob after re-verifying its hash (null if missing or corrupt). */
  function verifiedPath(sha) { if (!has(sha)) return null; const f = fileFor(sha); return hashFile(f) === sha ? f : null; }
  return { dir, has, putFile, putBuffer, verifiedPath, fileFor };
}
