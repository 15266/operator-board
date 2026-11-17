# AI 软件接入方式与验证

整理日期：2026-11-13。共 43 条。

HTTP/CLI 表示已接入只读或版本检查；existing 使用原有适配器；guide 只有说明，不能声称已验证。所有项目仍需分别验证真实对话和任务执行。

## Codex CLI
- 项目实现：cli
- 验证边界：仅验证本机 CLI 可启动并返回版本；不验证登录或执行任务
- 用户操作：安装并登录 Codex CLI；版本检查后，主动派发小任务才能验证实际执行。
- 官方来源：https://github.com/openai/codex


## Claude Code
- 项目实现：cli
- 验证边界：仅验证本机 CLI 可启动并返回版本；不验证登录或执行任务
- 用户操作：安装 Claude Code 并完成官方登录或 API 配置；可通过非交互 CLI / Agent SDK 接入。
- 官方来源：https://docs.anthropic.com/en/docs/claude-code/cli-usage


## Cursor CLI
- 项目实现：cli
- 验证边界：仅验证本机 CLI 可启动并返回版本；不验证登录或执行任务
- 用户操作：安装官方 Cursor CLI 并登录；仅安装 Cursor 编辑器不代表安装了 CLI。当前探测命令为 agent，请核对所装版本。
- 官方来源：https://cursor.com/docs/cli/overview


## Gemini CLI
- 项目实现：cli
- 验证边界：仅验证本机 CLI 可启动并返回版本；不验证登录或执行任务
- 用户操作：安装 Gemini CLI；按官方说明完成登录或 API Key 配置，再使用 headless 模式。
- 官方来源：https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md


## Qwen Code
- 项目实现：cli
- 验证边界：仅验证本机 CLI 可启动并返回版本；不验证登录或执行任务
- 用户操作：安装 Qwen Code 并配置官方支持的认证；可用 headless CLI。
- 官方来源：https://github.com/QwenLM/qwen-code


## Kimi Code CLI
- 项目实现：cli
- 验证边界：仅验证本机 CLI 可启动并返回版本；不验证登录或执行任务
- 用户操作：安装 Kimi CLI 并登录；官方 CLI 提供 ACP，需后续接入协议会话验证。
- 官方来源：https://github.com/MoonshotAI/kimi-cli


## GitHub Copilot CLI
- 项目实现：cli
- 验证边界：仅验证本机 CLI 可启动并返回版本；不验证登录或执行任务
- 用户操作：安装 Copilot CLI，登录 GitHub 并确认账号可用；程序化调用与 IDE 插件是不同入口。
- 官方来源：https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically


## Ollama
- 项目实现：http
- 验证边界：只读服务/模型目录验证，不会生成内容或下载模型
- 用户操作：启动 Ollama 服务；目录为空时按需下载模型。服务端口改变时填写本地地址。
- 官方来源：https://github.com/ollama/ollama/blob/main/docs/api.md
- 示例地址：http://127.0.0.1:11434；端口不代表已经发现服务。

## LM Studio
- 项目实现：http
- 验证边界：只读服务/模型目录验证，不会生成内容或下载模型
- 用户操作：在 Developer 中启动本地 API Server；如开启认证，填写该服务的 API Token。
- 官方来源：https://lmstudio.ai/docs/developer/core/server
- 示例地址：http://127.0.0.1:1234；端口不代表已经发现服务。

## Open WebUI
- 项目实现：http
- 验证边界：只读服务/模型目录验证，不会生成内容或下载模型
- 用户操作：确认部署地址与端口，在账号设置中启用/创建 API Key；端口以实际部署为准。
- 官方来源：https://docs.openwebui.com/reference/api-endpoints/
- 示例地址：http://127.0.0.1:3000；端口不代表已经发现服务。

## AnythingLLM
- 项目实现：http
- 验证边界：只读服务/模型目录验证，不会生成内容或下载模型
- 用户操作：在设置中创建开发者 API Key，查看实例 /api/docs 确认 API 可用；桌面版是否开放以当前版本为准。
- 官方来源：https://docs.anythingllm.com/features/api
- 示例地址：http://127.0.0.1:3001；端口不代表已经发现服务。

## ComfyUI
- 项目实现：http
- 验证边界：只读服务/模型目录验证，不会生成内容或下载模型
- 用户操作：启动 ComfyUI 后端，填写实际监听地址；工作流执行还需要模型及 API 格式工作流。
- 官方来源：https://docs.comfy.org/development/comfyui-server/comms_routes
- 示例地址：http://127.0.0.1:8188；端口不代表已经发现服务。

## OpenCode Server
- 项目实现：http
- 验证边界：只读服务/模型目录验证，不会生成内容或下载模型
- 用户操作：手动启动官方 opencode serve；如设置了服务密码，应使用支持该认证方式的接入，当前检查不发送 Basic 凭据。
- 官方来源：https://opencode.ai/docs/server/
- 示例地址：http://127.0.0.1:4096；端口不代表已经发现服务。

## llama.cpp Server
- 项目实现：http
- 验证边界：只读服务/模型目录验证，不会生成内容或下载模型
- 用户操作：启动 llama-server 并加载模型；有认证时填写服务 API Key，端口以启动参数为准。
- 官方来源：https://github.com/ggml-org/llama.cpp/tree/master/tools/server
- 示例地址：http://127.0.0.1:8080；端口不代表已经发现服务。

## DeepSeek API
- 项目实现：http
- 验证边界：用户点击才向所示官方域名发送模型目录请求；目录成功不代表生成或额度已验证
- 用户操作：在 DeepSeek 开放平台生成 API Key，确认 API 账户可用；网页/App 登录不能代替 API Key。
- 官方来源：https://api-docs.deepseek.com/en/
- 示例地址：https://api.deepseek.com；端口不代表已经发现服务。

## 千问 / 百炼 API
- 项目实现：http
- 验证边界：用户点击才向所示官方域名发送模型目录请求；目录成功不代表生成或额度已验证
- 用户操作：在百炼开通模型并创建对应地域 API Key；本项固定使用中国内地地址，其他地域暂不支持自定义云域名。
- 官方来源：https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
- 示例地址：https://dashscope.aliyuncs.com/compatible-mode/v1；端口不代表已经发现服务。

## 豆包桌面
- 项目实现：existing
- 验证边界：使用现有实机探测；不自动打开远程调试
- 用户操作：可以发现安装与进程；当前项目的 CDP 适配器需要特定调试接口，普通桌面登录不等于可调用。
- 官方来源：https://www.doubao.com


## WorkBuddy
- 项目实现：existing
- 验证边界：使用现有 WorkBuddy 适配器；不把健康检查成功当成任务执行成功
- 用户操作：启动 WorkBuddy；现有适配器需要本机服务与有效凭据，使用上方实机探测查看实际缺失项。
- 官方来源：https://www.codebuddy.ai


## 豆包 / 火山方舟 API
- 项目实现：guide
- 验证边界：官方模型 API 可用；本项目尚未实现该服务的可靠目录验证，不能用它验证豆包桌面登录
- 用户操作：在方舟创建 API Key 并开通模型或推理接入点；按量 API 与 Coding Plan 的地址和权限不同。
- 官方来源：https://docs.volcengine.com/docs/ark/quick-start?lang=zh


## GLM / 智谱 API
- 项目实现：guide
- 验证边界：官方 API 接入说明已接入；平台目录与认证探测待实现
- 用户操作：创建智谱开放平台 API Key，选择普通 API 或 Coding Plan 的正确地址。
- 官方来源：https://docs.bigmodel.cn/cn/api/introduction


## Kimi / Moonshot API
- 项目实现：guide
- 验证边界：开放平台 API 与 Kimi CLI 分开接入；本项尚未实现在线验证
- 用户操作：在 Moonshot 开放平台配置 API Key；Kimi 网页账号和 Kimi Code 授权不能直接视为通用 API 授权。
- 官方来源：https://platform.moonshot.cn/docs


## ChatGPT 桌面 / 网页
- 项目实现：guide
- 验证边界：本项目未确认该桌面客户端提供通用本地服务端 API；不能因为发现程序就验证它可调用
- 用户操作：无需向操作台填写 ChatGPT 登录密码。若希望程序化调用模型，使用独立模型 API 或 Codex 接入方式。
- 官方来源：https://platform.openai.com/docs


## Claude 桌面
- 项目实现：guide
- 验证边界：MCP 客户端不等于可供操作台调用的 MCP 服务端
- 用户操作：桌面端配置 MCP 是让 Claude 使用外部工具；程序化调用应使用 Claude Code / Agent SDK 或官方模型 API。
- 官方来源：https://modelcontextprotocol.io/docs/develop/connect-local-servers


## Cherry Studio
- 项目实现：guide
- 验证边界：已知是多模型客户端；本项目未确认通用入站接口，暂不验证
- 用户操作：查看当前版本官方文档是否有对外服务；仅配置模型供应商不能让其他软件调用 Cherry Studio。
- 官方来源：https://github.com/CherryHQ/cherry-studio


## Trae
- 项目实现：guide
- 验证边界：接口待核实；不猜测端口、不注入调试接口
- 用户操作：查看当前版本官方接入文档；安装编辑器及登录不等于已提供外部自动化接口。
- 官方来源：https://www.trae.ai


## Windsurf
- 项目实现：guide
- 验证边界：尚未实现对外任务接口验证
- 用户操作：MCP 配置用于让编辑器访问工具；外部调用需要官方支持的 Agent 接口或专用适配器。
- 官方来源：https://docs.windsurf.com


## Cline
- 项目实现：guide
- 验证边界：官方 CLI/ACP 入口需后续增加握手和认证验证
- 用户操作：若使用 CLI / ACP，请按官方当前版本安装并配置模型提供商；IDE 扩展不等于 CLI 已安装。
- 官方来源：https://github.com/cline/cline


## Roo Code
- 项目实现：guide
- 验证边界：扩展发现已支持；外部调用尚未验证
- 用户操作：先确认安装版本和官方自动化能力；配置其模型提供商不等于开放入站接口。
- 官方来源：https://github.com/RooCodeInc/Roo-Code


## Aider
- 项目实现：guide
- 验证边界：脚本接入方式已登记；版本/任务适配器尚未实现
- 用户操作：按官方脚本方式安装 Aider 并配置模型提供商；任务执行可能修改工程文件。
- 官方来源：https://aider.chat/docs/scripting.html


## 通用 MCP 服务
- 项目实现：guide
- 验证边界：协议说明已接入；本项目尚未实现通用 MCP 握手，不执行任意工具
- 用户操作：准备服务端启动命令或 HTTP 地址及官方认证方式；先用 Inspector 测试 initialize 和 tools/list。
- 官方来源：https://github.com/modelcontextprotocol/inspector


## 通用 ACP 智能体
- 项目实现：guide
- 验证边界：注册表不等于本机已安装；本项目尚未实现通用 ACP 适配器
- 用户操作：从官方注册表选择支持当前系统的智能体，按文档完成安装与登录。
- 官方来源：https://github.com/agentclientprotocol/registry


## Jan 本地 API
- 项目实现：http
- 验证边界：只读模型目录验证；不验证生成、工具调用或任务执行
- 用户操作：在 Jan 中启动 Local API Server，配置 API Key 并确保模型已下载；API Server 与桌面聊天是不同入口。
- 官方来源：https://docs.jan.ai/desktop/api-preference
- 示例地址：http://127.0.0.1:1337；端口不代表已经发现服务。

## GPT4All 本地 API
- 项目实现：http
- 验证边界：只读模型目录验证；不验证生成、工具调用或任务执行
- 用户操作：在设置中打开 Enable Local Server，确认模型可用；LocalDocs 的 API 能力与桌面界面可能不同。
- 官方来源：https://docs.gpt4all.io/gpt4all_api_server/home.html
- 示例地址：http://127.0.0.1:4891；端口不代表已经发现服务。

## vLLM
- 项目实现：http
- 验证边界：只读模型目录验证；不验证生成与任务执行
- 用户操作：手动启动模型服务并加载模型，按实际部署填写本机端口；配置 API Key 时在本次验证中提供。WSL/容器端口需要映射到本机。
- 官方来源：https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html
- 示例地址：http://127.0.0.1:8000；端口不代表已经发现服务。

## SGLang
- 项目实现：http
- 验证边界：只读模型目录验证；不验证生成与任务执行
- 用户操作：手动启动模型服务并加载模型，按实际部署填写本机端口；配置 API Key 时在本次验证中提供。WSL/容器端口需要映射到本机。
- 官方来源：https://github.com/sgl-project/sglang
- 示例地址：http://127.0.0.1:30000；端口不代表已经发现服务。

## Dify
- 项目实现：guide
- 验证边界：官方项目/协议入口已登记；当前项目尚未实现此项专用验证和任务派发
- 用户操作：发布应用，在应用的 API 页面获取专用 API Key 和实际地址；应用 API 与后台管理接口不同。
- 官方来源：https://github.com/langgenius/dify


## n8n
- 项目实现：guide
- 验证边界：官方项目/协议入口已登记；当前项目尚未实现此项专用验证和任务派发
- 用户操作：在设置中创建 API Key；工作流触发需要单独启用 Webhook 或官方执行入口，不要把后台管理 API 当成模型 API。
- 官方来源：https://docs.n8n.io/api/authentication/


## Goose
- 项目实现：guide
- 验证边界：官方项目/协议入口已登记；当前项目尚未实现此项专用验证和任务派发
- 用户操作：安装官方 CLI 并配置模型提供商；ACP 适配需按当前版本文档核对。
- 官方来源：https://github.com/block/goose


## Continue
- 项目实现：guide
- 验证边界：官方项目/协议入口已登记；当前项目尚未实现此项专用验证和任务派发
- 用户操作：区分 IDE 扩展与 CLI，配置模型提供商和认证；MCP 客户端配置不代表开放入站接口。
- 官方来源：https://github.com/continuedev/continue


## CodeBuddy Code
- 项目实现：guide
- 验证边界：官方项目/协议入口已登记；当前项目尚未实现此项专用验证和任务派发
- 用户操作：按官方 ACP 注册表安装适用系统的 CodeBuddy Code，完成登录；与 WorkBuddy 桌面入口分别验证。
- 官方来源：https://github.com/agentclientprotocol/registry


## Qoder CLI
- 项目实现：guide
- 验证边界：官方项目/协议入口已登记；当前项目尚未实现此项专用验证和任务派发
- 用户操作：按官方 ACP 注册表和 Qoder 文档安装 CLI 并登录；仅安装编辑器不足以验证 CLI。
- 官方来源：https://github.com/agentclientprotocol/registry


## Google Antigravity
- 项目实现：guide
- 验证边界：官方项目/协议入口已登记；当前项目尚未实现此项专用验证和任务派发
- 用户操作：先核对 ACP 注册表中当前平台的分发方式并完成官方登录；本项目尚未实现它的握手。
- 官方来源：https://github.com/agentclientprotocol/registry


## Augment / Auggie
- 项目实现：guide
- 验证边界：官方项目/协议入口已登记；当前项目尚未实现此项专用验证和任务派发
- 用户操作：确认安装 Auggie CLI 并完成账号配置；IDE 扩展与 CLI 接入不同。
- 官方来源：https://github.com/agentclientprotocol/registry

