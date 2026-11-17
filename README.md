# 编排操作台 · Operator Board

本地网页操作台，用来组织「圆桌会议」：为会议配置国王和骑士，探测本机已经出现的 AI 接口，再把任务派到对应的桌面应用或命令行。

界面是 Vite + React + TypeScript。会议数据只存在本机浏览器里，刷新后还在。选择执行器或模型并不等于已经连通，也不会自动发出任务。

完整的安装、启动、探测、派发和上传说明见 [使用说明.md](./使用说明.md)。

## 快速开始

需要 Node.js 18+。在仓库根目录：

```bash
npm install
```

Windows 上一键启动桥接和界面：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-board.ps1
```

然后打开 [http://127.0.0.1:5173/#projects](http://127.0.0.1:5173/#projects)。停止时在同一脚本后加 `-Stop`。

也可以手动执行 `npx vite --host 127.0.0.1 --port 5173`，另开一个进程运行 `node bridge/server.mjs`（桥接监听 `127.0.0.1:5180`）。

## 能做什么

- 新建或打开圆桌会议（目录里带有示例会议「卡美洛」）
- 在通道页「一键探测」本机接口；执行器列表只出现探测到的项
- 国王汇总各骑士本轮结果并向你汇报；国王只能选带图形界面的执行器（如 WorkBuddy、豆包），命令行接口不能当国王
- 骑士可使用已探测到的任一种执行器，包括 Codex
- 「按任务分配骑士」不会改动或复制国王
- 未配置国王执行器时，派发和汇报会被拦住
- 任务行可单独派发，也可以「派发全部未完成任务」；有结果后可「向国王汇报本轮结果」

当前可派发的适配器：WorkBuddy（官方可见任务链接）、豆包桌面（CDP「新工作任务」）、Codex CLI。探测到不等于已连通，也不保证这一次派发成功。

## 范围

- 本仓库是操作台和本机桥接，不包含 Unreal 或其他游戏工程
- 不要把 `node_modules/`、`dist/`、`logs/`、`.env` 或 `bridge-token` 提交到 Git 仓库
- 视觉参考的授权说明见 `LICENSE-RHINE-REFERENCE.txt`
