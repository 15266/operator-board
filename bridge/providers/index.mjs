// Read-only provider registry + router: GET /bridge/providers, GET /bridge/provider/<id>/status|sessions|processes.
// Contract per provider: { id, name, kind, capabilities, status(ctx), sessions(ctx,{limit,offset}), processes(ctx) }.
// Not registered yet: workbuddy, doubao (recon done, see providers/README.md).
export function createProviderRegistry(providers = []) {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const list = () => providers.map((p) => ({ id: p.id, name: p.name, kind: p.kind, capabilities: p.capabilities }));
  /** Returns true when handled. send(code, body). */
  async function handle(url, method, send, ctx = {}) {
    const p = url.pathname;
    if (p !== "/bridge/providers" && !p.startsWith("/bridge/provider/")) return false;
    if (method !== "GET") { send(405, { error: "只支持 GET（只读接口）" }); return true; }
    if (p === "/bridge/providers") { send(200, { providers: list() }); return true; }
    const m = /^\/bridge\/provider\/([a-z0-9_-]{1,40})\/(status|sessions|processes)$/.exec(p);
    if (!m) { send(404, { error: "未知 provider 接口", routes: ["/bridge/providers", "/bridge/provider/<id>/status", "/bridge/provider/<id>/sessions?limit=&offset=", "/bridge/provider/<id>/processes"] }); return true; }
    const prov = byId.get(m[1]);
    if (!prov) { send(404, { error: "未知 provider：" + m[1], providers: list().map((x) => x.id) }); return true; }
    try {
      if (m[2] === "status") send(200, await prov.status(ctx));
      else if (m[2] === "sessions") send(200, await prov.sessions(ctx, { limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") }));
      else send(200, await prov.processes(ctx));
    } catch (e) { send(500, { id: prov.id, available: false, reason: "provider 内部错误：" + String(e?.message || e).slice(0, 160) }); }
    return true;
  }
  return { list, handle, get: (id) => byId.get(id) };
}
