import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRIDGE_URL } from "./bridge";
import type {
  AuthMode,
  DiscoveryRecord,
  DiscoveryStatus,
  ScannerCatalogEntry,
  ScannerRegistry,
} from "./scanners/types";
import bundledRegistry from "./scanners/registry.json";
import bundledExample from "./scanners/scanners.example.json";

/** How the last catalog/scan request went. Example is never treated as a live machine scan. */
export type ScannerAvailability = "idle" | "ok" | "missing_route" | "offline" | "error" | "example";

export type InterfaceUiStatus =
  | "discovered"
  | "missing_key"
  | "not_found"
  | "registered_unverified";

export const INTERFACE_STATUS_LABEL: Record<
  InterfaceUiStatus,
  { text: string; tone: "info" | "warn" | "unverified" | "neutral"; code: string }
> = {
  discovered: { text: "已发现", tone: "info", code: "discovered" },
  missing_key: { text: "缺密钥", tone: "warn", code: "missing_key" },
  not_found: { text: "未找到", tone: "unverified", code: "not_found" },
  registered_unverified: { text: "已登记未验证", tone: "neutral", code: "registered_unverified" },
};

export const SESSION_PENDING_SENTENCE = "已有会话，待实机核实后再派发";

export interface ScannerCatalogItem {
  id: string;
  display_name: string;
  module?: string;
  status?: ScannerCatalogEntry["status"];
  notes?: string | null;
  auth_mode?: AuthMode | string | null;
  auth_ref?: string | null;
  transport?: string | null;
  adapter?: string | null;
}

export interface InterfaceRow {
  scanner_id: string;
  display_name: string;
  catalog: ScannerCatalogItem;
  record: DiscoveryRecord | null;
  uiStatus: InterfaceUiStatus;
  sessionPendingVerify: boolean;
  registered: boolean;
  source: "live" | "example";
}

export interface ScannerSummary {
  availability: ScannerAvailability;
  discovered: number;
  missing_key: number;
  not_found: number;
  registered_unverified: number;
  total: number;
  scanned: boolean;
  example: boolean;
}

export interface SaveSecretResult {
  ok: boolean;
  auth_ref: string | null;
  auth_status?: string | null;
  error?: string;
}

export interface ActionResult {
  ok: boolean;
  wired: boolean;
  error?: string;
  record?: DiscoveryRecord | null;
  draft?: PromoteDraft | null;
}

export interface PromoteDraft {
  scanner_id: string;
  display_name: string;
  auth_ref: string | null;
  endpoint?: string | null;
  base_url?: string | null;
  adapter?: string | null;
}

const REGISTRATIONS_KEY = "operator-board-scanner-registrations";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_LIKE = /^(sk-|sk-ant-|ghp_|github_pat_|xox[baprs]-|Bearer\s)/i;

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asEnvName(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  if (raw.length > 80 || /\s/.test(raw)) return null;
  if (SECRET_LIKE.test(raw)) return null;
  if (!ENV_NAME.test(raw)) return null;
  return raw;
}

function redactSecret(message: string, secret: string): string {
  if (!secret) return message;
  return message.includes(secret) ? message.split(secret).join("***") : message;
}

function looksLikeSecretValue(value: unknown): boolean {
  return typeof value === "string" && SECRET_LIKE.test(value.trim());
}

function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripSecrets(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (looksLikeSecretValue(entry)) continue;
      if ((key === "auth_ref" || key === "api_key_env") && typeof entry === "string") {
        out[key] = asEnvName(entry);
        continue;
      }
      if (/^(secret|api_key|token|password|authorization|access_token)$/i.test(key)) continue;
      out[key] = stripSecrets(entry);
    }
    return out as T;
  }
  return value;
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

function availabilityForStatus(status: number): ScannerAvailability {
  if (status === 404 || status === 501) return "missing_route";
  return "error";
}

export function isLiveCatalogEntry(entry: { id?: string; status?: string | null }): boolean {
  if (!entry.id || entry.id === "_template") return false;
  if (entry.status === "skeleton") return false;
  return true;
}

function normalizeCatalogItem(raw: unknown): ScannerCatalogItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = stripSecrets(raw as Record<string, unknown>);
  const id = asString(o.id);
  if (!id) return null;
  return {
    id,
    display_name: asString(o.display_name) ?? id,
    module: asString(o.module) ?? undefined,
    status: (asString(o.status) as ScannerCatalogEntry["status"]) ?? undefined,
    notes: asString(o.notes),
    auth_mode: (asString(o.auth_mode) as AuthMode | null) ?? null,
    auth_ref: asEnvName(o.auth_ref) ?? asEnvName(o.api_key_env),
    transport: asString(o.transport),
    adapter: asString(o.adapter),
  };
}

function asAuthMode(value: unknown): AuthMode {
  const s = asString(value);
  if (s === "none" || s === "user_secret" || s === "running_session") return s;
  return "none";
}

function asDiscoveryStatus(value: unknown): DiscoveryStatus {
  const s = asString(value);
  if (s === "not_found" || s === "found" || s === "reachable" || s === "needs_secret" || s === "session_available") {
    return s;
  }
  return "not_found";
}

export function normalizeDiscoveryRecord(raw: unknown): DiscoveryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = stripSecrets(raw as Record<string, unknown>);
  const scanner_id = asString(o.scanner_id) ?? asString(o.id);
  if (!scanner_id) return null;
  const evidence = (o.evidence && typeof o.evidence === "object" ? o.evidence : {}) as DiscoveryRecord["evidence"];
  const endpoint = (o.endpoint && typeof o.endpoint === "object" ? o.endpoint : undefined) as DiscoveryRecord["endpoint"];
  const authRaw = (o.auth && typeof o.auth === "object" ? o.auth : {}) as Record<string, unknown>;
  return {
    scanner_id,
    display_name: asString(o.display_name) ?? scanner_id,
    status: asDiscoveryStatus(o.status),
    evidence: {
      process_names: Array.isArray(evidence.process_names) ? evidence.process_names.filter((x) => typeof x === "string") : undefined,
      path_hits: Array.isArray(evidence.path_hits) ? evidence.path_hits.filter((x) => typeof x === "string") : undefined,
      install_dirs: Array.isArray(evidence.install_dirs) ? evidence.install_dirs.filter((x) => typeof x === "string") : undefined,
      open_ports: Array.isArray(evidence.open_ports)
        ? evidence.open_ports.filter((p) => p && typeof p === "object")
        : undefined,
      probe: evidence.probe,
      session_present: evidence.session_present === true,
      model_names: Array.isArray(evidence.model_names) ? evidence.model_names.filter((x) => typeof x === "string") : undefined,
      current_model: typeof evidence.current_model === "string" ? evidence.current_model : undefined,
      model_catalog: evidence.model_catalog && typeof evidence.model_catalog === "object" ? evidence.model_catalog : undefined,
    },
    endpoint,
    auth: {
      mode: asAuthMode(authRaw.mode),
      auth_ref: asEnvName(authRaw.auth_ref) ?? asEnvName(authRaw.api_key_env),
      session_present: authRaw.session_present === true,
      needs_user_secret: authRaw.needs_user_secret === true,
    },
    tools_verified: false,
    chat_bridge: "unverified",
    notes: asString(o.notes) ?? undefined,
  };
}

export function bundledExampleCatalog(): ScannerCatalogItem[] {
  const registry = bundledRegistry as ScannerRegistry;
  return (registry.scanners ?? []).map(normalizeCatalogItem).filter((x): x is ScannerCatalogItem => !!x);
}

export function bundledExampleRecords(): DiscoveryRecord[] {
  const raw = bundledExample as { records?: unknown[] };
  return (raw.records ?? []).map(normalizeDiscoveryRecord).filter((x): x is DiscoveryRecord => !!x);
}

export function loadLocalRegistrations(): Record<string, PromoteDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(REGISTRATIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PromoteDraft>;
    if (!parsed || typeof parsed !== "object") return {};
    const clean: Record<string, PromoteDraft> = {};
    for (const [id, draft] of Object.entries(parsed)) {
      if (!draft || typeof draft !== "object") continue;
      clean[id] = {
        scanner_id: id,
        display_name: asString(draft.display_name) ?? id,
        auth_ref: asEnvName(draft.auth_ref),
        endpoint: asString(draft.endpoint),
        base_url: asString(draft.base_url),
        adapter: asString(draft.adapter),
      };
    }
    return clean;
  } catch {
    return {};
  }
}

export function persistLocalRegistrations(next: Record<string, PromoteDraft>): void {
  try {
    localStorage.setItem(REGISTRATIONS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

function sessionPresent(record: DiscoveryRecord | null): boolean {
  if (!record) return false;
  return (
    record.status === "session_available" ||
    record.auth.session_present === true ||
    record.auth.mode === "running_session" && record.evidence.session_present === true ||
    record.evidence.session_present === true
  );
}

function needsSecret(record: DiscoveryRecord | null, catalog: ScannerCatalogItem): boolean {
  if (record?.status === "needs_secret") return true;
  if (record?.auth.mode === "user_secret" && record.auth.needs_user_secret === true) return true;
  if (!record && catalog.auth_mode === "user_secret") return false;
  return false;
}

/**
 * Map a catalog entry + optional DiscoveryRecord + registration into the four UI labels.
 * 缺密钥 wins over 已发现. session_available stays 已发现 plus the pending-verify sentence.
 */
export function mapInterfaceStatus(
  record: DiscoveryRecord | null,
  registered: boolean,
  catalog: ScannerCatalogItem,
): { uiStatus: InterfaceUiStatus; sessionPendingVerify: boolean } {
  const pending = sessionPresent(record);
  if (needsSecret(record, catalog)) {
    return { uiStatus: "missing_key", sessionPendingVerify: pending };
  }
  if (record?.status === "session_available") {
    return { uiStatus: "discovered", sessionPendingVerify: true };
  }
  if (record?.status === "found" || record?.status === "reachable") {
    return { uiStatus: "discovered", sessionPendingVerify: pending };
  }
  if (registered) {
    return { uiStatus: "registered_unverified", sessionPendingVerify: pending };
  }
  return { uiStatus: "not_found", sessionPendingVerify: pending };
}

export function mergeInterfaceRows(
  catalog: ScannerCatalogItem[],
  records: DiscoveryRecord[],
  registeredIds: Set<string>,
  source: "live" | "example",
): InterfaceRow[] {
  const byId = new Map<string, DiscoveryRecord>();
  for (const record of records) byId.set(record.scanner_id, record);
  return catalog.filter(isLiveCatalogEntry).map((entry) => {
    const record = byId.get(entry.id) ?? null;
    const registered = registeredIds.has(entry.id);
    const mapped = mapInterfaceStatus(record, registered, entry);
    return {
      scanner_id: entry.id,
      display_name: record?.display_name ?? entry.display_name,
      catalog: entry,
      record,
      uiStatus: mapped.uiStatus,
      sessionPendingVerify: mapped.sessionPendingVerify,
      registered,
      source,
    };
  });
}

export function summarizeRows(rows: InterfaceRow[], availability: ScannerAvailability, scanned: boolean): ScannerSummary {
  return {
    availability,
    discovered: rows.filter((r) => r.uiStatus === "discovered").length,
    missing_key: rows.filter((r) => r.uiStatus === "missing_key").length,
    not_found: rows.filter((r) => r.uiStatus === "not_found").length,
    registered_unverified: rows.filter((r) => r.uiStatus === "registered_unverified").length,
    total: rows.length,
    scanned,
    example: availability === "example",
  };
}

export async function fetchScannerCatalog(): Promise<{
  availability: ScannerAvailability;
  scanners: ScannerCatalogItem[];
  error: string | null;
}> {
  try {
    const response = await fetch(`${BRIDGE_URL}/bridge/scanners`);
    if (!response.ok) {
      return {
        availability: availabilityForStatus(response.status),
        scanners: [],
        error:
          response.status === 404 || response.status === 501
            ? "本机桥接尚未提供 /bridge/scanners"
            : `目录请求失败（HTTP ${response.status}）`,
      };
    }
    const raw = await readJson(response);
    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const list = Array.isArray(body?.scanners) ? body.scanners : [];
    const scanners = list.map(normalizeCatalogItem).filter((x): x is ScannerCatalogItem => !!x);
    return { availability: "ok", scanners, error: null };
  } catch {
    return { availability: "offline", scanners: [], error: "本机桥接未接通" };
  }
}

export async function postScan(): Promise<{
  availability: ScannerAvailability;
  records: DiscoveryRecord[];
  error: string | null;
}> {
  try {
    const response = await fetch(`${BRIDGE_URL}/bridge/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ live: false }),
    });
    if (!response.ok) {
      return {
        availability: availabilityForStatus(response.status),
        records: [],
        error:
          response.status === 404 || response.status === 501
            ? "本机桥接尚未提供 /bridge/scan"
            : `扫描请求失败（HTTP ${response.status}）`,
      };
    }
    const raw = stripSecrets(await readJson(response));
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).records)
        ? ((raw as Record<string, unknown>).records as unknown[])
        : [];
    const records = list.map(normalizeDiscoveryRecord).filter((x): x is DiscoveryRecord => !!x);
    return { availability: "ok", records, error: null };
  } catch {
    return { availability: "offline", records: [], error: "本机桥接未接通" };
  }
}

async function postScanAction(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; raw: unknown; offline: boolean }> {
  try {
    const response = await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, raw: stripSecrets(await readJson(response)), offline: false };
  } catch {
    return { status: 0, raw: null, offline: true };
  }
}

export async function postScanProbe(scannerId: string, live: boolean): Promise<ActionResult> {
  const { status, raw, offline } = await postScanAction("/bridge/scan/probe", {
    scanner_id: scannerId,
    live,
  });
  if (offline) return { ok: false, wired: false, error: "本机桥接未接通" };
  if (status === 404 || status === 501) {
    return { ok: false, wired: false, error: "桥接尚未提供 POST /bridge/scan/probe" };
  }
  if (status < 200 || status >= 300) {
    const err = raw && typeof raw === "object" && typeof (raw as { error?: unknown }).error === "string"
      ? (raw as { error: string }).error
      : `HTTP ${status}`;
    return { ok: false, wired: true, error: err };
  }
  const record = recordFromProbeBody(raw, scannerId);
  return { ok: true, wired: true, record };
}

/** The bridge returns `{ records, scanned_at, probe: true }`; also accept a bare record. */
function recordFromProbeBody(raw: unknown, scannerId: string): DiscoveryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as { record?: unknown; records?: unknown };
  const direct = normalizeDiscoveryRecord(raw) ?? normalizeDiscoveryRecord(body.record);
  if (direct) return direct;
  const list = Array.isArray(body.records) ? body.records : [];
  const records = list.map(normalizeDiscoveryRecord).filter((item): item is DiscoveryRecord => !!item);
  return records.find((item) => item.scanner_id === scannerId) ?? records[0] ?? null;
}

export async function postScanPromote(scannerId: string): Promise<ActionResult> {
  const { status, raw, offline } = await postScanAction("/bridge/scan/promote", {
    scanner_id: scannerId,
    confirmed: true,
  });
  if (offline) return { ok: false, wired: false, error: "本机桥接未接通" };
  if (status === 404 || status === 501) {
    return { ok: false, wired: false, error: "桥接尚未提供 POST /bridge/scan/promote" };
  }
  if (status < 200 || status >= 300) {
    const err = raw && typeof raw === "object" && typeof (raw as { error?: unknown }).error === "string"
      ? (raw as { error: string }).error
      : `HTTP ${status}`;
    return { ok: false, wired: true, error: err };
  }
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const draftSrc = (o.draft && typeof o.draft === "object" ? o.draft : o) as Record<string, unknown>;
  const draft: PromoteDraft = {
    scanner_id: asString(draftSrc.scanner_id) ?? scannerId,
    display_name: asString(draftSrc.display_name) ?? scannerId,
    auth_ref: asEnvName(draftSrc.auth_ref) ?? asEnvName(draftSrc.api_key_env),
    endpoint: asString(draftSrc.endpoint),
    base_url: asString(draftSrc.base_url) ?? asString((draftSrc.endpoint as { base_url?: unknown } | undefined)?.base_url),
    adapter: asString(draftSrc.adapter),
  };
  return { ok: true, wired: true, draft };
}

export async function saveScannerSecret(
  scannerId: string,
  authRef: string,
  secret: string,
): Promise<SaveSecretResult> {
  if (!scannerId) return { ok: false, auth_ref: null, error: "缺少 scanner_id" };
  if (!authRef) return { ok: false, auth_ref: null, error: "缺少环境变量名 auth_ref" };
  if (!secret) return { ok: false, auth_ref: authRef, error: "请输入密钥" };
  try {
    const response = await fetch(`${BRIDGE_URL}/bridge/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interface_id: scannerId, scanner_id: scannerId, auth_ref: authRef, secret }),
    });
    const raw = await readJson(response);
    const safe = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const name = asEnvName(safe.auth_ref) ?? asEnvName(safe.api_key_env) ?? authRef;
    const status = asString(safe.auth_status);
    if (!response.ok) {
      const fallback =
        response.status === 404 || response.status === 501
          ? "本机桥接尚未提供 /bridge/credentials"
          : typeof safe.error === "string"
            ? safe.error
            : `HTTP ${response.status}`;
      return { ok: false, auth_ref: name, error: redactSecret(fallback, secret) };
    }
    return { ok: true, auth_ref: name, auth_status: status };
  } catch (e) {
    return {
      ok: false,
      auth_ref: authRef,
      error: redactSecret(`桥接未接通：${(e as Error).message}`, secret),
    };
  }
}

export interface ScannerBoardView {
  availability: ScannerAvailability;
  catalogAvailability: ScannerAvailability;
  rows: InterfaceRow[];
  summary: ScannerSummary;
  error: string | null;
  scanned: boolean;
  scanning: boolean;
  example: boolean;
  lastError: string | null;
  refresh: () => Promise<void>;
  useExample: () => void;
  probeWired: boolean | null;
  promoteWired: boolean | null;
  credentialsWired: boolean | null;
  markProbeWired: (wired: boolean) => void;
  markPromoteWired: (wired: boolean) => void;
  markCredentialsWired: (wired: boolean) => void;
  registerLocalDraft: (draft: PromoteDraft) => void;
  registrations: Record<string, PromoteDraft>;
}

export function useScannerBoard(opts: {
  autoScan: boolean;
  forceExample: boolean;
  extraRegisteredIds?: string[];
}): ScannerBoardView {
  const [catalogAvailability, setCatalogAvailability] = useState<ScannerAvailability>("idle");
  const [liveCatalog, setLiveCatalog] = useState<ScannerCatalogItem[]>([]);
  const [liveRecords, setLiveRecords] = useState<DiscoveryRecord[]>([]);
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useExampleFlag, setUseExampleFlag] = useState(false);
  const [registrations, setRegistrations] = useState<Record<string, PromoteDraft>>(() =>
    typeof window === "undefined" ? {} : loadLocalRegistrations(),
  );
  const [probeWired, setProbeWired] = useState<boolean | null>(null);
  const [promoteWired, setPromoteWired] = useState<boolean | null>(null);
  const [credentialsWired, setCredentialsWired] = useState<boolean | null>(null);
  const autoRan = useRef(false);

  const exampleForced = opts.forceExample || useExampleFlag;

  useEffect(() => {
    let alive = true;
    void fetchScannerCatalog().then((result) => {
      if (!alive) return;
      setCatalogAvailability(result.availability);
      setLiveCatalog(result.scanners);
      if (result.error && result.availability !== "ok") setError(result.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  const runScan = useCallback(async () => {
    setScanning(true);
    const result = await postScan();
    setScanning(false);
    if (result.availability === "ok") {
      setLiveRecords(result.records);
      setScanned(true);
      setError(null);
      setUseExampleFlag(false);
    } else {
      setError(result.error);
      setScanned(false);
    }
    return result;
  }, []);

  useEffect(() => {
    if (!opts.autoScan || autoRan.current || exampleForced) return;
    if (catalogAvailability === "idle") return;
    autoRan.current = true;
    if (catalogAvailability === "ok") {
      void runScan();
    }
  }, [opts.autoScan, catalogAvailability, exampleForced, runScan]);

  const useExample = useCallback(() => {
    setUseExampleFlag(true);
    setScanned(true);
  }, []);

  const example = exampleForced;

  const catalog = example ? bundledExampleCatalog() : liveCatalog;
  const records = example ? bundledExampleRecords() : liveRecords;
  const availability: ScannerAvailability = example
    ? "example"
    : scanned
      ? "ok"
      : catalogAvailability;

  const registeredIds = useMemo(() => {
    const ids = new Set<string>([...Object.keys(registrations), ...(opts.extraRegisteredIds ?? [])]);
    return ids;
  }, [registrations, opts.extraRegisteredIds]);

  const rows = useMemo(
    () => mergeInterfaceRows(catalog, records, registeredIds, example ? "example" : "live"),
    [catalog, records, registeredIds, example],
  );

  const summary = useMemo(
    () => summarizeRows(rows, availability, example || scanned),
    [rows, availability, example, scanned],
  );

  const registerLocalDraft = useCallback((draft: PromoteDraft) => {
    setRegistrations((prev) => {
      const next = { ...prev, [draft.scanner_id]: draft };
      persistLocalRegistrations(next);
      return next;
    });
  }, []);

  return {
    availability,
    catalogAvailability,
    rows,
    summary,
    error,
    scanned: example || scanned,
    scanning,
    example,
    lastError: error,
    refresh: async () => {
      const catalogResult = await fetchScannerCatalog();
      setCatalogAvailability(catalogResult.availability);
      setLiveCatalog(catalogResult.scanners);
      if (catalogResult.availability === "ok") {
        await runScan();
      } else {
        setError(catalogResult.error);
      }
    },
    useExample,
    probeWired,
    promoteWired,
    credentialsWired,
    markProbeWired: setProbeWired,
    markPromoteWired: setPromoteWired,
    markCredentialsWired: setCredentialsWired,
    registerLocalDraft,
    registrations,
  };
}

export function rowBaseUrl(row: InterfaceRow): string | null {
  return asString(row.record?.endpoint?.base_url) ?? asString(row.record?.endpoint ? (row.record.endpoint as { endpoint?: string }).endpoint : null);
}

export function rowAuthRef(row: InterfaceRow): string | null {
  return row.record?.auth.auth_ref ?? row.catalog.auth_ref ?? null;
}

export function rowTransport(row: InterfaceRow): string | null {
  return row.record?.endpoint?.transport ?? row.catalog.transport ?? row.catalog.adapter ?? row.catalog.module ?? null;
}

export function shouldShowKeyField(row: InterfaceRow): boolean {
  const mode = row.record?.auth.mode ?? row.catalog.auth_mode;
  const needed = row.record?.auth.needs_user_secret === true || row.record?.status === "needs_secret" || row.uiStatus === "missing_key";
  return mode === "user_secret" && needed;
}

export function prefilledAdvancedOpen(row: InterfaceRow): boolean {
  const url = rowBaseUrl(row);
  const probeOk = row.record?.evidence.probe?.ok === true;
  if (url && (probeOk || row.record?.status === "reachable" || row.record?.status === "found")) return false;
  return true;
}
