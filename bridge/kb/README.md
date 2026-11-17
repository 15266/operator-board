# kb/ — 操作台本地知识库（可替换模块）

把每次外部 AI 派发的结果存下来（回复、执行器 / 模型、原样状态、产物清单 + sha256、脱敏证据），并让新派发用 `kb_refs` 引用前序条目：把「前序产物」块附到 prompt 末尾，再把产物复制到新工作目录的 `kb_refs/<id>/`。契约见 [`contract.md`](contract.md)。

| 文件 | 角色 |
|---|---|
| `contract.md`、`kb.schema.json`、`types.ts` | 契约（三份同步） |
| `store.mjs` | 存储后端：`node:sqlite` 或 JSON 文件 |
| `ingest.mjs` | 纯函数：派发记录 → 条目、产物哈希、脱敏、`kb_refs` 块 |
| `routes.mjs` | 桥接门面 `createKb()`：`ingestSafe` / `resolveRefs` / `prepareDispatch` / `handle` |
| `apply-kb-patch.mjs` | 给 `bridge/server.mjs` 打 6 处加法钩子（锚点校验、哈希前置条件、改前再比对） |
| `reindex-offline.mjs` | 不经桥接，从 `logs/dispatches.json` 按时间顺序重入库（事件 + 副本）、可选 `--projects-json` 导入项目、扫描文档，并做一次 `kb_refs` 演练（写 `logs/kb-reindex-v2.json`、`logs/kb-refs-dryrun-v2.json`） |
| `ui/` | 操作台最小入口：`KnowledgeBase.tsx`、`bridge.kb.ts`、`apply-ui-patch.mjs` |
| `blobs.mjs` | 内容寻址副本 `data/blobs/<sha[0:2]>/<sha256>`，去重，读时校验，`KB_BLOB_MAX`（默认 50MB） |
| `events.mjs` | 进度事件 `kb.event/1.0`：校验、确定性 id、由派发记录推出生命周期事件 |
| `snapshot.mjs` | 项目快照校验与逐任务比对（创建 / 拆分 / 指派 / 更新 / 删除事件） |
| `docs.mjs`、`docs.config.json` | 文档版本（国王汇报 / 验收报告 / 任务包…），sha256 变才存新版；离线扫描规则 |
| `tree.mjs` | 项目树（项目 → 阶段 → 任务 → 子任务… → 派发 → 产物 / 文档）与状态汇总 |
| `FRONTEND-INTEGRATION.md` | 给可视化官：何时调 `/events`、`/projects/snapshot`，时间线 / 树怎么取 |
| `test_kb.mjs` | `node --test kb/test_kb.mjs`（16 项：两种后端、入库、幂等、脱敏、kb_refs 400、HTTP 路由、副本、事件、快照、文档、时间线 / 树、project_dir 与 sent_awaiting_result、树的环 / 深度保护与密钥函数、文档重入库不重复加版本、代码审查修复） |

## 接到一块操作台上

```powershell
# 1) 复制模块（不含 data/）到 <board>\bridge\kb\
# 2) 备份后打桥接钩子（哈希不符、锚点不唯一、已打过都会拒绝写）
copy bridge\server.mjs bridge\server.mjs.bak-kb-<yyyyMMdd-HHmmss>
node bridge\kb\apply-kb-patch.mjs bridge\server.mjs --expect-sha256=<当前 sha256> --dry-run
node bridge\kb\apply-kb-patch.mjs bridge\server.mjs --expect-sha256=<当前 sha256>
node --check bridge\server.mjs
node --test bridge\kb\test_kb.mjs
# 3) 界面（先备份 src\lib\bridge.ts、src\lib\types.ts、src\components\ProjectsBoard.tsx）
node bridge\kb\ui\apply-ui-patch.mjs <board>
npx tsc -b
# 4) 已有记录入库（离线，可重复执行；sqlite 可在桥接运行时执行）
node bridge\kb\reindex-offline.mjs <board>
# 5) 只用 bridge\start-bridge.ps1 重启桥接
```

钩子只有：一行 import；`createKb(...)` 与同规则的 `dispatchCwd()`；`execute()` 结尾一行 `kb.ingestSafe(rec, state.dispatches)`；`POST /bridge/dispatch` 里先 `kb.resolveRefs`（未知 id 400、不派发），再 `kb.prepareDispatch` 注入；一行 `/bridge/kb*` 路由委托。不改任何适配器（Codex 的 `-C` / `-m` / `windows.sandbox="unelevated"` / `doneFile` 不动）。

## 测试示例（令牌已省略；本桥接现有路由没有 Bearer 校验，kb 路由同样只靠回环绑定 + Origin 白名单）

```powershell
curl.exe -s "http://127.0.0.1:5180/bridge/kb?limit=5"
curl.exe -s "http://127.0.0.1:5180/bridge/kb?executor=codex&state=verified"
curl.exe -s "http://127.0.0.1:5180/bridge/kb/kb-20261116-7b737c12"
curl.exe -s "http://127.0.0.1:5180/bridge/kb/kb-20261116-7b737c12/artifacts/0"
curl.exe -s -X POST -H "Content-Type: application/json" -d "{}" http://127.0.0.1:5180/bridge/kb/reindex
# 未知引用必须 400 且不产生派发记录：
curl.exe -s -X POST -H "Content-Type: application/json" -d "{\"executor\":\"codex\",\"prompt\":\"x\",\"kb_refs\":[\"kb-20990101-deadbeef\"]}" http://127.0.0.1:5180/bridge/dispatch
```

`data/` 是本机数据（含 prompt / 回复原文），已 gitignore，打包脚本也排除。
