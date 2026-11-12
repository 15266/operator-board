# AI 派发连通测试计划（1110-1914）

目的：验证操作台「派发」按钮能真的把任务发到本机的外部 AI，并把真实结果回填到界面。

| # | 执行器 | 通道 | 任务 | 通过标准 |
|---|---|---|---|---|
| 1 | WorkBuddy | `POST /api/v1/jobs`（GUI serve），失败则 `codebuddy -p` 兜底 | 在 `ai-dispatch-test/1110-1914/workbuddy/` 建 `wb-test.txt`，并回复口令 | 回复含 `AKILI-TEST-WORKBUDDY-1110-1914`，且文件存在、内容含口令 |
| 2 | Codex | `codex exec`（只读沙箱，会话持久化） | 回复口令（全程只发 1 次，额度保护） | 回复含 `AKILI-TEST-CODEX-1110-1914` |
| 3 | 豆包 | 社区 `dsh-doubao-bridge`，CDP `127.0.0.1:9225`，仅 chat | 回复口令 | 回复含 `AKILI-TEST-DOUBAO-1110-1914` |

判定：
- 「已核实」= 桥接拿到真实回复（以及文件）且全部校验通过。
- 「有回复，待核实」= 拿到回复但校验没过。
- 「失败」= 通道报错或超时，界面显示原因。
- 不做任何假成功；Codex 超过 1 次会被桥接拒绝。

记录：`operator-board/logs/dispatches.json`、`operator-board/logs/bridge.log`。
