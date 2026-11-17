import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type {
  ChannelLayerKind,
  ExternalChannel,
  Priority,
  Project,
  ProjectAiRole,
  ProjectBoardPrefs,
  ProjectTask,
  TaskRecommendation,
} from "../lib/types";
import { ACTION, AI_DIVISION, ASSIGN_ROLES, PROJECT_COPY, deleteAiRoleConfirm, deleteProjectConfirm } from "../lib/copy";
import { ArchiveText } from "./ArchiveText";
import { ArchiveSelect } from "./ArchiveSelect";
import { EmptyState } from "./EmptyState";
import { MotionFold, MotionSurface, RollingCount } from "./Motion";
import { RoundtableMark } from "./RoundtableMark";
import { KbRefPicker, KnowledgeBasePanel } from "./KnowledgeBase";
import { extractCard, markUserNav, onContentPresented, waveStyle } from "../lib/motion";
import { isPersonaPortraitId } from "../lib/personas";
import { isArthurSampleProject } from "../lib/sampleArthurProject";
import { isGuiKingExecutor } from "../lib/localExecutors";
import { BRIDGE_URL, BRIDGE_EXECUTORS, DISPATCH_LABEL, executorDispatchGate, fetchLiveModels, type BridgeHealth, type BridgeView, type DispatchRecord } from "../lib/bridge";
import { catalogModelsFromEvidence, loadPreferredModels, resolveDispatchModel, subscribePreferredModels, type PreferredModels } from "../lib/preferredModels";
import type { ScannerBoardView } from "../lib/scannerBoard";

const PROJECTS_KEY = "operator-board-projects";
const PREFS_KEY = "operator-board-project-prefs";
const PRIORITIES: Priority[] = ["P0", "P1", "P2"];

function executorOptions(channels: ExternalChannel[], emptyLabel = "未指定执行器") {
  return [
    { value: "", label: emptyLabel },
    ...channels.map((ch) => ({
      value: ch.id,
      label: ch.title,
      note: ch.title_en || undefined,
    })),
  ];
}

function usableExecutorOptions(
  usable: string[],
  channels: ExternalChannel[],
  emptyLabel: string,
) {
  if (usable.length === 0) return [{ value: "", label: emptyLabel }];
  return usable.map((id) => ({
    value: id,
    label: channels.find((ch) => ch.id === id)?.title ?? id,
    note: channels.find((ch) => ch.id === id)?.title_en || undefined,
  }));
}

const CUSTOM_MODEL_VALUE = "__add_model__";

const DEFAULT_PREFS: ProjectBoardPrefs = {
  selfCreateTasks: true,
  defaultModel: "",
  customModels: [],
};

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeProject(item))
      .filter((item): item is Project => item !== null);
  } catch {
    return [];
  }
}

export function persistProjects(projects: Project[]): void {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadProjectPrefs(): ProjectBoardPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ProjectBoardPrefs>;
    const custom = Array.isArray(parsed.customModels)
      ? parsed.customModels.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [];
    return {
      selfCreateTasks: parsed.selfCreateTasks !== false,
      defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : "",
      customModels: Array.from(new Set(custom.map((item) => item.trim()))),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function persistProjectPrefs(prefs: ProjectBoardPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Drop a per-project prefs entry if the stored JSON is keyed by project id.
 *  Board-wide prefs (selfCreateTasks / defaultModel / customModels) are left intact.
 */
export function forgetProjectPrefs(projectId: string): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const record = parsed as Record<string, unknown>;
    const looksBoardWide =
      "selfCreateTasks" in record || "defaultModel" in record || "customModels" in record;
    if (looksBoardWide || !(projectId in record)) return;
    delete record[projectId];
    localStorage.setItem(PREFS_KEY, JSON.stringify(record));
  } catch {
    /* ignore quota / private mode */
  }
}

function modelOptions(prefs: ProjectBoardPrefs, extra?: string | null, catalog: string[] = []): string[] {
  const values = [...prefs.customModels, ...catalog];
  if (prefs.defaultModel) values.push(prefs.defaultModel);
  if (extra) values.push(extra);
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function catalogForExecutor(scannerBoard: ScannerBoardView | undefined, executorId: string | null | undefined): string[] {
  if (!scannerBoard || !executorId) return [];
  const row = scannerBoard.rows.find((item) => item.scanner_id === executorId);
  return catalogModelsFromEvidence(row?.record?.evidence);
}

function isPriority(value: unknown): value is Priority {
  return value === "P0" || value === "P1" || value === "P2";
}

function normalizeRecommendation(raw: unknown): TaskRecommendation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<TaskRecommendation>;
  if (typeof r.title !== "string" || !r.title.trim()) return null;
  return {
    title: r.title.trim(),
    description: typeof r.description === "string" ? r.description : "",
    recommended_executor_channel_id:
      typeof r.recommended_executor_channel_id === "string" && r.recommended_executor_channel_id
        ? r.recommended_executor_channel_id
        : null,
    recommended_model:
      typeof r.recommended_model === "string" && r.recommended_model.trim()
        ? r.recommended_model.trim()
        : null,
    rationale:
      typeof r.rationale === "string" && r.rationale.trim() ? r.rationale : undefined,
  };
}

function normalizeTask(raw: unknown, fallbackProjectId: string): ProjectTask | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<ProjectTask> & {
    evaluator_enabled?: unknown;
    ask_evaluator?: unknown;
    evaluator_suggestions_requested?: unknown;
    ask_assessor?: unknown;
    assessor_enabled?: unknown;
  };
  if (typeof t.task_id !== "string" || !t.task_id) return null;
  if (typeof t.title !== "string") return null;
  // Official field wins. The legacy name is only read when the official one is
  // missing, and is never written back.
  const askEvaluator =
    typeof t.ask_evaluator_suggestions === "boolean"
      ? t.ask_evaluator_suggestions
      : ([t.evaluator_enabled, t.ask_evaluator, t.evaluator_suggestions_requested, t.ask_assessor, t.assessor_enabled].find(
          (v): v is boolean => typeof v === "boolean",
        ) ?? false);
  return {
    task_id: t.task_id,
    project_id:
      typeof t.project_id === "string" && t.project_id ? t.project_id : fallbackProjectId,
    title: t.title,
    description: typeof t.description === "string" ? t.description : "",
    priority: isPriority(t.priority) ? t.priority : "P2",
    executor_channel_id:
      typeof t.executor_channel_id === "string" && t.executor_channel_id
        ? t.executor_channel_id
        : null,
    model: typeof t.model === "string" && t.model.trim() ? t.model.trim() : null,
    kb_refs: Array.isArray(t.kb_refs)
      ? t.kb_refs.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 20)
      : undefined,
    parent_task_id:
      typeof t.parent_task_id === "string" && t.parent_task_id ? t.parent_task_id : null,
    // Only roots carry the toggle; a 分工 is always false.
    ask_evaluator_suggestions:
      typeof t.parent_task_id === "string" && t.parent_task_id ? false : askEvaluator,
    recommendation: normalizeRecommendation(t.recommendation),
    role_id: typeof t.role_id === "string" && t.role_id ? t.role_id : null,
    role_name:
      typeof t.role_name === "string" && t.role_name.trim() ? t.role_name.trim() : null,
    duty: typeof t.duty === "string" && t.duty.trim() ? t.duty.trim() : null,
    persona: typeof t.persona === "string" && t.persona.trim() ? t.persona.trim() : null,
    portrait_id: isPersonaPortraitId(t.portrait_id) ? t.portrait_id : null,
    created_at: typeof t.created_at === "string" ? t.created_at : undefined,
    dispatch_intent_at:
      typeof t.dispatch_intent_at === "string" && t.dispatch_intent_at
        ? t.dispatch_intent_at
        : undefined,
  };
}

function isKingName(name: string | null | undefined): boolean {
  const value = (name ?? "").trim().toLowerCase();
  return value === "国王" || value === "king";
}

function kingDisplayName(role: Pick<ProjectAiRole, "name"> | null | undefined): string {
  const name = (role?.name ?? "").trim();
  return name || AI_DIVISION.king.zh;
}

function createKingRole(
  projectId: string,
  patch?: Partial<Omit<ProjectAiRole, "seat" | "duty">>,
): ProjectAiRole {
  const displayName =
    typeof patch?.name === "string" && patch.name.trim() ? patch.name.trim() : AI_DIVISION.king.zh;
  return {
    role_id: patch?.role_id || `role-king-${projectId}`,
    seat: "king",
    name: displayName,
    duty: AI_DIVISION.kingDuty,
    persona: typeof patch?.persona === "string" ? patch.persona : "",
    portrait_id: isPersonaPortraitId(patch?.portrait_id) ? patch.portrait_id : null,
    executor_channel_id: patch?.executor_channel_id ?? null,
    model: typeof patch?.model === "string" && patch.model.trim() ? patch.model.trim() : null,
  };
}

function asKnight(role: ProjectAiRole): ProjectAiRole {
  return { ...role, seat: "knight" };
}

/** Guarantee exactly one fixed king, then knights. Existing roles are kept. */
export function ensureProjectRoles(project: Project): Project {
  return { ...project, ai_roles: ensureRosterRoles(project.ai_roles, project.project_id) };
}

function ensureRosterRoles(roles: ProjectAiRole[] | undefined, projectId: string): ProjectAiRole[] {
  const incoming = roles ?? [];
  const markedKing = incoming.find((role) => role.seat === "king");
  const namedKing = incoming.find((role) => isKingName(role.name));
  const chosen = markedKing ?? namedKing;
  const rest = incoming.filter((role) => role !== chosen).map(asKnight);
  if (chosen) {
    return [
      createKingRole(projectId, {
        role_id: chosen.role_id,
        name: chosen.name,
        persona: chosen.persona,
        portrait_id: chosen.portrait_id ?? null,
        executor_channel_id: chosen.executor_channel_id,
        model: chosen.model,
      }),
      ...rest,
    ];
  }
  return [createKingRole(projectId), ...rest];
}

function kingOf(roles: ProjectAiRole[] | undefined): ProjectAiRole | undefined {
  return (roles ?? []).find((role) => role.seat === "king");
}

function knightsOf(roles: ProjectAiRole[] | undefined): ProjectAiRole[] {
  return (roles ?? []).filter((role) => role.seat !== "king");
}

export function kingExecutionGate(project: Project): { ok: boolean; reason: string } {
  const king = kingOf(project.ai_roles);
  if (!king) return { ok: false, reason: AI_DIVISION.kingMissing };
  if (!king.executor_channel_id) return { ok: false, reason: AI_DIVISION.kingExecutorRequired };
  if (!isGuiKingExecutor(king.executor_channel_id)) {
    return { ok: false, reason: AI_DIVISION.kingExecutorNeedGui };
  }
  return { ok: true, reason: "" };
}

function kingReportTaskId(projectId: string): string {
  return `${projectId}::king-report`;
}

function reservedSyntheticTaskIds(project: Project): Set<string> {
  const ids = new Set<string>([assignAdviceTaskId(project.project_id), kingReportTaskId(project.project_id)]);
  for (const task of project.tasks) {
    if (!task.parent_task_id) ids.add(evaluatorTaskId(task.task_id));
  }
  return ids;
}

interface RoundReportItem {
  title: string;
  state: string;
  reply: string | null;
  error: string | null;
  executor: string | null;
  intentOnly: boolean;
}

function collectRoundResults(project: Project, dispatches: DispatchRecord[]): RoundReportItem[] {
  const reserved = reservedSyntheticTaskIds(project);
  const items: RoundReportItem[] = [];
  const seen = new Set<string>();
  for (const task of project.tasks) {
    if (reserved.has(task.task_id)) continue;
    const record = dispatches.find((item) => item.task_id === task.task_id);
    if (record) {
      items.push({
        title: task.title || record.title,
        state: record.state,
        reply: record.reply,
        error: record.error,
        executor: record.executor,
        intentOnly: false,
      });
      seen.add(task.task_id);
      continue;
    }
    if (task.dispatch_intent_at) {
      items.push({
        title: task.title,
        state: "intent",
        reply: null,
        error: null,
        executor: task.executor_channel_id,
        intentOnly: true,
      });
      seen.add(task.task_id);
    }
  }
  for (const record of dispatches) {
    if (!record.task_id || reserved.has(record.task_id) || seen.has(record.task_id)) continue;
    if (record.project_id && record.project_id !== project.project_id) continue;
    if (!record.project_id && !project.tasks.some((task) => task.task_id === record.task_id)) continue;
    items.push({
      title: record.title,
      state: record.state,
      reply: record.reply,
      error: record.error,
      executor: record.executor,
      intentOnly: false,
    });
  }
  return items;
}

function kingReportPrompt(project: Project, king: ProjectAiRole, items: RoundReportItem[]): string {
  const lines: string[] = [
    `你的角色：${kingDisplayName(king)}`,
    `你的职能：${AI_DIVISION.kingDuty}`,
  ];
  lines.push("", `会议：${project.name}`);
  if (project.notes) lines.push(`会议说明：${project.notes}`);
  lines.push(
    "",
    "下面是其他 AI 本轮已经留下的任务记录。请只根据这些记录汇总，向用户汇报本轮进展。不要把没有出现的结果写成已完成，也不要编造回复。若某条只有派发意向、尚无回复，请如实说明。",
    "",
  );
  items.forEach((item, index) => {
    lines.push(`${index + 1}. 任务：${item.title}`);
    if (item.executor) lines.push(`   执行器：${item.executor}`);
    if (item.intentOnly) {
      lines.push("   状态：已记录派发意向，尚无桥接回复。");
    } else {
      lines.push(`   状态：${item.state}`);
      if (item.reply) lines.push(`   回复：${item.reply}`);
      else lines.push("   回复：（无）");
      if (item.error) lines.push(`   错误：${item.error}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

function normalizeAiRole(raw: unknown): ProjectAiRole | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ProjectAiRole>;
  if (typeof r.role_id !== "string" || !r.role_id) return null;
  if (typeof r.name !== "string") return null;
  return {
    role_id: r.role_id,
    seat: r.seat === "king" ? "king" : "knight",
    name: r.name,
    duty: typeof r.duty === "string" ? r.duty : "",
    persona: typeof r.persona === "string" ? r.persona : "",
    portrait_id: isPersonaPortraitId(r.portrait_id) ? r.portrait_id : null,
    executor_channel_id:
      typeof r.executor_channel_id === "string" && r.executor_channel_id
        ? r.executor_channel_id
        : null,
    model: typeof r.model === "string" && r.model.trim() ? r.model.trim() : null,
  };
}

function normalizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Project> & { title?: unknown };
  if (typeof p.project_id !== "string" || !p.project_id) return null;
  const name =
    typeof p.name === "string" && p.name.trim()
      ? p.name
      : typeof p.title === "string"
        ? p.title
        : "";
  if (!name) return null;
  const tasks = Array.isArray(p.tasks)
    ? p.tasks
        .map((task) => normalizeTask(task, p.project_id as string))
        .filter((task): task is ProjectTask => task !== null)
    : [];
  return ensureProjectRoles({
    project_id: p.project_id,
    name,
    notes: typeof p.notes === "string" ? p.notes : undefined,
    tasks,
    ai_roles: Array.isArray(p.ai_roles)
      ? p.ai_roles.map(normalizeAiRole).filter((role): role is ProjectAiRole => role !== null)
      : [],
    created_at: typeof p.created_at === "string" ? p.created_at : undefined,
  });
}

function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

export function ProjectsBoard({
  projects,
  channels,
  onChange,
  selectedProjectId,
  onSelectProject,
  createRequested,
  onCreateHandled,
  bridge,
  scannerBoard,
}: {
  projects: Project[];
  channels: ExternalChannel[];
  onChange: (next: Project[]) => void;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  createRequested: boolean;
  onCreateHandled: () => void;
  bridge: BridgeView;
  scannerBoard?: ScannerBoardView;
}) {
  const [projectFormOpen, setProjectFormOpen] = useState(createRequested);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [prefs, setPrefs] = useState<ProjectBoardPrefs>(loadProjectPrefs);
  const [addingModel, setAddingModel] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [preferredModels, setPreferredModels] = useState<PreferredModels>(loadPreferredModels);

  useEffect(() => subscribePreferredModels(setPreferredModels), []);

  useEffect(() => {
    if (createRequested) {
      setProjectFormOpen(true);
      setTaskFormOpen(false);
    }
  }, [createRequested]);

  useEffect(() => {
    setTaskFormOpen(false);
  }, [selectedProjectId]);

  const selected = projects.find((p) => p.project_id === selectedProjectId) ?? null;
  const pendingFocus = useRef<"list" | "detail" | null>(null);

  useEffect(() => {
    return onContentPresented(() => {
      const intent = pendingFocus.current;
      if (!intent) return;
      const scope = document.querySelector<HTMLElement>(".project-workspace");
      pendingFocus.current = null;
      if (!scope) return;
      const target = intent === "detail" ? scope : scope.querySelector<HTMLElement>(".project-summary-card");
      target?.focus({ preventScroll: true });
    });
  }, [selectedProjectId]);

  function openProject(id: string, element: HTMLElement | null) {
    markUserNav();
    pendingFocus.current = "detail";
    extractCard(element, () => onSelectProject(id));
  }

  function commitPrefs(next: ProjectBoardPrefs) {
    persistProjectPrefs(next);
    setPrefs(next);
  }

  function handleDefaultModelChange(value: string) {
    if (value === CUSTOM_MODEL_VALUE) {
      setAddingModel(true);
      return;
    }
    setAddingModel(false);
    commitPrefs({ ...prefs, defaultModel: value });
  }

  function handleAddModel() {
    const name = newModel.trim();
    if (!name) return;
    const customModels = Array.from(new Set([...prefs.customModels, name]));
    commitPrefs({ ...prefs, customModels, defaultModel: name });
    setNewModel("");
    setAddingModel(false);
  }

  function closeProjectForm() {
    setProjectFormOpen(false);
    onCreateHandled();
  }

  function handleCreateProject(project: Project) {
    onChange([...projects, project]);
    setProjectFormOpen(false);
    onCreateHandled();
    onSelectProject(project.project_id);
  }

  function deleteProject(project: Project) {
    if (!window.confirm(deleteProjectConfirm(project.name))) return;
    onChange(projects.filter((p) => p.project_id !== project.project_id));
    forgetProjectPrefs(project.project_id);
    onSelectProject(null);
  }

  const modelControl = (
    <div className="model-control">
      <label className="field model-control-field">
        <span>默认模型</span>
        <ArchiveSelect
          value={addingModel ? CUSTOM_MODEL_VALUE : prefs.defaultModel}
          onChange={handleDefaultModelChange}
          aria-label="默认模型"
          options={[
            { value: "", label: "未指定模型" },
            ...modelOptions(
              prefs,
              null,
              (scannerBoard?.rows ?? []).flatMap((row) => catalogModelsFromEvidence(row.record?.evidence)),
            ).map((model) => ({ value: model, label: model })),
            { value: CUSTOM_MODEL_VALUE, label: "添加模型…" },
          ]}
        />
      </label>
      {addingModel ? (
        <form
          className="pref-add-model"
          onSubmit={(e) => {
            e.preventDefault();
            handleAddModel();
          }}
        >
          <input
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="输入模型名称"
            aria-label="新模型名称"
            autoFocus
          />
          <button type="submit" className="icon-btn add-channel-btn">
            添加
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setAddingModel(false);
              setNewModel("");
            }}
          >
            取消
          </button>
        </form>
      ) : (
        <p className="hint model-hint">模型名是本机标签，不是实时目录。</p>
      )}
    </div>
  );

  if (projectFormOpen && !selected) {
    return (
      <div className="project-workspace">
        <NewProjectForm onCancel={closeProjectForm} onCreate={handleCreateProject} />
      </div>
    );
  }

  if (selected) {
    const projectId = selected.project_id;
    const taskIds = new Set(selected.tasks.map((t) => t.task_id));
    // A subtask whose parent is missing falls back to being a root, so a half-written
    // local record can never make work invisible.
    const roots = selected.tasks.filter((t) => !t.parent_task_id || !taskIds.has(t.parent_task_id));
    const childrenByParent = new Map<string, ProjectTask[]>();
    for (const t of selected.tasks) {
      if (!t.parent_task_id || !taskIds.has(t.parent_task_id)) continue;
      const list = childrenByParent.get(t.parent_task_id) ?? [];
      list.push(t);
      childrenByParent.set(t.parent_task_id, list);
    }
    // 派发全部 only sweeps undecomposed root tasks. 分工 are started one by one on
    // their own rows, and a decomposed root never dispatches itself.
    const leaves = roots.filter((t) => !childrenByParent.has(t.task_id));

    const updateTask = (next: ProjectTask) => {
      onChange(
        projects.map((p) =>
          p.project_id === projectId
            ? { ...p, tasks: p.tasks.map((t) => (t.task_id === next.task_id ? next : t)) }
            : p,
        ),
      );
    };
    const addTask = (next: ProjectTask) => {
      onChange(
        projects.map((p) => (p.project_id === projectId ? { ...p, tasks: [...p.tasks, next] } : p)),
      );
    };
    const removeTask = (task: ProjectTask) => {
      const kids = childrenByParent.get(task.task_id) ?? [];
      const warn = kids.length
        ? `「${task.title}」下面还有 ${kids.length} 条分工，删除会一并移除。确定？`
        : `确定删除任务「${task.title}」？`;
      if (!window.confirm(warn)) return;
      const doomed = new Set([task.task_id, ...kids.map((k) => k.task_id)]);
      onChange(
        projects.map((p) =>
          p.project_id === projectId
            ? { ...p, tasks: p.tasks.filter((t) => !doomed.has(t.task_id)) }
            : p,
        ),
      );
    };
    const updateProject = (next: Project) => {
      onChange(projects.map((p) => (p.project_id === next.project_id ? next : p)));
    };
    const writeTaskRoleToRoster = (task: ProjectTask) => {
      const name = (task.role_name ?? "").trim();
      if (!name) return;
      if (isKingName(name)) return;
      const role: ProjectAiRole = {
        role_id: newId("role"),
        seat: "knight",
        name,
        duty: (task.duty ?? "").trim(),
        persona: (task.persona ?? "").trim(),
        portrait_id: isPersonaPortraitId(task.portrait_id) ? task.portrait_id : null,
        executor_channel_id: task.executor_channel_id,
        model: task.model,
      };
      onChange(
        projects.map((p) =>
          p.project_id === projectId
            ? {
                ...p,
                ai_roles: ensureRosterRoles([...(p.ai_roles ?? []), role], p.project_id),
                tasks: p.tasks.map((t) =>
                  t.task_id === task.task_id
                    ? {
                        ...task,
                        role_id: role.role_id,
                        role_name: role.name,
                        duty: role.duty || null,
                        persona: role.persona?.trim() || null,
                        portrait_id: role.portrait_id ?? null,
                      }
                    : t,
                ),
              }
            : p,
        ),
      );
    };

    const kingGate = kingExecutionGate(selected);
    const dispatchAll = () => {
      if (!kingGate.ok) return;
      for (const task of leaves) {
        const latest = bridge.dispatches.find((d) => d.task_id === task.task_id);
        if (!task.executor_channel_id || !BRIDGE_EXECUTORS.has(task.executor_channel_id)) continue;
        if (latest && !["failed", "handoff_closed"].includes(latest.state)) continue;
        void sendTask(task, {
          bridge,
          prefs,
          preferredModels,
          scannerBoard,
          onIntent: () => updateTask({ ...task, dispatch_intent_at: new Date().toISOString() }),
        });
      }
    };

    return (
      <MotionSurface token={projectId} className="project-workspace" focusable>
        {() => (
          <>
            <header className="project-workspace-head">
              <div className="project-workspace-titles">
                <p className="workspace-crumb">
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      markUserNav();
                      pendingFocus.current = "list";
                      onSelectProject(null);
                    }}
                  >
                    <ArchiveText zh={ACTION.allProjects.zh} en={ACTION.allProjects.en} />
                  </button>
                  <span aria-hidden="true"> / </span>
                  <span>{selected.name}</span>
                </p>
                <h2>
                  {selected.name}
                  {isArthurSampleProject(selected.project_id) ? (
                    <span className="project-sample-badge">
                      <ArchiveText zh={PROJECT_COPY.sampleBadge.zh} en={PROJECT_COPY.sampleBadge.en} />
                    </span>
                  ) : null}
                </h2>
                {isArthurSampleProject(selected.project_id) ? (
                  <p className="callout callout-info">{PROJECT_COPY.sampleCallout}</p>
                ) : null}
                {selected.notes ? <p className="hint">{selected.notes}</p> : null}
              </div>
          <div className="project-workspace-tools">
            {modelControl}
            <div className="project-card-actions">
              {prefs.selfCreateTasks ? (
                <button
                  type="button"
                  className="icon-btn add-channel-btn"
                  onClick={() => {
                    setTaskFormOpen(true);
                    requestAnimationFrame(() => {
                      document.getElementById(`task-title-${selected.project_id}`)?.focus();
                    });
                  }}
                >
                  <ArchiveText zh={ACTION.newTask.zh} en={ACTION.newTask.en} />
                </button>
              ) : null}
              <button
                type="button"
                className="icon-btn add-channel-btn"
                onClick={dispatchAll}
                disabled={!kingGate.ok}
                title={kingGate.ok ? "只派发未完成、不在运行中的任务" : kingGate.reason}
              >
                派发全部未完成任务
              </button>
              <button
                type="button"
                className="danger-btn"
                onClick={() => deleteProject(selected)}
              >
                <ArchiveText zh={ACTION.deleteProject.zh} en={ACTION.deleteProject.en} />
              </button>
            </div>
          </div>
        </header>

        <MotionFold className="howto project-pref-details" summary="任务来源">
          <fieldset className="pref-segment">
            <legend className="visually-hidden">是否自建任务</legend>
            <div className="pref-segment-options" role="radiogroup" aria-label="是否自建任务">
              <label className={prefs.selfCreateTasks ? "is-selected" : undefined}>
                <input
                  type="radio"
                  name="self-create-tasks"
                  checked={prefs.selfCreateTasks}
                  onChange={() => commitPrefs({ ...prefs, selfCreateTasks: true })}
                />
                自建任务
              </label>
              <label className={!prefs.selfCreateTasks ? "is-selected" : undefined}>
                <input
                  type="radio"
                  name="self-create-tasks"
                  checked={!prefs.selfCreateTasks}
                  onChange={() => {
                    commitPrefs({ ...prefs, selfCreateTasks: false });
                    setTaskFormOpen(false);
                  }}
                />
                不自建，用编排队列
              </label>
            </div>
          </fieldset>
        </MotionFold>

        {prefs.selfCreateTasks ? null : (
          <p className="callout callout-info">
            当前不自建任务。可到左侧「队列」查看演示里选取的开放项，或把上面改回「自建任务」。
          </p>
        )}

        <BridgeBar
          bridge={bridge}
          canDispatchAll={kingGate.ok}
          dispatchAllReason={kingGate.reason}
          onDispatchAll={dispatchAll}
        />

        {selected.tasks.length === 0 && !(prefs.selfCreateTasks && taskFormOpen) ? (
          <EmptyState
            title={PROJECT_COPY.noTasksTitle.zh}
            titleEn={PROJECT_COPY.noTasksTitle.en}
            description={
              prefs.selfCreateTasks
                ? "登记任务后，再为其指定执行器与模型。不会预选通道，也不会自动派发。"
                : "当前为「不自建，用编排队列」。如需自己添加任务，请改回「自建任务」。"
            }
            action={
              prefs.selfCreateTasks ? (
                <button
                  type="button"
                  className="icon-btn add-channel-btn"
                  onClick={() => setTaskFormOpen(true)}
                >
                  <ArchiveText zh={ACTION.newTask.zh} en={ACTION.newTask.en} />
                </button>
              ) : null
            }
          />
        ) : (
          <ul className="task-list motion-cards">
            {roots.map((root) => (
              <TaskGroup
                key={root.task_id}
                root={root}
                subtasks={childrenByParent.get(root.task_id) ?? []}
                channels={channels}
                prefs={prefs}
                bridge={bridge}
                scannerBoard={scannerBoard}
                preferredModels={preferredModels}
                aiRoles={selected.ai_roles ?? []}
                canStartMeeting={kingExecutionGate(selected).ok}
                startBlockedReason={kingExecutionGate(selected).reason}
                onChangeTask={updateTask}
                onAddTask={addTask}
                onRemoveTask={removeTask}
                onWriteRoleToRoster={writeTaskRoleToRoster}
              />
            ))}
          </ul>
        )}

        <KnowledgeBasePanel online={bridge.online} projectId={selected.project_id} />

        {prefs.selfCreateTasks && taskFormOpen ? (
          <NewTaskForm
            projectId={selected.project_id}
            onCancel={() => setTaskFormOpen(false)}
            onCreate={(task) => {
              addTask(task);
              setTaskFormOpen(false);
            }}
          />
        ) : null}

        <ProjectAiRoster
          project={selected}
          channels={channels}
          prefs={prefs}
          bridge={bridge}
          scannerBoard={scannerBoard}
          preferredModels={preferredModels}
          onChange={updateProject}
        />

        {projectFormOpen ? (
          <NewProjectForm onCancel={closeProjectForm} onCreate={handleCreateProject} />
        ) : null}
          </>
        )}
      </MotionSurface>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="project-workspace">
        <EmptyState
          title={PROJECT_COPY.emptyTitle.zh}
          titleEn={PROJECT_COPY.emptyTitle.en}
          description={PROJECT_COPY.emptyDescription}
          action={
            <button
              type="button"
              className="icon-btn add-channel-btn"
              onClick={() => setProjectFormOpen(true)}
            >
              <ArchiveText zh={ACTION.newProject.zh} en={ACTION.newProject.en} />
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="project-workspace">
      <header className="project-workspace-head">
        <div className="project-workspace-titles">
          <h2>
            <ArchiveText zh={ACTION.allProjects.zh} en={ACTION.allProjects.en} />
          </h2>
          <p className="hint">{PROJECT_COPY.listHint}</p>
        </div>
        <div className="project-workspace-tools">
          {modelControl}
          <button
            type="button"
            className="icon-btn add-channel-btn"
            onClick={() => setProjectFormOpen(true)}
          >
            <ArchiveText zh={ACTION.newProject.zh} en={ACTION.newProject.en} />
          </button>
        </div>
      </header>

      {projectFormOpen ? (
        <NewProjectForm onCancel={closeProjectForm} onCreate={handleCreateProject} />
      ) : null}

      <ul className="project-summary-list motion-cards">
        {projects.map((project, index) => {
          const roots = project.tasks.filter((t) => !t.parent_task_id).length;
          const pieces = project.tasks.length - roots;
          return (
            <li key={project.project_id} className="project-summary-item" style={waveStyle(index)}>
              <button
                type="button"
                className="project-summary-card motion-card"
                onClick={(e) => openProject(project.project_id, e.currentTarget)}
              >
                <span className="project-summary-title">
                  <RoundtableMark />
                  <strong>{project.name}</strong>
                  {isArthurSampleProject(project.project_id) ? (
                    <span className="project-sample-badge">
                      <ArchiveText zh={PROJECT_COPY.sampleBadge.zh} en={PROJECT_COPY.sampleBadge.en} />
                    </span>
                  ) : null}
                </span>
                <span className="muted">
                  {project.tasks.length === 0 ? (
                    "尚无任务"
                  ) : (
                    <>
                      <RollingCount value={roots} /> 条任务
                      {pieces > 0 ? (
                        <>
                          {" · "}
                          <RollingCount value={pieces} /> 条分工
                        </>
                      ) : null}
                    </>
                  )}
                </span>
                {project.notes ? <span className="hint">{project.notes}</span> : null}
              </button>
              <button
                type="button"
                className="danger-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteProject(project);
                }}
              >
                <ArchiveText zh={ACTION.deleteProject.zh} en={ACTION.deleteProject.en} />
              </button>
            </li>
          );
        })}
      </ul>

      <KnowledgeBasePanel online={bridge.online} projectId={null} />
    </div>
  );
}

function applyRosterRole(task: ProjectTask, role: ProjectAiRole): ProjectTask {
  const executorChanged =
    Boolean(role.executor_channel_id) && role.executor_channel_id !== task.executor_channel_id;
  return {
    ...task,
    role_id: role.role_id,
    role_name: role.name,
    duty: role.duty || null,
    persona: role.persona?.trim() || null,
    portrait_id: role.portrait_id ?? null,
    executor_channel_id: role.executor_channel_id ?? task.executor_channel_id,
    model: role.model ?? task.model,
    dispatch_intent_at: executorChanged ? undefined : task.dispatch_intent_at,
  };
}

function RoleAssignmentFields({
  task,
  aiRoles,
  onChange,
  onWriteToRoster,
  compact,
  expanded,
}: {
  task: ProjectTask;
  aiRoles: ProjectAiRole[];
  onChange: (next: ProjectTask) => void;
  onWriteToRoster: (task: ProjectTask) => void;
  compact?: boolean;
  expanded?: boolean;
}) {
  const bound = aiRoles.find((role) => role.role_id === task.role_id) ?? null;
  const isCustom =
    !bound &&
    Boolean(
      (task.role_name ?? "").trim() ||
        (task.duty ?? "").trim() ||
        (task.persona ?? "").trim() ||
        task.portrait_id ||
        task.role_id,
    );
  const selectValue = bound ? bound.role_id : isCustom ? "__custom__" : "";
  const duty = (task.duty ?? bound?.duty ?? "").trim();
  const name = (task.role_name ?? bound?.name ?? "").trim();
  const persona = (task.persona ?? bound?.persona ?? "").trim();
  const editingCustom = selectValue === "__custom__";
  // Compact rows always show one-off fields so a 临时角色 can be filled without hunting.
  // Bound duty is visible on the line; the textarea opens when 说明 is expanded.
  const showEdit = editingCustom || (!compact && Boolean(bound)) || Boolean(compact && expanded && bound);
  const showDutyLine = Boolean(compact && duty && !editingCustom);

  function handleSelect(value: string) {
    if (!value) {
      onChange({
        ...task,
        role_id: null,
        role_name: null,
        duty: null,
        persona: null,
        portrait_id: null,
      });
      return;
    }
    if (value === "__custom__") {
      onChange({
        ...task,
        role_id: null,
        role_name: task.role_name ?? bound?.name ?? "",
        duty: task.duty ?? bound?.duty ?? "",
        persona: task.persona ?? bound?.persona ?? "",
        portrait_id: task.portrait_id ?? bound?.portrait_id ?? null,
      });
      return;
    }
    const role = aiRoles.find((item) => item.role_id === value);
    if (!role) return;
    onChange(applyRosterRole(task, role));
  }

  return (
    <div className={`role-assign ${compact ? "is-compact" : ""}`}>
      <div className="role-assign-seat">
        <label className="field task-row-control">
          <span className={compact ? "visually-hidden" : undefined}>
            <ArchiveText zh={AI_DIVISION.role.zh} en={AI_DIVISION.role.en} />
          </span>
          <ArchiveSelect
            value={selectValue}
            onChange={handleSelect}
            aria-label={`${task.title || "任务"} 的角色`}
            options={[
              { value: "", label: AI_DIVISION.unassigned },
              ...(bound?.seat === "king" ? aiRoles : knightsOf(aiRoles)).map((role) => ({
                value: role.role_id,
                label:
                  role.seat === "king"
                    ? `${kingDisplayName(role)} / ${AI_DIVISION.king.en}`
                    : role.name.trim() || "未命名骑士",
              })),
              { value: "__custom__", label: AI_DIVISION.customLabel(editingCustom ? name : "") },
            ]}
          />
        </label>
      </div>
      {showDutyLine ? (
        <p className="role-assign-duty" title={duty}>
          <ArchiveText zh={AI_DIVISION.duty.zh} en={AI_DIVISION.duty.en} />
          {duty}
        </p>
      ) : null}
      {showEdit ? (
        <div className="role-assign-edit">
          {editingCustom ? (
            <>
              <label className="field">
                <span>
                  <ArchiveText zh={AI_DIVISION.role.zh} en={AI_DIVISION.role.en} />
                </span>
                <input
                  value={task.role_name ?? ""}
                  placeholder={AI_DIVISION.namePlaceholder}
                  onChange={(e) =>
                    onChange({
                      ...task,
                      role_id: null,
                      role_name: e.target.value,
                    })
                  }
                  aria-label="临时角色名称"
                />
              </label>
            </>
          ) : null}
          <label className="field">
            <span>
              <ArchiveText zh={AI_DIVISION.duty.zh} en={AI_DIVISION.duty.en} />
            </span>
            <textarea
              value={task.duty ?? ""}
              placeholder={AI_DIVISION.dutyPlaceholder}
              rows={2}
              onChange={(e) => onChange({ ...task, duty: e.target.value })}
              aria-label="职能"
            />
          </label>
          {editingCustom && name ? (
            <button
              type="button"
              className="text-btn"
              onClick={() =>
                onWriteToRoster({
                  ...task,
                  role_name: name,
                  duty: duty || null,
                  persona: persona || null,
                  portrait_id: task.portrait_id ?? null,
                })
              }
            >
              <ArchiveText zh={ACTION.writeToRoster.zh} en={ACTION.writeToRoster.en} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function assignAdviceTaskId(projectId: string): string {
  return `${projectId}::roster-assign`;
}

interface ProposedAssignment {
  name: string;
  duty: string;
  persona: string;
  portrait_id: string | null;
  recommended_executor: string | null;
  attach_task_id: string | null;
  new_subtask: boolean;
  parent_task_id: string | null;
  subtask_title: string;
  subtask_description: string;
}

/** Leaves if any exist; otherwise root tasks. These are the rows a role would sit on. */
function assignableTasks(project: Project): ProjectTask[] {
  const leaves = project.tasks.filter((task) => task.parent_task_id);
  if (leaves.length) return leaves;
  return project.tasks.filter((task) => !task.parent_task_id);
}

function canSplitSingleRoot(project: Project): boolean {
  const roots = project.tasks.filter((task) => !task.parent_task_id);
  const leaves = project.tasks.filter((task) => task.parent_task_id);
  return roots.length === 1 && leaves.length === 0;
}

function matchTaskByTitle(project: Project, title: string): ProjectTask | null {
  const needle = title.trim().toLowerCase();
  if (!needle) return null;
  const exact = project.tasks.find((task) => task.title.trim().toLowerCase() === needle);
  if (exact) return exact;
  const loose = project.tasks.find((task) => {
    const hay = task.title.trim().toLowerCase();
    return hay.includes(needle) || needle.includes(hay);
  });
  return loose ?? null;
}

function parseRoleAssignments(
  reply: string,
  project: Project,
  executorIds: string[],
): ProposedAssignment[] | null {
  const fenced = /```[a-zA-Z]*\s*([\s\S]*?)```/.exec(reply);
  const body = fenced ? fenced[1] : reply;
  const arrayStart = body.indexOf("[");
  const objStart = body.indexOf("{");
  let parsed: unknown;
  try {
    if (arrayStart >= 0 && (objStart < 0 || arrayStart <= objStart)) {
      const end = body.lastIndexOf("]");
      if (end <= arrayStart) return null;
      parsed = JSON.parse(body.slice(arrayStart, end + 1));
    } else if (objStart >= 0) {
      const end = body.lastIndexOf("}");
      if (end <= objStart) return null;
      parsed = JSON.parse(body.slice(objStart, end + 1));
    } else {
      return null;
    }
  } catch {
    return null;
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { roles?: unknown }).roles)
      ? (parsed as { roles: unknown[] }).roles
      : null;
  if (!rows) return null;

  const allowSplit = canSplitSingleRoot(project);
  const soleRoot = allowSplit ? project.tasks.find((task) => !task.parent_task_id) ?? null : null;
  const items: ProposedAssignment[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || isKingName(name)) continue;
    const attachId =
      typeof r.attach_task_id === "string" && project.tasks.some((task) => task.task_id === r.attach_task_id)
        ? r.attach_task_id
        : null;
    const attachTitle =
      typeof r.attach_title === "string"
        ? r.attach_title
        : typeof r.subtask_title === "string"
          ? r.subtask_title
          : "";
    const matched = attachId ? project.tasks.find((task) => task.task_id === attachId) ?? null : matchTaskByTitle(project, attachTitle);
    const wantNew = r.new_subtask === true && allowSplit;
    const recommended =
      typeof r.recommended_executor === "string" && executorIds.includes(r.recommended_executor)
        ? r.recommended_executor
        : typeof r.recommended_executor_channel_id === "string" &&
            executorIds.includes(r.recommended_executor_channel_id)
          ? r.recommended_executor_channel_id
          : null;
    const parentId =
      typeof r.parent_task_id === "string" && project.tasks.some((task) => task.task_id === r.parent_task_id)
        ? r.parent_task_id
        : soleRoot?.task_id ?? null;
    items.push({
      name,
      duty: typeof r.duty === "string" ? r.duty.trim() : "",
      persona: typeof r.persona === "string" ? r.persona.trim() : "",
      portrait_id: isPersonaPortraitId(r.portrait_id) ? r.portrait_id : null,
      recommended_executor: recommended,
      attach_task_id: wantNew ? null : (matched?.task_id ?? attachId),
      new_subtask: wantNew,
      parent_task_id: wantNew ? parentId : null,
      subtask_title:
        typeof r.subtask_title === "string" && r.subtask_title.trim()
          ? r.subtask_title.trim()
          : name,
      subtask_description: typeof r.subtask_description === "string" ? r.subtask_description.trim() : "",
    });
  }
  if (!items.length) return null;
  return items.slice(0, 6);
}

/** Conservative local draft: one seat per existing assignable task, no invented team, no executor. */
function localAssignmentDraft(project: Project): ProposedAssignment[] {
  const tasks = assignableTasks(project).slice(0, 6);
  const items = tasks.map((task) => ({
    name: isKingName(task.title) ? `${task.title.trim()}（骑士）` : task.title.trim() || "未命名骑士",
    duty: task.description.trim() || "负责完成本条任务，并说明如何验收。",
    persona: "",
    portrait_id: null as string | null,
    recommended_executor: null as string | null,
    attach_task_id: task.task_id,
    new_subtask: false,
    parent_task_id: null as string | null,
    subtask_title: "",
    subtask_description: "",
  }));
  return items;
}

function assignmentPrompt(project: Project, executorIds: string[]): string {
  const tasks = project.tasks
    .map((task) => {
      const kind = task.parent_task_id ? `parent=${task.parent_task_id}` : "根任务";
      return `- task_id=${task.task_id} | ${kind} | title=${task.title}${task.description ? ` | description=${task.description}` : ""}`;
    })
    .join("\n");
  const maySplit = canSplitSingleRoot(project);
  return [
    "你在为圆桌会议分配骑士与职能，不是执行任务。不要写代码，不要改文件，不要派发任何工作。",
    "",
    `会议名称：${project.name}`,
    project.notes ? `会议说明：${project.notes}` : "",
    "",
    "国王是固定席位，已存在，不要建议国王，也不要把任何角色命名为「国王」或 King。只需建议骑士。",
    "",
    "现有任务（请尽量把骑士派到这些任务上；不要无故新增分工）：",
    tasks || "（还没有任务）",
    "",
    "请建议 2-6 个骑士。只输出一个 JSON 数组，不要解释，不要 markdown 代码块。每个元素的字段：",
    '{"name":"骑士名，短，不要用国王或 King","duty":"职能：负责什么、如何验收、如何与其他角色配合","recommended_executor":"可空","attach_task_id":"要派给的现有 task_id，没有合适的就空字符串","new_subtask":false,"parent_task_id":"仅当 new_subtask 为 true","subtask_title":"仅当 new_subtask 为 true","subtask_description":"仅当 new_subtask 为 true"}',
    "",
    `recommended_executor 的取值只能从这些里挑：${executorIds.join("、") || "（本机没有可派发的执行器）"}。不要假设某个 AI 一定可用。`,
    maySplit
      ? "这场会议目前只有一条根任务。只有在工作明显需要拆开时，才可以把 new_subtask 设为 true，并为新分工填写 parent_task_id、subtask_title、subtask_description。"
      : "已有任务或分工时，请把角色派到现有任务，不要再拆，也不要把 new_subtask 设为 true。",
    "建议只是建议。角色、职能、执行器都要等人确认后才写入。不要执行这些任务。",
  ]
    .filter(Boolean)
    .join("\n");
}

function applyAssignmentProposal(
  project: Project,
  proposals: ProposedAssignment[],
): Project {
  const king = kingOf(project.ai_roles) ?? createKingRole(project.project_id);
  const knightProposals = proposals.filter((item) => !isKingName(item.name));
  const roles: ProjectAiRole[] = [
    king,
    ...knightProposals.map((item) => ({
      role_id: newId("role"),
      seat: "knight" as const,
      name: item.name,
      duty: item.duty,
      persona: item.persona,
      portrait_id: item.portrait_id,
      executor_channel_id: item.recommended_executor,
      model: null,
    })),
  ];
  const knights = roles.filter((role) => role.seat === "knight");
  let tasks = project.tasks.map((task) => ({ ...task }));
  knightProposals.forEach((item, index) => {
    const role = knights[index];
    if (!role) return;
    if (item.new_subtask && item.parent_task_id) {
      const parent = tasks.find((task) => task.task_id === item.parent_task_id);
      if (!parent) return;
      const created: ProjectTask = applyRosterRole(
        {
          task_id: newId("task"),
          project_id: project.project_id,
          title: item.subtask_title || item.name,
          description: item.subtask_description,
          priority: parent.priority,
          executor_channel_id: null,
          model: null,
          parent_task_id: parent.task_id,
        },
        role,
      );
      tasks.push(created);
      return;
    }
    if (!item.attach_task_id) return;
    tasks = tasks.map((task) => (task.task_id === item.attach_task_id ? applyRosterRole(task, role) : task));
  });
  return { ...project, ai_roles: roles, tasks };
}

function seatAngle(index: number, count: number): string {
  if (count <= 0) return "-90deg";
  const step = 360 / count;
  return `${step * index - 90}deg`;
}

function ProjectAiRoster({
  project,
  channels,
  prefs,
  bridge,
  scannerBoard,
  preferredModels,
  onChange,
}: {
  project: Project;
  channels: ExternalChannel[];
  prefs: ProjectBoardPrefs;
  bridge: BridgeView;
  scannerBoard?: ScannerBoardView;
  preferredModels: PreferredModels;
  onChange: (next: Project) => void;
}) {
  const roles = ensureRosterRoles(project.ai_roles, project.project_id);
  const king = kingOf(roles);
  const knights = knightsOf(roles);
  const usable = Array.from(BRIDGE_EXECUTORS).filter((id) => channels.some((ch) => ch.id === id));
  const [advisor, setAdvisor] = useState(() => usable[0] ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [previewSource, setPreviewSource] = useState<"ai" | "local" | null>(null);
  const [localPreview, setLocalPreview] = useState<ProposedAssignment[] | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const usableKey = usable.join(",");
  useEffect(() => {
    if (advisor && usableKey.split(",").includes(advisor)) return;
    const first = usableKey.split(",").filter(Boolean)[0];
    if (first) setAdvisor(first);
  }, [usableKey, advisor]);

  const assignTaskId = assignAdviceTaskId(project.project_id);
  const record = bridge.dispatches.find((d) => d.task_id === assignTaskId) ?? null;
  const aiPreview = useMemo(
    () => (previewSource === "ai" && record?.reply ? parseRoleAssignments(record.reply, project, usable) : null),
    [previewSource, record?.reply, project, usableKey],
  );
  const preview = previewSource === "local" ? localPreview : aiPreview;
  const hasTasks = project.tasks.length > 0;
  const waiting = Boolean(
    previewSource === "ai" &&
      record &&
      (record.state === "queued" || record.state === "running"),
  );

  function updateRoles(next: ProjectAiRole[]) {
    onChange({ ...project, ai_roles: ensureRosterRoles(next, project.project_id) });
  }

  function addKnight() {
    updateRoles([
      ...roles,
      {
        role_id: newId("role"),
        seat: "knight",
        name: "",
        duty: "",
        persona: "",
        portrait_id: null,
        executor_channel_id: null,
        model: null,
      },
    ]);
  }

  function updateRole(next: ProjectAiRole) {
    const current = roles.find((role) => role.role_id === next.role_id);
    if (current?.seat === "king" || next.seat === "king") {
      updateRoles(
        roles.map((role) =>
          role.role_id === next.role_id
            ? createKingRole(project.project_id, {
                role_id: current?.role_id ?? next.role_id,
                name: current?.name ?? next.name,
                persona: next.persona,
                portrait_id: next.portrait_id,
                executor_channel_id: next.executor_channel_id,
                model: next.model,
              })
            : role,
        ),
      );
      return;
    }
    updateRoles(roles.map((role) => (role.role_id === next.role_id ? { ...next, seat: "knight" } : role)));
  }

  function removeRole(role: ProjectAiRole) {
    if (role.seat === "king") return;
    const used = project.tasks.filter((task) => task.role_id === role.role_id);
    if (used.length && !window.confirm(deleteAiRoleConfirm(role.name, used.length))) return;
    onChange({
      ...project,
      ai_roles: ensureRosterRoles(
        roles.filter((item) => item.role_id !== role.role_id),
        project.project_id,
      ),
      tasks: project.tasks.map((task) =>
        task.role_id === role.role_id ? { ...task, role_id: null } : task,
      ),
    });
  }

  const reportItems = collectRoundResults(project, bridge.dispatches);
  const reportRecord = bridge.dispatches.find((item) => item.task_id === kingReportTaskId(project.project_id)) ?? null;
  const kingIsGui = Boolean(king?.executor_channel_id && isGuiKingExecutor(king.executor_channel_id));
  const canReport = kingIsGui && reportItems.length > 0;
  const reportBlockedReason = !king?.executor_channel_id
    ? AI_DIVISION.reportNeedKing
    : !kingIsGui
      ? AI_DIVISION.kingExecutorNeedGui
      : reportItems.length === 0
        ? AI_DIVISION.reportNeedResults
        : "";

  async function reportToKing() {
    if (!king?.executor_channel_id || !isGuiKingExecutor(king.executor_channel_id) || !reportItems.length) return;
    setReportError(null);
    if (!bridge.online) {
      setReportError("桥接未启动，无法把本轮记录发给国王。启动本机桥接后再试。");
      return;
    }
    setReporting(true);
    const err = await bridge.dispatch({
      executor: king.executor_channel_id,
      prompt: kingReportPrompt(project, king, reportItems),
      task_id: kingReportTaskId(project.project_id),
      project_id: project.project_id,
      title: `国王汇报：${project.name}`,
      model: resolveDispatchModel({
        taskModel: king.model,
        preferred: preferredModels[king.executor_channel_id] ?? "",
        boardDefault: prefs.defaultModel,
        catalog: catalogForExecutor(scannerBoard, king.executor_channel_id),
      }),
    });
    setReporting(false);
    if (err) setReportError(err);
  }

  function openLocalDraft() {
    setError(null);
    setPreviewSource("local");
    setLocalPreview(localAssignmentDraft(project));
    setOfferOpen(true);
    setSending(false);
  }

  async function requestAssignment() {
    if (!hasTasks) return;
    if (knights.some((role) => role.name.trim() || role.duty.trim()) && !window.confirm(ASSIGN_ROLES.replaceConfirm)) {
      return;
    }
    setOfferOpen(true);
    setLocalPreview(null);
    setError(null);
    if (!bridge.online || !advisor) {
      setPreviewSource(null);
      setError(advisor ? ASSIGN_ROLES.offline : ASSIGN_ROLES.noExecutor);
      return;
    }
    setPreviewSource("ai");
    setSending(true);
    const err = await bridge.dispatch({
      executor: advisor,
      prompt: assignmentPrompt(project, usable),
      task_id: assignTaskId,
      project_id: project.project_id,
      title: `角色分配建议：${project.name}`,
      model: resolveDispatchModel({
        taskModel: null,
        preferred: preferredModels[advisor] ?? "",
        boardDefault: prefs.defaultModel,
        catalog: catalogForExecutor(scannerBoard, advisor),
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      setPreviewSource(null);
    }
  }

  function applyPreview() {
    if (!preview?.length) return;
    onChange(applyAssignmentProposal(project, preview));
    setOfferOpen(false);
    setPreviewSource(null);
    setLocalPreview(null);
    setError(null);
  }

  function dismissPreview() {
    setOfferOpen(false);
    setPreviewSource(null);
    setLocalPreview(null);
    setError(null);
    setSending(false);
  }

  const seatCount = roles.length;
  const crowded = seatCount > 8;

  return (
    <section className="project-ai-roster" aria-label={AI_DIVISION.titleZh}>
      <div className="project-ai-roster-head">
        <div>
          <h3>
            <ArchiveText zh={AI_DIVISION.titleZh} en={AI_DIVISION.titleEn} />
          </h3>
          <p className="hint">{AI_DIVISION.hint}</p>
        </div>
        <div className="project-ai-roster-tools">
          <label className="field task-row-control">
            <span>
              <ArchiveText zh={ASSIGN_ROLES.consult.zh} en={ASSIGN_ROLES.consult.en} />
            </span>
            <ArchiveSelect
              value={advisor}
              onChange={setAdvisor}
              aria-label={ASSIGN_ROLES.consult.zh}
              disabled={!hasTasks}
              options={usableExecutorOptions(usable, channels, "没有可征询的执行器")}
            />
          </label>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void requestAssignment()}
            disabled={!hasTasks || sending}
            title={hasTasks ? ASSIGN_ROLES.hint : ASSIGN_ROLES.noTasksHint}
          >
            <ArchiveText
              zh={sending ? ASSIGN_ROLES.requesting.zh : ACTION.assignFromTask.zh}
              en={sending ? ASSIGN_ROLES.requesting.en : ACTION.assignFromTask.en}
            />
          </button>
          <button type="button" className="icon-btn" onClick={addKnight}>
            <ArchiveText zh={ACTION.addRole.zh} en={ACTION.addRole.en} />
          </button>
        </div>
      </div>
      {!hasTasks ? <p className="hint">{ASSIGN_ROLES.noTasksHint}</p> : <p className="hint">{ASSIGN_ROLES.hint}</p>}

      <div
        className={`roundtable${seatCount === 0 ? " is-empty" : ""}${crowded ? " is-crowded" : ""}`}
        aria-label={AI_DIVISION.roundtable.zh}
        style={{ "--seat-count": Math.max(seatCount, 1) } as CSSProperties}
      >
        <div className="roundtable-surface" aria-hidden={seatCount === 0 ? undefined : true}>
          <div className="roundtable-center">
            <span className="roundtable-center-name">{project.name || AI_DIVISION.roundtable.zh}</span>
            <span className="title-en">{AI_DIVISION.roundtable.en}</span>
          </div>
        </div>
        {seatCount === 0 ? (
          <ul className="roundtable-seats" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <li
                key={`vacant-${index}`}
                className="roundtable-seat is-vacant"
                style={{ "--seat-angle": seatAngle(index, 4) } as CSSProperties}
              >
                <span className="roundtable-seat-card">
                  <span className="roundtable-vacant" />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="roundtable-seats">
            {roles.map((role, index) => (
              <li
                key={role.role_id}
                className={`roundtable-seat${role.seat === "king" ? " is-king" : ""}`}
                style={{ "--seat-angle": seatAngle(index, seatCount) } as CSSProperties}
              >
                <span className="roundtable-seat-card">
                  <span className="roundtable-seat-name">
                    {role.seat === "king" ? kingDisplayName(role) : role.name.trim() || "未命名骑士"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {offerOpen ? (
        <div className="assign-preview">
          <p className="assign-preview-title">
            {previewSource === "local" ? (
              <ArchiveText zh={ASSIGN_ROLES.localDraftTitle.zh} en={ASSIGN_ROLES.localDraftTitle.en} />
            ) : (
              <ArchiveText zh={ASSIGN_ROLES.previewTitle.zh} en={ASSIGN_ROLES.previewTitle.en} />
            )}
          </p>
          <p className="hint">
            {previewSource === "local" ? ASSIGN_ROLES.localDraftHint : ASSIGN_ROLES.aiHint}
          </p>
          {sending || waiting ? <p className="muted">{ASSIGN_ROLES.thinking}</p> : null}
          {error ? (
            <p className="callout callout-warn">
              {ASSIGN_ROLES.failed}
              {error ? ` ${error}` : ""}
            </p>
          ) : null}
          {previewSource === "ai" && record && record.state === "failed" ? (
            <p className="callout callout-warn">
              {ASSIGN_ROLES.failed}
              {record.error ? ` ${record.error}` : ""}
            </p>
          ) : null}
          {previewSource === "ai" && record && record.reply && !aiPreview && !waiting && !sending ? (
            <>
              <p className="muted">{ASSIGN_ROLES.parseFail}</p>
              <blockquote className="dispatch-reply">{(record.reply || "").slice(0, 600)}</blockquote>
            </>
          ) : null}
          {preview?.length ? (
            <ul className="assign-preview-list">
              {preview.map((item, index) => {
                const attached = item.attach_task_id
                  ? project.tasks.find((task) => task.task_id === item.attach_task_id)
                  : null;
                return (
                  <li key={`${item.name}-${index}`}>
                    <div className="assign-preview-body">
                      <strong>{item.name}</strong>
                      {item.duty ? <span className="hint">{item.duty}</span> : null}
                      <span className="muted">
                        {item.new_subtask
                          ? `${ASSIGN_ROLES.newSubtask}：${item.subtask_title}`
                          : attached
                            ? `${ASSIGN_ROLES.attachTo}：${attached.title}`
                            : ASSIGN_ROLES.rosterOnly}
                        {" · "}
                        {item.recommended_executor
                          ? channels.find((ch) => ch.id === item.recommended_executor)?.title ??
                            item.recommended_executor
                          : ASSIGN_ROLES.noExecutorNamed}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <p className="hint">{ASSIGN_ROLES.applyNote}</p>
          <div className="assign-preview-actions">
            <button
              type="button"
              className="icon-btn add-channel-btn"
              onClick={applyPreview}
              disabled={!preview?.length}
            >
              <ArchiveText zh={ACTION.applyAssignment.zh} en={ACTION.applyAssignment.en} />
            </button>
            <button type="button" className="text-btn" onClick={openLocalDraft}>
              <ArchiveText zh={ACTION.useLocalDraft.zh} en={ACTION.useLocalDraft.en} />
            </button>
            <button type="button" className="text-btn" onClick={dismissPreview}>
              <ArchiveText zh={ACTION.dismissAssignment.zh} en={ACTION.dismissAssignment.en} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="king-report">
        <p className="hint">{AI_DIVISION.reportHint}</p>
        <button
          type="button"
          className="icon-btn add-channel-btn"
          onClick={() => void reportToKing()}
          disabled={!canReport || reporting}
          title={reportBlockedReason || AI_DIVISION.reportHint}
        >
          <ArchiveText
            zh={reporting ? AI_DIVISION.reporting.zh : ACTION.reportToKing.zh}
            en={reporting ? AI_DIVISION.reporting.en : ACTION.reportToKing.en}
          />
        </button>
        {reportBlockedReason ? <p className="hint">{reportBlockedReason}</p> : null}
        {reportError ? <p className="callout callout-warn">{reportError}</p> : null}
        {reportRecord ? <DispatchResult record={reportRecord} /> : null}
      </div>

      <ul className="project-ai-role-list">
        {roles.map((role) => (
          <AiRoleRow
            key={role.role_id}
            role={role}
            channels={channels}
            prefs={prefs}
            bridge={bridge}
            scannerBoard={scannerBoard}
            preferredModels={preferredModels}
            onChange={updateRole}
            onRemove={() => removeRole(role)}
          />
        ))}
      </ul>
    </section>
  );
}

function AiRoleRow({
  role,
  channels,
  prefs,
  bridge,
  scannerBoard,
  preferredModels,
  onChange,
  onRemove,
}: {
  role: ProjectAiRole;
  channels: ExternalChannel[];
  prefs: ProjectBoardPrefs;
  bridge: BridgeView;
  scannerBoard?: ScannerBoardView;
  preferredModels: PreferredModels;
  onChange: (next: ProjectAiRole) => void;
  onRemove: () => void;
}) {
  const catalog = catalogForExecutor(scannerBoard, role.executor_channel_id);
  const preferred = role.executor_channel_id ? preferredModels[role.executor_channel_id] || "" : "";
  const dispatchModel = resolveDispatchModel({
    taskModel: role.model,
    preferred,
    boardDefault: prefs.defaultModel,
    catalog,
  });
  const followLabel = modelFollowLabel(prefs, preferred, dispatchModel);
  const liveChoices = useLiveModels(role.executor_channel_id, bridge.online);
  const choices = modelChoices(
    prefs,
    { model: role.model } as ProjectTask,
    preferred,
    catalog,
    liveChoices,
  );

  const isKing = role.seat === "king";
  const seatCopy = isKing ? AI_DIVISION.king : AI_DIVISION.knight;
  const shownName = isKing ? kingDisplayName(role) : role.name || AI_DIVISION.knight.zh;
  const executorLabel = `${shownName} 的执行器`;
  const modelLabel = `${shownName} 的模型`;

  return (
    <li className={`project-ai-role${isKing ? " is-king" : " is-knight"}`}>
      <p className="project-ai-role-seat">
        <ArchiveText zh={seatCopy.zh} en={seatCopy.en} />
      </p>
      <div className="project-ai-role-identity">
        {isKing ? (
          <div className="project-ai-role-king-copy">
            {kingDisplayName(role) !== AI_DIVISION.king.zh ? (
              <p className="project-ai-role-name">{kingDisplayName(role)}</p>
            ) : null}
            <p className="project-ai-role-duty-fixed">
              <span className="field-label">
                <ArchiveText zh={AI_DIVISION.duty.zh} en={AI_DIVISION.duty.en} />
              </span>
              {AI_DIVISION.kingDuty}
            </p>
          </div>
        ) : (
          <label className="field">
            <span>
              <ArchiveText zh={AI_DIVISION.role.zh} en={AI_DIVISION.role.en} />
            </span>
            <input
              value={role.name}
              placeholder={AI_DIVISION.namePlaceholder}
              onChange={(e) => onChange({ ...role, name: e.target.value })}
              aria-label="骑士名称"
            />
          </label>
        )}
      </div>
      {isKing ? (
        <p className="hint">{AI_DIVISION.kingHint}</p>
      ) : (
        <label className="field project-ai-role-duty">
          <span>
            <ArchiveText zh={AI_DIVISION.duty.zh} en={AI_DIVISION.duty.en} />
          </span>
          <textarea
            value={role.duty}
            placeholder={AI_DIVISION.dutyPlaceholder}
            rows={2}
            onChange={(e) => onChange({ ...role, duty: e.target.value })}
            aria-label="职能"
          />
        </label>
      )}
      <div className="project-ai-role-tools">
      <label className="field task-row-control">
        <span>执行器</span>
        <ArchiveSelect
          value={role.executor_channel_id ?? ""}
          onChange={(value) =>
            onChange({
              ...role,
              executor_channel_id: value ? value : null,
            })
          }
          aria-label={executorLabel}
          options={
            isKing
              ? executorOptions(
                  channels.filter((channel) => isGuiKingExecutor(channel.id)),
                  "请选择带图形界面的执行器",
                )
              : executorOptions(channels)
          }
        />
      </label>
      <label className="field task-row-control">
        <span>模型</span>
        <ArchiveSelect
          value={role.model ?? ""}
          onChange={(value) => onChange({ ...role, model: value ? value : null })}
          aria-label={modelLabel}
          title={
            liveChoices.length
              ? "来自该 AI 会话的真实可选列表，选完后派发该角色的分工才生效"
              : "跟随默认或扫描器发布列表；若该 AI 不接受这个名称，派发会被拒绝并列出可选值"
          }
          options={[
            { value: "", label: followLabel },
            ...choices.map((model) => ({ value: model.value, label: model.label })),
          ]}
        />
      </label>
      {isKing ? null : (
        <button type="button" className="text-btn" onClick={onRemove}>
          <ArchiveText zh={ACTION.deleteRole.zh} en={ACTION.deleteRole.en} />
        </button>
      )}
      </div>
    </li>
  );
}

function TaskRow({
  task,
  channels,
  prefs,
  bridge,
  scannerBoard,
  preferredModels,
  aiRoles,
  latest,
  onChange,
  onRemove,
  onDecompose,
  onWriteRoleToRoster,
}: {
  task: ProjectTask;
  channels: ExternalChannel[];
  prefs: ProjectBoardPrefs;
  bridge: BridgeView;
  scannerBoard?: ScannerBoardView;
  preferredModels: PreferredModels;
  aiRoles: ProjectAiRole[];
  latest: DispatchRecord | null;
  onChange: (next: ProjectTask) => void;
  onRemove: () => void;
  /** Only offered on root tasks: opens the decomposition panel for this task. */
  onDecompose?: () => void;
  onWriteRoleToRoster: (task: ProjectTask) => void;
}) {
  const [open, setOpen] = useState(false);
  const status = describeExecutor(task.executor_channel_id, channels);
  const catalog = catalogForExecutor(scannerBoard, task.executor_channel_id);
  const preferred = task.executor_channel_id ? preferredModels[task.executor_channel_id] || "" : "";
  const dispatchModel = resolveDispatchModel({
    taskModel: task.model,
    preferred,
    boardDefault: prefs.defaultModel,
    catalog,
  });
  const followLabel = modelFollowLabel(prefs, preferred, dispatchModel);
  const effectiveModel = task.model || (dispatchModel ? followLabel : "未指定模型");
  const liveChoices = useLiveModels(task.executor_channel_id, bridge.online);
  const choices = modelChoices(prefs, task, preferred, catalog, liveChoices);

  const [sendError, setSendError] = useState<string | null>(null);
  const canBridge = !!task.executor_channel_id && BRIDGE_EXECUTORS.has(task.executor_channel_id);
  const gate = task.executor_channel_id
    ? executorDispatchGate(task.executor_channel_id, bridge.health, bridge.online)
    : { ok: false, reason: "未指定执行器" };
  const busy = latest ? ["queued", "running", "awaiting_user", "sent_awaiting_result"].includes(latest.state) : false;
  const live = liveExecutorStatus(task.executor_channel_id, channels, bridge.health, status);
  const rowDispatchState = latest
    ? DISPATCH_LABEL[latest.state] ?? { text: latest.state, tone: "neutral" }
    : { text: "尚未派发", tone: "neutral" };

  async function handleStart() {
    setSendError(null);
    const err = await sendTask(task, {
      bridge,
      prefs,
      preferredModels,
      scannerBoard,
      onIntent: () => onChange({ ...task, dispatch_intent_at: new Date().toISOString() }),
    });
    if (err) setSendError(err);
  }

  return (
    <li className={`task-row ${task.priority === "P0" ? "p0" : ""} ${open ? "is-open" : ""}`}>
      <div className={`task-row-main ${onDecompose ? "has-decompose" : ""}`}>
        <span className={`pill ${task.priority === "P0" ? "p0" : ""}`}>{task.priority}</span>
        <div className="task-row-identity">
          <button
            type="button"
            className="task-row-title"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {task.title}
          </button>
        </div>
        <label className="field task-row-control">
          <span className="visually-hidden">执行器</span>
          <ArchiveSelect
            value={task.executor_channel_id ?? ""}
            onChange={(value) =>
              onChange({
                ...task,
                executor_channel_id: value ? value : null,
                dispatch_intent_at: undefined,
              })
            }
            aria-label={`${task.title} 的执行器`}
            options={executorOptions(channels)}
          />
        </label>
        <label className="field task-row-control">
          <span className="visually-hidden">模型</span>
          <ArchiveSelect
            value={task.model ?? ""}
            onChange={(value) =>
              onChange({
                ...task,
                model: value ? value : null,
              })
            }
            aria-label={`${task.title} 的模型`}
            title={
              liveChoices.length
                ? "来自该 AI 会话的真实可选列表，选完点派发才生效"
                : "来自扫描器的发布列表；若该 AI 不接受这个名称，派发会被拒绝并列出可选值"
            }
            options={[
              { value: "", label: followLabel },
              ...choices.map((model) => ({ value: model.value, label: model.label })),
            ]}
          />
        </label>
        <button
          type="button"
          className="icon-btn"
          disabled={!task.executor_channel_id || busy || (canBridge && bridge.online && !gate.ok)}
          onClick={() => void handleStart()}
          title={
            canBridge && bridge.online && !gate.ok
              ? gate.reason
              : canBridge && bridge.online
                ? "通过本机桥接真实派发"
                : "桥接未连或该执行器无适配器：只记录意向"
          }
        >
          {busy ? "运行中…" : canBridge && bridge.online ? (latest ? "重新派发" : "派发") : "开始"}
        </button>
        {onDecompose ? (
          <button
            type="button"
            className="icon-btn task-row-decompose"
            onClick={onDecompose}
            title="把这条任务拆成多条分工，每条各自选执行器和模型"
          >
            拆解
          </button>
        ) : null}
      </div>

      {!task.executor_channel_id ? (
        <p className="executor-status status-text tone-unverified">
          <strong>未指定执行器</strong>
          <span className="executor-detail"> · 不可开始：未指定执行器</span>
        </p>
      ) : (
        <p className={`executor-status status-text tone-${rowDispatchState.tone}`}>
          <strong>派发状态：{rowDispatchState.text}</strong>
          {live.detail ? <span className="executor-detail"> · {live.detail}</span> : null}
          {task.dispatch_intent_at && !latest ? (
            <span className="executor-detail"> · 已记录下发意向（未真正发送）</span>
          ) : null}
        </p>
      )}

      {sendError ? <p className="callout callout-warn">派发未发出：{sendError}</p> : null}
      {latest ? <DispatchResult record={latest} /> : null}

      {open ? (
        <div className="task-row-editor">
          {task.description ? <p className="hint">{task.description}</p> : <p className="muted">没有补充说明。</p>}
          <RoleAssignmentFields
            task={task}
            aiRoles={aiRoles}
            onChange={onChange}
            onWriteToRoster={onWriteRoleToRoster}
          />
          <KbRefPicker
            online={bridge.online}
            projectId={task.project_id}
            value={task.kb_refs ?? []}
            onChange={(next) => onChange({ ...task, kb_refs: next.length ? next : undefined })}
          />
          <p className="muted">
            当前模型：{effectiveModel}
            {" · "}
            <code>task_id</code> <code className="id">{task.task_id}</code>
            {" · "}
            <code>executor_channel_id</code>{" "}
            {task.executor_channel_id ? <code>{task.executor_channel_id}</code> : "（空）"}
            {" · "}
            <button type="button" className="text-btn" onClick={onRemove}>
              删除任务
            </button>
          </p>
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Task decomposition
 *
 * A decomposed task keeps `tasks` flat: the root row plus one ordinary row per
 * piece of work, linked by `parent_task_id`. The root never dispatches itself
 * once it has pieces — it only reports their progress.
 * ------------------------------------------------------------------ */

interface SendContext {
  bridge: BridgeView;
  prefs: ProjectBoardPrefs;
  preferredModels: PreferredModels;
  scannerBoard?: ScannerBoardView;
  /** Called when the board can only record an intent (no adapter / bridge offline). */
  onIntent: () => void;
}

/**
 * The single send path for standalone rows and subtasks alike. Returns an error
 * message when nothing went out, or null. It never reports a send as done when
 * the board only recorded an intent.
 */
/**
 * Enrich the existing prompt string only. The POST /bridge/dispatch payload
 * shape is unchanged: if the task has no 角色 / 职能 / 内部形象, this is still
 * `description || title`. Role fields are read from the copied task record,
 * not looked up live on the roster.
 */
function dispatchPrompt(task: ProjectTask): string {
  const body = task.description || task.title;
  const name = (task.role_name ?? "").trim();
  const duty = (task.duty ?? "").trim();
  const persona = (task.persona ?? "").trim();
  if (!name && !duty && !persona) return body;
  const lines: string[] = [];
  if (name) lines.push(`你的角色：${name}`);
  if (duty) lines.push(`你的职能：${duty}`);
  if (persona) lines.push(`内部形象：${persona}`);
  lines.push("", `任务：${task.title}`);
  if (task.description.trim() && task.description.trim() !== task.title.trim()) {
    lines.push(`说明：${task.description}`);
  }
  return lines.join("\n");
}

async function sendTask(task: ProjectTask, ctx: SendContext): Promise<string | null> {
  const executor = task.executor_channel_id;
  if (!executor) return null;
  if (!BRIDGE_EXECUTORS.has(executor) || !ctx.bridge.online) {
    ctx.onIntent();
    return null;
  }
  const gate = executorDispatchGate(executor, ctx.bridge.health, ctx.bridge.online);
  if (!gate.ok) return gate.reason || "当前不可派发";
  return ctx.bridge.dispatch({
    executor,
    prompt: dispatchPrompt(task),
    task_id: task.task_id,
    project_id: task.project_id,
    title: task.title,
    ...(task.kb_refs?.length ? { kb_refs: task.kb_refs } : {}),
    model: resolveDispatchModel({
      taskModel: task.model,
      preferred: ctx.preferredModels[executor] ?? "",
      boardDefault: ctx.prefs.defaultModel,
      catalog: catalogForExecutor(ctx.scannerBoard, executor),
    }),
  });
}

function modelFollowLabel(
  prefs: ProjectBoardPrefs,
  preferred: string,
  dispatchModel: string | null,
): string {
  if (preferred) return `跟随该 AI 所选（${preferred}）`;
  if (prefs.defaultModel && dispatchModel === prefs.defaultModel) return `跟随默认（${prefs.defaultModel}）`;
  return prefs.defaultModel ? "未指定模型（默认模型不属于这个 AI）" : "未指定模型";
}

interface ModelChoice {
  value: string;
  label: string;
}

/**
 * The picker prefers the live session list over the scanner's published list:
 * only the session list is what `session/set_config_option` validates against.
 * Values, not display names, are what gets submitted — the session has several
 * models sharing one name (e.g. two "Hy4" tiers), so names are not unique.
 */
function modelChoices(
  prefs: ProjectBoardPrefs,
  task: ProjectTask,
  preferred: string,
  catalog: string[],
  live: ModelChoice[],
): ModelChoice[] {
  const base: ModelChoice[] = live.length
    ? live
    : modelOptions(prefs, task.model || preferred, catalog).map((value) => ({ value, label: value }));
  const out = [...base];
  if (task.model && !out.some((item) => item.value === task.model)) {
    out.push({ value: task.model, label: task.model });
  }
  return out;
}

/** Asks the bridge for the executor's real model list; empty until it answers. */
function useLiveModels(executorId: string | null, online: boolean): ModelChoice[] {
  const [choices, setChoices] = useState<ModelChoice[]>([]);
  useEffect(() => {
    if (!executorId || !online) {
      setChoices([]);
      return;
    }
    let alive = true;
    let attempt = 0;
    async function load() {
      const res = await fetchLiveModels(executorId as string);
      if (!alive) return;
      if (res) {
        const list = res.models
          .filter((m) => m.value)
          .map((m) => ({ value: m.value, label: m.name || m.value }));
        const seen = new Map<string, number>();
        for (const item of list) seen.set(item.label, (seen.get(item.label) ?? 0) + 1);
        setChoices(
          list.map((item) =>
            (seen.get(item.label) ?? 0) > 1
              ? { ...item, label: `${item.label}（${item.value}）` }
              : item,
          ),
        );
        return;
      }
      // Opening a session can be slow or briefly unavailable; retry a couple of times.
      attempt += 1;
      if (attempt < 3) window.setTimeout(() => void load(), 2500);
    }
    void load();
    return () => {
      alive = false;
    };
  }, [executorId, online]);
  return choices;
}

interface SubtaskTally {
  total: number;
  verified: number;
  replied: number;
  running: number;
  failed: number;
  pending: number;
  unassigned: number;
  /** Assigned, and neither done nor in flight: what 「开始」 would send right now. */
  ready: number;
}

function tallySubtasks(subtasks: ProjectTask[], dispatches: DispatchRecord[]): SubtaskTally {
  const tally: SubtaskTally = {
    total: subtasks.length,
    verified: 0,
    replied: 0,
    running: 0,
    failed: 0,
    pending: 0,
    unassigned: 0,
    ready: 0,
  };
  for (const sub of subtasks) {
    if (!sub.executor_channel_id) tally.unassigned += 1;
    const latest = dispatches.find((d) => d.task_id === sub.task_id) ?? null;
    if (!latest) {
      tally.pending += 1;
      if (sub.executor_channel_id) tally.ready += 1;
      continue;
    }
    if (latest.state === "verified") {
      tally.verified += 1;
      continue;
    }
    if (latest.state === "awaiting_user") { tally.pending += 1; continue; }
    if (latest.state === "handoff_closed") { tally.pending += 1; if (sub.executor_channel_id) tally.ready += 1; continue; }
    if (latest.state === "replied_unverified" || latest.state === "partial") {
      tally.replied += 1;
      continue;
    }
    if (latest.state === "queued" || latest.state === "running" || latest.state === "sent_awaiting_result") {
      tally.running += 1;
      continue;
    }
    tally.failed += 1;
    if (sub.executor_channel_id) tally.ready += 1;
  }
  return tally;
}

function progressText(tally: SubtaskTally): string {
  const bits: string[] = [];
  if (tally.verified) bits.push(`已核实 ${tally.verified}`);
  if (tally.replied) bits.push(`有回复待核实 ${tally.replied}`);
  if (tally.running) bits.push(`运行中 ${tally.running}`);
  if (tally.failed) bits.push(`失败 ${tally.failed}`);
  if (tally.pending) bits.push(`未派发 ${tally.pending}`);
  if (tally.unassigned) bits.push(`其中 ${tally.unassigned} 条未指定执行器`);
  return bits.join(" · ") || "还没有分工";
}

/** Deterministic so the panel can find the evaluator reply across page reloads. */
function evaluatorTaskId(rootTaskId: string): string {
  return `${rootTaskId}::eval`;
}

function evaluatorPrompt(root: ProjectTask, executorIds: string[]): string {
  return [
    "你在做任务拆解，不是执行任务。不要写代码，不要改文件，不要派发任何东西。",
    "",
    `总任务：${root.title}`,
    root.description ? `说明：${root.description}` : "",
    "",
    "请把它拆成 2-5 条分工，每条都要能单独派给一个 AI 做到底、单独验收。",
    "",
    "只输出一个 JSON 数组，不要解释，不要 markdown 代码块。每个元素的字段：",
    '{"title":"分工标题，短","description":"这一条要做什么、交付什么、怎么算做完","recommended_executor":"可为空字符串","recommended_model":"可为空字符串","rationale":"为什么这样拆，一句话"}',
    "",
    `recommended_executor 的取值只能从这些里挑：${executorIds.join("、") || "（本机没有可派发的执行器）"}。不要假设某个 AI 一定可用。`,
    "建议只是建议，派给谁、用哪个模型由人来定。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Tolerant reader: models wrap JSON in prose or fences, so find the array. */
function parseRecommendations(reply: string): TaskRecommendation[] | null {
  const fenced = /```[a-zA-Z]*\s*([\s\S]*?)```/.exec(reply);
  const body = fenced ? fenced[1] : reply;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const items = parsed
    .map((item) => normalizeRecommendation(item))
    .filter((item): item is TaskRecommendation => item !== null);
  return items.length ? items.slice(0, 8) : null;
}

function TaskGroup({
  root,
  subtasks,
  channels,
  prefs,
  bridge,
  scannerBoard,
  preferredModels,
  aiRoles,
  canStartMeeting,
  startBlockedReason,
  onChangeTask,
  onAddTask,
  onRemoveTask,
  onWriteRoleToRoster,
}: {
  root: ProjectTask;
  subtasks: ProjectTask[];
  channels: ExternalChannel[];
  prefs: ProjectBoardPrefs;
  bridge: BridgeView;
  scannerBoard?: ScannerBoardView;
  preferredModels: PreferredModels;
  aiRoles: ProjectAiRole[];
  canStartMeeting: boolean;
  startBlockedReason: string;
  onChangeTask: (next: ProjectTask) => void;
  onAddTask: (next: ProjectTask) => void;
  onRemoveTask: (task: ProjectTask) => void;
  onWriteRoleToRoster: (task: ProjectTask) => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const hasSubtasks = subtasks.length > 0;
  const tally = tallySubtasks(subtasks, bridge.dispatches);

  function buildSubtask(patch: Partial<ProjectTask>): ProjectTask {
    return {
      task_id: newId("task"),
      project_id: root.project_id,
      title: "",
      description: "",
      priority: root.priority,
      executor_channel_id: null,
      model: null,
      parent_task_id: root.task_id,
      created_at: new Date().toISOString(),
      ...patch,
    };
  }

  function addSubtask(patch: Partial<ProjectTask>) {
    onAddTask(buildSubtask(patch));
  }

  if (!hasSubtasks && !panelOpen) {
    return (
      <TaskRow
        task={root}
        channels={channels}
        prefs={prefs}
        bridge={bridge}
        scannerBoard={scannerBoard}
        preferredModels={preferredModels}
        aiRoles={aiRoles}
        latest={bridge.dispatches.find((d) => d.task_id === root.task_id) ?? null}
        onChange={onChangeTask}
        onRemove={() => onRemoveTask(root)}
        onDecompose={() => setPanelOpen(true)}
        onWriteRoleToRoster={onWriteRoleToRoster}
      />
    );
  }

  return (
    <li className={`task-row is-parent ${root.priority === "P0" ? "p0" : ""}`}>
      <div className="task-group-head">
        <span className={`pill ${root.priority === "P0" ? "p0" : ""}`}>{root.priority}</span>
        <div className="task-group-title">
          <strong>{root.title}</strong>
          <span className="muted">
            {tally.total > 0 ? `分工 ${tally.verified}/${tally.total} 已完成 · ${progressText(tally)}` : "还没有分工"}
          </span>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setPanelOpen((value) => !value)}
          aria-expanded={panelOpen}
        >
          {panelOpen ? "收起拆解" : "继续拆解"}
        </button>
      </div>

      {root.description ? <p className="hint task-group-desc">{root.description}</p> : null}
      <p className="status-text tone-neutral">总任务只汇总进度，不在这一行派发；「开始」在每条分工上。</p>
      {!canStartMeeting ? <p className="callout callout-warn">{startBlockedReason}</p> : null}

      {panelOpen ? (
        <DecomposePanel
          root={root}
          channels={channels}
          bridge={bridge}
          prefs={prefs}
          preferredModels={preferredModels}
          scannerBoard={scannerBoard}
          onChangeTask={onChangeTask}
          onAddSubtask={addSubtask}
        />
      ) : null}

      {hasSubtasks ? (
        <ul className="subtask-list">
          {subtasks.map((sub, index) => (
            <SubtaskRow
              key={sub.task_id}
              task={sub}
              index={index}
              channels={channels}
              prefs={prefs}
              bridge={bridge}
              scannerBoard={scannerBoard}
              preferredModels={preferredModels}
              aiRoles={aiRoles}
              onChange={onChangeTask}
              onRemove={() => onRemoveTask(sub)}
              onWriteRoleToRoster={onWriteRoleToRoster}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          title="还没有分工"
          description="只生成清单、不派发。先「添加分工」，或勾选「让评估官给建议」。"
          action={
            <button type="button" className="icon-btn add-channel-btn" onClick={() => addSubtask({})}>
              添加分工
            </button>
          }
        />
      )}
    </li>
  );
}

function DecomposePanel({
  root,
  channels,
  bridge,
  prefs,
  preferredModels,
  scannerBoard,
  onChangeTask,
  onAddSubtask,
}: {
  root: ProjectTask;
  channels: ExternalChannel[];
  bridge: BridgeView;
  prefs: ProjectBoardPrefs;
  preferredModels: PreferredModels;
  scannerBoard?: ScannerBoardView;
  onChangeTask: (next: ProjectTask) => void;
  onAddSubtask: (patch: Partial<ProjectTask>) => void;
}) {
  const ask = root.ask_evaluator_suggestions === true;
  const usable = Array.from(BRIDGE_EXECUTORS).filter((id) => channels.some((ch) => ch.id === id));
  const [evaluator, setEvaluator] = useState(() => usable[0] ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const usableKey = usable.join(",");
  useEffect(() => {
    if (evaluator && usableKey.split(",").includes(evaluator)) return;
    const first = usableKey.split(",").filter(Boolean)[0];
    if (first) setEvaluator(first);
  }, [usableKey, evaluator]);

  const evalTaskId = evaluatorTaskId(root.task_id);
  // Newest first: useBridge prepends, and the bridge lists newest first too.
  const record = bridge.dispatches.find((d) => d.task_id === evalTaskId) ?? null;
  const suggestions = useMemo(
    () => (record?.reply ? parseRecommendations(record.reply) : null),
    [record?.reply],
  );

  async function requestAdvice() {
    if (!evaluator) {
      setError("本机没有可派发的执行器，无法请求建议。");
      return;
    }
    setError(null);
    setSending(true);
    const err = await bridge.dispatch({
      executor: evaluator,
      prompt: evaluatorPrompt(root, usable),
      task_id: evalTaskId,
      project_id: root.project_id,
      title: `拆解建议：${root.title}`,
      model: resolveDispatchModel({
        taskModel: null,
        preferred: preferredModels[evaluator] ?? "",
        boardDefault: prefs.defaultModel,
        catalog: catalogForExecutor(scannerBoard, evaluator),
      }),
      ask_evaluator_suggestions: true,
    });
    setSending(false);
    if (err) setError(err);
  }

  return (
    <section className="decompose-panel" aria-label={`${root.title} 的任务拆解`}>
      <div className="decompose-head">
        <h4>任务拆解</h4>
        <p className="hint">
          总任务本身不派发。每条分工各自选执行器和模型，点上面的「开始」才会真的发出去。
        </p>
      </div>

      <div className="decompose-actions">
        <button type="button" className="icon-btn" onClick={() => onAddSubtask({})}>
          添加一条分工
        </button>
        <label className="decompose-evaluator-toggle">
          <input
            type="checkbox"
            checked={ask}
            onChange={(e) =>
              onChangeTask({ ...root, ask_evaluator_suggestions: e.target.checked })
            }
          />
          让评估官给建议
        </label>
      </div>

      {ask ? (
        <div className="decompose-evaluator">
          <label className="field task-row-control">
            <span>评估官</span>
            <ArchiveSelect
              value={evaluator}
              onChange={setEvaluator}
              aria-label="评估官执行器"
              options={usableExecutorOptions(usable, channels, "没有可派发的执行器")}
            />
          </label>
          <button
            type="button"
            className="icon-btn add-channel-btn"
            disabled={sending || !evaluator}
            onClick={() => void requestAdvice()}
          >
            {sending ? "请求中…" : record ? "重新请求建议" : "请求分工建议"}
          </button>
          <p className="hint decompose-evaluator-note">
            只是请它出建议，不会自动派发，也不会替你填执行器。建议要你点「采用」才会变成分工。
          </p>
        </div>
      ) : null}

      {error ? <p className="callout callout-warn">建议没拿到：{error}</p> : null}

      {ask && record ? (
        <div className="decompose-advice">
          {record.state === "queued" || record.state === "running" ? (
            <p className="muted">评估官思考中…（每 2.5 秒刷新）</p>
          ) : record.state === "failed" ? (
            <p className="callout callout-warn">评估官失败：{record.error || "没有拿到回复"}</p>
          ) : suggestions ? (
            <>
              <p className="muted">
                建议 {suggestions.length} 条，来自 <code>{record.executor}</code>
                {record.model ? <> · 模型 <code>{String(record.evidence?.model_applied || record.model)}</code></> : null}
                {" "}· <span className="status-text tone-unverified">建议，未派发</span>
              </p>
              <ul className="suggestion-list">
                {suggestions.map((item, index) => {
                  const key = `${item.title}-${index}`;
                  if (dismissed.has(key)) return null;
                  const rec = item.recommended_executor_channel_id;
                  const recKnown = !!rec && channels.some((ch) => ch.id === rec);
                  return (
                  <li key={key}>
                    <div className="suggestion-body">
                      <strong>{item.title}</strong>
                      {item.description ? <span className="hint">{item.description}</span> : null}
                      {item.rationale ? <span className="muted">为什么：{item.rationale}</span> : null}
                      <span className="suggestion-rec">
                        建议执行器：{item.recommended_executor_channel_id || "未建议"}
                        {" · "}
                        建议模型：{item.recommended_model || "未建议"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      title="只写入标题和说明；执行器保持「未指定执行器」"
                      onClick={() => {
                        onAddSubtask({
                          title: item.title,
                          description: item.description,
                          priority: root.priority,
                          recommendation: item,
                        });
                        setDismissed((prev) => new Set(prev).add(key));
                      }}
                    >
                      接受分工
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={!recKnown}
                      title={
                        !rec
                          ? "这条建议没有推荐执行器"
                          : !recKnown
                            ? `推荐的执行器 ${rec} 不在本机可选列表里`
                            : "同时把推荐执行器写成已选；仍不会自动派发"
                      }
                      onClick={() => {
                        if (!recKnown) return;
                        onAddSubtask({
                          title: item.title,
                          description: item.description,
                          priority: root.priority,
                          recommendation: item,
                          executor_channel_id: rec,
                        });
                        setDismissed((prev) => new Set(prev).add(key));
                      }}
                    >
                      同时接受建议执行器
                    </button>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => setDismissed((prev) => new Set(prev).add(key))}
                    >
                      丢掉
                    </button>
                  </li>
                  );
                })}
              </ul>
              <p className="hint">「接受分工」只写标题和说明，执行器保持未指定；接受后可在分工行里直接改掉标题、说明和执行器。</p>
            </>
          ) : (
            <>
              <p className="muted">评估官有回复，但没解析出结构化分工。原文：</p>
              <blockquote className="dispatch-reply">{(record.reply || "").slice(0, 600)}</blockquote>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SubtaskRow({
  task,
  index,
  channels,
  prefs,
  bridge,
  scannerBoard,
  preferredModels,
  aiRoles,
  onChange,
  onRemove,
  onWriteRoleToRoster,
}: {
  task: ProjectTask;
  index: number;
  channels: ExternalChannel[];
  prefs: ProjectBoardPrefs;
  bridge: BridgeView;
  scannerBoard?: ScannerBoardView;
  preferredModels: PreferredModels;
  aiRoles: ProjectAiRole[];
  onChange: (next: ProjectTask) => void;
  onRemove: () => void;
  onWriteRoleToRoster: (task: ProjectTask) => void;
}) {
  const [openDesc, setOpenDesc] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const latest = bridge.dispatches.find((d) => d.task_id === task.task_id) ?? null;
  const status = describeExecutor(task.executor_channel_id, channels);
  const live = liveExecutorStatus(task.executor_channel_id, channels, bridge.health, status);
  const catalog = catalogForExecutor(scannerBoard, task.executor_channel_id);
  const preferred = task.executor_channel_id ? preferredModels[task.executor_channel_id] || "" : "";
  const dispatchModel = resolveDispatchModel({
    executorId: task.executor_channel_id,
    taskModel: task.model,
    preferred,
    boardDefault: prefs.defaultModel,
    catalog,
  });
  const unassigned = !task.executor_channel_id;
  const followLabel = unassigned
    ? "未指定执行器，先选执行器再选模型"
    : modelFollowLabel(prefs, preferred, dispatchModel);
  const liveChoices = useLiveModels(task.executor_channel_id, bridge.online);
  const choices = modelChoices(prefs, task, preferred, catalog, liveChoices);
  const canBridge = !!task.executor_channel_id && BRIDGE_EXECUTORS.has(task.executor_channel_id);
  const gate = task.executor_channel_id
    ? executorDispatchGate(task.executor_channel_id, bridge.health, bridge.online)
    : { ok: false, reason: "未指定执行器" };
  const busy = latest ? ["queued", "running", "awaiting_user", "sent_awaiting_result"].includes(latest.state) : false;
  const dispatchState = latest
    ? DISPATCH_LABEL[latest.state] ?? { text: latest.state, tone: "neutral" }
    : { text: "尚未派发", tone: "neutral" };

  async function handleSend() {
    setSendError(null);
    const err = await sendTask(task, {
      bridge,
      prefs,
      preferredModels,
      scannerBoard,
      onIntent: () => onChange({ ...task, dispatch_intent_at: new Date().toISOString() }),
    });
    if (err) setSendError(err);
  }

  return (
    <li className="subtask-row">
      <div className="subtask-main">
        <span className="subtask-index" aria-hidden="true">
          {index + 1}
        </span>
        <div className="subtask-identity">
          <input
            className="subtask-title"
            value={task.title}
            placeholder="这条分工叫什么"
            onChange={(e) => onChange({ ...task, title: e.target.value })}
            aria-label={`第 ${index + 1} 条分工的标题`}
          />
        </div>
        <button type="button" className="text-btn" onClick={onRemove} aria-label="删除这条分工">
          删除
        </button>
      </div>

      <div className="subtask-controls">
        <RoleAssignmentFields
          task={task}
          aiRoles={aiRoles}
          onChange={onChange}
          onWriteToRoster={onWriteRoleToRoster}
          compact
          expanded={openDesc}
        />
        <label className="field task-row-control">
          <span className="visually-hidden">执行器</span>
          <ArchiveSelect
            value={task.executor_channel_id ?? ""}
            onChange={(value) =>
              onChange({
                ...task,
                executor_channel_id: value ? value : null,
                dispatch_intent_at: undefined,
              })
            }
            aria-label={`${task.title || "分工"} 的执行器`}
            options={executorOptions(channels)}
          />
        </label>
        <label className="field task-row-control">
          <span className="visually-hidden">模型</span>
          <ArchiveSelect
            value={task.model ?? ""}
            onChange={(value) => onChange({ ...task, model: value ? value : null })}
            disabled={unassigned}
            aria-label={`${task.title || "分工"} 的模型`}
            title={
              liveChoices.length
                ? "来自该 AI 会话的真实可选列表，每条分工各自生效"
                : "来自扫描器的发布列表；若该 AI 不接受这个名称，派发会被拒绝并列出可选值"
            }
            options={[
              { value: "", label: followLabel },
              ...choices.map((model) => ({ value: model.value, label: model.label })),
            ]}
          />
        </label>
        <button
          type="button"
          className="icon-btn"
          disabled={!task.executor_channel_id || busy || (canBridge && bridge.online && !gate.ok)}
          onClick={() => void handleSend()}
          title={
            canBridge && bridge.online && !gate.ok
              ? gate.reason
              : canBridge && bridge.online
                ? "按这里选的模型真实派发"
                : "桥接未连或该执行器无适配器：只记录意向"
          }
        >
          {busy ? "运行中…" : canBridge && bridge.online ? (latest ? "重新派发" : "派发") : "开始"}
        </button>
        <button
          type="button"
          className="text-btn"
          onClick={() => setOpenDesc((value) => !value)}
          aria-expanded={openDesc}
        >
          {openDesc ? "收起说明" : "说明"}
        </button>
      </div>

      {task.recommendation ? (
        <p className="subtask-advice">
          评估官建议：
          {task.recommendation.recommended_executor_channel_id || "未建议执行器"}
          {" · "}
          {task.recommendation.recommended_model || "未建议模型"}
          <span className="muted">（只是建议，上面仍是你自己选的）</span>
        </p>
      ) : null}

      {unassigned ? (
        <p className="executor-status status-text tone-unverified">
          <strong>未指定执行器</strong>
          <span className="executor-detail"> · 不可开始：未指定执行器</span>
        </p>
      ) : (
        <p className={`executor-status status-text tone-${dispatchState.tone}`}>
          <strong>派发状态：{dispatchState.text}</strong>
          {live.detail ? <span className="executor-detail"> · {live.detail}</span> : null}
          {task.dispatch_intent_at && !latest ? (
            <span className="executor-detail"> · 已记录下发意向（未真正发送）</span>
          ) : null}
        </p>
      )}

      {sendError ? <p className="callout callout-warn">没发出去：{sendError}</p> : null}
      {latest ? <DispatchResult record={latest} /> : null}

      {openDesc ? (
        <label className="field subtask-desc">
          <span>说明</span>
          <textarea
            value={task.description}
            placeholder="这一条要做什么、交付什么、怎么算做完"
            rows={3}
            onChange={(e) => onChange({ ...task, description: e.target.value })}
          />
        </label>
      ) : null}
    </li>
  );
}

interface ExecutorStatusView {
  headline: string;
  detail?: string;
  note?: string;
  tone: "ok" | "warn" | "bad" | "unverified" | "neutral";
}

function findLayer(channel: ExternalChannel, kind: ChannelLayerKind) {
  return channel.layers.find((layer) => layer.kind === kind);
}

/**
 * Conservative dispatch-readiness: chat_bridge ok AND tool_verify ok AND
 * (if inventory_claimed > 0) inventory_verified === inventory_claimed.
 * A user selection is never worded as 「已连通」.
 */
function liveExecutorStatus(
  executorChannelId: string | null,
  _channels: ExternalChannel[],
  health: BridgeHealth | null,
  fallback: ExecutorStatusView,
): ExecutorStatusView {
  if (executorChannelId === "workbuddy") {
    const w = health?.workbuddy;
    if (w?.desktop_detected && !w.public_gateway) return {headline:"桌面客户端已发现，投递与回读待验证",detail:"无需补填 WB_TOKEN；公开 Gateway 尚未配置。",tone:"warn"};
    if (w?.health === 200 && w?.token && w.acp_ok !== false) {
      return {
        headline: "服务与凭据已就绪，实际派发待验证",
        detail: `serve :${w.serve_port || "?"} 在线，走官方 ACP（workingDirectory）；jobs 仍与 serve 抢端口，暂不使用`,
        tone: "ok",
      };
    }
    return {
      headline: "WorkBuddy serve 未连接",
      detail: w?.jobs_issue || w?.error || "未拿到 serve 端口或凭据",
      tone: "bad",
    };
  }
  if (executorChannelId === "codex") {
    const c = health?.codex;
    if (c?.cli && c.proxy_up) {
      const exhausted = (c.used ?? 0) >= (c.max ?? 1);
      return {
        headline: exhausted ? "本机派发次数已达上限" : "CLI 与代理已发现，实际派发待验证",
        detail: `已用 ${c.used ?? 0}/${c.max ?? 1} 次，代理 :${c.proxy_port ?? 7890} 在线`,
        tone: exhausted ? "warn" : "ok",
      };
    }
    if (c?.cli && !c.proxy_up) {
      return { headline: "已发现 CLI，但代理未启动", detail: "请先启动 FlClash 代理后再派发", tone: "warn" };
    }
  }
  if (executorChannelId === "doubao") {
    const d = health?.doubao;
    if (d?.cdp && (d?.local_work_task || d?.bridge_cli)) {
      return {
        headline: "桌面调试入口已发现，任务执行待验证",
        detail: "走工作任务，而不是聊天",
        tone: "ok",
      };
    }
    return {
      headline: "豆包工作任务通道未连",
      detail: d?.cdp ? "本机没有可用的「新工作任务」脚本" : "本机未发现豆包 CDP 调试口",
      tone: "warn",
    };
  }
  return fallback;
}

export function describeExecutor(
  executorChannelId: string | null,
  channels: ExternalChannel[],
): ExecutorStatusView {
  if (!executorChannelId) {
    return { headline: "未指定", tone: "unverified" };
  }

  const channel = channels.find((ch) => ch.id === executorChannelId);
  if (!channel) {
    return {
      headline: "指定的通道已不存在或无效，不能视为已连通",
      detail: `找不到 executor_channel_id=${executorChannelId}`,
      tone: "bad",
    };
  }

  const chat = findLayer(channel, "chat_bridge");
  const inventory = findLayer(channel, "tool_inventory");
  const toolVerify = findLayer(channel, "tool_verify");
  const verifiedEnough =
    chat?.status === "ok" &&
    toolVerify?.status === "ok" &&
    (channel.inventory_claimed <= 0 ||
      channel.inventory_verified === channel.inventory_claimed);

  const detail = factualVerifyStatus(channel, chat?.status, inventory?.status, toolVerify?.status);

  if (!verifiedEnough) {
    return {
      headline: "已指定，待核实后再派发",
      detail: `${channel.title} · ${detail}`,
      tone: "warn",
    };
  }

  return {
    headline: "已指定，待核实后再派发",
    detail: `${channel.title} · ${detail}`,
    tone: "neutral",
  };
}

function factualVerifyStatus(
  channel: ExternalChannel,
  chatStatus: string | undefined,
  inventoryStatus: string | undefined,
  toolVerifyStatus: string | undefined,
): string {
  if (chatStatus !== "ok") return "对话未齐";
  if (channel.inventory_claimed <= 0 && inventoryStatus !== "ok" && inventoryStatus !== "partial") {
    return "尚未列出可验证工具";
  }
  if (channel.inventory_claimed > 0 && channel.inventory_verified < channel.inventory_claimed) {
    return `工具 ${channel.inventory_verified}/${channel.inventory_claimed} 已验证`;
  }
  if (toolVerifyStatus === "partial") return "插件仅部分验证";
  if (toolVerifyStatus !== "ok") return "插件尚未验证";
  if (channel.inventory_claimed > 0) {
    return `工具 ${channel.inventory_verified}/${channel.inventory_claimed} 已验证`;
  }
  return "对话已通，逐项验证仍以本机登记为准，不是已派发";
}

function NewProjectForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (project: Project) => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(PROJECT_COPY.nameRequired);
      return;
    }
    const project_id = newId("proj");
    onCreate({
      project_id,
      name: trimmed,
      notes: notes.trim() || undefined,
      tasks: [],
      ai_roles: [createKingRole(project_id)],
      created_at: new Date().toISOString(),
    });
  }

  return (
    <form className="workspace-form" onSubmit={handleSubmit}>
      <h3>
        <ArchiveText zh={ACTION.newProject.zh} en={ACTION.newProject.en} />
      </h3>
      <p className="hint">{PROJECT_COPY.formHint}</p>
      {error ? <p className="form-error">{error}</p> : null}
      <label className="field">
        <span>{PROJECT_COPY.nameLabel}</span>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如 操作台试点"
          autoComplete="off"
          autoFocus
        />
      </label>
      <label className="field">
        <span>备注（可选）</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={PROJECT_COPY.notesPlaceholder}
          rows={3}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="icon-btn add-channel-btn">
          <ArchiveText zh={ACTION.createProject.zh} en={ACTION.createProject.en} />
        </button>
        <button type="button" className="icon-btn" onClick={onCancel}>
          <ArchiveText zh={ACTION.cancel.zh} en={ACTION.cancel.en} />
        </button>
      </div>
    </form>
  );
}

function NewTaskForm({
  projectId,
  onCancel,
  onCreate,
}: {
  projectId: string;
  onCancel: () => void;
  onCreate: (task: ProjectTask) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("P2");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("请填写任务标题。");
      return;
    }
    onCreate({
      task_id: newId("task"),
      project_id: projectId,
      title: trimmed,
      description: description.trim(),
      priority,
      executor_channel_id: null,
      model: null,
      created_at: new Date().toISOString(),
    });
  }

  return (
    <form className="workspace-form" onSubmit={handleSubmit}>
      <h3>
        <ArchiveText zh={ACTION.newTask.zh} en={ACTION.newTask.en} />
      </h3>
      <p className="hint">登记后再指定执行器与模型。默认未指定执行器；模型跟随工作区顶部的默认模型。</p>
      {error ? <p className="form-error">{error}</p> : null}
      <label className="field">
        <span>标题</span>
        <input
          id={`task-title-${projectId}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如 核对执行器核实状态"
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>说明（可选）</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="补充背景或验收注意点"
          rows={3}
        />
      </label>
      <label className="field">
        <span>优先级</span>
        <ArchiveSelect
          value={priority}
          onChange={(value) => setPriority(value as Priority)}
          aria-label="优先级"
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="icon-btn add-channel-btn">
          <ArchiveText zh="创建任务" en="CREATE TASK" />
        </button>
        <button type="button" className="icon-btn" onClick={onCancel}>
          <ArchiveText zh={ACTION.cancel.zh} en={ACTION.cancel.en} />
        </button>
      </div>
    </form>
  );
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}（北京时间）`;
}

const EVIDENCE_KEYS: [string, string][] = [
  ["job_id", "WorkBuddy job"],
  ["job_state", "job 状态"],
  ["job_detail", "job 说明"],
  ["session_id", "会话"],
  ["print_session_id", "CLI 会话"],
  ["thread_url", "Codex 会话"],
  ["last_message_file", "回复文件"],
  ["cwd", "工作目录"],
  ["elapsedMs", "耗时 ms"],
  ["exit", "退出码"],
  ["proxy", "代理"],
  ["print_exit", "CLI 退出码"],
  ["model_requested", "所选模型"],
  ["model_applied", "实际调用模型"],
  ["model_source", "模型来源"],
];

/** Same normalisation the bridge uses, so `GLM-5.3-Flash` and `glm-5.3-flash` compare equal. */
function sameModelName(a: string, b: string): boolean {
  const key = (value: string) => value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return key(a) === key(b);
}

function DispatchResult({ record }: { record: DispatchRecord }) {
  const [closing,setClosing] = useState(false);
  const [closeError,setCloseError] = useState<string|null>(null);
  async function finishHandoff() {
    setClosing(true);setCloseError(null);
    try { const r=await fetch(BRIDGE_URL+"/bridge/handoff/"+encodeURIComponent(record.id)+"/close",{method:"POST"});
      if(!r.ok)throw new Error((await r.json()).error||"无法结束交接记录");
    } catch(e) {setCloseError(e instanceof Error?e.message:"连接失败");} finally {setClosing(false);}
  }
  const label = DISPATCH_LABEL[record.state] ?? { text: record.state, tone: "neutral" };
  const ev = record.evidence ?? {};
  const requested = typeof ev.model_requested === "string" ? ev.model_requested : "";
  const applied = typeof ev.model_applied === "string" ? ev.model_applied : "";
  const modelMismatch = Boolean(requested && applied && !sameModelName(requested, applied));
  return (
    <div className={`dispatch-result tone-${label.tone}`} role="status" aria-live="polite">
      <p className="dispatch-result-head">
        <strong className={`status-text tone-${label.tone}`}>{label.text}</strong>
        <span className="muted">
          {" "}· <code>{record.id}</code>
          {record.model ? <> · 模型 <code>{String(ev.model_applied || record.model)}</code></> : null}
          {" "}· 发出 {fmtTime(record.created_at)}
          {record.finished_at ? ` · 结束 ${fmtTime(record.finished_at)}` : ` · 更新 ${fmtTime(record.updated_at)}`}
        </span>
      </p>
      {record.via ? (
        <p className="muted">
          通道：<code>{record.via}</code>
        </p>
      ) : null}
      {record.state === "awaiting_user" ? <p><button type="button" className="icon-btn" disabled={closing} onClick={()=>void finishHandoff()}>结束这次交接记录</button><span className="muted"> 仅结束操作台等待，不代表模型执行完成，也不停止客户端任务。</span></p> : null}
      {closeError ? <p role="alert">{closeError}</p> : null}
      {typeof ev.user_action === "string" ? <p className="callout callout-info">{ev.user_action}</p> : null}
      {record.reply ? (
        <blockquote className="dispatch-reply">{record.reply.slice(0, 600)}</blockquote>
      ) : record.state === "running" || record.state === "queued" ? (
        <p className="muted">等待真实回复…（每 2.5 秒刷新）</p>
      ) : record.state === "sent_awaiting_result" ? (
        <p className="muted">已发出，等对方回写结果（未核实）。</p>
      ) : (
        <p className="muted">没有拿到回复。</p>
      )}
      {typeof (ev.sandbox ?? record.sandbox) === "string" ? (
        <p className="muted">
          沙箱 <code>sandbox</code>：{String(ev.sandbox ?? record.sandbox)}
          {typeof ev.sandbox_source === "string" ? <>（来源 <code>{ev.sandbox_source}</code>）</> : null}
          {typeof (ev.project_dir ?? record.project_dir) === "string" ? <> · 项目目录 <code>{String(ev.project_dir ?? record.project_dir)}</code></> : null}
        </p>
      ) : null}
      {record.checks?.length ? (
        <ul className="dispatch-checks">
          {record.checks.map((c, i) => (
            <li key={`${c.name}-${i}`}>
              {c.name || c.type || "无此信息"} ·{" "}
              <span className={`status-text tone-${c.ok ? "ok" : "bad"}`}>{c.ok ? "通过" : "未通过"}</span>
              {c.detail ? <span className="muted"> · {c.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {record.error ? <p className="callout callout-warn">{record.error}</p> : null}
      {modelMismatch ? (
        <p className="callout callout-warn">
          模型和你选的不一致：你要 <code>{requested}</code>，实际记录为 <code>{applied}</code>。
        </p>
      ) : null}
      {requested && !applied ? (
        <p className="muted">
          已把 <code>{requested}</code> 作为请求发出，但这次没有拿到「实际用了哪个模型」的回执。
        </p>
      ) : null}
      <p className="muted dispatch-evidence">
        {EVIDENCE_KEYS.filter(([k]) => ev[k] !== undefined && ev[k] !== null && ev[k] !== "").map(([k, name]) => (
          <span key={k}>
            {name} <code>{String(ev[k])}</code>{" "}
          </span>
        ))}
      </p>
    </div>
  );
}

function BridgeBar({
  bridge,
  onDispatchAll,
  canDispatchAll,
  dispatchAllReason,
}: {
  bridge: BridgeView;
  onDispatchAll: () => void;
  canDispatchAll: boolean;
  dispatchAllReason: string;
}) {
  const h = bridge.health;
  return (
    <div className={`bridge-bar ${bridge.online ? "is-online" : "is-offline"}`} role="region" aria-label="本机派发桥接">
      <p>
        <strong className={`status-text tone-${bridge.online ? "ok" : "bad"}`}>
          {bridge.online ? "桥接在线" : "桥接未启动"}
        </strong>{" "}
        <code>127.0.0.1:5180</code>
        {bridge.online && h ? (
          <span className="muted">
            {" "}· WorkBuddy {h.workbuddy?.desktop_detected && !h.workbuddy.public_gateway ? "桌面已发现，投递待验证" : h.workbuddy?.health === 200 ? `serve :${h.workbuddy?.serve_port} 在线，任务执行待验证` : "未连"}
            {" "}· Codex {h.codex?.cli ? (h.codex.proxy_up ? "CLI 与代理已发现，任务待验证" : "CLI 已发现，代理未启动") : "CLI 未发现"}，已用 {h.codex?.used ?? 0}/{h.codex?.max ?? 1} 次
            {" "}· 豆包 {h.doubao?.cdp ? "CDP 已发现，任务待验证" : "CDP 未连"}
          </span>
        ) : null}
        {!bridge.online ? (
          <span className="muted">
            {" "}· 运行 <code>bridge\start-bridge.ps1</code> 后，「派发」才会真的发出；否则只记录意向。
          </span>
        ) : null}
      </p>
      <div className="king-report">
        <button
          type="button"
          className="icon-btn add-channel-btn"
          onClick={onDispatchAll}
          disabled={!canDispatchAll}
          title={canDispatchAll ? "只派发未完成、不在运行中的任务" : dispatchAllReason}
        >
          派发全部未完成任务
        </button>
        {canDispatchAll ? null : <p className="hint">{dispatchAllReason}</p>}
      </div>
    </div>
  );
}
