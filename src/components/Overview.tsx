import type { DashboardMock, DispatchPlan, ExternalChannel } from "../lib/types";
import type { ScannerSummary } from "../lib/scannerBoard";
import { CORE_ROLES, HERO, ROLE_COPY, STEP_STATUS_LABEL } from "../lib/copy";

export function Hero({ version, freshness }: { version: string; freshness: string }) {
  return (
    <section className="hero is-compact" aria-labelledby="board-title">
      <p className="kicker">{HERO.kicker} · MCP v{version}</p>
      <h1 id="board-title">
        {HERO.title}
        <span className="title-en">{HERO.titleEn}</span>
      </h1>
      <p className="hero-intro">{HERO.intro}</p>
      <p className="freshness">
        <span className="pill">mock</span>
        MOCK / DEMO · 最近更新 {freshness}
      </p>
    </section>
  );
}

export function StatusStrip({
  data,
  plan,
  channels,
  scanners,
}: {
  data: DashboardMock;
  plan: DispatchPlan;
  channels: ExternalChannel[];
  scanners?: ScannerSummary | null;
}) {
  const roles = Object.values(data.roles);
  const core = roles.filter((r) => (CORE_ROLES as readonly string[]).includes(r.name)).length;
  const optional = roles.length - core;

  const active = plan.steps.find((s) => s.status === "active");
  const done = plan.steps.filter((s) => s.status === "done").length;
  const roleTitle = active ? (ROLE_COPY[active.role]?.title ?? active.role) : "—";

  const openP0 = data.open_items.filter((i) => i.status === "open" && i.priority === "P0");
  const pass = data.evidence_samples.filter((s) => s.validation.ok).length;
  const reject = data.evidence_samples.length - pass;

  const chatOk = channels.filter((c) =>
    c.layers.some((l) => l.kind === "chat_bridge" && l.status === "ok"),
  ).length;
  const toolsOpen = channels.some(
    (c) => c.inventory_claimed > c.inventory_verified || c.layers.some((l) => l.kind === "tool_verify" && l.status !== "ok"),
  );


  const scannerChip = scannerOverviewChip(scanners);

  const chips = [
    {
      href: "#roles",
      label: "ROLES / 角色",
      value: `核心 ${core} · 可选 ${optional}`,
      detail: `共 ${roles.length} 个`,
      tone: "neutral" as const,
    },
    {
      href: "#dispatch",
      label: "DISPATCH / 当前派工",
      value: active
        ? `步骤 ${active.order} / ${plan.steps.length} · ${roleTitle}`
        : `已完成 ${done} / ${plan.steps.length}`,
      detail: active
        ? `${STEP_STATUS_LABEL[active.status ?? "active"]} · ${active.action}`
        : "无进行中步骤",
      tone: (active ? "info" : "ok") as "info" | "ok",
    },
    {
      href: "#queue",
      label: "OPEN P0 / 开放 P0",
      value: openP0.length > 0 ? `${openP0.length} 项` : "无",
      detail: openP0[0]?.title ?? "当前没有开放的 P0",
      tone: (openP0.length > 0 ? "warn" : "ok") as "warn" | "ok",
    },
    {
      href: "#evidence",
      label: "EVIDENCE / 证据校验",
      value: `${data.evidence_samples.length} 个样例`,
      detail: `${pass} 通过 · ${reject} 拒绝`,
      tone: (reject > 0 ? "warn" : "ok") as "warn" | "ok",
    },
    {
      href: "#channels",
      label: "CHANNELS / 外部通道",
      value: channels.length
        ? `共 ${channels.length} 条（mock）`
        : "尚未登记",
      detail: toolsOpen
        ? "示例或已登记，不是本机已核实连接"
        : "插件层数字来自 mock，不是本机实况",
      tone: (toolsOpen || chatOk < channels.length ? "warn" : "ok") as "warn" | "ok",
    },
    scannerChip,
  ];

  return (
    <section className="status-strip" aria-label="看板总览">
      {chips.map((c) => (
        <a key={c.label} href={c.href} className={`status-chip tone-${c.tone}`}>
          <span className="chip-label">{c.label}</span>
          <strong className="chip-value">{c.value}</strong>
          <span className="chip-detail">{c.detail}</span>
        </a>
      ))}
    </section>
  );
}

type WorkRow = {
  id: string;
  href: string;
  pill: string;
  pillClass: string;
  text: string;
  kind: "attention" | "progress" | "ok";
};

export function CurrentWork({
  data,
  plan,
  channels,
}: {
  data: DashboardMock;
  plan: DispatchPlan;
  channels: ExternalChannel[];
}) {
  const active = plan.steps.find((s) => s.status === "active");
  const open = data.open_items.filter((i) => i.status === "open");
  const pickable = open
    .filter((i) => i.lane !== "human")
    .sort((a, b) => a.priority.localeCompare(b.priority));
  const picked = pickable[0] ?? null;
  const humans = open.filter((i) => i.lane === "human");
  const quotaOn = plan.quota_exhausted;
  const channelGap = channels.some(
    (c) =>
      c.inventory_verified < c.inventory_claimed ||
      c.layers.some((l) => l.kind === "chat_bridge" && l.status !== "ok") ||
      c.layers.some((l) => l.kind === "tool_verify" && l.status !== "ok"),
  );

  const rows: WorkRow[] = [
    {
      id: "quota",
      href: "#dispatch",
      pill: quotaOn ? "配额耗尽" : "配额正常",
      pillClass: quotaOn ? "warn" : "status-done",
      text: quotaOn
        ? "外部编码 CLI 已跳过，执行官接管当前改/编/跑步骤。"
        : "外部编码 CLI 仍可调度；未启用配额耗尽预案。",
      kind: quotaOn ? "attention" : "ok",
    },
    {
      id: "active",
      href: "#dispatch",
      pill: active ? "进行中" : "无进行中步骤",
      pillClass: active ? "status-active" : "status-done",
      text: active
        ? `步骤 ${active.order} · ${ROLE_COPY[active.role]?.title ?? active.role}（${active.role}）正在执行 ${active.action}：${active.brief}`
        : "当前派工没有进行中的步骤。",
      kind: active ? "progress" : "ok",
    },
    {
      id: "picked",
      href: "#queue",
      pill: picked ? `已选取 ${picked.priority}` : "无可选取任务",
      pillClass: picked ? "p0" : "status-done",
      text: picked ? `${picked.title}（${picked.id}）` : "没有开放的非人工任务可选取。",
      kind: picked ? "attention" : "ok",
    },
    {
      id: "human",
      href: "#queue",
      pill: humans.length ? `人工轨 ${humans.length} 项` : "无待人工项",
      pillClass: humans.length ? "lane human" : "status-done",
      text: humans.length
        ? `${humans.map((h) => h.title).join("；")}。人工验收永远不会自动通过。`
        : "当前没有等待人工验收的开放项。",
      kind: humans.length ? "attention" : "ok",
    },
    {
      id: "channels",
      href: "#channels",
      pill: `外部通道 ${channels.length} 条`,
      pillClass: channelGap ? "warn" : "status-done",
      text: channelSummary(channels),
      kind: channelGap ? "attention" : "ok",
    },
  ];

  const focused = rows.filter((r) => r.kind !== "ok");
  const settled = rows.filter((r) => r.kind === "ok");
  const hint =
    focused.length > 0
      ? "先看本栏，再自条目进入对应目录。"
      : "当前没有例外。可自顶栏或总览指标进入对应目录。";

  return (
    <section className="current-work" id="current-work" aria-label="例外与当前工作">
      <header className="current-work-head">
        <h2>
          例外与当前工作
          <span className="title-en">EXCEPTIONS / CURRENT WORK</span>
        </h2>
        <p className="muted">{hint}</p>
      </header>
      {focused.length > 0 ? (
        <ul className="current-work-list">
          {focused.map((row) => (
            <li key={row.id} className={row.kind === "attention" ? "is-attention" : "is-progress"}>
              <span className={`pill ${row.pillClass}`}>{row.pill}</span>
              <span>
                {row.text}
                <a className="jump" href={row.href}>
                  查看
                </a>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {settled.length > 0 ? (
        <p className="current-work-settled">其余正常：{settled.map((r) => r.pill).join(" · ")}</p>
      ) : null}
    </section>
  );
}

function channelSummary(channels: ExternalChannel[]): string {
  if (channels.length === 0) {
    return "还没有通道。可在「外部通道」用「添加通道」按 kind 与 endpoint 登记。";
  }
  const gaps = channels.filter(
    (c) =>
      c.inventory_verified < c.inventory_claimed ||
      c.layers.some((l) => l.kind === "chat_bridge" && l.status !== "ok") ||
      c.layers.some((l) => l.kind === "tool_verify" && l.status !== "ok"),
  );
  if (gaps.length === 0) {
    return `已列出 ${channels.length} 条（含示例）。数字来自 mock，不是本机已核实连接。`;
  }
  const parts = gaps.map((c) => {
    const chat = c.layers.find((l) => l.kind === "chat_bridge");
    if (chat?.status !== "ok") return `${c.title} 对话未齐`;
    if (c.inventory_claimed === 0) return `${c.title} 尚未列出可验证工具`;
    if (c.inventory_verified < c.inventory_claimed) {
      return `${c.title} 工具 ${c.inventory_verified}/${c.inventory_claimed} 已验证`;
    }
    return `${c.title} 插件仅部分验证`;
  });
  return `${parts.join("；")}。能对话不等于能调用全部插件。`;
}

function scannerOverviewChip(scanners?: ScannerSummary | null): {
  href: string;
  label: string;
  value: string;
  detail: string;
  tone: "info" | "warn" | "ok";
} {
  if (!scanners || scanners.availability === "idle") {
    return {
      href: "#interfaces",
      label: "INTERFACES / 本机接口",
      value: "尚未扫描",
      detail: "点此查看扫描器目录。发现不是已核实连接。",
      tone: "info",
    };
  }
  if (scanners.availability === "missing_route") {
    return {
      href: "#interfaces",
      label: "INTERFACES / 本机接口",
      value: "桥接未提供 /bridge/scanners",
      detail: "没有编造本机发现结果。",
      tone: "warn",
    };
  }
  if (scanners.availability === "offline") {
    return {
      href: "#interfaces",
      label: "INTERFACES / 本机接口",
      value: "桥接未接通",
      detail: "无法连接本机桥接，不是已核实。",
      tone: "warn",
    };
  }
  if (!scanners.scanned && scanners.availability !== "example") {
    return {
      href: "#interfaces",
      label: "INTERFACES / 本机接口",
      value: scanners.availability === "error" ? "扫描失败" : "尚未扫描",
      detail: "点此查看扫描器目录。发现不是已核实连接。",
      tone: "info",
    };
  }
  if (scanners.availability === "example") {
    return {
      href: "#interfaces",
      label: "INTERFACES / 本机接口",
      value: `示例 已发现 ${scanners.discovered} · 缺密钥 ${scanners.missing_key} · 未找到 ${scanners.not_found}`,
      detail: "这是示例数据，不是本机实机扫描。",
      tone: "warn",
    };
  }
  return {
    href: "#interfaces",
    label: "INTERFACES / 本机接口",
    value: `已发现 ${scanners.discovered} · 缺密钥 ${scanners.missing_key} · 未找到 ${scanners.not_found}`
      + (scanners.registered_unverified ? ` · 已登记未验证 ${scanners.registered_unverified}` : ""),
    detail: "点此查看详情。已发现或已保存密钥 ≠ 已核实。",
    tone: scanners.missing_key > 0 ? "warn" : "info",
  };
}
