# 只读契约副本

这些文件是 `portable-agent-orchestrator/scanners/` 的只读快照，供操作台在桥接未提供 `GET /bridge/scanners` / `POST /bridge/scan` 时做**明确标注的示例预览**，以及给 TypeScript 使用同一套类型。

- 不要把这里改成第二份注册表。新增扫描器应登记到原 `scanners/registry.json`。
- `scanners.example.json` 里每条记录的 `tools_verified` 均为 `false`，`chat_bridge` 均为 `"unverified"`，且不含密钥。界面必须标明「示例，不是本机实机扫描」。
- 跳过 `id: "_template"` 与 `status: "skeleton"`，它们不是已发现的活接口。
