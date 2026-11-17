import { interfaceGuidance } from "./interfaceGuidance";
/**
 * One-click reachability / catalog probe for the channels page.
 * Uses existing discover + POST /bridge/scan/probe. Never treats a successful
 * probe or model list as chat_bridge=ok or tool_verify=verified.
 */

import { useCallback, useRef, useState } from "react";
import { BRIDGE_URL, type BridgeHealth, type BridgeView, type DiscoverReport, type DiscoveredInterface } from "./bridge";
import {
  bundledExampleCatalog,
  fetchScannerCatalog,
  isLiveCatalogEntry,
  postScanProbe,
  type ActionResult,
  type ScannerCatalogItem,
} from "./scannerBoard";
import type { DiscoveryRecord } from "./scanners/types";
import { CHANNEL_PROBE } from "./copy";
import type { ExternalChannel } from "./types";

export const PROBE_CONCURRENCY = 3;

const KIND_TO_SCANNER: Record<string, string> = {
  workbuddy: "workbuddy",
  codex: "codex",
  doubao: "doubao",
  ollama: "ollama",
};

export type CatalogProbeStatus = "ok" | "fail" | "na";

export interface LiveProbeRow {
  key: string;
  scanner_id: string | null;
  endpoint?: string | null;
  display_name: string;
  kind: string | null;
  origin: "scanner-probe" | "discover-only";
  found: boolean | null;
  listening: boolean | null;
  catalog: CatalogProbeStatus;
  catalog_note: string | null;
  auth_missing: boolean;
  auth_status: string | null;
  auth_ref: string | null;
  error: string | null;
  model_count: number;
  health_http: number | null;
  discovery_status: string | null;
  wired: boolean;
}

export interface WorkbuddyModelsFact {
  attempted: boolean;
  ok: boolean;
  count: number;
  current: string | null;
  error: string | null;
}

export interface ChannelProbeReport {
  ran_at: string;
  discover_error: string | null;
  health_error: string | null;
  offline: boolean;
  missing_route: boolean;
  rows: LiveProbeRow[];
  health_notes: string[];
  workbuddy_models: WorkbuddyModelsFact;
}

export interface ChannelProbeView {
  busy: boolean;
  phase: "idle" | "discover" | "probe" | "health" | "done" | "blocked";
  progress: { done: number; total: number };
  message: string | null;
  wired: boolean | null;
  report: ChannelProbeReport | null;
  run: () => Promise<void>;
}

export function mapDiscoverToScannerId(iface: { id?: string | null; kind?: string | null }): string | null {
  const kind = (iface.kind ?? "").trim().toLowerCase();
  if (KIND_TO_SCANNER[kind]) return KIND_TO_SCANNER[kind];
  const id = (iface.id ?? "").trim().toLowerCase();
  if (KIND_TO_SCANNER[id]) return KIND_TO_SCANNER[id];
  for (const key of Object.keys(KIND_TO_SCANNER)) {
    if (id === key || id.startsWith(`${key}-`)) return KIND_TO_SCANNER[key];
  }
  return null;
}

export function collectProbeTargets(
  catalog: ScannerCatalogItem[],
  discover: DiscoverReport | null,
): { scanner_id: string; display_name: string }[] {
  const targets: { scanner_id: string; display_name: string }[] = [];
  const seen = new Set<string>();
  for (const entry of catalog.filter(isLiveCatalogEntry)) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    targets.push({ scanner_id: entry.id, display_name: entry.display_name });
  }
  for (const iface of discover?.interfaces ?? []) {
    const scannerId = mapDiscoverToScannerId(iface);
    if (!scannerId || seen.has(scannerId)) continue;
    seen.add(scannerId);
    targets.push({ scanner_id: scannerId, display_name: iface.display_name });
  }
  return targets;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const total = items.length;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
      done += 1;
      onProgress?.(done, total);
    }
  }
  const n = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: items.length ? n : 0 }, () => worker()));
  return results;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function fetchDiscoverSnapshot(): Promise<{ report: DiscoverReport | null; error: string | null }> {
  try {
    const response = await fetch(`${BRIDGE_URL}/bridge/discover`);
    if (!response.ok) {
      return { report: null, error: `发现结果 HTTP ${response.status}` };
    }
    const raw = (await readJson(response)) as DiscoverReport | null;
    if (!raw || !Array.isArray(raw.interfaces)) {
      return { report: null, error: "发现结果格式无法解读" };
    }
    return { report: raw, error: null };
  } catch (error) {
    return { report: null, error: `读取发现结果失败：${(error as Error).message}` };
  }
}

export async function fetchHealthSnapshot(): Promise<{ health: BridgeHealth | null; error: string | null }> {
  try {
    const response = await fetch(`${BRIDGE_URL}/bridge/health`);
    if (!response.ok) {
      return { health: null, error: `健康检查 HTTP ${response.status}` };
    }
    const raw = (await readJson(response)) as BridgeHealth | null;
    return { health: raw ?? null, error: raw ? null : "健康检查无内容" };
  } catch (error) {
    return { health: null, error: `读取 /bridge/health 失败：${(error as Error).message}` };
  }
}

export async function fetchWorkbuddyModelsSnapshot(): Promise<WorkbuddyModelsFact> {
  try {
    const response = await fetch(`${BRIDGE_URL}/bridge/models?executor=${encodeURIComponent("workbuddy")}`);
    const raw = (await readJson(response)) as {
      ok?: boolean;
      models?: { value?: string; name?: string }[];
      current?: string | null;
      error?: string;
    } | null;
    const models = Array.isArray(raw?.models) ? raw.models : [];
    if (!response.ok) {
      return {
        attempted: true,
        ok: false,
        count: 0,
        current: null,
        error: raw?.error ?? `HTTP ${response.status}`,
      };
    }
    return {
      attempted: true,
      ok: raw?.ok === true,
      count: models.length,
      current: typeof raw?.current === "string" ? raw.current : null,
      error: raw?.ok === true ? null : (raw?.error ?? "目录未返回"),
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      count: 0,
      current: null,
      error: `读取 /bridge/models 失败：${(error as Error).message}`,
    };
  }
}

function discoverForScanner(discover: DiscoverReport | null, scannerId: string): DiscoveredInterface | undefined {
  return discover?.interfaces.find((iface) => mapDiscoverToScannerId(iface) === scannerId);
}

function listeningFromRecord(record: DiscoveryRecord | null, iface?: DiscoveredInterface): boolean | null {
  if (iface && typeof iface.listening === "boolean") return iface.listening;
  if (!record) return null;
  if ((record.evidence.open_ports?.length ?? 0) > 0) return true;
  if (record.status === "reachable") return true;
  return null;
}

function foundFromRecord(record: DiscoveryRecord | null, iface?: DiscoveredInterface): boolean | null {
  if (iface && typeof iface.found === "boolean") return iface.found;
  if (!record) return null;
  return record.status !== "not_found";
}

export function rowFromProbeResult(
  scannerId: string,
  displayName: string,
  result: ActionResult,
  discover: DiscoverReport | null,
): LiveProbeRow {
  const iface = discoverForScanner(discover, scannerId);
  const record = result.record ?? null;
  const authMissing =
    record?.status === "needs_secret" ||
    record?.auth.needs_user_secret === true ||
    iface?.auth_needed === true;
  const probe = record?.evidence.probe;
  const catalogInfo = record?.evidence.model_catalog;
  let catalog: CatalogProbeStatus = "na";
  let catalogNote: string | null = null;
  if (probe?.ok === true || catalogInfo?.ok === true) {
    catalog = "ok";
    catalogNote = probe?.note ?? catalogInfo?.note ?? catalogInfo?.path ?? "目录或版本探测有应答";
  } else if (probe?.ok === false || catalogInfo?.ok === false) {
    catalog = "fail";
    catalogNote = probe?.note ?? catalogInfo?.note ?? "目录或版本探测未通过";
  } else if (record) {
    catalogNote = "未返回目录或版本探测证据";
  }

  const modelCount = record?.evidence.model_names?.length ?? 0;
  const base: LiveProbeRow = {
    endpoint: iface?.endpoint ?? iface?.cli_path ?? iface?.exe_path ?? null,
    key: scannerId,
    scanner_id: scannerId,
    display_name: record?.display_name ?? iface?.display_name ?? displayName,
    kind: iface?.kind ?? scannerId,
    origin: "scanner-probe",
    found: foundFromRecord(record, iface),
    listening: listeningFromRecord(record, iface),
    catalog,
    catalog_note: catalogNote,
    auth_missing: authMissing,
    auth_status: iface?.auth_status ?? null,
    auth_ref: record?.auth.auth_ref ?? iface?.auth_ref ?? null,
    error: result.error ?? null,
    model_count: modelCount,
    health_http: iface?.health_http ?? null,
    discovery_status: record?.status ?? null,
    wired: result.wired,
  };

  if (!result.wired) {
    return { ...base, catalog: "na", catalog_note: null, found: iface?.found ?? null, listening: iface?.listening ?? null };
  }
  if (!result.ok) {
    return { ...base, catalog: "fail", error: result.error ?? "探测失败" };
  }
  if (!record) {
    return {
      ...base,
      catalog: "na",
      catalog_note: "扫描器未返回记录",
      found: iface?.found ?? false,
      listening: iface?.listening ?? false,
    };
  }
  return { ...base, error: null };
}

export function rowFromDiscoverOnly(iface: DiscoveredInterface): LiveProbeRow {
  return {
    endpoint: iface.endpoint ?? iface.cli_path ?? iface.exe_path ?? null,
    key: iface.id,
    scanner_id: null,
    display_name: iface.display_name,
    kind: iface.kind,
    origin: "discover-only",
    found: iface.found,
    listening: iface.listening,
    catalog: "na",
    catalog_note: `缺少什么：${interfaceGuidance(iface).missing}。你需要做：${interfaceGuidance(iface).user}。项目需要补充：${interfaceGuidance(iface).development}`,
    auth_missing: iface.auth_needed === true,
    auth_status: iface.auth_status,
    auth_ref: iface.auth_ref ?? null,
    error: null,
    model_count: 0,
    health_http: iface.health_http ?? null,
    discovery_status: null,
    wired: true,
  };
}

export function healthNotes(health: BridgeHealth | null): string[] {
  if (!health) return [];
  const notes: string[] = [];
  const workbuddy = health.workbuddy;
  if (workbuddy?.public_gateway === false && workbuddy.desktop_detected) notes.push("WorkBuddy：桌面客户端已发现；未识别公开 Gateway，不需要填写 WB_TOKEN。实时目录和任务回读尚未验证。");
  else if (workbuddy) {
    const parts = [
      workbuddy.health != null ? `健康检查 HTTP ${workbuddy.health}` : "未读到健康检查",
      workbuddy.token ? "token 已就位" : "token 未就位",
      workbuddy.acp_ok === true ? "ACP 通道可用" : workbuddy.acp_ok === false ? "ACP 通道不可用" : null,
      workbuddy.error ? workbuddy.error : null,
    ].filter(Boolean);
    notes.push(`WorkBuddy：${parts.join("，")}（仅健康检查，不是 chat_bridge=ok）`);
  }
  const codex = health.codex;
  if (codex) {
    const parts = [
      codex.cli ? "已找到 CLI" : "未找到 CLI",
      codex.proxy_up ? "代理在听" : "代理未启动",
      typeof codex.used === "number" && typeof codex.max === "number" ? `额度 ${codex.used}/${codex.max}` : null,
    ].filter(Boolean);
    notes.push(`Codex：${parts.join("，")}（不是工具核实）`);
  }
  const doubao = health.doubao;
  if (doubao) {
    const parts = [
      doubao.cdp ? "已发现 CDP" : "未发现 CDP",
      doubao.bridge_cli ? "已找到 bridge CLI" : "未找到 bridge CLI",
    ];
    notes.push(`豆包：${parts.join("，")}（发现不等于已连通）`);
  }
  for (const item of health.openai_compatible ?? []) {
    const parts = [
      item.endpoint ?? item.id,
      item.listening ? "端口在听" : "未在听",
      item.auth_needed ? "需要填写密钥" : item.auth_status ?? null,
    ].filter(Boolean);
    notes.push(`OpenAI 兼容：${parts.join("，")}（目录或端口应答不是对话核实）`);
  }
  return notes;
}

export function matchProbeRow(channel: ExternalChannel, rows: LiveProbeRow[]): LiveProbeRow | undefined {
  const kind = (channel.kind ?? "").trim().toLowerCase();
  const id = (channel.id ?? "").trim().toLowerCase();
  const mapped = mapDiscoverToScannerId({ id: channel.id, kind: channel.kind });
  // A manually registered endpoint must never borrow another instance's evidence.
  if (channel.source === "registered" && channel.endpoint?.trim()) {
    const normalize = (value: string) => {
      try { return new URL(value).href.replace(/\/$/, ""); }
      catch { return value.trim().replace(/\\/g, "/").toLowerCase(); }
    };
    const endpoint = normalize(channel.endpoint);
    rows = rows.filter(row => row.endpoint && normalize(row.endpoint) === endpoint);
  }
  return (
    rows.find((row) => row.scanner_id && (row.scanner_id === mapped || row.scanner_id === kind || row.scanner_id === id)) ??
    rows.find((row) => row.kind && (row.kind === kind || row.kind === mapped)) ??
    rows.find((row) => row.key === id)
  );
}

async function loadCatalog(): Promise<ScannerCatalogItem[]> {
  const result = await fetchScannerCatalog();
  if (result.availability === "ok" && result.scanners.length) return result.scanners;
  return bundledExampleCatalog();
}

export function useChannelProbe(bridge?: BridgeView): ChannelProbeView {
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ChannelProbeView["phase"]>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [wired, setWired] = useState<boolean | null>(null);
  const [report, setReport] = useState<ChannelProbeReport | null>(null);
  const generation = useRef(0);
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

  const run = useCallback(async () => {
    const current = bridgeRef.current;
    if (!current?.online) {
      setPhase("blocked");
      setBusy(false);
      setWired(null);
      setMessage(CHANNEL_PROBE.offline);
      setReport({
        ran_at: new Date().toISOString(),
        discover_error: null,
        health_error: null,
        offline: true,
        missing_route: false,
        rows: [],
        health_notes: [],
        workbuddy_models: { attempted: false, ok: false, count: 0, current: null, error: null },
      });
      return;
    }

    const token = ++generation.current;
    setBusy(true);
    setPhase("discover");
    setProgress({ done: 0, total: 0 });
    setMessage(CHANNEL_PROBE.refreshing);

    const discoverError = await current.refreshDiscover();
    if (token !== generation.current) return;
    const snapshot = await fetchDiscoverSnapshot();
    if (token !== generation.current) return;
    const discover = snapshot.report ?? current.discover;
    const combinedDiscoverError = discoverError || snapshot.error;

    setPhase("probe");
    const catalog = await loadCatalog();
    if (token !== generation.current) return;
    const targets = collectProbeTargets(catalog, discover);
    setProgress({ done: 0, total: targets.length });
    setMessage(targets.length ? CHANNEL_PROBE.probingProgress(0, targets.length).zh : CHANNEL_PROBE.noTargets);

    let missingRoute = false;
    let wentOffline = false;
    const probeResults = await mapPool(
      targets,
      PROBE_CONCURRENCY,
      async (target) => {
        if (missingRoute || wentOffline) {
          return {
            target,
            result: {
              ok: false,
              wired: false,
              error: missingRoute ? "桥接尚未提供 POST /bridge/scan/probe" : "本机桥接未接通",
            } satisfies ActionResult,
          };
        }
        const result = await postScanProbe(target.scanner_id, false);
        if (!result.wired) {
          if ((result.error ?? "").includes("尚未提供")) missingRoute = true;
          else wentOffline = true;
        }
        return { target, result };
      },
      (done, total) => {
        if (token !== generation.current) return;
        setProgress({ done, total });
        setMessage(CHANNEL_PROBE.probingProgress(done, total).zh);
      },
    );
    if (token !== generation.current) return;

    if (missingRoute) setWired(false);
    else if (wentOffline) setWired(false);
    else if (targets.length > 0) setWired(true);

    const rows: LiveProbeRow[] = probeResults.map(({ target, result }) =>
      rowFromProbeResult(target.scanner_id, target.display_name, result, discover),
    );
    const probed = new Set(rows.map((row) => row.scanner_id).filter(Boolean));
    for (const iface of discover?.interfaces ?? []) {
      if (iface.kind === "proxy") continue;
      const mapped = mapDiscoverToScannerId(iface);
      if (mapped && probed.has(mapped)) continue;
      rows.push(rowFromDiscoverOnly(iface));
    }

    setPhase("health");
    setMessage(CHANNEL_PROBE.healthTitle + "…");
    const healthSnap = await fetchHealthSnapshot();
    if (token !== generation.current) return;
    const wantsWorkbuddy = rows.some((row) => row.scanner_id === "workbuddy" || row.kind === "workbuddy");
    const workbuddyModels = wantsWorkbuddy && healthSnap.health?.workbuddy?.public_gateway === true
      ? await fetchWorkbuddyModelsSnapshot()
      : { attempted: false, ok: false, count: 0, current: null, error: null };
    if (token !== generation.current) return;

    const nextReport: ChannelProbeReport = {
      ran_at: new Date().toISOString(),
      discover_error: combinedDiscoverError,
      health_error: healthSnap.error,
      offline: wentOffline && !missingRoute,
      missing_route: missingRoute,
      rows,
      health_notes: healthNotes(healthSnap.health),
      workbuddy_models: workbuddyModels,
    };
    setReport(nextReport);
    setPhase("done");
    setBusy(false);
    if (missingRoute) {
      setMessage(CHANNEL_PROBE.missingRoute + " 发现与健康检查仍会列出，但不把它们当成探测成功。");
    } else if (wentOffline) {
      setMessage(CHANNEL_PROBE.offlineDropped);
    } else if (combinedDiscoverError && !targets.length) {
      setMessage(combinedDiscoverError);
    } else {
      setMessage(targets.length ? CHANNEL_PROBE.done : CHANNEL_PROBE.noTargets);
    }
  }, []);

  return { busy, phase, progress, message, wired, report, run };
}
