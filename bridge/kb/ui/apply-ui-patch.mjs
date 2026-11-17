// Anchor-checked additive UI patch for operator-board src/. Usage: node apply-ui-patch.mjs <boardRoot> [--dry-run]
// Copies KnowledgeBase.tsx into src/components and edits bridge.ts / types.ts / ProjectsBoard.tsx.
// Exits 2 without writing anything if any anchor is missing / not unique or the board is already patched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [root, ...flags] = process.argv.slice(2);
const dry = flags.includes("--dry-run");
if (!root) { console.error("usage: node apply-ui-patch.mjs <boardRoot> [--dry-run]"); process.exit(64); }
const f = (p) => path.join(root, "src", p);
const kbTs = fs.readFileSync(path.join(here, "bridge.kb.ts"), "utf8");
const plan = {
  "lib/bridge.ts": [
    ["  title?: string;\n  model?: string | null;\n}", "  title?: string;\n  model?: string | null;\n  /** Local knowledge base ids (kb-YYYYMMDD-xxxxxxxx). Unknown ids -> 400, nothing dispatched. */\n  kb_refs?: string[];\n  /** Default true: copy referenced artifacts into <cwd>/kb_refs/<id>/. */\n  kb_copy_artifacts?: boolean;\n}"],
    ["  events: { ts: string; msg: string }[];\n}", "  events: { ts: string; msg: string }[];\n  /** kb ids this dispatch consumed via kb_refs. */\n  kb_refs?: string[];\n}"],
    [null, "\n" + kbTs],
  ],
  "lib/types.ts": [
    ["  parent_task_id?: string | null;", "  /** Optional local knowledge base ids sent as kb_refs when this task is dispatched. */\n  kb_refs?: string[];\n  parent_task_id?: string | null;"],
  ],
  "components/ProjectsBoard.tsx": [
    ['import { RoundtableMark } from "./RoundtableMark";', 'import { RoundtableMark } from "./RoundtableMark";\nimport { KbRefPicker, KnowledgeBasePanel } from "./KnowledgeBase";'],
    ["    parent_task_id:\n      typeof t.parent_task_id", '    kb_refs: Array.isArray(t.kb_refs)\n      ? t.kb_refs.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 20)\n      : undefined,\n    parent_task_id:\n      typeof t.parent_task_id'],
    ["    title: task.title,\n    model: resolveDispatchModel({\n      taskModel: task.model,\n      preferred: ctx.preferredModels[executor]", "    title: task.title,\n    ...(task.kb_refs?.length ? { kb_refs: task.kb_refs } : {}),\n    model: resolveDispatchModel({\n      taskModel: task.model,\n      preferred: ctx.preferredModels[executor]"],
    ['            onWriteToRoster={onWriteRoleToRoster}\n          />\n          <p className="muted">', '            onWriteToRoster={onWriteRoleToRoster}\n          />\n          <KbRefPicker\n            online={bridge.online}\n            projectId={task.project_id}\n            value={task.kb_refs ?? []}\n            onChange={(next) => onChange({ ...task, kb_refs: next.length ? next : undefined })}\n          />\n          <p className="muted">'],
    ["        {prefs.selfCreateTasks && taskFormOpen ? (", "        <KnowledgeBasePanel online={bridge.online} projectId={selected.project_id} />\n\n        {prefs.selfCreateTasks && taskFormOpen ? ("],
  ],
};
const out = {}; const report = [];
for (const [rel, edits] of Object.entries(plan)) {
  let src = fs.readFileSync(f(rel), "utf8");
  if (src.includes("\r\n")) { console.log(JSON.stringify({ ok: false, reason: "crlf_not_supported", file: rel })); process.exit(2); }
  if (/KnowledgeBase|kb_refs|fetchKbEntries/.test(src)) { console.log(JSON.stringify({ ok: false, reason: "already_patched", file: rel })); process.exit(2); }
  for (const [anchor, rep] of edits) {
    if (anchor === null) { src = src.replace(/\s*$/, "\n") + rep; continue; }
    const n = src.split(anchor).length - 1;
    if (n !== 1) { console.log(JSON.stringify({ ok: false, reason: n ? "anchor_not_unique" : "anchor_missing", file: rel, anchor: anchor.slice(0, 60) })); process.exit(2); }
    src = src.replace(anchor, rep);
  }
  out[rel] = src; report.push(rel);
}
if (fs.existsSync(f("components/KnowledgeBase.tsx"))) { console.log(JSON.stringify({ ok: false, reason: "KnowledgeBase.tsx exists" })); process.exit(2); }
if (!dry) {
  for (const [rel, src] of Object.entries(out)) fs.writeFileSync(f(rel), src);
  fs.copyFileSync(path.join(here, "KnowledgeBase.tsx"), f("components/KnowledgeBase.tsx"));
}
console.log(JSON.stringify({ ok: true, dry_run: dry, edited: report, created: ["src/components/KnowledgeBase.tsx"] }));
