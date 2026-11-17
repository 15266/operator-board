# 本地知识库契约 `kb.entry/1.0`

本模块保存每次外部 AI 派发（WorkBuddy / Codex / 豆包 / 以后接入的任何执行器）的完成内容，并让后续派发通过 `kb_refs` 引用前序产物。它是**可替换模块**：契约（本文件 + `kb.schema.json` + `types.ts`）稳定；存储后端（`store.mjs`）、入库规则（`ingest.mjs`）、HTTP 门面（`routes.mjs`）都可以单独换。

## 1. 硬规则

1. **状态原样**：`state` 逐字复制 `DispatchRecord.state`，不发明新状态。`success` 只在 `state=verified` 时为 `true`；`replied_unverified`、`partial`、`failed`、`handoff_closed` 都不是成功。
2. **失败也入库**：终态（除 `queued` / `running` / `awaiting_user` 之外的任何状态）都入库；失败条目对后续任务也是有用上下文，但 `success=false`。
3. **幂等**：以 `dispatch_id` 唯一。`id = kb-<派发日期(Asia/Shanghai) yyyyMMdd>-<sha256(dispatch_id) 前 8 位>`，确定性生成；同一派发重复入库只更新内容，不产生新条目，`id` / `created_at` 不变。
4. **执行器不是枚举**：`executor` 是通道 / 扫描器 id 字符串。模块里没有任何厂商分支。
5. **不存密钥**：prompt / reply / error / evidence 入库前过滤 `Bearer …`、`sk-…`、`gh?_…`、`github_pat_…`、`xox?-…`、`AKIA…`、JWT、`token|password|secret|api_key=…`，以及桥接运行时已知的密钥值（精确替换）。evidence 里名字像密钥的键只保留布尔值，其余改成 `<redacted>`。只存环境变量**名**。
6. **列出 ≠ 核实**：条目存在只表示「这次派发结束了」。产物是否满足验收要看 `state` / `checks`，不由知识库推断。
7. **只读接口**：第一轮无删除路由；唯一写接口是 `POST /bridge/kb/reindex`（从已有派发记录重建，幂等）。

## 2. 产物（artifacts）

每项 `{path, root, size, sha256, mtime, attribution}`：

- `root=cwd`：相对派发工作目录（计划任务的 `cwd`，否则 `ai-dispatch-test/adhoc`）。
- `root=board`：相对操作台根目录（例如 Codex 的 `logs/codex/<id>/last-message.txt`）。
- `attribution=reported_by_adapter`：适配器在 evidence 里明确报出的文件（`last_message_file` / `prompt_file` / `output_file` / `result_file` / `salvaged_artifacts[]` / `artifacts[]`，通用键名）。
- `attribution=time_window`：派发期间（`created_at-2s` 到 `finished_at+5s`）在工作目录里新建或修改的文件。**共用工作目录时可能混入同时段其它派发的文件**；此时 `overlapping_dispatches` 列出重叠的派发 id，`artifacts_note` 非空，界面会提示人工核对。
- 跳过 `kb_refs/`（引用复制进来的输入）、`node_modules`、`.git`；单文件 ≤ 50 MB，最多 200 个。
- 内容寻址：sha256 在入库时计算；读取产物时（`GET …/artifacts/<n>`、`kb_refs` 复制）都会重算，不符则拒绝（409 / 不复制）。

## 3. 资源传递（`kb_refs`）

`POST /bridge/dispatch` 追加两个可选字段（旧请求不受影响）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `kb_refs` | `string[]`（≤20） | `kb-YYYYMMDD-xxxxxxxx` 或 `kb://…` |
| `kb_copy_artifacts` | `boolean`，默认 `true` | 是否把引用条目的产物复制进新派发工作目录 |

流程（全部在创建派发记录**之前**）：

1. 校验 id 格式；任一 id 格式无效或库里不存在 → **400**，错误信息列出 id，**不创建派发、不调用任何 AI**。
2. 复制产物到 `<cwd>/kb_refs/<kb_id>/<path>`：先校验源文件 sha256 与入库时一致，复制后再校验一次；失败的文件在 prompt 里标「未复制：原因」，不阻断派发。总复制上限 200 MB。
3. 在原 prompt 末尾追加分隔块（格式见下）；加完超过 128000 字符 → 413。
4. 新派发记录写 `kb_refs` 与 `evidence.kb_refs` / `evidence.kb_copies`；它结束入库时 `refs` 字段即这些 id，形成引用链。

前序产物块格式：

```
<原 prompt>

=== 前序产物（知识库引用，只读参考；共 N 条）===
说明：以下是此前其他执行器的任务结果。状态原样抄自派发记录；只有 verified 表示已核实，replied_unverified / partial / failed 都不代表成功。

[1] kb://kb-20261116-7b737c12 · <标题>
    执行器: <executor> · 模型: <model|未记录> · 状态: <state> · 派发: <dispatch_id>
    回复摘录: <回复前 600 字，空白折叠>
    产物 (k):
      - kb_refs/kb-20261116-7b737c12/ACCEPTANCE.md  sha256=<64hex>  9131B
      - cwd:src/x.js（未复制：source_changed_since_ingest）  sha256=…  …B
=== 前序产物结束 ===
```

## 4. HTTP 接口（同桥接其它路由一样的访问门槛）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/bridge/kb?q=&executor=&project_id=&task_id=&state=&limit=` | 列表（摘要，不含全文 prompt / reply），按派发时间倒序，`limit` ≤ 500，默认 50 |
| GET | `/bridge/kb/<id>` | 完整条目（`<id>` 也可写 `kb%3A%2F%2F…`） |
| GET | `/bridge/kb/<id>/artifacts/<n>` | 第 n 个产物：v2 先给库内副本（`X-KB-Source: blob`，读时重算 sha256）；没有副本才看原文件（`X-KB-Source: original`），sha256 不符 409，源文件不在 410 |
| POST | `/bridge/kb/reindex` `{dispatch_ids?: string[], force?: boolean, scan_docs?: boolean}` | 从 `/bridge/dispatches` 的记录重建（v2 同时写事件、副本），幂等；返回多一个 `events_written`，`scan_docs` 时多 `docs` |

v2 新路由见 §7–§12。

## 5. 存储后端

`store.mjs` 接口：`put / get / getByDispatch / list(filter) / count / close`，`backend` 与 `location` 只读属性。

- `sqlite`：内置 `node:sqlite`（Node ≥ 22.13 免 flag；实测 LAPTOP-7N998ISG 上 v24.22.1 与 v22.22.2 可用），单文件 `data/kb.sqlite`。条目整份 JSON 存一列，另有筛选列和小写检索列。
- `json`：`data/entries/<id>.json` + `data/index.json`，原子改名写入；无 sqlite 时自动退回。
- 选择：`KB_BACKEND=sqlite|json|auto`（默认 auto）。换后端用 `POST /bridge/kb/reindex` 从派发记录重建即可，不需要迁移脚本。

## 6. 参考的开源做法

| 来源 | 看了什么 | 吸收 | 没搬 |
|---|---|---|---|
| open-webui/open-webui `b0e6098e9409`（main，2026-11-08） | `backend/open_webui/models/files.py`：`File` 表有 `hash`、`path`、`meta`；`models/knowledge.py`：`Knowledge` 集合 + `KnowledgeFile` 关联表 | 文件记录 = 路径 + 哈希 + 元数据，集合与文件分开；我们用「条目 = 一次派发」，产物是条目下的文件记录 | 向量化 / RAG、上传接口、用户权限表 |
| modelcontextprotocol/modelcontextprotocol `0175d20f8b2c`，`docs/specification/2025-06-18/server/resources.mdx` | 资源以 RFC 3986 URI 标识，`resources/read` 按 URI 取内容，带 `mimeType` | 稳定 URI `kb://<id>`；产物按 `/bridge/kb/<id>/artifacts/<n>` 读取并带 Content-Type | 订阅 / list_changed 通知（以后若做 MCP 资源服务器可直接映射） |
| Git 对象模型（内容寻址，Pro Git「Git Internals – Git Objects」；本轮未取具体提交） | 对象以内容哈希命名，读取时可校验 | 产物登记 sha256，读取 / 复制时重算比对，不符拒绝 | 按哈希去重存储副本（第一轮不复制产物进库，只登记原位置） |

---

# 第二版：项目全部进度（`kb.event/1.0` 等），全部向后兼容

条目 `kb.entry/1.0` 字段不变，只加了可选字段；旧路由行为不变，只有一处按要求改变：产物路由先给副本（见 §4）。`prompt` 上限 8000 → 128000，`reply` 20000 → 200000（只影响新入库/重入库条目）。

## 7. 进度事件 `kb.event/1.0`

`{event_id, project_id, task_id?, parent_task_id?, dispatch_id?, kind, from_state?, to_state?, actor, at(+08:00), summary, payload, source}`。`id` 与 `event_id` 相同。

- **幂等**：`event_id` 确定性生成：`"ev-" + sha256(source|键…)[0:16]`。调用方也可自带 `event_id`（`^[A-Za-z0-9_.:-]{1,120}$`），重复写入算 duplicate，不改原记录。
- **kind** 开放字符串（`^[a-z][a-z0-9_.-]{0,47}$`），已用：`project_created task_created task_split task_updated task_removed assigned dispatched state_changed completed failed handoff_closed doc_version note`。
- **没有项目的记录**归入 `project_id = "_unassigned"`。
- **校验**：必须有 `project_id` 与 `kind`；`at` 必须可解析，否则 400；单批最多 500 条，`summary` ≤ 1000 字，`payload` JSON ≤ 16KB，否则 413；任何字段疑似密钥（`Bearer …`、`sk-…`、`gh*_…`、`github_pat_…`、`xox*-…`、`AKIA…`、JWT、`token=/password=/api_key=…` 形式）400「疑似包含密钥」，整批不写。派发推出的事件另外按已知令牌值（WB_TOKEN 等）清洗。
- **派发生命周期由 DispatchRecord 推出**（入库时和 GET 进度路由时的懒同步，每 10 秒最多一次）：`dispatched`（键 created）、每条 `rec.events` 一条 `note`（source `dispatch_log`）、终态一条 `completed`（verified）/ `failed` / `handoff_closed` / `state_changed`（其它状态，如 replied_unverified、partial、awaiting_user）。终态事件 id = `eventId("dispatch", id, "state", state)`，所以同一状态只记一次，状态再变会多一条。`to_state` 原样照抄，不改写。

## 8. 项目快照 `POST /bridge/kb/projects/snapshot`

请求 `{projects: Project[], actor?}`（看板 localStorage `operator-board-projects` 的整个数组）。每个项目必须有 `project_id`（`^[A-Za-z0-9_.:-]{1,200}$`），每个任务必须有 `task_id`；最多 200 个项目、每项目 2000 个任务、每项目 400KB；任一项目疑似密钥则整个快照 400 不写；整个请求受桥接 `readBody` 512KB 限制。
处理：项目整份规范化 JSON 的 sha256 与上一版相同 → `unchanged`；不同 → 存一版（副本进 blobs，`snapshot_versions` 记 `<pid>:v<n>`），并与上一版逐任务比较写事件：`project_created`、`task_created`、`assigned`（executor/model 变化）、`task_updated`（title/description/priority/model/parent_task_id/role_name/duty/phase/status 变化，payload 列出 changed 字段）、`task_split`（某父任务新增子任务，payload.children）、`task_removed`。事件 id 含版本号。
响应 `{projects:[{project_id, status:"created"|"new_version"|"unchanged", version, events?}]}`。

## 8.5 共享项目目录 `project_dir`、新状态（v2.1）

- `sent_awaiting_result`（akili 执行器 webhook 已发出、等 `POST /bridge/dispatch/<id>/result` 回写）是**非终态**：不入库条目，只记 `state_changed` 事件；树里归 running。回写后桥接照常调 `ingestSafe`。
- 派发记录的 `rec.project_dir` / `evidence.project_dir`（共享项目目录，代码写在这里）与 `rec.cwd`（每派发子目录，日志与报告）**都扫**：
  - cwd：同前，`reported_by_adapter` / `time_window`，root `cwd`。
  - project_dir：只收派发时间窗内（created_at−2s … finished_at+5s）改过的文件，root `project`，attribution `project_dir_time_window`；跳过 node_modules/.git/dist/kb_refs/.pnpm-store/releases/.vite/.cache 和 cwd 子目录；每次派发最多 200 个（超出在 `artifacts_note` 注明）；同样存副本。
  - 同一 project_dir 上时间窗重叠的其它派发记入 `overlapping_dispatches`（并单列 `overlapping_dispatches_project_dir`），说明这些文件可能是别人的。
  - project_dir 必须是绝对路径、不是盘符根、不是 `E:\ue_test\fdz_2`、不等于 cwd，否则忽略。
- 以 `rec.project_dir`（或 `evidence.project_dir`）为准；**请求体里的 `cwd` 是 project_dir 的别名，但记录里的 `cwd` / `evidence.dispatch_dir` 是派发子目录**。
- 条目新增 `project_dir`、`sandbox`、`sandbox_source`；`evidence.webhook_auth_mode`（auth|key|none，非密钥）照常保留在 evidence。
- 脱敏用的密钥值：`createKb({secrets})` 可给数组或函数（桥接传 `() => [WB_TOKEN, CODEBUDDY_GATEWAY_PASSWORD, ...akili.secretValues()]`，每次入库时取值），`ingestSafe(rec, dispatches, extraSecrets?)` 可再追加；只用长度 ≥ 4 的字符串。`kb_refs` 复制时 project 根的文件放 `kb_refs/<id>/_project/<path>`，避免与 cwd 同名文件互相覆盖。条目总产物上限 200 → 400。

## 9. 产物副本（内容寻址）

`data/blobs/<sha256[0:2]>/<sha256>`，同内容只存一份（dedupe）。写入：复制到临时文件 → 边复制边算哈希 → 与登记哈希比对 → 改名，不符就丢弃。每个产物记录加 `blob: true|false` 和 `blob_reason`：

| blob_reason | 含义 |
|---|---|
| `source_missing` | 入库时源文件已不在 |
| `too_large(>NB)` | 超过 `KB_BLOB_MAX`（字节，默认 52428800 = 50MB） |
| `changed_since_ingest(sha256_now=…)` | 源文件已不是登记时的内容，不复制 |
| `changed_during_copy` | 复制过程中被改 |
| `overwritten_since_dispatch(sha256_now=…)` | 重入库时发现早先登记的产物已离开时间窗且内容已变（`carried_from_previous_ingest: true`） |

读取副本时重算 sha256，不符当作没有副本。

**副本安全**（v2.3，Codex 审查后加）：复制前对文件全文查密钥模式和已知密钥值，命中则 `blob:false, blob_reason:"secret_pattern"`，产物路由对它返回 403，`kb_refs` 不复制；登记、复制、原文件回退都校验真实路径（符号链接 / junction 不能指出根目录）。`POST /bridge/kb/docs` 只接受白名单字段（客户端不能指定 `file` / `source`），路径同样做真实路径校验，文件全文查密钥。事件与快照除正则外还递归拒绝密钥样字段名（`token` / `password` / `api_key`…）下的非布尔值（值是环境变量名如 `WB_TOKEN` 时放行）及已知密钥值；快照内 `task_id`、批内 `project_id` 重复则 400。证据超过 5 层的子树替换为 `<truncated:depth>`。`kb_refs` 复制优先用副本，复制清单每项带 `from: "blob"|"source"`。

## 10. 文档版本（国王汇报 / 验收报告 / 任务包 / 卡美洛资料等）

- `POST /bridge/kb/docs` `{project_id, doc_type, title, path | content, actor?}`：`path` 与 `content` 二选一；`path` 只允许在看板上一级工作区内（`..` 越界 400），只读源文件。内容疑似密钥 400。
- 离线扫描：`kb/docs.config.json` 的 `roots` + `rules[{root, glob, doc_type, project_id?}]`（`**`/`*`/`?`），跳过 node_modules/.git/dist/data/kb_refs/releases。项目归属：规则写死 → `ai-dispatch-test/<已知项目>/` → 与某条目产物同路径 → `_unassigned`。
- 派发规则 `dispatch_rules[{task_id_suffix|task_id_prefix, field: "prompt"|"reply", doc_type, title}]`：例如 `::king-report` 的 prompt = 国王汇报，reply = 国王回复。同一任务的多次汇报是同一文档的不同版本（按派发时间顺序编号）。
- **只有 sha256 变化才存新版本**；每版写一条 `doc_version` 事件。
- `doc_id = "doc-" + sha256(project|doc_type|key)[0:12]`，key = 相对路径（扫描）、标题（POST content）或 `dispatch_rule:<task_id>:<field>`。
- `GET /bridge/kb/docs?project_id=&doc_type=&limit=&cursor=` → `{total, count, docs}`；`GET /bridge/kb/docs/<doc_id>/versions` → `{doc, versions(新→旧)}`；`GET /bridge/kb/docs/<doc_id>/versions/<n>/content` → 该版原文（副本坏了 410）。

## 11. 时间线与项目列表

- `GET /bridge/kb/timeline?project_id=&task_id=&since=&until=&kind=&limit=&cursor=&order=asc|desc` → `{total, count, items, next_cursor}`。`items` 合并事件与条目（`kind:"kb_entry"`），统一形状 `{at, kind, project_id, task_id, dispatch_id, event_id?, kb_id, doc_id, title, summary, state, actor, source, links}`。默认新→旧，`limit` ≤ 500（默认 100）。
- `GET /bridge/kb/projects` → `{projects:[{project_id, name, rollup, snapshot_version, counts:{tasks, dispatches, entries, events, docs}, last_activity, links:{tree, timeline}}]}`，按最近活动排序。

## 12. 树（懒加载，无限层级）

节点 `{id, parent_id, kind, title, project_id, task_id, state, rollup:{state, counts}, summary, has_children, child_count, refs, at, links:{self, children, content?}}`。
id：`p:<pid>`、`ph:<pid>:<phase>`、`t:<pid>:<task_id>`（有父任务时 kind = subtask，任意层级）、`d:<dispatch_id>`、`a:<kb_id>:<n>`、`docs:<pid>`（kind doc_group）、`doc:<doc_id>`、`dv:<doc_id>:<n>`。
任务来源：最新快照；快照里没有、但派发记录里有的任务从派发补出（`source:"dispatch"`）。

**环与深度保护**：父链成环（含自指）的任务挂到项目根下并标 `tree_issue:"cycle"`；父链超过 `MAX_TREE_DEPTH = 64` 层的挂到根下并标 `tree_issue:"too_deep"`；两者都带 `declared_parent_task_id`。汇总递归有 visiting 标记，面包屑最多 64 层，所以任何快照都不会让 `/tree`、`/node` 卡死。每层子节点分页（`limit` ≤ 500 + `next_cursor`）。

- `GET /bridge/kb/tree`（无参数）→ 项目列表作为根的子节点。
- `GET /bridge/kb/tree?project_id=|node=&depth=1..3&limit=&cursor=` → `{node, children, total, next_cursor}`，`depth>1` 时子节点带 `children`。
- `GET /bridge/kb/node/<id>` → `{node, breadcrumbs, detail, children(前 50)}`；detail 视类型带 entry / dispatch / doc+versions / task+events。

**状态汇总**（只数叶子：派发、无派发的任务；有子任务的任务自身最新派发也算一个叶子，所以父任务失败不会被已核实的子任务掩盖）：叶子归类 verified → verified；failed → failed；queued/running/awaiting_user → running；其它（replied_unverified、partial、handoff_closed…）→ needs_check。父节点：任一 failed → failed；否则有 running → running；否则有 needs_check → needs_check；全部 verified → verified；部分 verified、其余未开始 → in_progress；全未开始 → not_started；没有叶子 → empty。任务自身 `state` = 最新一次派发的状态原文。界面显示 `counts.verified/counts.total 已核实`。

## 13. 回填（离线）

`node bridge/kb/reindex-offline.mjs <board> [--projects-json=<file>] [--data-dir=] [--evidence-dir=] [--rebuild-dispatch-docs] [--no-dryrun]`：按派发时间顺序重入库全部派发（事件 + 副本），可选导入导出的项目数组，扫描文档，写 `logs/kb-reindex-v2.json`。sqlite 为 WAL + busy_timeout 5s，可在桥接运行时执行；json 后端必须先停桥接（否则拒绝，`--allow-json` 覆盖）。

## 14. 参考（第二版新增）

| 来源 | 吸收 |
|---|---|
| Git 对象存储（`objects/<2位>/<38位>` 内容寻址） | blobs 目录布局、同内容去重、读时校验 |
| VS Code `TreeDataProvider.getChildren(element)` | 树按节点懒取子节点，`has_children` 决定是否可展开 |
| MmCodexMgr（`/workspace/refs/MmCodexMgr`，提交 `6467883`）`Source/Relay/RelayTreeStore.cs` 第 18–31 行 `TreePage(parentId, offset)`；`Source/Relay/RelayPolicy.cs` 第 10–41 行 | 按父节点分页取一层并带子节点数（→ `child_count`、`next_cursor`）；祖先 HashSet 查环、`MaxDepth` 上限（→ `tree_issue` cycle / too_deep）。写路径互斥属于派发期调度，归外部通道官，kb 只用 `overlapping_dispatches` 事后标注 |
| react-arborist 懒加载 / 受控数据 | 前端只拿一层（`depth=1`），展开时再取；`next_cursor` 分页 |
| open-webui `files.py`（第一版已引） | 文件记录 = 哈希 + 路径 + 元数据，与集合分离 |
