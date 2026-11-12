# 本机 AI 接口扫描（scanners）

可插拔模块：在新环境里自动找到本机已有的 AI 接口，用户通常只需填密钥（或确认已有会话）。**新 AI 只需加一个扫描器插件就会出现在发现列表里**，不要把 WorkBuddy / Codex / 豆包写死在 `operator-board/bridge/server.mjs`。

权威契约：[contract.md](contract.md)、[types.ts](types.ts)、[contract.py](contract.py)。

这层只负责**发现**。对话、工具核实、派发仍走已有的 `adapters/`、`channels`、`projects/`。发现 ≠ 已连接 ≠ 已核实。`auth_ref` 只存环境变量**名**，禁止存原始密钥。

## 目录

```
scanners/
  contract.md / contract.py / types.ts
  registry.json              ← 插件目录（host 只循环这里）
  loader.py / loader.mjs     ← 通用定位器引擎（进程 / PATH / 安装目录 / 本机端口）
  _template/                 ← 复制后改名即可
  workbuddy/ codex/ doubao/ ollama/   ← 示例插件（声明怎么找，不是 host 里的 if）
  scanners.example.json      ← 示例发现记录，无密钥
```

现场结果若落盘，只用 gitignore 的 `results.json`，且仍不得含密钥。

## CLI

```bash
python3 -m scanners list
python3 -m scanners validate
python3 -m scanners register --id <id>
```

`scan` 默认用空 host（全部 `not_found`），避免在 CI 或编排箱里误扫用户桌面。实机扫描由操作台桥接在目标机器上调用。

## 如何新增一个扫描器

1. `cp -R scanners/_template scanners/<id>`
2. 填写 `manifest.json`：`id`、如何找进程 / PATH / 安装目录 / 本机端口（端口可以是数字，也可以是 `from_env` 变量名或 `from_process`）、发现后的 endpoint 形状、是否需要用户密钥（或可从已运行进程检测会话）、探活怎么做。`name_regex` 不要写 `(?i)`。多数插件**只需要 manifest**。
3. 写 `README.md`：怎么找到、用户要不要填密钥、**明确不声称什么**。
4. `python3 -m scanners register --id <id>`（先校验，失败不写注册表）

不要改 `server.mjs`。下一轮 `GET /bridge/scanners` 就会列出它。

## 接入操作台（给外部通道官）

见下面「接入步骤」。原则：`server.mjs` 只 `import` loader 并挂通用路由；现有 `/bridge/health` 与派发逻辑第一轮保持不动（加法）。不要重启 WorkBuddy / Codex / 豆包 / UE / FlClash。

## 学过的做法

- Home Assistant：插件用 manifest 声明如何被发现，发现之后走用户确认的 config flow，不是自动写成已配置。
- Continue：本机 Ollama 默认 `http://localhost:11434/`，用 `GET /api/tags` 列模型；列模型不是工具核实。
- Open WebUI：只探测已声明端口（11434，失败再试声明的 12434）；校验是另一步。我们不把原始密钥写入 JSON。

详细引用见 `contract.md` §8。
