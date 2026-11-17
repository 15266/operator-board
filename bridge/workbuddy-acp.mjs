// WorkBuddy official ACP adapter.
// Live-verified 2026-11-11: session/new must send workingDirectory (cwd alone
// lands writes in %TEMP%\workbuddy-host-cli). Jobs API remains EADDRINUSE.
import http from "node:http";
import { findModelOption, optionNames, resolveModelValue } from "./modelResolve.mjs";

// session/prompt covers the whole agent turn (multi-file deliverables can exceed 8 min).
// Override with WORKBUDDY_PROMPT_TIMEOUT_MS; other ACP RPC timeouts are unchanged.
export const DEFAULT_PROMPT_TIMEOUT_MS = 20 * 60 * 1000;
export function promptTimeoutMs(env = process.env) {
  const n = Number(env.WORKBUDDY_PROMPT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PROMPT_TIMEOUT_MS;
}

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
      try { events.push(JSON.parse(text)); } catch { events.push({ _unparsed: text.slice(0, 400) }); }
    }
  }
  return { events, rest };
}

export async function adapterWorkBuddyAcp(rec, cwd, { port, token, update, redact }) {
  if (!token || !port) throw new Error("未拿到 WorkBuddy serve 端口/凭据（桥接需由 start-bridge.ps1 启动）");
  const base = { host: "127.0.0.1", port: Number(port) };
  let connectionId = "";
  let sessionToken = "";
  const answered = new Set();
  const chunks = [];
  const pending = new Map();
  const streams = new Set();
  let activeSessionId = null;

  function request(method, urlPath, { headers = {}, body, timeoutMs = 30000, stream = false } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body == null ? null : Buffer.from(JSON.stringify(body));
      const req = http.request({
        ...base, path: urlPath, method,
        headers: {
          "X-CodeBuddy-Request": "1",
          Authorization: `Bearer ${token}`,
          ...headers,
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        },
      }, (res) => {
        if (stream) { req.setTimeout(0); return resolve({ status: res.statusCode, headers: res.headers, res }); }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { data += c; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });
      req.on("error", reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout " + timeoutMs)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async function replyPermission(ev) {
    const key = String(ev.id);
    if (answered.has(key)) return;
    answered.add(key);
    const opts = ev.params?.options || ev.params?.permission?.options || [];
    const ids = opts.map((o) => o.optionId || o.id).filter(Boolean);
    const optionId = ids.find((x) => /allow_always|allow-always/i.test(x)) || ids.find((x) => /allow-once|allow_once/i.test(x)) || ids.find((x) => /allow/i.test(x)) || "allow_always";
    update(rec, {}, "ACP 自动批准权限 " + optionId);
    const body = { jsonrpc: "2.0", id: ev.id, result: { outcome: { outcome: "selected", optionId } } };
    try {
      const r = await request("POST", "/api/v1/acp", {
        headers: {
          "acp-connection-id": connectionId,
          "acp-session-token": sessionToken || "",
          Accept: "application/json, text/event-stream",
        },
        body,
        timeoutMs: 20000,
      });
      if (r.status >= 400) update(rec, {}, "ACP 权限回复 HTTP " + r.status);
    } catch (e) {
      update(rec, {}, "ACP 权限回复失败：" + String(e.message || e));
    }
  }

  function handleEv(ev) {
    if (!ev) return;
    if (ev.id != null && (ev.result !== undefined || ev.error)) {
      pending.get(String(ev.id))?.(null, ev);
      return;
    }
    if (activeSessionId && ev.params?.sessionId && ev.params.sessionId !== activeSessionId) return;
    if (ev.method && ev.id != null && ev.result === undefined && ev.error === undefined) {
      if (String(ev.method).toLowerCase().includes("permission")) replyPermission(ev);
      return;
    }
    const u = ev.params?.update || (ev.method === "session/update" ? ev.params : null);
    if (!u) return;
    if (/agent_message/.test(String(u.sessionUpdate || "")) && u.content?.text) chunks.push(u.content.text);
    if (u.sessionUpdate === "tool_call" && u.title) {
      const loc = u.locations?.[0]?.path || u.path || "";
      update(rec, {}, "ACP 工具 " + (u.title + (loc ? " " + loc : "")).slice(0, 180));
    }
  }

  async function acpRpc(message, timeoutMs = 120000) {
    let finish;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("rpc timeout for " + message.method)), timeoutMs);
      finish = (error, result) => {
        if (!pending.has(String(message.id))) return;
        clearTimeout(timer);
        pending.delete(String(message.id));
        error ? reject(error) : resolve(result);
      };
      pending.set(String(message.id), finish);
    });
    // A result may arrive over GET before the POST response headers arrive.
    response.catch(() => {});
    let res;
    try {
      const reply = await request("POST", "/api/v1/acp", {
        headers: { "acp-connection-id": connectionId, "acp-session-token": sessionToken || "", Accept: "application/json, text/event-stream" },
        body: message, timeoutMs, stream: true,
      });
      res = reply.res;
      streams.add(res);
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        const parsed = parseSseBuffer(buf);
        buf = parsed.rest;
        for (const ev of parsed.events) handleEv(ev);
      });
      res.on("end", () => {
        // Some gateways use a finite JSON body instead of SSE.
        if (buf.trim()) { try { handleEv(JSON.parse(buf)); } catch {} }
      });
      res.on("error", (error) => finish(error));
      if (reply.status >= 400) finish(new Error("ACP HTTP " + reply.status + " for " + message.method));
      const result = await response;
      return { status: reply.status, result, body: null };
    } catch (error) {
      finish(error);
      throw error;
    } finally {
      if (res) { streams.delete(res); res.destroy(); }
    }
  }

  /* Historical POST-only reader retained below temporarily for comparison. */
  async function legacyAcpRpc(message, timeoutMs = 120000) {
    const { status, headers, res } = await request("POST", "/api/v1/acp", {
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
          handleEv(ev);
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

  const connect = await request("POST", "/api/v1/acp/connect", { headers: { Accept: "application/json" }, body: {}, timeoutMs: 15000 });
  let conn = {};
  try { conn = JSON.parse(connect.body || "{}"); } catch {}
  if (conn.data) conn = conn.data;
  connectionId = conn.connectionId;
  sessionToken = conn.sessionToken || "";
  if (!connectionId) throw new Error("ACP connect 失败 HTTP " + connect.status);
  update(rec, { via: "workbuddy ACP session/new（workingDirectory，非 jobs）", evidence: { ...rec.evidence, acp_connection_id: connectionId, cwd } }, "ACP 已连接");

  try {
  try {
    const sse = await request("GET", "/api/v1/acp", {
      headers: { "acp-connection-id": connectionId, "acp-session-token": sessionToken || "", Accept: "text/event-stream" },
      stream: true, timeoutMs: 15000,
    });
    let sseBuf = "";
    streams.add(sse.res);
    sse.res.setEncoding("utf8");
    sse.res.on("error", (error) => {
      update(rec, {}, "ACP SSE 中断：" + redact(String(error.message || error)));
    });
    sse.res.on("data", (chunk) => {
      sseBuf += chunk;
      const parsed = parseSseBuffer(sseBuf);
      sseBuf = parsed.rest;
      for (const ev of parsed.events) handleEv(ev);
    });
  } catch (e) {
    update(rec, {}, "ACP SSE 打开失败：" + String(e.message || e));
  }

  const init = await acpRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientInfo: { name: "akili-operator-board", version: "0.1.0" }, capabilities: {} } }, 30000);
  if (!init.result?.result) throw new Error("ACP initialize 失败 HTTP " + init.status + " " + redact(init.body || "").slice(0, 200));

  const neu = await acpRpc({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd, workingDirectory: cwd, mcpServers: [] } }, 60000);
  const sessionId = neu.result?.result?.sessionId;
  activeSessionId = sessionId;
  if (!sessionId) throw new Error("ACP session/new 失败：" + redact(JSON.stringify(neu.result?.error || neu.body || "")).slice(0, 300));
  update(rec, { state: "running", evidence: { ...rec.evidence, session_id: sessionId, cwd, workingDirectory: cwd } }, "ACP 会话 " + sessionId);

  try { await acpRpc({ jsonrpc: "2.0", id: 3, method: "session/set_mode", params: { sessionId, modeId: "acceptEdits" } }, 20000); }
  catch (e) { update(rec, {}, "ACP set_mode 失败：" + String(e.message || e)); }
  try { await acpRpc({ jsonrpc: "2.0", id: 4, method: "session/set_config_option", params: { sessionId, configId: "thought_level", value: "low" } }, 20000); }
  catch (e) { /* optional */ }

  const sessionResult = neu.result?.result || {};
  const modelOption = findModelOption(sessionResult.configOptions);
  const requestedModel = typeof rec.model === "string" ? rec.model.trim() : "";
  if (requestedModel) {
    if (!modelOption) {
      throw new Error("已选模型「" + requestedModel + "」，但此次 ACP 会话没有返回模型配置项。未改全局默认，也没有发送 prompt");
    }
    const applied = resolveModelValue(modelOption, requestedModel);
    if (!applied) {
      const sample = optionNames(modelOption).slice(0, 12).map((o) => o.name || o.value).join("、");
      throw new Error("已选模型「" + requestedModel + "」不在本机会话可选列表中" + (sample ? "（" + sample + "）" : "") + "。未发送 prompt，也未改全局默认。");
    }
    if (applied !== modelOption.currentValue) {
      const set = await acpRpc({
        jsonrpc: "2.0",
        id: 5,
        method: "session/set_config_option",
        params: { sessionId, configId: modelOption.id || "model", value: applied },
      }, 20000);
      if (set.result?.error) {
        throw new Error("ACP 切换模型失败：" + redact(JSON.stringify(set.result.error)).slice(0, 300));
      }
      const after = findModelOption(set.result?.result?.configOptions);
      const current = after?.currentValue ?? applied;
      if (current !== applied) {
        throw new Error("ACP 未能把模型切到「" + applied + "」（当前 " + (current || "未知") + "）。未发送 prompt，也未改全局默认。");
      }
      update(rec, { evidence: { ...rec.evidence, model_requested: requestedModel, model_applied: current, model_source: "session/set_config_option" } }, "ACP 已切换模型 " + current);
    } else {
      update(rec, { evidence: { ...rec.evidence, model_requested: requestedModel, model_applied: applied, model_source: "already_current" } }, "ACP 模型已是 " + applied);
    }
  } else if (modelOption?.currentValue) {
    update(rec, { evidence: { ...rec.evidence, model_requested: null, model_applied: modelOption.currentValue, model_source: "session_default" } }, "ACP 使用会话默认模型 " + modelOption.currentValue);
  }

  const promptTimeout = promptTimeoutMs();
  update(rec, { evidence: { ...rec.evidence, prompt_timeout_ms: promptTimeout, prompt_started_at: new Date().toISOString() } }, "ACP prompt 等待上限 " + Math.round(promptTimeout / 60000) + " 分钟");
  let prompt;
  try {
    prompt = await acpRpc({ jsonrpc: "2.0", id: 6, method: "session/prompt", params: { sessionId, prompt: [{ type: "text", text: `本任务指定工作目录为：${cwd}。涉及文件时必须使用这个目录下的绝对路径，不得使用宿主进程临时目录代替。\n\n${rec.prompt}` }] } }, promptTimeout);
  } catch (e) {
    const partial = chunks.join("").trim();
    if (partial) update(rec, { evidence: { ...rec.evidence, partial_reply: partial.slice(0, 4000) } }, "ACP prompt 中断前已收到部分回复 " + partial.length + " 字");
    throw e;
  }
  const stop = prompt.result?.result?.stopReason;
  const outcome = prompt.result?.result?._meta?.["codebuddy.ai/outcome"];
  const reply = chunks.join("").trim() || null;
  update(rec, { reply, evidence: { ...rec.evidence, stopReason: stop || null, outcome: outcome || null } }, "ACP prompt " + (outcome || stop || "done"));
  if (prompt.result?.error) throw new Error("ACP session/prompt 错误：" + redact(JSON.stringify(prompt.result.error)).slice(0, 300));
  if (outcome === "PARTIAL_SUCCESS" && reply) {
    // WorkBuddy self-reports partial success but returned a reply: keep it for review, never auto-verify.
    rec._partialOutcome = outcome;
    update(rec, { evidence: { ...rec.evidence, partial_success: true } }, "WorkBuddy 自报部分成功，回复已保留，待人工验收");
  } else if (outcome && outcome !== "SUCCESS") throw new Error("ACP 任务未成功完成：" + outcome);
  if (!reply) throw new Error("ACP 会话结束但没有模型回复，不能判定成功");
  return true;
  } finally {
    for (const settle of [...pending.values()]) settle(new Error("ACP connection closed"));
    for (const stream of streams) stream.destroy();
    streams.clear();
    try { await request("DELETE", "/api/v1/acp", { headers: { "acp-connection-id": connectionId, "acp-session-token": sessionToken || "", Accept: "application/json" }, timeoutMs: 8000 }); } catch {}
  }
}
