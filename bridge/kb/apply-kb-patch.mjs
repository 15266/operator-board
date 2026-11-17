// Minimal, anchor-checked patch that wires bridge/kb into an operator-board bridge/server.mjs.
// Usage: node kb/apply-kb-patch.mjs <path/to/server.mjs> [--expect-sha256=<hex>] [--dry-run]
// Refuses (exit 2) if the file hash differs from --expect-sha256, an anchor is missing / not unique,
// or the file is already patched. Never touches adapter code (adapterCodex args etc.).
import fs from "node:fs";
import crypto from "node:crypto";

const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error("usage: node apply-kb-patch.mjs <server.mjs> [--expect-sha256=hex] [--dry-run]"); process.exit(64); }
const expect = (flags.find((f) => f.startsWith("--expect-sha256=")) || "").split("=")[1];
const dry = flags.includes("--dry-run");
const buf = fs.readFileSync(file);
const hash = crypto.createHash("sha256").update(buf).digest("hex");
if (expect && expect.toLowerCase() !== hash) { console.log(JSON.stringify({ ok: false, reason: "hash_changed", sha256: hash })); process.exit(2); }
let src = buf.toString("utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";
if (src.includes("./kb/routes.mjs")) { console.log(JSON.stringify({ ok: false, reason: "already_patched", sha256: hash })); process.exit(2); }

const edits = [
  { name: "import", anchor: 'import { handleScanHttp, scanLocal as scanWithPlugins, createLiveHost, assertNoSecrets as assertScannerNoSecrets, promoteDraft } from "./scanners/loader.mjs";',
    fallbackAnchor: /^import .* from "\.\/scanners\/loader\.mjs";$/m,
    insertAfter: 'import { createKb } from "./kb/routes.mjs";' },
  { name: "kb-init", anchor: 'function loadPlan() { try { return JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")); } catch { return null; } }',
    insertAfter: [
      "",
      "// Local knowledge base (bridge/kb/, replaceable module; contract in kb/contract.md).",
      "// Same cwd rule as execute(): plan task cwd, else ai-dispatch-test/adhoc.",
      'function dispatchCwd(r) { const pt = loadPlan()?.tasks?.find((t) => t.task_id === r?.task_id); return pt?.cwd ? path.resolve(AKILI, pt.cwd) : path.join(AKILI, "ai-dispatch-test", "adhoc"); }',
      'const kb = createKb({ dataDir: path.join(HERE, "kb", "data"), boardDir: BOARD, cwdFor: dispatchCwd, secrets: () => [WB_TOKEN, process.env.CODEBUDDY_GATEWAY_PASSWORD], log });',
    ].join(eol) },
  { name: "ingest-at-terminal", anchor: "  delete rec._force; save();" + eol + "}",
    replace: "  delete rec._force; save();" + eol + "  kb.ingestSafe(rec, state.dispatches); // KB: idempotent by dispatch_id, never throws" + eol + "}" },
  { name: "kb-refs-resolve", anchor: "      validateDispatch(b);" + eol + "      const busy = state.dispatches.find(",
    replace: "      validateDispatch(b);" + eol + "      const kbEntries = kb.resolveRefs(b.kb_refs); // unknown kb id -> 400, nothing dispatched" + eol + "      const busy = state.dispatches.find(" },
  { name: "kb-refs-inject", anchor: "      const rec = newRecord(b);" + eol + '      log("dispatch", rec.id, rec.executor, rec.task_id || "");',
    replace: [
      "      const kbPrep = kbEntries.length ? kb.prepareDispatch(b, dispatchCwd(b)) : null;",
      "      if (kbPrep) b.prompt = kbPrep.prompt;",
      "      const rec = newRecord(b);",
      '      if (kbPrep) update(rec, { kb_refs: kbPrep.kb_refs, evidence: { ...rec.evidence, kb_refs: kbPrep.kb_refs, kb_copies: kbPrep.copies } }, "引用知识库 " + kbPrep.kb_refs.join(","));',
      '      log("dispatch", rec.id, rec.executor, rec.task_id || "");',
    ].join(eol) },
  { name: "route", anchor: '    if (url.pathname === "/bridge/dispatches") return send(',
    replace: '    if (url.pathname === "/bridge/kb" || url.pathname.startsWith("/bridge/kb/")) return void (await kb.handle(req, res, url, { dispatches: () => state.dispatches, readBody: readJsonBody }));' + eol + '    if (url.pathname === "/bridge/dispatches") return send(' },
];
const applied = [];
for (const e of edits) {
  let anchor = e.anchor;
  let count = src.split(anchor).length - 1;
  if (count !== 1 && e.fallbackAnchor) { const m = src.match(e.fallbackAnchor); if (m) { anchor = m[0]; count = src.split(anchor).length - 1; } }
  if (count !== 1) { console.log(JSON.stringify({ ok: false, reason: "anchor_" + (count ? "not_unique" : "missing"), edit: e.name, sha256: hash })); process.exit(2); }
  src = src.replace(anchor, e.replace ?? anchor + eol + e.insertAfter);
  applied.push(e.name);
}
const out = Buffer.from(src, "utf8");
const newHash = crypto.createHash("sha256").update(out).digest("hex");
if (!dry) {
  // Re-check right before writing: a concurrent editor may have saved in between.
  const again = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (again !== hash) { console.log(JSON.stringify({ ok: false, reason: "changed_during_patch", sha256: again })); process.exit(2); }
  fs.writeFileSync(file, out);
}
console.log(JSON.stringify({ ok: true, dry_run: dry, applied, sha256_before: hash, sha256_after: newHash, eol: eol === "\r\n" ? "CRLF" : "LF" }));
