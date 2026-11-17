// One-off live check: session/set_config_option only. No prompt, no PUT settings.
import fs from "node:fs";
import http from "node:http";
import { findModelOption, optionNames, resolveModelValue } from "./modelResolve.mjs";

function parseSseBuffer(buf) {
  const events = [];
  let rest = buf;
  for (;;) {
    const idx = rest.indexOf("\n\n");
    if (idx < 0) break;
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const dataLines = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart());
    if (dataLines.length) {
      const text = dataLines.join("\n");
      try { events.push(JSON.parse(text)); } catch { events.push({ _unparsed: text.slice(0, 200) }); }
    }
  }
  return { events, rest };
}

const port = Number(process.env.WB_PORT || 0);
const token = process.env.WB_TOKEN || "";
const cwd = process.argv[2];
const outPath = process.argv[3];
if (!port || !token) {
  console.error("missing WB_PORT or WB_TOKEN");
  process.exit(2);
}
if (!cwd || !outPath) {
  console.error("usage: node verify-acp-model.mjs <cwd> <out.json>");
  process.exit(2);
}

const evidence = {
  started_at: new Date().toISOString(),
  cwd,
  prompt_sent: false,
  global_put: false,
};

function request(method, urlPath, { headers = {}, body, timeoutMs = 30000, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: urlPath,
      method,
      headers: {
        "X-CodeBuddy-Request": "1",
        Authorization: `Bearer ${token}`,
        ...headers,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
      },
    }, (res) => {
      if (stream) return resolve({ status: res.statusCode, headers: res.headers, res });
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout " + timeoutMs)));
    if (payload) req.write(payload);
    req.end();
  });
}

function parseJson(text) {
  try { return JSON.parse(text || "{}"); } catch { return {}; }
}

async function getGlobalModel() {
  const r = await request("GET", "/api/v1/settings/model", { timeoutMs: 10000 });
  const j = parseJson(r.body);
  const data = j.data || j;
  return {
    status: r.status,
    model: data.model || data.modelId || data.id || data.value || data.current || null,
    name: data.name || data.displayName || null,
  };
}

let connectionId = "";
let sessionToken = "";

async function acpRpc(message, timeoutMs = 60000) {
  const { status, res } = await request("POST", "/api/v1/acp", {
    headers: {
      "acp-connection-id": connectionId,
      "acp-session-token": sessionToken || "",
      Accept: "application/json, text/event-stream",
    },
    body: message,
    timeoutMs,
    stream: true,
  });
  if (status >= 400) {
    const body = await new Promise((r) => { let d = ""; res.setEncoding("utf8"); res.on("data", (c) => d += c); res.on("end", () => r(d)); });
    return { status, body, result: null };
  }
  let buf = "", result = null;
  const deadline = Date.now() + timeoutMs;
  await new Promise((resolve, reject) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buf += chunk;
      const parsed = parseSseBuffer(buf);
      buf = parsed.rest;
      for (const ev of parsed.events) {
        if (ev && ev.id === message.id && (ev.result !== undefined || ev.error)) { result = ev; resolve(); }
      }
    });
    res.on("end", () => resolve());
    res.on("error", reject);
    const t = setInterval(() => {
      if (result) return clearInterval(t);
      if (Date.now() > deadline) { clearInterval(t); reject(new Error("rpc timeout for " + message.method)); }
    }, 500);
  });
  return { status, result, body: null };
}

function summarizeOption(opt) {
  if (!opt) return null;
  return {
    id: opt.id || opt.configId || null,
    category: opt.category || null,
    currentValue: opt.currentValue ?? null,
    names: optionNames(opt).map((o) => ({ value: o.value, name: o.name || null })),
  };
}

try {
  evidence.global_before = await getGlobalModel();

  const connect = await request("POST", "/api/v1/acp/connect", { headers: { Accept: "application/json" }, body: {}, timeoutMs: 15000 });
  let conn = parseJson(connect.body);
  if (conn.data) conn = conn.data;
  connectionId = conn.connectionId || "";
  sessionToken = conn.sessionToken || "";
  if (!connectionId) throw new Error("ACP connect failed HTTP " + connect.status);
  evidence.acp_connection_id = connectionId;

  const init = await acpRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientInfo: { name: "akili-model-verify", version: "0.1.0" }, capabilities: {} } }, 30000);
  if (!init.result?.result) throw new Error("initialize failed HTTP " + init.status);

  const neu = await acpRpc({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd, workingDirectory: cwd, mcpServers: [] } }, 60000);
  const sessionId = neu.result?.result?.sessionId;
  if (!sessionId) throw new Error("session/new failed: " + JSON.stringify(neu.result?.error || neu.body || "").slice(0, 300));
  evidence.session_id = sessionId;

  const modelOption = findModelOption(neu.result?.result?.configOptions);
  evidence.model_option = summarizeOption(modelOption);
  if (!modelOption) throw new Error("session has no model config option");

  const original = modelOption.currentValue;
  evidence.original = original;
  const others = optionNames(modelOption).map((o) => o.value).filter((v) => v && v !== original);
  const target = others[0] || original;
  evidence.target = target;
  const resolvedSame = resolveModelValue(modelOption, original);
  evidence.resolve_current_ok = resolvedSame === original;

  if (target !== original) {
    const set = await acpRpc({
      jsonrpc: "2.0",
      id: 5,
      method: "session/set_config_option",
      params: { sessionId, configId: modelOption.id || "model", value: target },
    }, 20000);
    if (set.result?.error) throw new Error("set_config_option error: " + JSON.stringify(set.result.error).slice(0, 300));
    const after = findModelOption(set.result?.result?.configOptions);
    evidence.after_switch = after?.currentValue ?? null;
    if (evidence.after_switch !== target) throw new Error("switch did not stick, current=" + evidence.after_switch);
    evidence.model_source = "session/set_config_option";
    const restore = await acpRpc({
      jsonrpc: "2.0",
      id: 7,
      method: "session/set_config_option",
      params: { sessionId, configId: modelOption.id || "model", value: original },
    }, 20000);
    const restored = findModelOption(restore.result?.result?.configOptions);
    evidence.after_restore = restored?.currentValue ?? null;
  } else {
    evidence.model_source = "already_current_only_option";
    evidence.after_switch = original;
    evidence.after_restore = original;
  }

  evidence.global_after = await getGlobalModel();
  evidence.global_unchanged =
    String(evidence.global_before?.model || "") === String(evidence.global_after?.model || "") &&
    evidence.global_before?.status === 200 &&
    evidence.global_after?.status === 200;
  evidence.ok = evidence.model_source === "session/set_config_option"
    ? evidence.after_switch === target && evidence.after_restore === original && evidence.global_unchanged
    : evidence.global_unchanged && !!original;
  evidence.finished_at = new Date().toISOString();
} catch (err) {
  evidence.ok = false;
  evidence.error = String(err && err.message ? err.message : err).slice(0, 500);
  evidence.finished_at = new Date().toISOString();
  try { evidence.global_after = await getGlobalModel(); } catch {}
} finally {
  if (connectionId) {
    try {
      await request("DELETE", "/api/v1/acp", {
        headers: { "acp-connection-id": connectionId, "acp-session-token": sessionToken || "", Accept: "application/json" },
        timeoutMs: 8000,
      });
    } catch {}
  }
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify({
    ok: evidence.ok,
    model_source: evidence.model_source || null,
    original: evidence.original || null,
    target: evidence.target || null,
    after_switch: evidence.after_switch || null,
    after_restore: evidence.after_restore || null,
    global_unchanged: evidence.global_unchanged ?? null,
    option_count: evidence.model_option?.names?.length || 0,
    error: evidence.error || null,
    out: outPath,
  }));
  process.exit(evidence.ok ? 0 : 1);
}
