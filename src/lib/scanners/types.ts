/**
 * READ-ONLY snapshot of portable-agent-orchestrator/scanners/types.ts.
 * Do not fork this into a second registry or invent vendor lists here.
 * Keep in sync with the scanners package; the UI only consumes these shapes.
 */

export type Transport = "cli" | "http" | "mcp" | "desktop_bridge" | "a2a";

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
  port: number;
  protocol: "tcp" | "http" | "https";
  probe_path?: string;
  /** Optional fallback is itself a declared port, not a range scan. */
  role?: "primary" | "fallback";
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
  };
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
  open_ports?: { host: string; port: number }[];
  probe?: { method: string; ok: boolean; note?: string };
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
