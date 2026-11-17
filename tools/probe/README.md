# tools/probe — 联调探针

这些脚本不参与看板运行，只在**排查与验收**时手动用。全部走 HTTP/CDP 的公开接口，不改状态机。

## 常用

| 脚本 | 用途 |
|---|---|
| `round-run.py` | 按 JSON 清单一次派发一整轮（多执行器并行），统一盯到全部终态并汇总 |
| `dispatch-and-watch.py` | 派一条任务，逐条打印状态迁移与事件；单条排查用 |
| `negative-tests.py` | 撞桥接的拒绝分支（13 条坏输入），确认坏请求被拦且不产生记录 |
| `cdp-runstate.mjs` | 用 `doubao-work-task.mjs` 里 `RUN_STATE_JS` 的原样表达式取豆包页面状态，判断 `waitForRun` 卡在哪个条件 |
| `cdp-snapshot.mjs` | 只读快照：是否仍在生成、回复末尾、`HANDOFF-DONE` 是否出现 |

示例输入：`p1-kay.txt` / `p2-galahad.txt` / `p3-tristan.txt` / `p4-king.txt` 是任务提示词，`round-r3-closeout.json` 是轮次清单（三执行器并行 + 国王收口）。

要维护选择器时用 `cdp-snapshot.mjs` 现抓一份 DOM 树（它会把整棵 `mlChildren` 打出来），不必依赖历史转储。

## 用法

```bash
# 一整轮
python tools/probe/round-run.py tools/probe/round-r3-closeout.json --timeout 780

# 单条
python tools/probe/dispatch-and-watch.py --executor codex \
  --prompt-file tools/probe/p1-kay.txt \
  --project-dir "D:\...\ai-dispatch-test\adhoc" \
  --expect-file r3-logs/x.md --expect-marker SOME-MARKER --timeout 300

# 拒绝分支
python tools/probe/negative-tests.py

# 豆包卡住时
node tools/probe/cdp-runstate.mjs 9225
```

## 注意

- 本机环境的 `HTTP_PROXY` 会让回环请求拿到假 502，脚本里一律绕开代理（`ProxyHandler({})` / `curl --noproxy '*'`）。
- **超时别设太短**：豆包写长文档实测约 7 分钟，`running` 状态不等于卡死。先看记录的 `evidence.elapsedMs` 和 `finished_at`，再判断。
- `--project-dir` 指到共享项目根时，`expect_files` 才按项目根解析；只给 per-dispatch 目录会全判缺失。
