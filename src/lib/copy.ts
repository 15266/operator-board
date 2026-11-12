/** Plain-language copy for first-time operators. API names stay in English. */

export const CORE_ROLES = ["host", "progress", "improve", "execute"] as const;

export interface RoleCopy {
  title: string;
  meaning: string;
  kind: "core" | "optional";
}

export const ROLE_COPY: Record<string, RoleCopy> = {
  host: {
    title: "主控",
    meaning: "跟用户做计划、派工和验收的主控。",
    kind: "core",
  },
  progress: {
    title: "进度官",
    meaning: "审阅完成度与证据，标出已完成、部分完成、未核实或必须人工验收的项。",
    kind: "core",
  },
  improve: {
    title: "改进官",
    meaning: "排出优先级，并提出下一个可执行的最小任务。",
    kind: "core",
  },
  execute: {
    title: "执行官",
    meaning: "真正改代码、编译和跑任务；外部配额耗尽时接管内部分发。",
    kind: "core",
  },
  workbuddy: {
    title: "WorkBuddy 探查",
    meaning: "可选的低成本串行信息采集代理，用来探事实，不替代执行。",
    kind: "optional",
  },
  unreal_box: {
    title: "引擎/设备适配器",
    meaning: "可选的设备或引擎命令行适配器（截图、预览、资源检查），不是某套工程的归档。",
    kind: "optional",
  },
  desktop: {
    title: "桌面代理",
    meaning: "可选的桌面 / 图形界面代理，负责浏览器、识别和点击操作。",
    kind: "optional",
  },
  external_codex: {
    title: "外部编码 CLI",
    meaning: "可选的外部编码命令行（如 Codex）。配额耗尽时跳过，改由执行官接管。",
    kind: "optional",
  },
};

export const CAPABILITY_LABEL: Record<string, string> = {
  plan: "做计划",
  dispatch: "派工",
  verify: "验收",
  user_report: "向用户汇报",
  quota_failover: "配额切换",
  completion_matrix: "完成度矩阵",
  evidence_review: "审阅证据",
  maintenance_digest: "维护摘要",
  prioritize: "排优先级",
  gap_analysis: "缺口分析",
  p0_p1_p2: "P0/P1/P2 分级",
  code_change: "改代码",
  build: "编译构建",
  minimal_task: "最小任务",
  quota_takeover: "配额接管",
  cheap_info: "低成本探查",
  serial_dispatch: "串行派工",
  artifact_capture: "采集产物",
  ue_cli: "引擎命令行",
  pie: "运行时预览",
  screenshot: "截图",
  asset_inspect: "资源检查",
  gui: "图形界面",
  browser: "浏览器",
  vision: "视觉识别",
  click: "点击操作",
  codex_cli: "外部编码 CLI",
  maintenance_loop: "维护循环",
  codex_exec: "外部执行",
};

export const PANEL_COPY = {
  roles: {
    titleZh: "角色板",
    titleEn: "ROLES",
    purpose: "看看编排里有哪些角色、各自负责什么，以及哪些是按需接入的适配器。",
    howto:
      "先认中间四个核心角色：主控派工、进度审证据、改进排优先级、执行真正动手。虚线卡片是可选适配器，不是每次都要上场。英文 id 是接口里的角色名。",
    tool: "list_roles / upsert_role",
  },
  dispatch: {
    titleZh: "派工时间线",
    titleEn: "DISPATCH",
    purpose: "按顺序展示主控把工作派给谁，以及当前走到哪一步。",
    howto:
      "时间线从上到下执行。打开「配额耗尽」开关，可对照跳过外部编码 CLI、改由执行官接管的另一套计划。状态同时用文字和颜色标记。",
    tool: "make_dispatch_plan",
  },
  brief: {
    titleZh: "轮次简报",
    titleEn: "ROUND BRIEF",
    purpose: "本轮任务的五件套：目标、路径、成功标准、禁止项、证据路径。",
    howto:
      "派工和动手前先读完这五项。执行时不得做禁止项里的事；验收时按证据路径核对，不能用感觉代替。",
    tool: "make_round_brief",
  },
  queue: {
    titleZh: "最小任务队列",
    titleEn: "TASK QUEUE",
    purpose: "从开放任务里选出下一个可自动执行的最小项，并跳过必须人工验收的任务。",
    howto:
      "高亮的「已选取」是 next_minimal_task 会 pick 的项（跳过 human 轨，优先 P0）。标了「人工验收」的任务永远不会被自动选取。",
    tool: "next_minimal_task · pick",
  },
  evidence: {
    titleZh: "证据分轨校验",
    titleEn: "EVIDENCE",
    purpose: "把编译、自动测试、画面检查、人工验收分成四条独立轨道校验，防止混为一谈或伪造「手感」。",
    howto:
      "切换「合法分轨」和「伪造手感」两个样例，看校验如何通过或拒绝。四轨必须分开记账；human 轨没有真人证明时不能写成通过，也禁止用「手感好了」代替。",
    tool: "validate_evidence_report",
  },
  audit: {
    titleZh: "审计事件",
    titleEn: "AUDIT",
    purpose: "按时间回溯派工、取任务、校验等关键事件，便于核对「谁在何时做了什么」。",
    howto: "最新事件在上。每条都标明事件种类、相关角色和详情；时间已换算为 Asia/Shanghai。",
    tool: "record_event",
  },
  codex: {
    titleZh: "Codex 链路",
    titleEn: "CODEX LINK",
    purpose: "查看外部编码 CLI 的连接、鉴权和配额状态。本页是演示用的 mock 桩，不会真的连出去。",
    howto:
      "先看总状态（正常 / 降级 / 中断）和最近探测时间。真实环境需要主机侧探测；这里的「正常」只代表桩数据。更完整的「能对话 ≠ 能调插件」分层，见「外部通道」页。",
    tool: "codex_status（stub）",
  },
  channels: {
    titleZh: "通道索引",
    titleEn: "CHANNEL INDEX",
    purpose:
      "登记并查阅可链接的外部 AI 通道。WorkBuddy、Codex、豆包只是示例；可用「添加通道」按类型 kind 和接入点 endpoint 再登记新的。对话或 GUI 打通，并不等于已经拿到对方的全部 MCP / 插件。",
    howto:
      "先读顶部三条原则，再看「声称 claimed / 已验证 verified」对照表。表中 WorkBuddy / Codex / 豆包等行来自示例或离线登记，格子里的已通、已验证或工具计数不是本机实机结论。桥接在线时可点「一键探测」：先刷新本机发现，再对能对应到扫描器的接口做目录或版本探测（POST /bridge/scan/probe）。探测只说明找到、在听或目录有应答，不会把 chat_bridge 或 tool_verify 标绿，也不等于密钥已通过对话核实。点「添加通道」填写名称、类型 kind（如 mcp、codex_cli、http_api）和接入点 endpoint，即可在本看板做一次离线登记（只写入浏览器 localStorage，不会调用 MCP，也不会连外部账号）；登记后四层仍是未验证。每个通道分四层：对话桥 chat_bridge（能否发消息并读到回复）、工具清单 tool_inventory（已列出哪些 MCP/工具）、逐项验证 tool_verify（哪些真正调用过）、配额 quota。优先按功能调用；屏幕控制是最后手段。",
    tool: "list_channels / list_adapters（本看板为离线 mock，不会调用 MCP）",
  },
  interfaces: {
    titleZh: "本机接口",
    titleEn: "LOCAL INTERFACES",
    purpose:
      "由扫描器注册表驱动的本机 AI 接口目录。行、名称与状态来自登记与扫描记录；自目录选取一行进入详情，密钥在详情中填写。",
    howto:
      "总览只列出注册表中的扫描器及其文字状态，点进去再填写密钥或查看高级字段。已发现只表示短探测有应答，不是 chat_bridge 已通。缺密钥优先于已发现。骨架模板不会当成已发现。第一次进入可自动扫描一次，之后用「扫描本机常见端口」，不要无说明地后台轮询。",
    tool: "GET /bridge/scanners · POST /bridge/scan",
  },
  projects: {
    titleZh: "圆桌会议目录",
    titleEn: "ROUNDTABLE INDEX",
    purpose:
      "自建圆桌会议与所属任务目录。为每条任务指定执行器与模型。与「队列」中的自动选取项分列。",
    howto:
      "先新建圆桌会议，再在其下登记任务。每场会议都有一位固定的国王，职能是接收其他 AI 本轮的任务结果并向用户汇报，只需为其指定执行器与模型。骑士为自定义角色，名称、职能与执行器都由你配置。没有配好执行器的国王时，不能开启执行这场会议。拆解任务时可从骑士名册选用，或为单条分工临时填写。工作区顶部的默认模型可被单条任务覆盖。添加的模型名只是本机标签，不是供应商实时目录。执行器默认未指定；选定后仍要看核实状态。选择或点「开始」只记录本机意向，不会自动派发，也不等于已连通。数据保存在浏览器 localStorage。",
    tool: "list_projects / upsert_task（契约待补，本看板为离线 mock）",
  },
} as const;

export const LANE_COPY: Record<
  string,
  { title: string; meaning: string }
> = {
  compile: {
    title: "编译",
    meaning: "构建或编译是否通过，例如 npm run build。只说明「能不能编过」，不代替测试或人工验收。",
  },
  automated: {
    title: "自动测试",
    meaning: "脚本或自动测试的结果。与编译分开记账；跳过时应明确写 skipped，不能暗含通过。",
  },
  visual_pie: {
    title: "画面检查",
    meaning: "目视或集成界面检查。在本离线看板里指界面截图核验，不是游戏 / Unreal 的 PIE。",
  },
  human: {
    title: "人工验收",
    meaning: "必须由真人体验后才能判定。没有真人证明时只能标「未验收」，系统不得自动写成通过。",
  },
};

export const LANE_SEPARATION_NOTE =
  "四条轨道必须分开记账，不能合成一句「全都过了」。人工验收轨永远不会被自动判定通过。";

export const STEP_STATUS_LABEL: Record<string, string> = {
  done: "完成",
  active: "进行中",
  pending: "等待",
  skipped: "跳过",
};

export const ITEM_STATUS_LABEL: Record<string, string> = {
  open: "开放",
  closed: "已关闭",
  in_progress: "进行中",
};

export const CLAIM_LABEL: Record<string, string> = {
  pass: "通过",
  skipped: "跳过",
  fail: "失败",
  UNVERIFIED: "未验收",
};

export const CODEX_STUB_LABEL: Record<string, string> = {
  ok: "正常",
  degraded: "降级",
  down: "中断",
};

export interface GlossaryEntry {
  term: string;
  meaning: string;
}

export const GLOSSARY_GROUPS: { title: string; entries: GlossaryEntry[] }[] = [
  {
    title: "MCP 工具",
    entries: [
      { term: "list_roles", meaning: "列出编排里的角色及其能力。" },
      { term: "upsert_role", meaning: "新增或更新一个角色定义。" },
      { term: "make_dispatch_plan", meaning: "按目标生成一条派工时间线（谁、按什么顺序、做什么）。" },
      { term: "make_round_brief", meaning: "生成本轮五件套简报：目标、路径、成功标准、禁止项、证据路径。" },
      { term: "next_minimal_task", meaning: "从开放任务中选取下一个可执行的最小项。" },
      { term: "pick", meaning: "选取动作：跳过 human 轨，优先更高优先级（如 P0）。" },
      { term: "validate_evidence_report", meaning: "检查证据是否分轨记录，并拒绝无真人证明的「假手感」。" },
      { term: "record_event", meaning: "把派工、取任务、校验等事件写入审计日志。" },
      { term: "codex_status", meaning: "查询外部编码 CLI 的连接与配额；本看板为 mock 桩。" },
      { term: "channel_status", meaning: "查询外部 AI 通道的分层状态（对话桥 / 工具清单 / 逐项验证 / 配额）；本看板为 mock 桩。" },
      { term: "list_projects / upsert_task", meaning: "即将补充的圆桌会议与任务契约（字段含 project_id、task_id、executor_channel_id；界面称为圆桌会议，存储与协议字段名不变）。本看板为离线 mock，尚未调用这些工具。" },
    ],
  },
  {
    title: "规则与状态",
    entries: [
      { term: "quota_exhausted", meaning: "外部 CLI 配额已耗尽。此时不调度 external_codex，改由执行官接管。" },
      { term: "failover", meaning: "主执行方不可用时，改派给备用角色（例如落到 execute）。" },
      { term: "P0 / P1 / P2", meaning: "任务优先级：P0 最先做，P2 可后置。" },
      { term: "UNVERIFIED", meaning: "尚未被规定的验收方核实。人工轨在未试玩前应保持此状态。" },
      { term: "feel / 手感 / NO_MORE_ISSUES", meaning: "禁止在没有人工轨证明时使用的「假通过」措辞，校验会拒绝。" },
      { term: "stub", meaning: "演示用的状态桩，不代表真实外部连接已经探测成功。" },
    ],
  },
  {
    title: "证据轨道",
    entries: [
      { term: "compile", meaning: LANE_COPY.compile.meaning },
      { term: "automated", meaning: LANE_COPY.automated.meaning },
      { term: "visual_pie", meaning: LANE_COPY.visual_pie.meaning },
      { term: "human", meaning: LANE_COPY.human.meaning },
    ],
  },
  {
    title: "外部通道",
    entries: [
      { term: "chat_bridge", meaning: "对话桥：能向该通道发消息并读到回复。成功只证明聊天可达，不证明插件已开放。" },
      { term: "tool_inventory", meaning: "工具清单：已经列出的 MCP / 插件配置。列入清单是「声称 claimed」，还不是「已验证」。" },
      { term: "tool_verify", meaning: "逐项验证：对清单里的工具做过实际调用并留下证据。未验证的项不能当成可用。" },
      { term: "quota", meaning: "配额：该通道或外部 CLI 是否还有可调度额度。耗尽时应改由执行官接管。" },
      { term: "claimed / verified", meaning: "声称 vs 已验证：claimed 表示出现在清单或口头说明里；verified 表示实际跑通并留证。" },
      { term: "三方自动同步", meaning: "同时在多个外部 AI 之间自动转发与对齐上下文。当前未实现，只是分别发送并读取回复。" },
      { term: "按功能调用", meaning: "优先通过对方暴露的工具/API 按功能调用；不要一上来就操作屏幕。" },
      { term: "屏幕控制", meaning: "用桌面代理点击、键入或截图来驱动对方 GUI。这是最后手段，不能代替已验证的功能调用。" },
      { term: "screenshot-verify", meaning: "用截图核验窗口或回复。失败（例如窗口识别错误）应单独标记，不能写成对话失败或插件已通。" },
      { term: "kind", meaning: "通道类型，例如 workbuddy_desktop、codex_cli、mcp、http_api、a2a。决定用哪类适配器，不是只支持固定两家产品。" },
      { term: "endpoint", meaning: "接入点：CLI 路径、MCP / HTTP 地址，或桌面应用标识。" },
      { term: "添加通道", meaning: "把一个新的外部 AI 登记到通道区。登记只写入看板（mock），仍需分别验证对话桥与插件。" },
    ],
  },

  {
    title: "本机接口",
    entries: [
      { term: "本机接口", meaning: "按扫描器注册表列出的本机 AI 发现视图。新增扫描器并写入 registry.json 后，列表会自动多一行，不必改界面代码。" },
      { term: "GET /bridge/scanners", meaning: "返回注册表目录（id、display_name、module、status 等）。骨架模板不会当作活接口。" },
      { term: "POST /bridge/scan", meaning: "对已登记扫描器做一次发现（live 默认 false），返回 DiscoveryRecord[]，记录中不含密钥。" },
      { term: "已发现 / discovered", meaning: "短探测（例如 GET /api/tags、/api/version、/v1/models 或 TCP）有应答。只预填 base_url，不是 chat_bridge=ok，也不是工具核实。" },
      { term: "缺密钥 / missing_key", meaning: "该实例需要环境变量（auth.mode=user_secret 且尚未设置）。与已发现同时成立时，以缺密钥为准。" },
      { term: "未找到 / not_found", meaning: "短名单地址在超时内无应答。只说明这次没扫到，不是通道损坏。" },
      { term: "已登记未验证 / registered_unverified", meaning: "已作为本机实例或登记保存，四层仍是未验证。环境变量已设置也不升级 chat_bridge。" },
      { term: "auth_ref / api_key_env", meaning: "环境变量名，不是密钥本身。保存后界面只显示已保存或该变量名。" },
      { term: "已保存", meaning: "密钥已交给本机桥接进程的环境变量。界面不会回显密钥，也不等于已核实对话。" },
      { term: "已有会话，待实机核实后再派发", meaning: "发现记录为 session_available 或已检测到会话。只说明会话迹象，不能写成已连通。" },
      { term: "发现 ≠ 核实", meaning: "扫描成功、填好密钥或列出模型，都不能把 chat_bridge 或 tools_verified 写成已通。" },
    ],
  },
  {
    title: "圆桌会议任务",
    entries: [
      { term: "圆桌会议任务", meaning: "由操作员在本看板创建的圆桌会议及其下属任务。与自动选取的最小任务队列分开；须亲自为任务指定执行器。" },
      { term: "project_id", meaning: "圆桌会议的稳定标识。即将补充的 MCP 契约使用此字段名；本看板先写入本机 localStorage。界面称其为圆桌会议，存储与协议字段名不变。" },
      { term: "task_id", meaning: "圆桌会议下一条任务的稳定标识。即将补充的 MCP 契约使用此字段名。" },
      { term: "executor_channel_id", meaning: "任务指定的执行通道 id，对应已登记通道的 id。为空表示未指定执行器。指定不等于已连通或已派发。" },
      { term: "未指定执行器", meaning: "任务尚未选择执行通道时的默认状态。系统不会默认锁死某一家外部 AI。" },
      { term: "待核实后再派发", meaning: "已经点选了执行通道，但该通道尚未达到可派发的核实标准（对话桥已通、逐项验证已通过，且已声称的工具均已验证）。选择通道本身不能写成已连通。" },
      { term: "多 AI 分工", meaning: "圆桌会议的席位名册。每场会议有且仅有一位国王，另可添加若干骑士。没有配好执行器的国王时，不能开启执行这场会议。" },
      { term: "国王 / KING", meaning: "固定席位。职能不可改、不可删除。职能是接收其他 AI 本轮的任务结果，并向用户汇报。名称默认为「国王」，个别会议可显示特定称呼，但操作员不能改职能或删除国王，只需为其配置执行器与模型。一轮任务留下记录后，可把这些记录发给国王，请国王汇总汇报；看板不会把尚未出现的结果写成已完成。" },
      { term: "骑士 / KNIGHT", meaning: "自定义工作角色。名称、职能与执行器（及模型）都由操作员配置，可添加或删除。按任务分配角色只会建议或写入骑士，不会改动或复制国王。" },
      { term: "角色 / role_name", meaning: "骑士的短标签，例如策划、执笔、评审、检索。由操作员自拟。国王名称默认为「国王」，个别会议可显示特定称呼。" },
      { term: "职能 / duty", meaning: "骑士负责什么、如何验收、怎样与其他角色配合；派发时写入提示词。国王的职能固定为接收本轮结果并向用户汇报，不可编辑。" },
      { term: "role_id", meaning: "分工与圆桌会议名册条目的关联。删除名册角色时会清空此字段，但分工上已抄下的角色名与职能会保留。" },
    ],
  },
];

export const HERO = {
  kicker: "portable-agent-orchestrator",
  title: "概况",
  titleEn: "OVERVIEW",
  intro:
    "本页为离线演示总览，数据出自 mock 目录，不是本机通道的实况。自建任务请至左侧「圆桌会议目录」。",
};

export const BRIEF_FIELDS = [
  {
    key: "goal" as const,
    index: "1",
    label: "目标",
    en: "goal",
    hint: "这一轮要做成什么。",
  },
  {
    key: "path" as const,
    index: "2",
    label: "路径",
    en: "path",
    hint: "在哪台机器、哪个目录上做。",
  },
  {
    key: "success" as const,
    index: "3",
    label: "成功标准",
    en: "success",
    hint: "怎样才算做完，必须可核对。",
  },
  {
    key: "not_to_do" as const,
    index: "4",
    label: "禁止项",
    en: "NOT-to-do",
    hint: "明确不能做的事，执行时必须避开。",
  },
  {
    key: "evidence_paths" as const,
    index: "5",
    label: "证据路径",
    en: "evidence",
    hint: "验收时到哪里核对产物。",
  },
];

export const LAYER_COPY: Record<
  string,
  { title: string; meaning: string }
> = {
  chat_bridge: {
    title: "对话桥",
    meaning: "能否发消息并读到回复。成功只证明聊天可达。",
  },
  tool_inventory: {
    title: "工具清单",
    meaning: "已列出的 MCP / 插件配置，属于声称而非验证。",
  },
  tool_verify: {
    title: "逐项验证",
    meaning: "清单中真正调用过、并留下证据的项。",
  },
  quota: {
    title: "配额",
    meaning: "该通道是否还有可调度额度。",
  },
};

export const LAYER_STATUS_LABEL: Record<string, Record<string, string>> = {
  chat_bridge: {
    ok: "已通",
    partial: "部分通",
    fail: "失败",
    unverified: "未验证",
    na: "不适用",
  },
  tool_inventory: {
    ok: "已列出",
    partial: "部分列出",
    fail: "列出失败",
    unverified: "未列出",
    na: "不适用",
  },
  tool_verify: {
    ok: "已验证",
    partial: "部分验证",
    fail: "验证失败",
    unverified: "未验证",
    na: "不适用",
  },
  quota: {
    ok: "正常",
    partial: "紧张",
    fail: "已耗尽",
    unverified: "未探测",
    na: "不适用",
  },
};

export const BOOL_CLAIM_LABEL = {
  claimedYes: "已声称",
  claimedNo: "未声称",
  verifiedYes: "已验证",
  verifiedNo: "未验证",
} as const;

export const CHANNEL_PRINCIPLES = [
  {
    id: "chat-ne-tools",
    title: "能对话 ≠ 能调用其全部插件",
    body: "对话桥或 GUI 打通，只说明能发消息并读到回复。不能据此认为已经获得对方内部全部 MCP / 插件的调用权。",
  },
  {
    id: "no-triple-sync",
    title: "未实现三方自动同步",
    body: "目前是分别向各应用发送并读取回复，并没有在 WorkBuddy、Codex、豆包之间自动对齐上下文。",
  },
  {
    id: "prefer-function-call",
    title: "优先按功能调用，屏幕控制是最后手段",
    body: "先查看通道暴露了哪些工具，按功能调用；不要一上来就操作屏幕或让对方截图传回。",
  },
] as const;

export const SCREENSHOT_VERIFY_LABEL: Record<string, string> = {
  ok: "截图核验通过",
  fail: "截图核验失败",
  skipped: "截图核验跳过",
};

export const CHANNEL_KINDS: { id: string; label: string; hint: string }[] = [
  { id: "workbuddy", label: "WorkBuddy", hint: "示例：桌面对话桥 / 可选 MCP。登记不等于已连接。" },
  { id: "codex", label: "Codex", hint: "示例：CLI / app-server / ACP。cli_ok 不是工具权限。" },
  { id: "openai-compatible", label: "OpenAI 兼容 HTTP", hint: "任意 Chat Completions 兼容端。填 key 名不等于 chat_ok。" },
  { id: "anthropic", label: "Anthropic Claude", hint: "Messages API 骨架。不是已官方核通。" },
  { id: "generic-mcp", label: "通用 MCP", hint: "stdio 或 Streamable HTTP。列出工具 ≠ 已核实。" },
  { id: "a2a", label: "A2A", hint: "Agent Card 发现 ≠ 工具清单或核实。" },
  { id: "custom", label: "自定义适配器", hint: "尚未内置的类型，先登记再补适配。本看板是离线 mock。" },
];

/** Labels for older mock/localStorage kind strings; not canonical adapter ids. */
export const CHANNEL_KIND_ALIASES: Record<string, string> = {
  workbuddy_desktop: "workbuddy",
  codex_cli: "codex",
  doubao_desktop: "doubao",
  http_api: "openai-compatible",
  mcp: "generic-mcp",
};

/** One-click reachability / catalog probe on the channels page. Not chat_bridge or tool_verify. */
export const CHANNEL_PROBE = {
  titleZh: "实机探测结果",
  titleEn: "LIVE PROBE",
  hint: "先刷新本机发现，再对能对应到扫描器的接口调用 POST /bridge/scan/probe（目录或版本探测）。成功只说明找到、端口在听或目录有应答，不会把 chat_bridge 或 tool_verify 标绿。需要密钥时仍显示「需要填写密钥」，探测不会假装鉴权已通过。",
  refreshing: "正在刷新本机发现…",
  probingProgress(done: number, total: number): { zh: string; en: string } {
    return { zh: `正在探测 ${done}/${total}…`, en: `PROBING ${done}/${total}` };
  },
  done: "探测完成。成功只说明发现或目录有应答，不是 chat_bridge=ok，也不是工具已核实。",
  offline: "桥接未启动，无法探测。",
  missingRoute: "桥接尚未提供 POST /bridge/scan/probe，无法执行此操作。",
  offlineDropped: "本机桥接未接通，探测未完成。未把未完成的请求写成成功。",
  noTargets: "没有可对应到扫描器的接口，未调用目录探测。下面只列出本次发现结果。",
  matrixHint:
    "本表四层与工具计数来自示例或离线登记，不是实机探测结论。右侧「实机探测」是本页刚才跑过的发现 / 目录探测，成功也不会改写左侧 chat_bridge 或 tool_verify。",
  sourceDemo: "示例",
  sourceRegistered: "已登记",
  sourceLive: "实机",
  notRun: "尚未探测",
  noScanner: "无对应扫描器",
  found: "已找到",
  notFound: "未找到",
  listening: "端口在听",
  notListening: "未在听",
  catalogOk: "目录或版本探测通过",
  catalogFail: "目录或版本探测未通过",
  catalogNa: "未做目录探测",
  authMissing: "需要填写密钥",
  models(count: number): string {
    return `目录列出 ${count} 个模型名（仅清单，不是对话核实）`;
  },
  workbuddyModels: "WorkBuddy 模型目录（GET /bridge/models，只列清单，不发送提示词）",
  healthTitle: "健康检查补充（GET /bridge/health）",
} as const;

export const INTERFACE_STATUS_COPY = {
  discovered: "已发现",
  missing_key: "缺密钥",
  not_found: "未找到",
  registered_unverified: "已登记未验证",
} as const;

export const SESSION_PENDING_COPY = "已有会话，待实机核实后再派发";


/** Page titles: Chinese display + uppercase tracked English label. */
export const VIEW_TITLE = {
  projects: { zh: "圆桌会议目录", en: "ROUNDTABLE INDEX" },
  channels: { zh: "通道索引", en: "CHANNEL INDEX" },
  interfaces: { zh: "本机接口", en: "LOCAL INTERFACES" },
  overview: { zh: "概况", en: "OVERVIEW" },
  dispatch: { zh: "派工", en: "DISPATCH" },
  brief: { zh: "简报", en: "ROUND BRIEF" },
  queue: { zh: "队列", en: "TASK QUEUE" },
  evidence: { zh: "证据", en: "EVIDENCE" },
  audit: { zh: "审计", en: "AUDIT" },
  roles: { zh: "角色", en: "ROLES" },
  codex: { zh: "链路", en: "CODEX LINK" },
} as const;

export const ACTION = {
  newProject: { zh: "新建圆桌会议", en: "NEW ROUNDTABLE" },
  createProject: { zh: "创建圆桌会议", en: "CREATE ROUNDTABLE" },
  deleteProject: { zh: "删除圆桌会议", en: "DELETE ROUNDTABLE" },
  newTask: { zh: "新建任务", en: "NEW TASK" },
  scanPorts: { zh: "扫描本机常见端口", en: "SCAN LOCAL PORTS" },
  scanning: { zh: "正在扫描…", en: "SCANNING" },
  allInterfaces: { zh: "全部接口", en: "ALL INTERFACES" },
  allProjects: { zh: "圆桌会议目录", en: "ROUNDTABLE INDEX" },
  allChannels: { zh: "全部通道", en: "ALL CHANNELS" },
  addChannel: { zh: "添加通道", en: "ADD CHANNEL" },
  accessInterface: { zh: "查阅接口", en: "ACCESS INTERFACE" },
  viewExample: { zh: "查看示例（不是本机扫描）", en: "VIEW EXAMPLE" },
  close: { zh: "关闭", en: "CLOSE" },
  cancel: { zh: "取消", en: "CANCEL" },
  addRole: { zh: "添加骑士", en: "ADD KNIGHT" },
  deleteRole: { zh: "删除骑士", en: "DELETE KNIGHT" },
  writeToRoster: { zh: "同时写入名册", en: "ADD TO ROSTER" },
  assignFromTask: { zh: "按任务分配骑士", en: "ASSIGN KNIGHTS" },
  reportToKing: { zh: "向国王汇报本轮结果", en: "REPORT TO KING" },
  applyAssignment: { zh: "采用分配", en: "APPLY ASSIGNMENT" },
  dismissAssignment: { zh: "不用这份建议", en: "DISCARD" },
  useLocalDraft: { zh: "改用本地草稿", en: "USE LOCAL DRAFT" },
  probeChannels: { zh: "一键探测", en: "PROBE CHANNELS" },
  probing: { zh: "正在探测…", en: "PROBING" },

  glossary: { zh: "术语表", en: "GLOSSARY" },
  menu: { zh: "菜单", en: "MENU" },
} as const;

export const NAV_SECTION = {
  projectArchive: { zh: "圆桌会议", en: "ROUNDTABLE" },
  channelIndex: { zh: "通道索引", en: "CHANNEL INDEX" },
  interfaceIndex: { zh: "接口索引", en: "INTERFACE INDEX" },
  demoIndex: { zh: "演示索引", en: "DEMO INDEX" },
} as const;

export const FOOTNOTE = {
  en: "LOCAL PERSIST · ROUNDTABLE",
  zh: "圆桌会议、偏好与自行登记的通道保存在本机浏览器。选择执行器或点「开始」只记录意向，不会自动派发。",
} as const;

export const COL_HEADER = {
  no: "No.",
  interface: "INTERFACE / 接口",
  transport: "TRANSPORT / 传输",
  endpoint: "ENDPOINT / 端点",
  status: "STATUS / 状态",
  channel: "CHANNEL / 通道",
  kind: "KIND / 类型",
  tools: "TOOLS / 已验证 · 声称",
  tool: "TOOL / 工具",
  claimed: "CLAIMED / 声称",
  verified: "VERIFIED / 已验证",
  note: "NOTE / 说明",
  layers: "LAYERS / 分层",
  credentials: "CREDENTIALS / 凭据",
  liveProbe: "LIVE PROBE / 实机探测",
} as const;

export function deleteProjectConfirm(name: string): string {
  return `确定删除圆桌会议「${name}」及其全部任务？`;
}

export const AI_DIVISION = {
  titleZh: "圆桌席位",
  titleEn: "ROUNDTABLE SEATS",
  hint: "每场圆桌会议有一位固定的国王，以及可由你增删的骑士。国王职能固定：接收其他 AI 本轮的任务结果，并向用户汇报。国王的执行器只能选带图形界面的桌面应用，汇报会发到该软件的窗口里；命令行接口不能当国王。你还需为国王指定模型。骑士的名称、职能与执行器都由你配置。没有配好图形界面执行器的国王时，不能开启执行这场会议。骑士名册的改动不会自动改写已派给分工的角色与职能；重新选用即可更新。",
  empty: "国王席位已就绪。请为国王指定执行器，并按需要添加骑士。",
  role: { zh: "角色", en: "ROLE" },
  duty: { zh: "职能", en: "DUTY" },
  persona: { zh: "内部形象", en: "PERSONA" },
  portrait: { zh: "形象印记", en: "PORTRAIT" },
  king: { zh: "国王", en: "KING" },
  knight: { zh: "骑士", en: "KNIGHT" },
  kingDuty: "接收其他 AI 本轮的任务结果，并向用户汇报。",
  kingHint: "国王是固定席位，职能不可改、不可删除。名称默认为「国王」，个别会议可显示特定称呼，但仍不可改职能或删除国王。国王的执行器必须是带图形界面的桌面应用，汇报会发到该软件窗口里；命令行接口不能当国王。请指定后，才能开启执行本场会议。一轮任务留下记录后，可把这些记录交给国王，由国王向你汇报。看板不会自动把结果送给国王，也不会把尚未出现的结果写成已完成。",
  kingExecutorRequired: "请先为国王指定带图形界面的执行器，才能开启执行这场圆桌会议。",
  kingExecutorNeedGui: "国王只能使用带图形界面的执行器。请改选 WorkBuddy、豆包等桌面应用，命令行接口不能当国王。",
  kingMissing: "没有国王角色，不能开启执行这场圆桌会议。",
  reportHint: "国王负责向你汇报。点此把本轮已有的派发记录发给国王的图形界面执行器，请国王在该软件窗口里汇总。不会自动派发，也不会把尚未出现的结果写成已完成。",
  reportNeedResults: "还没有可汇报的本轮记录。请先派发骑士任务，或等已发出的任务留下结果。",
  reportNeedKing: "请先为国王指定带图形界面的执行器，才能把本轮结果交给国王，并在该软件窗口里汇报。",
  reporting: { zh: "正在向国王汇报…", en: "REPORTING" },
  roundtable: { zh: "圆桌", en: "ROUNDTABLE" },
  monogram: { zh: "字头", en: "MONOGRAM" },
  unassigned: "未指定角色",
  custom: "临时填写…",
  namePlaceholder: "例如 策划、执笔、评审、检索",
  dutyPlaceholder: "负责什么、如何验收、怎样与其他角色配合",
  personaPlaceholder: "这位在圆桌上如何说话、如何行事",
  customLabel(name: string): string {
    return name.trim() ? `临时：${name.trim()}` : "临时填写…";
  },
} as const;

/** Optional one-click: propose 角色 / 职能 from the meeting's tasks. Never auto-dispatches. */
export const ASSIGN_ROLES = {
  consult: { zh: "征询的执行器", en: "CONSULT" },
  requesting: { zh: "正在征询…", en: "CONSULTING" },
  thinking: "正在根据任务拟角色与职能…（每 2.5 秒刷新）",
  previewTitle: { zh: "角色分配预览", en: "ASSIGNMENT PREVIEW" },
  localDraftTitle: { zh: "本地草稿", en: "LOCAL DRAFT" },
  hint: "可选。按本场会议的任务建议骑士及职能。不会改动或删除国王，也不会再创建国王。只在点「采用分配」后写入名册，不会自动派发，也不会在采用前改执行器。",
  noTasksHint: "先登记至少一条任务，再按任务分配骑士。",
  replaceConfirm:
    "现有骑士将被这份建议替换，国王席位会保留。对应任务上的角色与职能也会按建议改写。不会自动派发。确定继续？",
  applyNote: "采用后会写入骑士名册（国王不变），并把角色、职能写到对应任务上。建议里点名的执行器才会一并写入。不会自动派发。",
  localDraftHint: "这是按现有任务生成的本地骑士草稿，不是 AI 分配。采用前可再改，也不会改动国王，更不会自动派发。",
  aiHint: "只是请它按任务建议骑士与职能，不会自动派发，也不会在采用前改名册或执行器，更不会改动国王。",
  offline: "本机没有可征询的执行器，或桥接未接通，无法向 AI 请求分配。",
  noExecutor: "请指定要征询的执行器，或改用本地草稿。",
  parseFail: "有回复，但没解析出结构化角色。",
  failed: "没有拿到分配建议。",
  noExecutorNamed: "未建议执行器",
  newSubtask: "将新增一条分工",
  attachTo: "派给任务",
  rosterOnly: "只写入名册，暂不挂到任务",
} as const;

/** Shown only when the roster role is already assigned to one or more tasks. */
export function deleteAiRoleConfirm(name: string, usedCount: number): string {
  const label = name.trim() || "未命名骑士";
  return `骑士「${label}」已被 ${usedCount} 条分工选用。删除后会断开与名册的关联，但分工上已填写的角色名与职能会保留。确定删除？`;
}

/** Operator-facing strings for the 圆桌会议 workspace (storage/MCP still use project_*). */
export const PROJECT_COPY = {
  emptyTitle: { zh: "尚无圆桌会议", en: "NO ROUNDTABLES" },
  emptyDescription:
    "建立圆桌会议后，在其下登记任务，并指定执行器与模型。内容保存在本机浏览器，刷新仍在；选择执行器不会自动派发。",
  listHint: "自目录选取圆桌会议，进入其任务档案。",
  sampleBadge: { zh: "示例", en: "EXAMPLE" },
  sampleCallout: "这是一场示例圆桌会议，用于展示亚瑟王与十二骑士围绕西方幻想 3D RPG 的分工。执行器需由你自行配置，不是已经在执行的会议。",
  noTasksTitle: { zh: "此圆桌会议尚无任务", en: "NO TASKS" },
  formHint: "先登记会议名称，再在其下编入任务。",
  nameLabel: "会议名称",
  nameRequired: "请填写会议名称。",
  notesPlaceholder: "可写这场圆桌会议要解决什么",
  sidebarEmpty: "尚无圆桌会议",
  sidebarListAria: "圆桌会议列表",
  demoLoadError(error: string): string {
    return `无法读取 mock/dashboard.json（${error}）。左侧「圆桌会议目录」仍可自建圆桌会议，不受影响。`;
  },
} as const;
