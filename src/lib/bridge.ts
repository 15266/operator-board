import { useEffect, useState } from "react";

/** Local dispatch bridge (operator-board/bridge/server.mjs), loopback only. */
export const BRIDGE_URL = "http://127.0.0.1:5180";

export type DispatchState = "queued" | "running" | "verified" | "replied_unverified" | "awaiting_user" | "handoff_closed" | "partial" | "failed" | "sent_awaiting_result";

export interface DispatchCheck {
  name: string;
  ok: boolean;
  detail?: string;
  /** Bridge v2: "marker" | "file" | "none" | "reply_nonempty" | "pending" (open string). */
  type?: string;
  target?: string | null;
}

/** Known evidence fields (all optional; evidence stays an open record). */
export interface DispatchEvidenceKnown {
  sandbox?: string | null;
  sandbox_source?: string | null;
  cwd?: string | null;
  project_dir?: string | null;
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
  evidence: Record<string, unknown> & DispatchEvidenceKnown;
  checks: DispatchCheck[];
  error: string | null;
  events: { ts: string; msg: string }[];
  /** Bridge v2 record fields (optional). */
  cwd?: string | null;
  project_dir?: string | null;
  sandbox?: string | null;
  /** kb ids this dispatch consumed via kb_refs. */
  kb_refs?: string[];
}

export interface BridgeHealth {
  bridge?: { ok: boolean; port: number };
  workbuddy?: { public_gateway?: boolean; desktop_detected?: boolean; serve_port?: string | null; token?: boolean; health?: number | null; error?: string; jobs_ok?: boolean; jobs_issue?: string; acp_ok?: boolean; adapter?: string; exe_path?: string | null; auth_status?: string };
  codex?: { cli?: boolean; cli_path?: string | null; used?: number; max?: number; proxy_port?: number | null; proxy_up?: boolean };
  doubao?: { cdp?: boolean; cdp_endpoint?: string | null; bridge_cli?: boolean; bridge_path?: string | null; adapter?: string; local_work_task?: boolean };
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
  /** Local knowledge base ids (kb-YYYYMMDD-xxxxxxxx). Unknown ids -> 400, nothing dispatched. */
  kb_refs?: string[];
  /** Default true: copy referenced artifacts into <cwd>/kb_refs/<id>/. */
  kb_copy_artifacts?: boolean;
  /** Evaluator advice requests only (Host rule). The bridge accepts and ignores it (not validated, not stored). */
  ask_evaluator_suggestions?: boolean;
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
  handoff_closed: { text: "交接记录已结束，结果未核实", tone: "neutral" },
  awaiting_user: { text: "等待你在 WorkBuddy 中发送", tone: "warn" },
  queued: { text: "排队中", tone: "neutral" },
  running: { text: "运行中", tone: "warn" },
  verified: { text: "已核实：真实回复已校验", tone: "ok" },
  replied_unverified: { text: "有回复，待核实", tone: "unverified" },
  partial: { text: "超时，已回收产物，待验收", tone: "unverified" },
  failed: { text: "失败", tone: "bad" },
  // Sent to a webhook executor; waiting for its result callback. Pending, never counts as verified.
  sent_awaiting_result: { text: "已发送，等待结果", tone: "neutral" },
};

export const BRIDGE_EXECUTORS = new Set(["workbuddy", "codex", "doubao"]);

/** Live gate: whether the board should actually POST a dispatch for this executor. */
export function executorDispatchGate(executor: string, health: BridgeHealth | null, online: boolean): { ok: boolean; reason?: string } {
  if (!online) return { ok: false, reason: "桥接未启动" };
  if (executor === "workbuddy") {
    const w = health?.workbuddy;
    if (!w?.desktop_detected || !w.exe_path) return { ok: false, reason: "未找到 WorkBuddy 桌面程序，无法进行桌面交接" };
    return { ok: true };
  }
  if (executor === "codex") {
    const c = health?.codex;
    if (!c?.cli) return { ok: false, reason: "找不到 Codex CLI" };
    if (!c.proxy_up) return { ok: false, reason: "代理未启动，未发送 Codex，以免浪费额度" };
    if ((c.used ?? 0) >= (c.max ?? 1)) return { ok: false, reason: `Codex 本机派发次数达到上限（${c.used}/${c.max}），未再发送` };
    return { ok: true };
  }
  if (executor === "doubao") {
    const d = health?.doubao;
    if (!d?.cdp) return { ok: false, reason: "本机未发现豆包 CDP 调试口" };
    if (!d.local_work_task && !d.bridge_cli) return { ok: false, reason: "找不到豆包「新工作任务」脚本" };
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

// ---- Local knowledge base (bridge/kb). Additive: appended to src/lib/bridge.ts. ----
export interface KbArtifact {
  path: string;
  root: "cwd" | "project" | "board" | string;
  size: number;
  sha256: string;
  mtime?: string | null;
  attribution: "reported_by_adapter" | "time_window" | "project_dir_time_window" | string;
  /** KB v2: content-addressed copy exists; false → see blob_reason (e.g. "secret_pattern" → route 403). */
  blob?: boolean;
  blob_reason?: string | null;
  carried_from_previous_ingest?: boolean;
}

export interface KbEntrySummary {
  id: string;
  uri: string;
  dispatch_id: string;
  task_id: string | null;
  project_id: string | null;
  title: string;
  executor: string;
  model: string | null;
  /** DispatchRecord.state verbatim. */
  state: string;
  success: boolean;
  artifact_count: number;
  refs: string[];
  reply_excerpt: string | null;
  created_at: string;
  dispatch_finished_at: string | null;
}

export interface KbEntry extends Omit<KbEntrySummary, "artifact_count" | "reply_excerpt"> {
  reply: string | null;
  reply_truncated: boolean;
  prompt: string | null;
  error: string | null;
  artifacts: KbArtifact[];
  artifacts_note?: string | null;
  overlapping_dispatches?: string[];
  cwd: string | null;
  /** KB v2 optional fields. */
  checks?: DispatchCheck[];
  evidence?: Record<string, unknown>;
  project_dir?: string | null;
  sandbox?: string | null;
  sandbox_source?: string | null;
  prompt_truncated?: boolean;
}

export interface KbQuery {
  q?: string;
  executor?: string;
  project_id?: string;
  task_id?: string;
  state?: string;
  limit?: number;
}

/** Honest text while the running bridge has no /bridge/kb route yet. */
export const KB_NOT_PROVIDED = "桥接尚未提供 /bridge/kb";

export async function fetchKbEntries(query: KbQuery = {}): Promise<{ entries: KbEntrySummary[]; total: number; error: string | null }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  try {
    const r = await fetch(`${BRIDGE_URL}/bridge/kb${params.toString() ? `?${params.toString()}` : ""}`);
    const j = (await r.json().catch(() => null)) as { entries?: KbEntrySummary[]; total?: number; error?: string } | null;
    if (r.status === 404) return { entries: [], total: 0, error: KB_NOT_PROVIDED };
    if (!r.ok || !j || !Array.isArray(j.entries)) return { entries: [], total: 0, error: j?.error ?? `HTTP ${r.status}` };
    return { entries: j.entries, total: j.total ?? j.entries.length, error: null };
  } catch (e) {
    // The running bridge may predate /bridge/kb; its 404 can arrive without CORS headers (= network error).
    return { entries: [], total: 0, error: `${KB_NOT_PROVIDED}（${(e as Error).message}）` };
  }
}

export async function fetchKbEntry(id: string): Promise<KbEntry | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/bridge/kb/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { entry?: KbEntry };
    return j.entry ?? null;
  } catch {
    return null;
  }
}

export function kbArtifactUrl(id: string, index: number): string {
  return `${BRIDGE_URL}/bridge/kb/${encodeURIComponent(id)}/artifacts/${index}`;
}

// ---- Codex local status (bridge/codexMgr.mjs, read-only GET /bridge/codex/*). ----
export interface CodexAccount {
  home?: string;
  auth_file: boolean;
  auth_mode?: string | null;
  api_key_present?: boolean;
  /** Names of non-empty token fields only; never values. Not displayed. */
  token_fields?: string[];
  last_refresh?: string | null;
  parse_error?: boolean;
}

export interface CodexRateWindow {
  used_percent: number | null;
  window_minutes: number | null;
  resets_at: string | null;
}

export interface CodexRateLimits {
  ok: boolean;
  error?: string;
  source?: string;
  source_file: string | null;
  observed_at?: string;
  age_minutes?: number;
  limit_id?: string | null;
  plan_type?: string | null;
  primary?: CodexRateWindow | null;
  secondary?: CodexRateWindow | null;
  credits?: { has_credits: boolean; unlimited: boolean } | null;
  rate_limit_reached_type?: string | null;
  note?: string;
}

export interface CodexStatusResponse {
  ok: boolean;
  account: CodexAccount | null;
  rate_limits: CodexRateLimits | null;
  bridge_counter: { used: number | null; max: number | null; codex_dispatch_records: number; note: string } | null;
}

export interface CodexSession {
  id: string | null;
  title: string | null;
  source: string | null;
  cwd: string | null;
  model: string | null;
  updated_at: string | null;
  tokens_used: number | null;
  rollout_exists: boolean;
  /** Only present on the rollout-file fallback; the sqlite path lists non-archived threads. */
  archived?: boolean;
  thread_url: string | null;
  dispatch: { id: string; state: string; task_id: string | null } | null;
}

export interface CodexSessionsResponse {
  ok: boolean;
  source: string;
  total: number;
  offset: number;
  limit: number;
  sessions: CodexSession[];
}

export interface CodexProcess {
  pid: number;
  parent_pid: number;
  created: string | null;
  exec: boolean;
  owner: string;
  flags?: Record<string, boolean>;
}

export interface CodexProcessesResponse {
  ok: boolean;
  bridge_pid?: number;
  processes: CodexProcess[];
  summary?: Record<string, number>;
  note?: string;
  error?: string;
}

/** GET a read-only Codex route. Never throws; 404 means the running bridge predates the route. */
async function getCodex<T extends { ok?: boolean; error?: string }>(path: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const r = await fetch(`${BRIDGE_URL}${path}`);
    if (r.status === 404) return { data: null, error: `桥接尚未提供 ${path.split("?")[0]}（运行中的桥接早于该接口，需桥接重启后才有）` };
    const j = (await r.json().catch(() => null)) as T | null;
    if (!r.ok || !j) return { data: null, error: j?.error ?? `HTTP ${r.status}` };
    if (j.ok === false) return { data: j, error: j.error ?? "接口返回 ok:false" };
    return { data: j, error: null };
  } catch (e) {
    // A route the old bridge doesn't know may come back without CORS headers, which surfaces as a network error.
    return { data: null, error: `读不到 ${path.split("?")[0]}：${(e as Error).message}（可能是桥接尚未提供该接口）` };
  }
}

export function fetchCodexStatus() {
  return getCodex<CodexStatusResponse & { error?: string }>("/bridge/codex/status");
}

export function fetchCodexSessions(limit = 10, offset = 0) {
  return getCodex<CodexSessionsResponse & { error?: string }>(`/bridge/codex/sessions?limit=${limit}&offset=${offset}`);
}

export function fetchCodexProcesses() {
  return getCodex<CodexProcessesResponse>("/bridge/codex/processes");
}
