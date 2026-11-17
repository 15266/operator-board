// Codex provider: wraps ../codexMgr.mjs (the /bridge/codex/* routes stay unchanged).
import fs from "node:fs";
import path from "node:path";
import { codexHome, readAccount, readRateLimits, listSessions, listCodexProcesses } from "../codexMgr.mjs";

function configuredModel(home) {
  try { const m = /^\s*model\s*=\s*"([^"]{1,80})"/m.exec(fs.readFileSync(path.join(home, "config.toml"), "utf8")); return m ? m[1] : null; } catch { return null; }
}
const windowName = (w) => (w?.window_minutes === 300 ? "5h" : w?.window_minutes === 10080 ? "weekly" : w?.window_minutes ? `${w.window_minutes}min` : "window");
const ROLE = { this_bridge: "bridge", other_bridge: "other-bridge", orphan_exec: "orphan", exec_other_parent: "other" };

export function createCodexProvider({ home = null, listProcs = listCodexProcesses } = {}) {
  const h = () => home || codexHome();
  return {
    id: "codex", name: "Codex", kind: "cli",
    capabilities: { dispatch: true, status: true, sessions: true, processes: true },
    async status() {
      const acc = readAccount(h()), rl = readRateLimits(h());
      const out = { id: "codex", limits: [], source: rl.ok ? rl.source : "Codex rollout 文件", recorded_at: rl.ok ? rl.observed_at : null, model: configuredModel(h()), account: { auth_file: acc.auth_file, auth_mode: acc.auth_mode ?? null, api_key_present: acc.api_key_present ?? false } };
      if (!rl.ok) return { ...out, available: false, reason: rl.error };
      for (const w of [rl.primary, rl.secondary]) if (w) out.limits.push({ name: windowName(w), used_percent: w.used_percent, resets_at: w.resets_at, window_minutes: w.window_minutes });
      return { ...out, available: true, plan: rl.plan_type, age_minutes: rl.age_minutes, note: rl.note };
    },
    async sessions(ctx = {}, { limit, offset } = {}) {
      const r = await listSessions({ home: h(), limit, offset, dispatches: typeof ctx.dispatches === "function" ? ctx.dispatches() : [] });
      if (!r.ok) return { available: false, reason: r.error || "读取失败", total: 0, items: [] };
      return { available: true, source: r.source, total: r.total, offset: r.offset, limit: r.limit,
        items: r.sessions.map((s) => ({ session_id: s.id, title: s.title, updated_at: s.updated_at, link: s.thread_url, dispatch_id: s.dispatch?.id || null, model: s.model || null })) };
    },
    async processes(ctx = {}) {
      const r = await listProcs(ctx.bridgePid || process.pid);
      if (!r.ok) return { available: false, reason: r.error, items: [] };
      return { available: true, bridge_pid: r.bridge_pid, items: r.processes.map((p) => ({ pid: p.pid, name: "codex.exe", role: p.exec ? (ROLE[p.owner] || "other") : "desktop", started_at: p.created || null, parent_pid: p.parent_pid })) };
    },
  };
}
