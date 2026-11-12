/** Shapes aligned with agent-orchestrator MCP v0.3.2 */

export type EvidenceLane = "compile" | "automated" | "visual_pie" | "human";
export type Priority = "P0" | "P1" | "P2";
export type ItemStatus = "open" | "closed" | "in_progress";

export interface Role {
  name: string;
  capabilities: string[];
  teammate_hint: string;
  endpoint: string | null;
  optional?: boolean;
}

export interface DispatchStep {
  order: number;
  role: string;
  action: string;
  brief: string;
  teammate_hint?: string;
  policy?: string;
  failover_to?: string | null;
  skip_roles?: string[];
  status?: "pending" | "active" | "done" | "skipped";
}

export interface DispatchPlan {
  goal: string;
  quota_exhausted: boolean;
  project_id: string;
  project_root: string;
  protocol_note: string;
  steps: DispatchStep[];
}

export interface RoundBrief {
  round: string;
  quota_exhausted: boolean;
  goal: string;
  path: string;
  success: string;
  not_to_do: string[];
  evidence_paths: string[];
  executor: string;
  task: OpenItem | null;
}

export interface OpenItem {
  id: string;
  title: string;
  priority: Priority;
  lane: EvidenceLane;
  status: ItemStatus;
  notes?: string;
}

export interface EvidenceClaims {
  compile?: string;
  automated?: string;
  visual_pie?: string;
  human?: string;
  feel?: string;
}

export interface EvidenceValidation {
  ok: boolean;
  lanes_found: Record<EvidenceLane, boolean>;
  warnings: string[];
  errors: string[];
  rules: {
    separate_lanes: EvidenceLane[];
    no_fake_feel: boolean;
  };
  claims: EvidenceClaims;
}

export interface AuditEvent {
  ts: string;
  kind: string;
  role?: string | null;
  detail: string | Record<string, unknown>;
}

export interface CodexLink {
  machine_id: string;
  machine_label: string;
  cli_path: string;
  cli_ok: boolean;
  auth_ok: boolean;
  auth_path: string;
  auth_exists: boolean;
  version: string | null;
  login_line: string | null;
  mode: string;
  app_server_ok: boolean | null;
  app_server_version: string | null;
  daemon_ok: boolean | null;
  processes: string[];
  last_probe_at: string | null;
  notes: string;
  session: string | null;
  pending_outbound: unknown;
  link_verified: boolean;
  quota_exhausted: boolean;
  /** UI stub — mock OK for dashboard demo */
  stub_status: "ok" | "degraded" | "down";
}


export type ChannelLayerKind = "chat_bridge" | "tool_inventory" | "tool_verify" | "quota";
export type ChannelLayerStatus = "ok" | "partial" | "fail" | "unverified" | "na";
export type ScreenshotVerifyStatus = "ok" | "fail" | "skipped";

export interface ChannelLayer {
  kind: ChannelLayerKind;
  status: ChannelLayerStatus;
  summary: string;
}

export interface ChannelTool {
  id: string;
  name: string;
  api_name?: string;
  claimed: boolean;
  verified: boolean;
  note?: string;
}

export interface ScreenshotVerify {
  status: ScreenshotVerifyStatus;
  label: string;
  detail: string;
}

/** External AI channel as seen by the operator board (UI stub / mock). */
export interface ExternalChannel {
  id: string;
  title: string;
  title_en: string;
  /** Adapter/protocol kind, e.g. workbuddy_desktop, codex_cli, mcp, http_api. */
  kind: string;
  /** CLI path, MCP/HTTP URL, or desktop app id. */
  endpoint: string | null;
  optional: boolean;
  product?: string;
  /** catalog = shipped example; registered = added via 添加通道 */
  source?: "catalog" | "registered";
  layers: ChannelLayer[];
  tools: ChannelTool[];
  inventory_claimed: number;
  inventory_verified: number;
  test_session?: string | null;
  test_reply?: string | null;
  screenshot_verify?: ScreenshotVerify | null;
  notes: string;
  last_probe_at: string | null;
}

/**
 * Evaluator advice for one piece of work. Display-only: it is never written into
 * `executor_channel_id` / `model`, so adopting a suggestion still leaves the
 * executor unselected until the operator picks one.
 */
export interface TaskRecommendation {
  title: string;
  description: string;
  recommended_executor_channel_id: string | null;
  recommended_model: string | null;
  rationale?: string;
}

/** Operator-board project/task records (localStorage). Field names align with the upcoming MCP contract. The UI calls a project a 圆桌会议; storage keys and field names stay `project_*`. */
export type AiRoleSeat = "king" | "knight";

/**
 * Per-project roster stored on `Project.ai_roles` in `operator-board-projects`.
 * Every project has exactly one king seat (fixed duty) plus zero or more
 * custom knight seats. The king reports a round of other AIs' results to
 * the user; knights are user-defined working roles.
 */
export interface ProjectAiRole {
  role_id: string;
  /** "king" = the single fixed monarch seat; "knight" = a custom working role. */
  seat: AiRoleSeat;
  /** King defaults to 国王, but a display name (e.g. 亚瑟王) may be stored. Knights use a user-written short label. */
  name: string;
  /** King duty is fixed. Knights use a user-written duty (职能). */
  duty: string;
  /** Optional in-character identity / voice (内部形象) at the roundtable. */
  persona?: string;
  /**
   * Built-in original portrait id from the board catalog. Null or absent uses
   * a monogram fallback. Not a URL and not official character art.
   */
  portrait_id?: string | null;
  executor_channel_id: string | null;
  /** Declared model id/name. null = follow the board default / live catalog. */
  model: string | null;
}

export interface ProjectTask {
  task_id: string;
  project_id: string;
  title: string;
  description: string;
  priority: Priority;
  executor_channel_id: string | null;
  /** Declared model id/name. null = follow the board default. Not a live connection. */
  model: string | null;
  /**
   * Optional link to `Project.ai_roles`. Deleting that roster role clears
   * `role_id` but keeps `role_name` / `duty` / `persona` / `portrait_id` copies,
   * so past assignments do not go blank.
   */
  role_id?: string | null;
  /** Copied or one-off 角色 label. Independent of the roster after assignment. */
  role_name?: string | null;
  /** Copied or one-off 职能. Independent of the roster after assignment. */
  duty?: string | null;
  /** Copied or one-off 内部形象. Independent of the roster after assignment. */
  persona?: string | null;
  /** Copied portrait id, same lifetime as `role_name` / `duty`. */
  portrait_id?: string | null;
  /**
   * Set when this row is one piece of a decomposed task. Keeps `tasks` flat:
   * subtasks are ordinary rows in the same array, never nested objects.
   */
  parent_task_id?: string | null;
  /**
   * Root task only, opt-in. false by default: the evaluator is asked for advice
   * only when the operator checks the box, and advice never auto-dispatches.
   */
  ask_evaluator_suggestions?: boolean;
  /** Subtask only: evaluator advice kept as a hint next to the empty selects. */
  recommendation?: TaskRecommendation | null;
  created_at?: string;
  /** Local-only record that the operator asked to dispatch. Never means a send succeeded. */
  dispatch_intent_at?: string;
}

export interface Project {
  project_id: string;
  name: string;
  notes?: string;
  tasks: ProjectTask[];
  /**
   * Per-project roster. Always includes exactly one king after normalize/load;
   * additional entries are knights.
   */
  ai_roles?: ProjectAiRole[];
  created_at?: string;
}

/** Operator-board project preferences (localStorage). */
export interface ProjectBoardPrefs {
  /** When true, the operator creates tasks in this panel. When false, hide 新建任务 and point to the orchestrator queue. */
  selfCreateTasks: boolean;
  /** Board-level default model id/name. Empty string means unspecified. */
  defaultModel: string;
  /** Model names the operator added; these are labels, not a verified catalog. */
  customModels: string[];
}

export interface DashboardMock {
  version: string;
  roles: Record<string, Role>;
  dispatch_plan: DispatchPlan;
  dispatch_plan_quota: DispatchPlan;
  round_brief: RoundBrief;
  open_items: OpenItem[];
  evidence_samples: {
    label: string;
    claims: EvidenceClaims;
    report_text: string;
    validation: EvidenceValidation;
  }[];
  events: AuditEvent[];
  codex_link: CodexLink;
  external_channels: ExternalChannel[];
}
