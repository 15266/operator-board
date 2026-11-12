// List-only ACP client: ask the live WorkBuddy session which models it accepts.
//
// Why this exists: the scanner fills its catalog from the manifest's
// published_models, but the ACP session's own option list is what
// session/set_config_option actually validates against. The two differ, so a
// name picked from the published list can be refused at dispatch time.
//
// This connects, opens one session, reads the model config option, and closes.
// It never sends session/prompt, so nothing runs and no quota is used.
import http from "node:http";
import { findModelOption, optionNames } from "./modelResolve.mjs";

function parseSseBuffer(buf) {
  const events = [];
  let rest = buf;
  for (;;) {
    const idx = rest.indexOf("\n\n");
    if (idx < 0) break;
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const dataLines = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart());
    if (dataLines.length) {
      const text = dataLines.join("\n");
      try {
        events.push(JSON.parse(text));
      } catch {
        events.push({ _unparsed: text.slice(0, 400) });
      }
    }
  }
  return { events, rest };
}

export async function listWorkBuddyModels({ port, token, cwd, timeoutMs = 30000 }) {
  if (!port || !token) throw new Error("未拿到 WorkBuddy serve 端口/凭据（桥接需由 start-board.ps1 启动）");
  const base = { host: "127.0.0.1", port: Number(port) };
  let connectionId = "";
  let sessionToken = "";
  const answered = new Set();

  function request(method, urlPath, { headers = {}, body, timeout = 20000, stream = false } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body == null ? null : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          ...base,
          path: urlPath,
          method,
          headers: {
            "X-CodeBuddy-Request": "1",
            Authorization: `Bearer ${token}`,
            ...headers,
            ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
          },
        },
        (res) => {
          if (stream) return resolve({ status: res.statusCode, res });
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => {
            data += c;
          });
          res.on("end", () => resolve({ status: res.statusCode, body: data }));
        },
      );
      req.on("error", reject);
      req.setTimeout(timeout, () => req.destroy(new Error("timeout " + timeout)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async function answerPermission(ev) {
    const key = String(ev.id);
    if (answered.has(key)) return;
    answered.add(key);
    const opts = ev.params?.options || ev.params?.permission?.options || [];
    const ids = opts.map((o) => o.optionId || o.id).filter(Boolean);
    const optionId =
      ids.find((x) => /allow_always|allow-always/i.test(x)) ||
      ids.find((x) => /allow-once|allow_once/i.test(x)) ||
      ids.find((x) => /allow/i.test(x)) ||
      "allow_always";
    try {
      await request("POST", "/api/v1/acp", {
        headers: {
          "acp-connection-id": connectionId,
          "acp-session-token": sessionToken || "",
          Accept: "application/json, text/event-stream",
        },
        body: { jsonrpc: "2.0", id: ev.id, result: { outcome: { outcome: "selected", optionId } } },
      });
    } catch {
      /* listing does not depend on permissions */
    }
  }

  async function rpc(message, ms) {
    const { status, res } = await request("POST", "/api/v1/acp", {
      headers: {
        "acp-connection-id": connectionId,
        "acp-session-token": sessionToken || "",
        Accept: "application/json, text/event-stream",
      },
      body: message,
      timeout: ms,
      stream: true,
    });
    if (status >= 400) return null;
    let buf = "";
    let result = null;
    const deadline = Date.now() + ms;
    await new Promise((resolve, reject) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        const parsed = parseSseBuffer(buf);
        buf = parsed.rest;
        for (const ev of parsed.events) {
          if (
            ev &&
            ev.method &&
            ev.id != null &&
            ev.result === undefined &&
            ev.error === undefined &&
            String(ev.method).toLowerCase().includes("permission")
          ) {
            void answerPermission(ev);
            continue;
          }
          if (ev && ev.id === message.id && (ev.result !== undefined || ev.error)) result = ev;
        }
        if (result) resolve();
      });
      res.on("end", () => resolve());
      res.on("error", reject);
      const timer = setInterval(() => {
        if (result) return clearInterval(timer);
        if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error("rpc timeout for " + message.method));
        }
      }, 500);
    });
    return result;
  }

  const connect = await request("POST", "/api/v1/acp/connect", {
    headers: { Accept: "application/json" },
    body: {},
    timeout: 15000,
  });
  let conn = {};
  try {
    conn = JSON.parse(connect.body || "{}");
  } catch {
    /* empty */
  }
  if (conn.data) conn = conn.data;
  connectionId = conn.connectionId;
  sessionToken = conn.sessionToken || "";
  if (!connectionId) throw new Error("ACP connect 失败 HTTP " + connect.status);

  // The SSE channel must be drained or acpRpc never sees its reply.
  const sse = await request("GET", "/api/v1/acp", {
    headers: {
      "acp-connection-id": connectionId,
      "acp-session-token": sessionToken || "",
      Accept: "text/event-stream",
    },
    stream: true,
    timeout: 15000,
  });
  if (sse.res) {
    sse.res.setEncoding("utf8");
    sse.res.on("data", () => {});
    sse.res.on("error", () => {});
  }

  try {
    const init = await rpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientInfo: { name: "akili-operator-board", version: "0.1.0" },
          capabilities: {},
        },
      },
      timeoutMs,
    );
    // rpc() returns the SSE event itself, so the payload is init.result.
    if (!init || !init.result) throw new Error("ACP initialize 失败");
    const neu = await rpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd, workingDirectory: cwd, mcpServers: [] },
      },
      timeoutMs,
    );
    const session = neu?.result || null;
    if (!session?.sessionId) throw new Error("ACP session/new 未返回 sessionId");
    const option = findModelOption(session.configOptions);
    if (!option) return { ok: false, models: [], current: null, error: "本次会话没有返回模型配置项" };
    const models = optionNames(option).map((o) => ({ value: o.value, name: o.name }));
    return { ok: true, models, current: option.currentValue || null, error: null };
  } finally {
    try {
      await request("DELETE", "/api/v1/acp", {
        headers: {
          "acp-connection-id": connectionId,
          "acp-session-token": sessionToken || "",
          Accept: "application/json",
        },
        timeout: 8000,
      });
    } catch {
      /* best effort */
    }
  }
}
