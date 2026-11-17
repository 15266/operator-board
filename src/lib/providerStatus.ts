// Normalized, read-only provider status for the "External AI status" panel.
// Mirrors 外部通道官's draft generic API (not live yet):
//   GET /bridge/providers
//   GET /bridge/provider/<id>/status | /sessions?limit=&offset= | /processes
// Fallbacks while that API is missing:
//   - provider list: the bridge's own discovery report (/bridge/discover), not a hardcoded vendor list
//   - codex: adapter over the existing read-only /bridge/codex/* routes (bridge/codexMgr.mjs)
//   - everyone else: available:false with an honest reason.
import {
  BRIDGE_URL,
  fetchCodexProcesses,
  fetchCodexSessions,
  fetchCodexStatus,
  type CodexRateWindow,
  type DiscoverReport,
} from "./bridge";

export type ProviderCapability = "status" | "sessions" | "processes";

export interface ProviderInfo {
  id: string;
  name: string;
  kind: string;
  capabilities: ProviderCapability[];
  /** Where this entry came from: the generic bridge route or the discovery fallback. */
  origin: "bridge_providers" | "discover";
}

export interface ProviderLimit {
  name: string;
  used_percent: number | null;
  resets_at: string | null;
  window_minutes?: number | null;
}

export interface ProviderStatus {
  id: string;
  available: boolean;
  reason?: string | null;
  plan?: string | null;
  model?: string | null;
  limits: ProviderLimit[];
  source?: string | null;
  recorded_at?: string | null;
  /** Extra read-only facts from an adapter (never secrets). */
  notes?: string[];
}

export interface ProviderSessionItem {
  session_id: string;
  title?: string | null;
  updated_at?: string | null;
  link?: string | null;
  dispatch_id?: string | null;
  model?: string | null;
}

export interface ProviderSessions {
  available: boolean;
  reason?: string | null;
  total?: number | null;
  items: ProviderSessionItem[];
}

export type ProviderProcessRole = "bridge" | "other-bridge" | "orphan" | "desktop" | "other";

export interface ProviderProcessItem {
  pid: number;
  name?: string | null;
  role: ProviderProcessRole | string;
  started_at?: string | null;
  parent_pid?: number | null;
}

export interface ProviderProcesses {
  available: boolean;
  reason?: string | null;
  items: ProviderProcessItem[];
  note?: string | null;
}

export interface ProviderSnapshot {
  status: ProviderStatus;
  sessions: ProviderSessions;
  processes: ProviderProcesses;
  /** Which data path answered: generic route, codex adapter, or none. */
  via: "provider_route" | "codex_adapter" | "none";
}

export const PROCESS_ROLE_LABEL: Record<ProviderProcessRole, string> = {
  bridge: "本桥接",
  "other-bridge": "其他桥接",
  orphan: "孤儿进程",
  desktop: "桌面应用",
  other: "其他",
};

export const NO_PROVIDER_ROUTE = "桥接尚未提供该 provider 的状态接口";

type Got<T> = { data: T | null; status: number | null; error: string | null };

/** API.md: capabilities is an object of booleans ({status:true, sessions:false…}); older drafts used an array. */
function normalizeCapabilities(raw: unknown): ProviderCapability[] {
  const known: ProviderCapability[] = ["status", "sessions", "processes"];
  if (Array.isArray(raw)) return known.filter((k) => raw.includes(k));
  if (raw && typeof raw === "object") return known.filter((k) => (raw as Record<string, unknown>)[k] === true);
  return [];
}

/** Raw GET /bridge/provider/<id>/status body (API.md §1). Provider-specific extras are read selectively, never spread. */
interface RawProviderStatus {
  id?: string;
  available?: boolean;
  reason?: string | null;
  plan?: string | null;
  model?: string | null;
  limits?: ProviderLimit[];
  source?: string | null;
  recorded_at?: string | null;
  note?: string | null;
  age_minutes?: number | null;
  account?: { auth_file?: boolean; auth_mode?: string | null } | null;
  config?: { url_configured?: boolean; auth_configured?: boolean; key_configured?: boolean; auth_mode?: string | null } | null;
}

function limitName(l: ProviderLimit): string {
  const m = l.window_minutes;
  if (typeof m !== "number") return l.name;
  const span = m % 1440 === 0 ? `${m / 1440} 天` : m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`;
  return `${l.name}（${span}窗口）`;
}

/** Only booleans / labels become notes — URLs, keys and header values are never shown. */
function normalizeStatus(id: string, raw: RawProviderStatus): ProviderStatus {
  const notes: string[] = [];
  if (typeof raw.age_minutes === "number") notes.push(`快照约 ${raw.age_minutes} 分钟前记录`);
  if (raw.note) notes.push(raw.note);
  if (raw.account) notes.push(raw.account.auth_file ? `登录文件：已读到${raw.account.auth_mode ? `（${raw.account.auth_mode}）` : ""}` : "登录文件：未找到");
  if (raw.config) {
    notes.push(`回调地址：${raw.config.url_configured ? "已录入" : "未录入"}`);
    const authed = raw.config.auth_configured || raw.config.key_configured;
    notes.push(`鉴权：${authed ? "已录入" : "未录入"}${raw.config.auth_mode ? `（${raw.config.auth_mode}）` : ""}`);
  }
  return {
    id: raw.id || id,
    available: raw.available === true,
    reason: raw.reason ?? null,
    plan: raw.plan ?? null,
    model: raw.model ?? null,
    limits: (raw.limits ?? []).map((l) => ({ ...l, name: limitName(l) })),
    source: raw.source ?? null,
    recorded_at: raw.recorded_at ?? null,
    notes,
  };
}

async function getJson<T>(path: string): Promise<Got<T>> {
  try {
    const r = await fetch(`${BRIDGE_URL}${path}`);
    const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!r.ok) return { data: null, status: r.status, error: j?.error ?? `HTTP ${r.status}` };
    return { data: j, status: r.status, error: j ? null : "响应不是 JSON" };
  } catch (e) {
    return { data: null, status: null, error: (e as Error).message };
  }
}

/** Discovery fallback: one provider per discovered kind; skips templates, skeletons and non-AI proxies. */
function providersFromDiscover(discover: DiscoverReport | null): ProviderInfo[] {
  const out = new Map<string, ProviderInfo>();
  for (const it of discover?.interfaces ?? []) {
    if (!it.found) continue;
    if (it.id.startsWith("_") || /template|skeleton/i.test(it.id)) continue;
    if (it.kind === "proxy" || it.transport === "http-proxy") continue; // a proxy is not an AI provider
    const id = it.kind || it.id;
    if (out.has(id)) continue;
    out.set(id, { id, name: it.display_name || id, kind: it.kind, capabilities: ["status", "sessions", "processes"], origin: "discover" });
  }
  return [...out.values()];
}

export async function loadProviders(discover: DiscoverReport | null): Promise<{ providers: ProviderInfo[]; listSource: string; listNote: string | null }> {
  const r = await getJson<{ providers?: Omit<ProviderInfo, "origin">[] }>("/bridge/providers");
  if (r.data && Array.isArray(r.data.providers)) {
    return {
      providers: r.data.providers.map((p) => ({ ...p, capabilities: normalizeCapabilities(p.capabilities), origin: "bridge_providers" as const })),
      listSource: "GET /bridge/providers",
      listNote: null,
    };
  }
  return {
    providers: providersFromDiscover(discover),
    listSource: "GET /bridge/discover（兜底）",
    listNote: r.status === 404 ? "桥接尚未提供 /bridge/providers，列表改用本机发现结果。" : `读不到 /bridge/providers（${r.error ?? "未知错误"}），列表改用本机发现结果。`,
  };
}

function windowName(w: CodexRateWindow | null | undefined, fallback: string): string {
  const m = w?.window_minutes;
  if (typeof m !== "number") return fallback;
  if (m % 1440 === 0) return `${m / 1440} 天窗口`;
  if (m % 60 === 0) return `${m / 60} 小时窗口`;
  return `${m} 分钟窗口`;
}

const CODEX_OWNER_ROLE: Record<string, ProviderProcessRole> = {
  this_bridge: "bridge",
  other_bridge: "other-bridge",
  orphan_exec: "orphan",
  exec_other_parent: "other",
  other: "other",
};

/** Codex-only adapter: map live /bridge/codex/* into the normalized shapes. */
async function loadCodexViaAdapter(id: string): Promise<ProviderSnapshot> {
  const [s, se, p] = await Promise.all([fetchCodexStatus(), fetchCodexSessions(10), fetchCodexProcesses()]);
  const rl = s.data?.rate_limits ?? null;
  const acc = s.data?.account ?? null;
  const counter = s.data?.bridge_counter ?? null;
  const notes: string[] = [];
  if (acc) notes.push(acc.auth_file ? `登录文件：已读到${acc.auth_mode ? `（${acc.auth_mode}）` : ""}` : "登录文件：未找到");
  if (counter) notes.push(`桥接派发计数 ${counter.used ?? "?"}/${counter.max ?? "?"}（${counter.note}）`);
  if (rl?.ok && rl.note) notes.push(rl.note);
  const status: ProviderStatus = s.data
    ? {
        id,
        available: true,
        reason: rl && !rl.ok ? `额度读不到：${rl.error ?? "无此信息"}` : null,
        plan: rl?.plan_type ?? null,
        model: null,
        limits: rl?.ok
          ? [
              ...(rl.primary ? [{ name: windowName(rl.primary, "主窗口"), used_percent: rl.primary.used_percent, resets_at: rl.primary.resets_at }] : []),
              ...(rl.secondary ? [{ name: windowName(rl.secondary, "次窗口"), used_percent: rl.secondary.used_percent, resets_at: rl.secondary.resets_at }] : []),
            ]
          : [],
        source: rl?.source ?? "GET /bridge/codex/status",
        recorded_at: rl?.observed_at ?? null,
        notes,
      }
    : { id, available: false, reason: s.error ?? NO_PROVIDER_ROUTE, limits: [] };
  const sessions: ProviderSessions = se.data
    ? {
        available: true,
        total: se.data.total,
        items: se.data.sessions.map((x) => ({
          session_id: x.id ?? "",
          title: x.title,
          updated_at: x.updated_at,
          link: x.thread_url,
          dispatch_id: x.dispatch?.id ?? null,
        })),
      }
    : { available: false, reason: se.error ?? NO_PROVIDER_ROUTE, items: [] };
  const processes: ProviderProcesses = p.data && p.data.ok !== false
    ? {
        available: true,
        items: p.data.processes.map((x) => ({
          pid: x.pid,
          name: x.exec ? "codex.exe exec" : "codex.exe",
          role: CODEX_OWNER_ROLE[x.owner] ?? "other",
          started_at: x.created,
        })),
        note: p.data.note ?? null,
      }
    : { available: false, reason: p.error ?? NO_PROVIDER_ROUTE, items: [] };
  return { status, sessions, processes, via: "codex_adapter" };
}

function unavailable(id: string, reason: string): ProviderSnapshot {
  return {
    status: { id, available: false, reason, limits: [] },
    sessions: { available: false, reason, items: [] },
    processes: { available: false, reason, items: [] },
    via: "none",
  };
}

export async function loadProviderSnapshot(provider: ProviderInfo): Promise<ProviderSnapshot> {
  const base = `/bridge/provider/${encodeURIComponent(provider.id)}`;
  const st = await getJson<RawProviderStatus>(`${base}/status`);
  if (st.data) {
    const [se, pr] = await Promise.all([
      getJson<ProviderSessions>(`${base}/sessions?limit=10&offset=0`),
      getJson<ProviderProcesses>(`${base}/processes`),
    ]);
    return {
      status: normalizeStatus(provider.id, st.data),
      sessions: se.data ? { ...se.data, items: se.data.items ?? [] } : { available: false, reason: se.error ?? NO_PROVIDER_ROUTE, items: [] },
      processes: pr.data ? { ...pr.data, items: pr.data.items ?? [] } : { available: false, reason: pr.error ?? NO_PROVIDER_ROUTE, items: [] },
      via: "provider_route",
    };
  }
  // The only vendor-specific branch: an adapter over routes that already exist for codex.
  if (provider.id === "codex" || provider.kind === "codex") return loadCodexViaAdapter(provider.id);
  return unavailable(provider.id, st.status === 404 || st.status === null ? NO_PROVIDER_ROUTE : st.error ?? NO_PROVIDER_ROUTE);
}
