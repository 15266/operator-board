/**
 * Local AI interface scanner contract — TypeScript copy.
 * Keep in sync with contract.md and contract.py.
 *
 * Scanner = how to find a class of local interface.
 * Discovery record = one scan result (no secret values).
 * Talking / verifying / dispatching stay in adapters, channels, and projects.
 */

export type Transport = "cli" | "http" | "mcp" | "desktop_bridge" | "a2a" | "acp";

export type AuthMode = "none" | "user_secret" | "running_session";

export type DiscoveryStatus =
  | "not_found"
  | "found"
  | "reachable"
  | "needs_secret"
  | "session_available";

export type ProbeMethod =
  | "tcp_connect"
  | "http_get"
  | "http_post"
  | "cli_version"
  | "none";

export const AUTH_MODES: AuthMode[] = ["none", "user_secret", "running_session"];

export const DISCOVERY_STATUSES: DiscoveryStatus[] = [
  "not_found",
  "found",
  "reachable",
  "needs_secret",
  "session_available",
];

export const HARD_RULES = {
  discovery_is_not_connected: true,
  discovery_is_not_tool_verification: true,
  listing_models_is_not_verification: true,
  no_secrets_in_records: true,
  no_vendor_list_in_the_host: true,
  loopback_declared_ports_only: true,
  do_not_disturb_running_apps: true,
  do_not_bind_claimed_ports: true,
  jobs_hit_is_not_acp_verification: true,
  user_promotion_only: true,
  plugin_folder_is_not_a_live_link: true,
} as const;

export const DEFAULT_SAFETY = {
  may_restart: false,
  may_kill: false,
  may_bind_port: false,
  may_start_if_stopped: false,
} as const;

export interface ProcessMatcher {
  name: string;
  /** Always matched case-insensitively. Do not include Python-only flags such as (?i). */
  name_regex?: string;
  /** If true, may read names in auth.session.env_keys from that process. Never persist values. */
  read_env?: boolean;
}

export interface PathLocator {
  command: string;
}

export interface InstallDirLocator {
  path: string;
  exists_file?: string;
}

export interface PortLocator {
  host?: string;
  /** Declared port. Optional when from_env or from_process is set. */
  port?: number;
  /**
   * Environment-variable NAME whose value is an already-observed port number
   * (not a hardcoded default). Example: WorkBuddy WB_PORT.
   */
  from_env?: string;
  /**
   * If true, observe loopback listen ports of a process already matched by
   * processes[]. When probe_path is set, keep only ports that respond to it
   * (disambiguation, not a chat / not reachable). A declared number such as
   * Doubao 9225 is only a hint.
   */
  from_process?: boolean;
  protocol: "tcp" | "http" | "https";
  probe_path?: string;
  /** hint / declared default is not the only port; observed comes from the process. */
  role?: "primary" | "fallback" | "hint" | "observed";
}

export interface RegistryKeyLocator {
  hive: "HKCU" | "HKLM";
  path: string;
  name?: string;
}

export interface DiscoverSpec {
  processes?: ProcessMatcher[];
  path?: PathLocator[];
  install_dirs?: InstallDirLocator[];
  ports?: PortLocator[];
  registry_keys?: RegistryKeyLocator[];
}

export interface EndpointShape {
  /** `acp` is the Agent Client Protocol talk path (WorkBuddy live dispatch). */
  transport: Transport;
  adapter?: string;
  base_url_template?: string;
  cli_path_from?: "path" | "install_dirs";
  openai_compatible?: boolean;
  paths?: Record<string, string>;
  working_directory_supported?: boolean;
  notes?: string;
}

export interface AuthSpec {
  mode: AuthMode;
  /** Environment variable NAME only. Never the secret value. */
  auth_ref?: string | null;
  session?: {
    env_keys: string[];
    source: "process_env" | "bridge_env";
    /**
     * If false, do not set session_present from env/process presence.
     * Desktop login (e.g. Codex auth.json) is not session_available.
     */
    infer_session?: boolean;
  };
  /** Only user_secret defaults to true when auth_ref is unset. running_session does not. */
  needs_user_secret_if_ref_missing?: boolean;
  user_prompt?: string;
}


export interface CatalogSpec {
  method?: "http_get" | "none";
  paths?: string[];
  current_model_path?: string;
  current_model_file?: string;
  current_model_key?: string;
  /** Official published names used only when a live local catalog is missing. */
  published_models?: string[];
  published_source?: string;
  published_as_of?: string;
  timeout_ms?: number;
  note?: string;
}
export interface ProbeSpec {
  method: ProbeMethod;
  path?: string;
  ok_when?: "status_2xx" | "exit_0" | "tcp_accept";
  timeout_ms?: number;
  live_default: false;
}

export interface SafetySpec {
  may_restart: false;
  may_kill: false;
  may_bind_port: false;
  may_start_if_stopped: false;
  do_not_disturb?: string[];
}

export interface ScannerManifest {
  id: string;
  display_name: string;
  discover: DiscoverSpec;
  endpoint: EndpointShape;
  auth: AuthSpec;
  probe: ProbeSpec;
  catalog?: CatalogSpec;
  safety?: SafetySpec;
  /** Optional mapping onto a legacy /bridge/health field during migration. */
  compat_health_key?: string;
  notes?: string;
}

export interface DiscoveryEvidence {
  process_names?: string[];
  path_hits?: string[];
  install_dirs?: string[];
  open_ports?: { host: string; port: number; source?: "declared" | "from_env" | "process" }[];
  probe?: { method: string; ok: boolean; note?: string; authorization_from?: "auth_ref" };
  session_present?: boolean;
  model_names?: string[];
  current_model?: string;
  model_catalog?: {
    attempted: boolean;
    ok?: boolean;
    path?: string;
    tried?: { path: string; ok: boolean; status?: number }[];
    note?: string;
    authorization_from?: "auth_ref";
    current_model_path?: string;
    current_model_from?: "config_file";
    source?: "local_http" | "published_docs";
    published_source?: string;
    published_as_of?: string;
  };
}

export interface DiscoveryRecord {
  scanner_id: string;
  display_name: string;
  status: DiscoveryStatus;
  evidence: DiscoveryEvidence;
  endpoint?: EndpointShape & { base_url?: string; cli_path?: string };
  auth: {
    mode: AuthMode;
    auth_ref?: string | null;
    session_present?: boolean;
    needs_user_secret?: boolean;
  };
  tools_verified: false;
  chat_bridge: "unverified";
  /** Health / ACP must not set this true. WorkBuddy jobs stay false while broken. */
  jobs_ok?: false;
  notes?: string;
}

export interface ScannerCatalogEntry {
  id: string;
  display_name: string;
  module: string;
  status?: "skeleton" | "experimental" | "stable";
  notes?: string;
}

export interface ScannerRegistry {
  version: string;
  rules: typeof HARD_RULES;
  scanners: ScannerCatalogEntry[];
}

export interface LocalScanner {
  manifest: ScannerManifest;
  /** Optional override; default loader runs manifest.discover locators. */
  discover?(ctx: unknown): Promise<Partial<DiscoveryEvidence>> | Partial<DiscoveryEvidence>;
}
