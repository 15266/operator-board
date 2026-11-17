import type { Project, ProjectAiRole, ProjectTask } from "./types";
import { AI_DIVISION } from "./copy";
import { isGuiKingExecutor } from "./localExecutors";

/** Stable id for the one-time Western fantasy 3D RPG sample meeting. */
export const SAMPLE_ARTHUR_PROJECT_ID = "proj-sample-arthur-3drpg";

const KING_DUTY = AI_DIVISION.kingDuty;

const KNIGHTS: Array<{ slug: string; name: string; duty: string }> = [
  { slug: "lancelot", name: "兰斯洛特", duty: "战斗与对手系统：设计战斗循环、对手行为与难度曲线，并约定可验收的对战表现。" },
  { slug: "gawain", name: "高文", duty: "世界探索与地图：规划可探索区域、路径与发现点，保证地图能支撑主线与支线走动。" },
  { slug: "percival", name: "珀西瓦尔", duty: "主线传说与任务叙事：撰写主线传说、任务目标与关键对白，并把故事落到可玩任务上。" },
  { slug: "galahad", name: "加拉哈德", duty: "美术与视觉方向：制定西方幻想的整体视觉标准，统一角色、场景与界面的外观。" },
  { slug: "tristan", name: "特里斯坦", duty: "音乐与音效：规划主题音乐、环境声与战斗反馈，确保声音能服务探索和战斗节奏。" },
  { slug: "bedivere", name: "贝迪维尔", duty: "引擎、渲染与技术：选定并维护 3D 引擎与渲染方案，解决性能、资源管线与技术风险。" },
  { slug: "kay", name: "凯", duty: "制作统筹与管线：拆解里程碑、对齐各部门交付，保证垂直切片能按期汇合。" },
  { slug: "gareth", name: "加雷斯", duty: "角色造型与动画：负责角色模型和动画，保证战斗、探索与过场动作可用。" },
  { slug: "bors", name: "博斯", duty: "系统与经济数值：设计成长、装备与经济循环，并用可调数值支撑战斗与探索。" },
  { slug: "gaheris", name: "加赫里斯", duty: "界面与操作手感：设计菜单、HUD 与键鼠/手柄操作，保证常用操作清晰跟手。" },
  { slug: "lamorak", name: "拉莫拉克", duty: "场景与关卡美术：制作可进入的场景与关卡空间，服务探索路线与战斗场地。" },
  { slug: "palamedes", name: "帕拉米徳斯", duty: "试玩与品质验收：组织试玩、记录问题并核对验收标准，确认垂直切片达到可玩品质。" },
];

function roleId(slug: string): string {
  return `role-${slug}-${SAMPLE_ARTHUR_PROJECT_ID}`;
}

function taskId(slug: string): string {
  return `task-${slug}-${SAMPLE_ARTHUR_PROJECT_ID}`;
}

function knightRole(entry: (typeof KNIGHTS)[number]): ProjectAiRole {
  return {
    role_id: roleId(entry.slug),
    seat: "knight",
    name: entry.name,
    duty: entry.duty,
    executor_channel_id: null,
    model: null,
  };
}

function starterTask(
  slug: string,
  title: string,
  description: string,
  knight: (typeof KNIGHTS)[number],
  createdAt: string,
): ProjectTask {
  return {
    task_id: taskId(slug),
    project_id: SAMPLE_ARTHUR_PROJECT_ID,
    title,
    description,
    priority: "P1",
    executor_channel_id: null,
    model: null,
    role_id: roleId(knight.slug),
    role_name: knight.name,
    duty: knight.duty,
    created_at: createdAt,
  };
}

export function isArthurSampleProject(projectId: string | null | undefined): boolean {
  return projectId === SAMPLE_ARTHUR_PROJECT_ID;
}

/** Build the sample roster and starter tasks. Executors start empty and are filled from detected interfaces. */
export function createArthurSampleProject(createdAt = new Date().toISOString()): Project {
  const kay = KNIGHTS[6];
  const gawain = KNIGHTS[1];
  const lancelot = KNIGHTS[0];
  const percival = KNIGHTS[2];
  const palamedes = KNIGHTS[11];
  const king: ProjectAiRole = {
    role_id: roleId("king"),
    seat: "king",
    name: "亚瑟王",
    duty: KING_DUTY,
    executor_channel_id: null,
    model: null,
  };
  return {
    project_id: SAMPLE_ARTHUR_PROJECT_ID,
    name: "卡美洛",
    notes:
      "【示例】项目目标：做一款西方幻想 3D RPG。本场会议展示亚瑟王与十二圆桌骑士的分工。空白执行器会按本机已探测到的可派发接口填写，方便试运行；你仍可改。",
    created_at: createdAt,
    ai_roles: [king, ...KNIGHTS.map(knightRole)],
    tasks: [
      starterTask(
        "vertical-slice",
        "确定可玩的垂直切片",
        "明确第一段可玩范围：一块可探索地图、一套战斗循环和一条短主线，并列出汇合标准。",
        kay,
        createdAt,
      ),
      starterTask(
        "world",
        "搭建世界与地图框架",
        "规划开场可探索区域、主要路径与发现点，让后续关卡和叙事有地方落脚。",
        gawain,
        createdAt,
      ),
      starterTask(
        "combat",
        "做出战斗与对手原型",
        "落地一套基础战斗循环和至少一类对手，方便试玩和调数值。",
        lancelot,
        createdAt,
      ),
      starterTask(
        "legend",
        "写出主线第一幕",
        "完成开场传说、第一幕任务目标与关键对白，并接到可玩任务上。",
        percival,
        createdAt,
      ),
      starterTask(
        "playtest",
        "组织第一次品质验收",
        "按垂直切片标准试玩，记录阻断问题，并确认还缺哪些部门交付。",
        palamedes,
        createdAt,
      ),
    ],
  };
}

/** Prefer adapters that can actually POST /bridge/dispatch, WorkBuddy first for the king. */
const DISPATCH_FILL_ORDER = ["workbuddy", "doubao", "codex"];

function uniqueDispatchable(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const preferred of DISPATCH_FILL_ORDER) {
    if (ids.includes(preferred) && !seen.has(preferred)) {
      seen.add(preferred);
      out.push(preferred);
    }
  }
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Fill empty executors on the Camelot sample once, when the king is still unassigned.
 * Does not overwrite a choice the user (or a previous fill) already made, and
 * does not invent model names — the picker follows the live catalog default.
 */
export function fillArthurSampleBlanks(project: Project, detectedExecutorIds: string[]): Project {
  if (!isArthurSampleProject(project.project_id)) return project;
  const usable = uniqueDispatchable(detectedExecutorIds);
  if (usable.length === 0) return project;
  const kingPool = usable.filter((id) => isGuiKingExecutor(id));

  const roles = project.ai_roles ?? [];
  const king = roles.find((role) => role.seat === "king");
  if (king?.executor_channel_id && isGuiKingExecutor(king.executor_channel_id)) return project;
  if (!king?.executor_channel_id && kingPool.length === 0) return project;

  const kingExecutor = (king?.executor_channel_id && isGuiKingExecutor(king.executor_channel_id)
    ? king.executor_channel_id
    : kingPool[0]) ?? null;
  const knightPool = usable;
  let knightIndex = 0;
  const nextRoles = roles.map((role) => {
    if (role.seat === "king") {
      if (role.executor_channel_id && isGuiKingExecutor(role.executor_channel_id)) return role;
      return kingExecutor ? { ...role, executor_channel_id: kingExecutor } : role;
    }
    if (role.executor_channel_id) return role;
    const executor = knightPool[knightIndex % knightPool.length];
    knightIndex += 1;
    return { ...role, executor_channel_id: executor };
  });
  const byRole = new Map(nextRoles.map((role) => [role.role_id, role]));
  const nextTasks = project.tasks.map((task) => {
    if (task.executor_channel_id) return task;
    const fromRole = task.role_id ? byRole.get(task.role_id) : undefined;
    return {
      ...task,
      executor_channel_id: fromRole?.executor_channel_id ?? knightPool[0],
    };
  });

  return {
    ...project,
    notes:
      "【示例】项目目标：做一款西方幻想 3D RPG。本场会议展示亚瑟王与十二圆桌骑士的分工。空白执行器已按本机已探测到的可派发接口填写，方便试运行；你仍可改。",
    ai_roles: nextRoles,
    tasks: nextTasks,
  };
}
