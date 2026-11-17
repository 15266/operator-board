# 把虚幻盒子的 MCP 交给执行器（适配说明）

本机已装「虚幻盒子」(unreal-agent)，它把 UE 编辑器的能力以 MCP 服务的形式暴露在回环上。
这份文档说明三个执行器各自怎么用，以及踩过的坑。适用于 fdz_2 这类 UE 工程。

## 1. 它是什么

| 项 | 值 |
| --- | --- |
| MCP 端点 | `http://127.0.0.1:17861/mcp`（streamable-http，只绑回环） |
| 鉴权 | 请求头 `Authorization: Bearer <token>` |
| 令牌来源 | `%APPDATA%\unreal-box\mcp-server.json` 的 `token` 字段（盒子自己写，别手改） |
| 服务开关 | 该文件的 `enabled`；`includeMutating` 决定是否暴露写工具 |
| CLI 入口 | `node F:\ue_mcp\unreal-agent\resources\cli\index.js`（同目录也有 `uebox.cmd`） |
| CLI 配置 | `%APPDATA%\unreal-box-cli\config.json`，内容只有 `{version, hostConfigPath}`，指向上面那份盒子配置 |

CLI 不复制令牌、不复制端口，每次运行都重新读盒子配置——所以盒子里重置令牌后 CLI 不用跟着改。

## 2. 三个执行器怎么接

### codex（能跑命令，能力最全）

直接在项目目录里调用 CLI，用 `--args-file` 传参：

```powershell
# 1) 先确认盒子连的是哪个工程实例
node F:\ue_mcp\unreal-agent\resources\cli\index.js projects list --json

# 2) 看有哪些工具（加 --allow-write 才列写工具）
node F:\ue_mcp\unreal-agent\resources\cli\index.js tools list --json

# 3) 查某个工具的参数 schema，不要凭名字猜
node F:\ue_mcp\unreal-agent\resources\cli\index.js tools show ue_screenshot

# 4) 调用；参数写成 JSON 文件，别用 --args 内联
node F:\ue_mcp\unreal-agent\resources\cli\index.js tools call ue_screenshot --args-file shot.json
```

`shot.json` 里就是这个工具的 inputSchema 字段：

```json
{ "resolution_width": 1280, "resolution_height": 720, "world": "editor" }
```

### workbuddy（ACP 会话）

`~/.workbuddy/mcp.json` 里已有 `unreal-box` 条目（streamable-http + Bearer）。新会话若看不到
`mcp__unreal-box__*` 工具，说明这条 MCP 还没在当前会话里授信——在连接器页面点一次「信任」即可，
不需要重写配置。授信之后直接用工具名调用，不必再走 CLI。

### 豆包 / Kimi（网页通道）

**接不了，也不要让它假装接了。** 网页对话访问不到本机回环，它的 handoff 只能读写被指定的工作目录。
给豆包派任务时，把需要的事实（ini 片段、工具输出）**贴进提示词**，让它产出文档，而不是让它去调 MCP。

## 3. 常用工具与风险分级

| 工具 | 用途 | 风险 |
| --- | --- | --- |
| `ue_screenshot` | 抓视口/整窗截图，返回 `world`(pie/editor)、`view`(player/viewport)、`pending_shaders` | safe |
| `ue_get_config` | 读工程配置项（核对 ini 是否真的生效） | safe |
| `ue_content_audit_optimization` | 盘点 Nanite/Lumen 启用率、纹理尺寸分布 | safe |
| `ue_project_asset_ranking` | 全工程按磁盘/面数/贴图内存排资产 | safe |
| `ue_asset_size_map` | 单个资产连同依赖的总占用 | safe |
| `ue_message_log` | 读编辑器 Message Log | safe |
| `ue_list_unsaved` | 列未保存改动，并区分是谁改的 | safe |
| actors spawn/move/delete、`ue_undo` | 改关卡 | 写，需 `--allow-write` |

判定截图能不能下结论，先看返回里的三个字段：`camera_source` 是 `fallback` 时构图不可信；
`pending_shaders` / `pending_assets` 不为 0 时别评材质；要看 HUD、面板、弹窗就传 `show_ui=true`，
默认路径渲的是场景，界面层根本不在图里。

## 4. 踩过的坑（2026-11-17 实测）

1. **`--args` 内联 JSON 会被 shell 吃掉**，报 `--args 不是合法 JSON`。一律写 `--args-file`。
2. **`filepath` 参数不生效**：截图固定落到 `Saved/Screenshots/UAL/UAShot_<时间戳>.png`，
   要指定位置就自己拷。
3. **CLI 报 `CONFIG_MISSING` 不等于盒子没开**：那只是 CLI 自己的 `config.json` 缺失。
   手写 `{version:1, hostConfigPath:"<盒子 mcp-server.json 的绝对路径>"}` 即可，等同 `uebox setup`。
4. **工程路径含中文会导致编译失败**（MSVC 按 GBK 解析成乱码，报 `C1083` 找不到 `.pch`）。
   用目录联接给一个 ASCII 路径：`New-Item -ItemType Junction -Path F:\fdz_2_build -Target <真实路径>`，
   再用 `-Project="F:\fdz_2_build\fdz.uproject"` 编译。盒子也会把这个联接路径当作工程路径显示。
5. **冷启动要从会被回收的 shell 里逃出来**：后台命令里 `Start-Process` 起的编辑器，会在该 shell
   结束时被作业对象一起收走（日志停在初始化中途、无 fatal）。用 `explorer.exe <脚本>` 拉起才真脱离。
6. **冷启动打开的是 `GameDefaultMap`**（fdz 是 `Lvl_ThirdPerson` 模板图），不是验收关卡。
   要在验收关卡里测玩法，得先由人指定关卡，别拿模板图的截图当验收证据。
