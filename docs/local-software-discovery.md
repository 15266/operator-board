# 本机软件发现：实现与检查

调研参考：
- https://github.com/uber/ADR
- https://github.com/guard0-ai/g0/blob/main/docs/endpoint-monitoring.md
- https://github.com/microsoft/winget-pkgs/blob/master/doc/FAQ.md

独立实现，未复制第三方代码，未安装后台代理。

覆盖 41 类 AI 软件：Windows 卸载注册表、当前用户 AppX、运行进程、PATH、常见安装目录、VS Code/Cursor/Windsurf 扩展目录及已知配置目录名。不读取聊天记录、浏览历史、密钥文件内容，不启动被扫描应用或发送推理任务。

GET /bridge/software?refresh=1 返回软件、来源和扫描范围；GET /bridge/discover 合并服务探测与软件盘点。POST /bridge/scan 与侧栏补充同一来源的证据。发现软件不会自动增加派发适配器。

无法保证覆盖未知产品、自定义命名便携版、WSL/容器内部、远程安装及网页服务。配置目录可能是卸载残留，显示时明确提示。扫描库可继续扩展。

本次检查 src、bridge、启动脚本、构建配置及现有测试。修复配色、侧栏与正文状态、过时 mock 文案、缺 npm 的启动方式，扩展软件发现并修正 Cursors 误报和 Codex 内部 ChatGPT.exe 重复归类。安装、运行、监听、登录、对话分别显示；仅受支持适配器允许派发。

TypeScript/生产构建通过。全目录静态检查无错误，有 91 条警告，涉及 React effect/ref、热更新组织及旧适配器未使用代码。本次没有批量重写动画与旧适配器，不能声称整个项目已经不存在缺陷。

新增误报、证据合并和保守状态测试，加上现有派发测试共 15 项通过。浏览器已核对文字可读性与 WorkBuddy、Codex、豆包状态同步。
