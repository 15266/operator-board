import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.writeFileSync(p, s); console.log("wrote", p); }
function must(cond, msg) { if (!cond) throw new Error(msg); }

const serverPath = path.join(HERE, "server.mjs");
let server = read(serverPath);
if (!server.includes('import { adapterWorkBuddyAcp } from "./workbuddy-acp.mjs";')) {
  must(server.includes('import { fileURLToPath } from "node:url";'), "missing fileURLToPath import");
  server = server.replace(
    'import { fileURLToPath } from "node:url";',
    'import { fileURLToPath } from "node:url";\nimport { adapterWorkBuddyAcp } from "./workbuddy-acp.mjs";'
  );
}

must(/if \(rec\.executor === "workbuddy"\) \{/.test(server), "missing workbuddy execute branch");
const next = server.replace(
  /if \(rec\.executor === "workbuddy"\) \{[\s\S]*?\} else if \(rec\.executor === "codex"\)/,
  'if (rec.executor === "workbuddy") {\n      await adapterWorkBuddyAcp(rec, cwd, { port: WB_PORT, token: WB_TOKEN, update, redact });\n    } else if (rec.executor === "codex")'
);
must(next !== server, "failed to replace workbuddy execute branch");
server = next;

// health try branch
if (!server.includes("acp_ok:")) {
  const a = server.replace(
    /out\.workbuddy = \{ serve_port: WB_PORT \|\| null, token: !!WB_TOKEN, health: h\?\.status \?\? null, jobs_ok: false, jobs_issue: "([^"]+)" \};/,
    'out.workbuddy = { serve_port: WB_PORT || null, token: !!WB_TOKEN, health: h?.status ?? null, jobs_ok: false, jobs_issue: "$1", acp_ok: h?.status === 200 && !!WB_TOKEN, adapter: "acp" };'
  );
  must(a !== server, "failed to patch health try branch");
  server = a;
  const b = server.replace(
    /out\.workbuddy = \{ error: String\(e\), jobs_ok: false, jobs_issue: "([^"]+)" \};/,
    'out.workbuddy = { error: String(e), jobs_ok: false, jobs_issue: "$1", acp_ok: false, adapter: "acp" };'
  );
  must(b !== server, "failed to patch health catch branch");
  server = b;
}
write(serverPath, server);

const tsPath = path.join(BOARD, "src", "lib", "bridge.ts");
let ts = read(tsPath);
if (!ts.includes("acp_ok?: boolean")) {
  const t1 = ts.replace(
    "workbuddy?: { serve_port?: string | null; token?: boolean; health?: number | null; error?: string; jobs_ok?: boolean; jobs_issue?: string };",
    "workbuddy?: { serve_port?: string | null; token?: boolean; health?: number | null; error?: string; jobs_ok?: boolean; jobs_issue?: string; acp_ok?: boolean; adapter?: string };"
  );
  must(t1 !== ts, "failed to patch BridgeHealth type");
  ts = t1;
}
if (ts.includes("jobs 通道待修复") || ts.includes('ok: false, reason: health?.workbuddy?.jobs_issue')) {
  const t2 = ts.replace(
    /if \(executor === "workbuddy"\) \{[\s\S]*?\n  \}/,
    `if (executor === "workbuddy") {
    const w = health?.workbuddy;
    if (w?.health !== 200 || !w?.token) return { ok: false, reason: "WorkBuddy serve 未连接" };
    if (w.acp_ok === false) return { ok: false, reason: "WorkBuddy ACP 通道不可用" };
    return { ok: true };
  }`
  );
  must(t2 !== ts, "failed to patch executorDispatchGate");
  ts = t2;
}
write(tsPath, ts);

const boardPath = path.join(BOARD, "src", "components", "ProjectsBoard.tsx");
let board = read(boardPath);
if (board.includes("待修复，不可派发")) {
  const b1 = board.replace(
    /if \(executorChannelId === "workbuddy"\) \{[\s\S]*?\n  \}/,
    `if (executorChannelId === "workbuddy") {
    const w = health?.workbuddy;
    if (w?.health === 200 && w?.token && w.acp_ok !== false) {
      return {
        headline: "已核实：ACP 可派发",
        detail: \`serve :\${w.serve_port || "?"} 在线，走官方 ACP（workingDirectory）；jobs 仍与 serve 抢端口，暂不使用\`,
        tone: "ok",
      };
    }
    return {
      headline: "WorkBuddy serve 未连接",
      detail: w?.jobs_issue || w?.error || "未拿到 serve 端口或凭据",
      tone: "bad",
    };
  }`
  );
  must(b1 !== board, "failed to patch liveExecutorStatus");
  board = b1;
}
if (board.includes("在线，jobs 待修复")) {
  const b2 = board.replace("在线，jobs 待修复", "在线，ACP 可派发");
  must(b2 !== board, "failed to patch bridge bar");
  board = b2;
}
write(boardPath, board);

must(fs.existsSync(path.join(HERE, "workbuddy-acp.mjs")), "workbuddy-acp.mjs missing beside server.mjs");
console.log("OK");
