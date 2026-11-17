# bridge/providers — read-only provider plugins

Each file exports a provider object (or a factory returning one):

```js
{ id, name, kind, capabilities,
  status(ctx)                      // -> { id, available, reason?, plan?, model?, limits:[{name,used_percent,resets_at}], source, recorded_at }
  sessions(ctx, { limit, offset }) // -> { available, reason?, total, items:[{ session_id, title, updated_at, link?, dispatch_id? }] }
  processes(ctx)                   // -> { available, reason?, items:[{ pid, name, role:"bridge"|"other-bridge"|"orphan"|"desktop"|"other", started_at? }] }
}
```
`ctx` = `{ dispatches: () => Dispatch[], bridgePid }`. Never return secrets; when data cannot be read, return `available:false` with a concrete `reason` — never fake data.

Register it in `server.mjs`: `createProviderRegistry([createCodexProvider(), akili.provider, ...])`. Routes are GET only:
`/bridge/providers`, `/bridge/provider/<id>/status|sessions|processes` (405 other methods, 404 unknown id/action).

Registered: `codex` (wraps codexMgr.mjs; /bridge/codex/* unchanged), `akili` (webhook executor).
Not yet registered: `workbuddy` (sources identified: ~/.workbuddy/workbuddy.db sessions table, projects/*/<id>.jsonl,
sessions/<pid>.json, work/wb-live-models.json, official GET /api/v1/{health,info,auth/status,sessions,sessions/live,stats}),
`doubao` (doubao CLI not installed on this laptop; CDP availability only).

Template for a new AI:
```js
export const provider = { id: "myai", name: "My AI", kind: "cli", capabilities: { dispatch: false, status: true, sessions: false, processes: false },
  async status() { return { id: "myai", available: false, reason: "尚未实现", limits: [], source: "n/a", recorded_at: new Date().toISOString() }; },
  async sessions() { return { available: false, reason: "尚未实现", total: 0, items: [] }; },
  async processes() { return { available: false, reason: "尚未实现", items: [] }; } };
```
