# 本机 AI 接口发现契约

操作台在新机器上应自动找到本机 AI 接口。用户只在「已发现接口但缺少凭据」时填写密钥，不必手填端口、安装路径或进程号。

**Citation ≠ connected。** 下列成熟项目的做法是本契约的来源，不表示它们已在本机连接。

## 学习来源（行号对应 2026-11-11 抓取的 `main` SHA）

- [Open WebUI](https://github.com/open-webui/open-webui) `b0e6098`：[Connections](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/components/admin/Settings/Connections.svelte) 把 Ollama / OpenAI 兼容地址当作可配置连接。`_resolve_ollama_base_url` 对默认 `11434` / 回退 `12434` 做 TCP 探测（[`config.py` L257–L285](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/config.py#L257-L285)），探测失败仍只保留默认 URL，不标成已连接。Verify 走协议探测：Ollama `GET /api/version`（[`ollama.py` L238–L250](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/ollama.py#L238-L250)），OpenAI 兼容 `GET /models`（[`openai.py` L1036–L1040](https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/backend/open_webui/routers/openai.py#L1036-L1040)）。**不要抄**：把明文密钥写入配置再回传给管理界面。
- [Continue](https://github.com/continuedev/continue) `5522c6f`：本地 provider 只有约定默认地址（Ollama `localhost:11434`，[`Ollama.ts` L154](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts#L154)；LM Studio `localhost:1234/v1`，[`LMStudio.ts` L8](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/LMStudio.ts#L8)），不是本机扫描。密钥位置编码为 `process_env:<NAME>` / `local_env:<NAME>`（[`SecretResult.ts` L66–L84](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/config-yaml/src/interfaces/SecretResult.ts#L66-L84)），运行时再解析；`LLMConfigurationStatuses` 把缺密钥与配置有效分开（[`constants.ts` L17–L21](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/constants.ts#L17-L21)）。Windows 打包环境下把 `localhost` 改成 `127.0.0.1`（[`Ollama.ts` L408–L414](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/Ollama.ts#L408-L414)）。**不要抄**：把 `apiKey` 原文序列化给前端（[`load.ts` L599–L621](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/config/load.ts#L599-L621)）。
- [LibreChat](https://github.com/danny-avila/LibreChat) `e6567c7`：端点在 `librechat.yaml`，凭据优先写成 `${ENV_VAR}`（[`librechat.example.yaml` L78](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/librechat.example.yaml#L78)）；缺少密钥用哨兵 `user_provided`（[`.env.example` L672](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/.env.example#L672)），引用本身不当密钥加密（[`secrets.ts` L100–L102](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/admin/secrets.ts#L100-L102)）。模型探测：Ollama 先 `GET /api/tags`，失败再 `GET /models`（[`models.ts` L226–L245](https://github.com/danny-avila/LibreChat/blob/e6567c7a681ce67869dce31486a21d3a25d6931b/packages/api/src/endpoints/models.ts#L226-L245)）；软失败，不把列表成功当成可对话。
- 既有 doctor-first（本仓库此前写入的 adapters 契约）：`wjingshan/dsh-doubao-bridge` 的 `doctor`（端口在听 ≠ `chat_bridge=ok`）；`Ianzhyh/workbuddy-to-dsh` 区分 port `running` 与 token-healthy `ok`。

详细摘录见本机学习笔记（未进操作台仓库、未推送）。

## 分层（必须分开，禁止升级）

| 层 | 含义 | 不是什么 |
| --- | --- | --- |
| `found` | 本机进程、PATH 或常见安装目录里识别到该软件 | 不是可对话 |
| `listening` | 本机环回地址上有对应端口在听 | 不是已认证、不是 chat_ok |
| `authenticated` | 凭据已从进程环境或用户填写的 `auth_ref` 就位，且（如有）健康检查 HTTP 200 | 不是已核实可对话 |
| `chat_ok` | 仅在真实派发并收到回复且按验收核验后置位 | **发现接口不得置 `chat_ok=true`** |

进程在跑、默认端口在听、`cli_ok`、`tools/list` 名称，都不能写成「已连接可对话」。

## 扫描范围（只读）

扫描来源，按优先级：

1. **正在运行的进程**（名称、可执行路径、经过打码的命令行摘要、该进程在环回上监听的端口）
2. **PATH**（`Get-Command` / `where`）
3. **常见安装目录**（`%LOCALAPPDATA%\Programs`、`%APPDATA%\npm`、`%ProgramFiles%`、用户目录下的 `agent-tools` 等）。`D:\workbuddy` 只是候选之一，不是写死默认。
4. **本机环回端口**：先对进程已绑定的端口和少量提示端口做 HTTP 指纹，再对其余环回监听做短超时 GET。提示端口（如 Ollama 11434、CDP 9225）**未在听不代表未安装**；在听也不代表已连接。

禁止：启动、停止或杀死 WorkBuddy / Codex / 豆包 / UE / FlClash。桥接本身只允许用 `start-bridge.ps1` 重启（且只杀本桥 `bridge\server.mjs`）。

识别对象：WorkBuddy、Codex、豆包，以及可识别的 OpenAI 兼容本地服务（如 Ollama、LM Studio，以及应答 `GET /v1/models` 的环回服务）。出站代理（如 FlClash）可被记录为 `kind=proxy`，不是 AI 接口；只有识别到常见 HTTP 代理端口才填写 `port`，不得使用 135、445 等系统端口。

## HTTP 指纹（GET，短超时，仅 127.0.0.1）

- WorkBuddy serve：`GET /api/v1/health`（已有 `WB_TOKEN` 时才带 `Authorization`，响应不得写入日志原文）
- 豆包 / CDP：`GET /json/version`（有 `webSocketDebuggerUrl` 或 `Browser`）
- Ollama：`GET /api/version`
- OpenAI 兼容：`GET /v1/models`（`data[].id`，或 401/403 表示接口在听但缺凭据）

指纹成功只说明接口在听。目录里的模型名是声称，不是已核实清单。

## 凭据

- 已登录的桌面应用，若能从本机进程环境**安全读取**凭据（现有：WorkBuddy GUI serve 的 `CODEBUDDY_GATEWAY_PASSWORD` → 环境变量 `WB_TOKEN`），则不再询问用户。
- **仅当**已发现接口且缺少凭据时，才请用户填写密钥。
- 密钥只存在桥接进程的环境变量里；对外只暴露 `auth_ref`（环境变量名）和 `auth_status`：
  - `none_required` — 无需密钥（如开放的 Ollama）
  - `missing` — 需要用户填写
  - `from_process_env` — 已从本机进程环境读入
  - `from_env` — 启动前已在桥接环境中
  - `user_provided_ref` — 用户本会话填写
  - `desktop_login_unverified` — 桌面登录态存在与否未核验（Codex）；不向用户要 API Key，也不宣称已登录
- **禁止**把密钥、`sessionToken` 或其它秘密写入 `logs/dispatches.json`、桥接日志、发现 JSON、Git、或前端 localStorage。
- `POST /bridge/credentials` 只接受允许名单内的 `auth_ref`，成功响应不含密钥。

## HTTP 接口

所有接口仅绑定 `127.0.0.1`。响应必须经过 `stripSecrets`。

### `GET /bridge/discover`

返回最近一次扫描（若尚无缓存则先扫一次）。

```json
{
  "scanned_at": "2026-11-11T01:00:00.000Z",
  "machine": { "hostname": "SX007747", "platform": "win32" },
  "interfaces": [
    {
      "id": "workbuddy-serve",
      "kind": "workbuddy",
      "transport": "acp",
      "display_name": "WorkBuddy",
      "found": true,
      "source": ["process", "loopback_port"],
      "exe_path": "C:\\\\...\\\\WorkBuddy.exe",
      "cli_path": "C:\\\\...\\\\codebuddy",
      "endpoint": "http://127.0.0.1:<discovered>",
      "port": 0,
      "pid": 0,
      "listening": true,
      "health_http": 200,
      "auth_status": "from_process_env",
      "auth_ref": "WB_TOKEN",
      "auth_needed": false,
      "layers": { "found": true, "listening": true, "authenticated": true, "chat_ok": false },
      "notes": ["派发走官方 ACP；jobs 仍 EADDRINUSE"],
      "jobs_ok": false
    }
  ],
  "needs_credential": [
    { "interface_id": "openai-compatible-1234", "auth_ref": "OPENAI_API_KEY", "prompt": "已发现接口，但缺少凭据。" }
  ],
  "unidentified_loopback": [],
  "notes": []
}
```

（示例中的路径和端口是形状说明，不是本机事实。）

### `POST /bridge/discover/refresh`

强制再扫描。不重启任何 AI 或代理进程。

### `GET /bridge/health`

使用发现结果，而不是写死的 `D:\\workbuddy`、默认 npm Codex 路径或豆包 `9225`。

- WorkBuddy：发现的 serve 端口 + `token` 是否就位 + `acp_ok`；`jobs_ok` 必须保持 `false` 并保留 EADDRINUSE 说明，直到该问题被单独修复并验收。
- Codex：发现的 CLI 路径是否存在；出站代理只采用已识别的 HTTP 代理端口（常见 Clash/FlClash 端口列表）。禁止把 135（epmap）等系统端口当成代理；进程在跑但没有这类端口时，`proxy_up` 必须为 false。
- 豆包：发现到的 CDP 与 `dsh-doubao-bridge` 路径。
- 可附带 `discover.scanned_at` 与 `needs_credential`。

### `POST /bridge/credentials`

```json
{ "interface_id": "ollama-11434", "auth_ref": "OLLAMA_API_KEY", "secret": "…" }
```

把 `secret` 写入 `process.env[auth_ref]`，不写盘。响应：`{ "ok": true, "auth_ref": "OLLAMA_API_KEY", "auth_status": "user_provided_ref" }`。

### 派发

`/bridge/dispatch` 使用发现到的可执行文件、端口和 CDP。WorkBuddy 仍走官方 ACP，`session/new` 必须带 `workingDirectory`。不要把 jobs 通道当成已修复。

## 环境变量覆盖（可选，仍不是写死默认）

若用户或 `start-bridge.ps1` 已设置 `WB_PORT` / `WB_TOKEN` / `CODEX_JS` / `DOUBAO_CDP` / `DOUBAO_SERVER` / `CODEX_PROXY_PORT`，且路径或端口确实存在，则作为覆盖提示，优先于目录猜测。未设置时必须扫描，不得回退到某一台机器上的硬编码路径。

## 不要抄的做法

- 把某一台机器的安装路径写进源码当唯一默认（例如 `D:\\workbuddy`、固定 npm 路径、固定 `9225`）。
- 把系统端口（如 135）或代理进程的任意第一个监听端口当成 HTTP 代理。
- 把默认端口在听当成已连接。
- 把密钥写入 state、日志、Git 或前端存储。
- 在发现流程里重启或杀死 WorkBuddy / Codex / 豆包 / UE / FlClash。
- `shell:true` 拼接用户输入、未沙箱的任意 `cwd`、默认跳过权限（见 `LinHaiJ/workbuddy-mcp` 审计，不要学）。
