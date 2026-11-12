# 接入操作台（Operator Board）

目标机器：`SX007747`，代码目录
`C:\Users\chenjiarui1\Desktop\AKILI-桌面项目\operator-board`。
契约与参考实现在本包 `scanners/`。不要推 GitHub。不要重启 WorkBuddy / Codex / 豆包 / UE / FlClash。

## 1. 把模块放进桥接

将本目录复制（或同步）为：

```
operator-board/bridge/scanners/
  contract.md  types.ts  registry.json  loader.mjs
  _template/  workbuddy/  codex/  doubao/  ollama/
```

`loader.mjs` 是给 `server.mjs` 用的 Node 入口；Python loader 供本包 CLI / 测试，不必在板子上跑。

## 2. `server.mjs` 只加通用接线（不要加厂商分支）

在文件顶部：

```js
import { listScanners, handleScanHttp } from "./scanners/loader.mjs";
```

在 HTTP 路由里，**先**把未知路径交给扫描模块，再走原有逻辑：

```js
if (handleScanHttp(url, req.method, send) !== null) return;
if (req.method === "POST" && url.pathname === "/bridge/scan") {
  // 在本机用已有的 portOpen / 进程查询实现一个 HostContext，
  // 调用与 loader.py scan_local 相同的规则；响应前走 assertNoSecrets。
  // 不要把 WB_TOKEN 或其他值写入 JSON 或日志。
}
```

第一轮只加：

- `GET /bridge/scanners` → `listScanners()`
- `POST /bridge/scan` → 发现记录（`live` 默认 false）
- 可选 `POST /bridge/scan/probe`、`POST /bridge/scan/promote`（promote 必须是用户确认之后，只产出带 `auth_ref` **名** 和 endpoint 的实例草稿）

**不要改**现有 `adapterWorkBuddy*` / `adapterCodex` / `adapterDoubao` 派发分支，也不要改现有 `/bridge/health` 的字段，以免打断当前派发。后续若要把 `/bridge/health` 改成由扫描记录组装，用 manifest 上的 `compat_health_key`，仍然不要在 `server.mjs` 里写 `if (id === "workbuddy")`。

派发函数抽成执行器插件是**另一次**改动，不和扫描模块绑在同一补丁。

## 3. 实机扫描时的安全约束

- 只探测 manifest 里声明的回环端口，connect-and-close，不要 listen / bind。
- 不要为了探活而启动、重启、结束 WorkBuddy、Codex、豆包、UE、FlClash。
- WorkBuddy 的端口只从已运行进程 / `WB_PORT`（`ports[].from_env`，值为已观察到的端口号）观察，不要把某个默认端口写成 manifest 或当成可占用端口。promote 草稿靠 `base_url_template=http://127.0.0.1:${port}` 填 URL。
- 会话凭据只进桥接进程环境（现有 `start-bridge.ps1` 已经是这个模式），发现记录只允许 `session_present: true|false` 和 `auth_ref` 名。
- 探活 HTTP 在 `auth_ref` 已存在于桥接环境时可带 Bearer，但绝不能把值写进记录或日志。
- `POST /bridge/scan` 必须拒绝 `live=true`。`POST /bridge/scan/promote` 只返回草稿，不登记通道、不派发。
- jobs 仍坏：健康或 ACP 探活成功也不能写成 jobs 已核实（`jobs_ok` 保持 false）。

## 4. UI（可视化官）

通道页增加「本机发现」列表，数据来自 `/bridge/scanners` + `/bridge/scan`。用户确认后才 promote。未填密钥且 `auth.mode=user_secret` 的条目显示「待填密钥」。`session_available` 显示「已有会话，待实机核实后再派发」。不要把发现成功写成「已连通 / 已派出」。

原有 `GET /bridge/discover` 可与本轮路由并存。若 UI 从 `interfaces/layers` 改吃 `/bridge/scanners` + `/bridge/scan`，需要和可视化官再对一次字段。Codex 条目在 `found` 且 `needs_user_secret=false` 时不要显示成「待填密钥」；桌面登录 ≠ `session_available`。

## 5. 验收

- `python3 -m scanners validate` 与 `python3 -m scanners.test_loader` 通过。
- 复制 `_template` 登记后，`list` 能看到新 id，且不必改 `server.mjs`。
- 示例与 `results.json` 不含密钥。
- 现有派发与 `/bridge/health` 行为保持。

## 6. 契约同步要点（与板子落地对齐）

- `ports[].from_env`：环境变量名，值为已观察到的端口，不是写死默认。
- `ports[].from_process`：从已匹配进程观察回环监听端口（豆包 CDP 换端口时不要只靠 9225）。
- `name_regex` 一律忽略大小写，模式里不要写 `(?i)`；加载器会剥掉旧清单里的该标记。
- 扫描层 `transport` 枚举含 `acp`。WorkBuddy 插件用 `acp` + `base_url_template`。
- Codex：`session.infer_session=false`；缺 `CODEX_API_KEY` 不是未安装，也不升成 `session_available`。

