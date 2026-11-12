import { useEffect, useState } from "react";

/** Local dispatch bridge (operator-board/bridge/server.mjs), loopback only. */
export const BRIDGE_URL = "http://127.0.0.1:5180";

export type DispatchState = "queued" | "running" | "verified" | "replied_unverified" | "failed";

export interface DispatchCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface DispatchRecord {
  id: string;
  executor: string;
  task_id: string | null;
  project_id: string | null;
  title: string;
  model?: string | null;
  state: DispatchState;
  via: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  reply: string | null;
  evidence: Record<string, unknown>;
  checks: DispatchCheck[];
  error: string | null;
  events: { ts: string; msg: string }[];
}

export interface BridgeHealth {
  bridge?: { ok: boolean; port: number };
  workbuddy?: { serve_port?: string | null; token?: boolean; health?: number | null; error?: string; jobs_ok?: boolean; jobs_issue?: string; acp_ok?: boolean; adapter?: string; exe_path?: string | null; auth_status?: string };
  codex?: { cli?: boolean; cli_path?: string | null; used?: number; max?: number; proxy_port?: number | null; proxy_up?: boolean };
  doubao?: { cdp?: boolean; cdp_endpoint?: string | null; bridge_cli?: boolean; bridge_path?: string | null; adapter?: string };
  discover?: { scanned_at?: string | null; needs_credential?: { interface_id: string; auth_ref: string; prompt: string }[] };
  openai_compatible?: { id: string; kind: string; endpoint?: string | null; listening?: boolean; auth_status?: string; auth_needed?: boolean }[];
}

export type DiscoverAuthStatus =
  | "none_required"
  | "missing"
  | "from_process_env"
  | "from_env"
  | "user_provided_ref"
  | "desktop_login_unverified";

export interface DiscoveredInterface {
  id: string;
  kind: string;
  transport: string;
  display_name: string;
  found: boolean;
  source: string[];
  exe_path?: string | null;
  cli_path?: string | null;
  endpoint?: string | null;
  port?: number | null;
  pid?: number | null;
  listening: boolean;
  health_http?: number | null;
  auth_status: DiscoverAuthStatus | string;
  auth_ref?: string | null;
  auth_needed: boolean;
  layers: { found: boolean; listening: boolean; authenticated: boolean; chat_ok: boolean };
  notes?: string[];
  jobs_ok?: boolean;
}

export interface DiscoverReport {
  scanned_at: string;
  machine?: { hostname?: string; platform?: string };
  interfaces: DiscoveredInterface[];
  needs_credential: { interface_id: string; auth_ref: string; prompt: string }[];
  unidentified_loopback?: { port: number; pid?: number; name?: string }[];
  notes?: string[];
}

export interface BridgeView {
  online: boolean;
  health: BridgeHealth | null;
  discover: DiscoverReport | null;
  dispatches: DispatchRecord[];
  lastPollAt: string | null;
  dispatch: (payload: DispatchPayload) => Promise<string | null>;
  refreshDiscover: () => Promise<string | null>;
  submitCredential: (interfaceId: string, authRef: string, secret: string) => Promise<string | null>;
}

export interface DispatchPayload {
  executor: string;
  prompt: string;
  task_id?: string;
  project_id?: string;
  title?: string;
  model?: string | null;
}

export function useBridge(): BridgeView {
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [discover, setDiscover] = useState<DiscoverReport | null>(null);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [lastPollAt, setLastPollAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch(`${BRIDGE_URL}/bridge/dispatches`);
        // A 500 from the bridge still parses as JSON; never treat it as "online".
        if (!r.ok) {
          if (alive) setOnline(false);
          return;
        }
        const j = (await r.json().catch(() => null)) as { dispatches?: DispatchRecord[] } | null;
        if (!alive) return;
        if (!j || !Array.isArray(j.dispatches)) {
          setOnline(false);
          return;
        }
        setDispatches(j.dispatches);
        setOnline(true);
        setLastPollAt(new Date().toISOString());
      } catch {
        if (alive) setOnline(false);
      }
    }
    async function pollHealth() {
      try {
        const r = await fetch(`${BRIDGE_URL}/bridge/health`);
        if (!r.ok) {
          if (alive) setHealth(null);
          return;
        }
        const j = (await r.json().catch(() => null)) as BridgeHealth | null;
        if (alive) setHealth(j ?? null);
      } catch {
        if (alive) setHealth(null);
      }
    }
    async function pollDiscover() {
      try {
        const r = await fetch(`${BRIDGE_URL}/bridge/discover`);
        if (!r.ok) return;
        const j = (await r.json().catch(() => null)) as DiscoverReport | null;
        if (alive && j && Array.isArray(j.interfaces)) setDiscover(j);
      } catch {
        /* discover is optional while the old bridge is still coming up */
      }
    }
    void poll();
    void pollHealth();
    void pollDiscover();
    const a = window.setInterval(poll, 2500);
    const b = window.setInterval(pollHealth, 15000);
    const c = window.setInterval(pollDiscover, 30000);
    return () => {
      alive = false;
      window.clearInterval(a);
      window.clearInterval(b);
      window.clearInterval(c);
    };
  }, []);

  async function dispatch(payload: DispatchPayload): Promise<string | null> {
    try {
      const r = await fetch(`${BRIDGE_URL}/bridge/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await r.json()) as { dispatch?: DispatchRecord; error?: string };
      if (j.dispatch) setDispatches((prev) => [j.dispatch as DispatchRecord, ...prev.filter((d) => d.id !== j.dispatch?.id)]);
      return r.ok ? null : j.error ?? `HTTP ${r.status}`;
    } catch (e) {
      return `桥接未启动：${(e as Error).message}`;
    }
  }

  async function refreshDiscover(): Promise<string | null> {
    try {
      const r = await fetch(`${BRIDGE_URL}/bridge/discover/refresh`, { method: "POST" });
      const j = (await r.json()) as DiscoverReport & { error?: string };
      if (j && Array.isArray(j.interfaces)) setDiscover(j);
      return r.ok ? null : j.error ?? `HTTP ${r.status}`;
    } catch (e) {
      return `刷新发现失败：${(e as Error).message}`;
    }
  }

  async function submitCredential(interfaceId: string, authRef: string, secret: string): Promise<string | null> {
    try {
      const r = await fetch(`${BRIDGE_URL}/bridge/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interface_id: interfaceId, auth_ref: authRef, secret }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (r.ok && j.ok) {
        const d = await fetch(`${BRIDGE_URL}/bridge/discover`);
        const report = (await d.json()) as DiscoverReport;
        if (report && Array.isArray(report.interfaces)) setDiscover(report);
        return null;
      }
      return j.error ?? `HTTP ${r.status}`;
    } catch (e) {
      return `未能保存凭据：${(e as Error).message}`;
    }
  }

  return { online, health, discover, dispatches, lastPollAt, dispatch, refreshDiscover, submitCredential };
}

export const DISPATCH_LABEL: Record<DispatchState, { text: string; tone: string }> = {
  queued: { text: "排队中", tone: "neutral" },
  running: { text: "运行中", tone: "warn" },
  verified: { text: "已核实：真实回复已校验", tone: "ok" },
  replied_unverified: { text: "有回复，待核实", tone: "unverified" },
  failed: { text: "失败", tone: "bad" },
};

export const BRIDGE_EXECUTORS = new Set(["workbuddy", "codex", "doubao"]);

/** Live gate: whether the board should actually POST a dispatch for this executor. */
export function executorDispatchGate(executor: string, health: BridgeHealth | null, online: boolean): { ok: boolean; reason?: string } {
  if (!online) return { ok: false, reason: "桥接未启动" };
  if (executor === "workbuddy") {
    const w = health?.workbuddy;
    if (w?.health !== 200 || !w?.token) return { ok: false, reason: "WorkBuddy serve 未连接" };
    if (w.acp_ok === false) return { ok: false, reason: "WorkBuddy ACP 通道不可用" };
    return { ok: true };
  }
  if (executor === "codex") {
    const c = health?.codex;
    if (!c?.cli) return { ok: false, reason: "找不到 Codex CLI" };
    if (!c.proxy_up) return { ok: false, reason: "代理未启动，未发送 Codex，以免浪费额度" };
    if ((c.used ?? 0) >= (c.max ?? 1)) return { ok: false, reason: `Codex 额度已用完（${c.used}/${c.max}），未再发送` };
    return { ok: true };
  }
  if (executor === "doubao") {
    const d = health?.doubao;
    if (!d?.cdp) return { ok: false, reason: "本机未发现豆包 CDP 调试口" };
    if (!d.bridge_cli) return { ok: false, reason: "找不到 dsh-doubao-bridge" };
    return { ok: true };
  }
  return { ok: BRIDGE_EXECUTORS.has(executor) };
}

export interface LiveModels {
  ok: boolean;
  models: { value: string; name: string }[];
  current: string | null;
  error: string | null;
  source?: string;
}

const liveModelCache = new Map<string, Promise<LiveModels | null>>();

/**
 * Ask the bridge which models the executor will actually accept. The scanner
 * catalog comes from the manifest's published list, which is not the same set
 * the live session validates against, so the picker prefers this.
 * Cached per executor for the page lifetime; the bridge also caches for 60s.
 */
export function fetchLiveModels(executor: string): Promise<LiveModels | null> {
  const hit = liveModelCache.get(executor);
  if (hit) return hit;
  const task = (async () => {
    try {
      const r = await fetch(`${BRIDGE_URL}/bridge/models?executor=${encodeURIComponent(executor)}`);
      const j = (await r.json()) as LiveModels;
      if (!j || !Array.isArray(j.models) || !j.ok) {
        // Never cache a failure: the session may not have been ready yet.
        liveModelCache.delete(executor);
        return null;
      }
      return j;
    } catch {
      liveModelCache.delete(executor);
      return null;
    }
  })();
  liveModelCache.set(executor, task);
  return task;
}

/** Seed project from bridge/test-plan.json so the plan shows up in the board. */export async function fetchSeedPlan(): Promise<{
  project: { project_id: string; name: string; notes?: string };
  tasks: {
    task_id: string;
    project_id: string;
    title: string;
    description: string;
    priority: "P0" | "P1" | "P2";
    executor_channel_id: string | null;
    model: string | null;
  }[];
} | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/bridge/plan`);
    const j = await r.json();
    return j && j.project ? j : null;
  } catch {
    return null;
  }
}
