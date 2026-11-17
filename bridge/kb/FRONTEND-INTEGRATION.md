# 前端接入说明（给可视化官）— 知识库第二版：项目全部进度

类型都在 `bridge/kb/types.ts`（可复制到 `src/lib/kbTypes.ts`）；契约细节见 `contract.md` §7–§12。所有路由与 `/bridge/kb` 同一门槛：**没有 Bearer**，只靠 127.0.0.1 绑定 + Origin 白名单；`src/lib/bridge.ts` 现在只发 `Content-Type`，照旧即可。模块化官不改 `src/`，下面是建议接法。

## 1. 什么时候写（看板 → 桥接）

| 时机 | 调用 | 说明 |
|---|---|---|
| 项目数组变化后（新建项目 / 加任务 / 拆子任务 / 改指派 / 改状态 / 删任务），**防抖 2–5 秒**，以及看板启动时一次 | `POST /bridge/kb/projects/snapshot` `{projects, actor:"board"}`，`projects` = localStorage `operator-board-projects` 的整个数组 | 后端算哈希，未变返回 `unchanged`，所以多发无害；变了就存一版并自动推出 `project_created / task_created / task_split / assigned / task_updated / task_removed` 事件。**这是首选**，看板不用自己判断事件种类 |
| 快照表达不了的用户动作（例如「交给国王」「手动备注」「接受验收」） | `POST /bridge/kb/events` `{kind, project_id, task_id?, summary, actor:"board", payload?, event_id?}` 或 `{events:[…]}` | 想幂等就自带 `event_id`（如 `board:<task_id>:accept:<时间>`）；`project_id` 不知道就写 `_unassigned` |
| 生成 / 收到国王汇报、验收报告等文本 | `POST /bridge/kb/docs` `{project_id, doc_type, title, content}` | 内容不变不会多一版 |

**不要**为派发写事件：派发、完成、失败、交接关闭由桥接从派发记录自动推出（GET 进度路由时最多每 10 秒同步一次）。请求体上限 512KB（桥接 `readBody`）；含疑似密钥返回 400，整批不写——界面上显示错误文本即可。

## 2. 什么时候读（展示）

| 视图 | 调用 | 用到的字段 |
|---|---|---|
| 项目列表 / 总览卡片 | `GET /bridge/kb/projects` | `name`、`rollup.state`、`rollup.counts`（显示 `counts.verified/counts.total 已核实`）、`counts.*`、`last_activity` |
| 树（懒加载） | 根：`GET /bridge/kb/tree?project_id=<pid>`（或不带参数拿全部项目）；展开某节点：`GET /bridge/kb/tree?node=<id>&depth=1`；更多：`&cursor=<next_cursor>` | `KbTreePage.children[]`：`id`、`kind`、`title`、`state`（原文）、`rollup`、`has_children`（决定是否显示展开箭头）、`child_count` |
| 点节点看详情 | `GET /bridge/kb/node/<encodeURIComponent(id)>` | `breadcrumbs`（面包屑，点击回上级）、`detail.entry`（回复、产物）、`detail.dispatch`、`detail.doc` + `detail.versions`、`detail.task` + `detail.events`、`children` |
| 时间线 | `GET /bridge/kb/timeline?project_id=<pid>&limit=100`，可加 `task_id / kind / since / until / order=asc / cursor` | `KbTimelineItem`：`at`、`kind`、`title/summary`、`state`、`actor`、`links.node`（跳到树节点） |
| 产物 / 文档原文 | 产物：`GET /bridge/kb/<kb_id>/artifacts/<n>`（节点 `links.content`）；文档：`GET /bridge/kb/docs/<doc_id>/versions/<n>/content` | 响应头 `X-KB-Source: blob|original`、`X-KB-SHA256`；409 = 原文件已改且无副本，410 = 不在了 |

## 3. 状态显示规则（不要自己升级状态）

- 叶子 `state` 是派发记录原文：只有 `verified` 算成功；`replied_unverified`、`partial`、`handoff_closed` 显示为「待核对」（rollup `needs_check`）；`queued / running / awaiting_user / sent_awaiting_result` 为「进行中」。
- 父节点用 `rollup.state`：`failed` > `running` > `needs_check` > `verified`（全部核实）；另有 `in_progress`（部分核实、其余未开始）、`not_started`、`empty`。
- 节点 `kind`：`project / phase / task / subtask / dispatch / artifact / doc_group / doc / doc_version`，未知 kind 当普通节点显示（以后会加）。子任务层数不限。
- 产物节点 `refs.kb_id + refs.artifact_index`；`blob:false` 时显示 `blob_reason`（例如「入库后已被覆盖」），不要显示成可下载。

## 4. 空状态 / 错误

- 桥接未重启到新版时，这些路由返回 404（旧版 kb 会回 `{"error":"知识库条目不存在"}` 或 `"知识库接口不存在…"`），请显示「桥接尚未提供进度接口」。
- 所有错误形状 `{error: string, ...}`；400 输入错误、404 不存在、409/410 见上、413 过大、500 内部错误。
- 项目里还没有快照时，树中的任务从派发记录补出（`source:"dispatch"`），标题可能是 task_id。

## 5. 一次性导入现有项目（卡美洛等）

项目只在浏览器 localStorage 里。看板接好快照调用后会自动导入；之前可在看板页面的开发者控制台执行一次：

```js
fetch('http://127.0.0.1:5180/bridge/kb/projects/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projects:JSON.parse(localStorage.getItem('operator-board-projects')||'[]'),actor:'console'})}).then(r=>r.json()).then(console.log)
```
