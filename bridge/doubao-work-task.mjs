#!/usr/bin/env node
// Board-local Doubao「新工作任务」handoff with official model selection.
// Modeled on dsh-doubao-bridge's CDP driver (real pointer events, HANDOFF-DONE).
// Official work-task models: 自动 / 豆包 2.1 Lite / 豆包 2.1 Pro.
// Does not invent unofficial IDs. Used only when a model was requested.

import fs from "node:fs";

const ENDPOINT = process.env.DOUBAO_CDP || "http://127.0.0.1:9225";
const CHAT_PAGE = "doubao-chat/chat";
const OFFICIAL_MODELS = ["自动", "豆包 2.1 Lite", "豆包 2.1 Pro"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", () => rej(new Error("CDP websocket error")));
  });
  const send = (method, params = {}, ms = 20000) => {
    const mid = ++id;
    const p = new Promise((resolve, reject) => {
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("CDP timeout: " + method)), ms))]);
  };
  return { ws, ready, send };
}

async function withPage(fn) {
  let targets;
  try {
    const res = await fetch(`${ENDPOINT}/json/list`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    targets = await res.json();
  } catch (err) {
    throw new Error(`无法连接豆包 CDP ${ENDPOINT}：${err.message}`);
  }
  const page = targets.find((t) => t.type === "page" && t.url.includes(CHAT_PAGE))
    || targets.find((t) => t.type === "page" && t.url.includes("doubao-launcher"));
  if (!page) throw new Error("CDP 里没有找到豆包聊天页");
  const { ws, ready, send } = connect(page.webSocketDebuggerUrl);
  await ready;
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "evaluate failed");
    }
    return r.result?.value;
  };
  try {
    return await fn({ page, send, evalJs });
  } finally {
    try { ws.close(); } catch {}
  }
}

async function realClick(send, evalJs, expr) {
  const rect = await evalJs(`(() => {
    const el = ${expr};
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!rect) return { ok: false, error: "element not found or zero-size" };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  return { ok: true, at: rect };
}

export function resolveOfficialDoubaoModel(requested) {
  const want = String(requested || "").trim();
  if (!want) return null;
  const exact = OFFICIAL_MODELS.find((name) => name === want);
  if (exact) return exact;
  const key = want.toLowerCase().replace(/\s+/g, "");
  if (key === "自动" || key === "auto") return "自动";
  if (key === "豆包2.1lite" || key === "lite") return "豆包 2.1 Lite";
  if (key === "豆包2.1pro" || key === "pro") return "豆包 2.1 Pro";
  return null;
}

const CURRENT_MODEL_JS = `(() => {
  const official = ${JSON.stringify(OFFICIAL_MODELS)};
  const hits = [];
  const nodes = [...document.querySelectorAll('button, [role="button"], [role="combobox"], [role="option"], div, span')];
  for (const el of nodes) {
    const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!t || t.length > 40) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const officialHit = official.find((n) => t === n || t.includes(n));
    const modelHit = t.includes('模型') || t.includes('选择模型');
    if (!officialHit && !modelHit) continue;
    hits.push({
      text: t,
      official: officialHit || null,
      modelHit,
      testid: el.getAttribute('data-testid') || '',
      aria: el.getAttribute('aria-label') || '',
      tag: el.tagName,
    });
  }
  return hits.slice(0, 40);
})()`;

function currentDisplayed(hits, official) {
  if (!Array.isArray(hits)) return null;
  const exact = hits.find((h) => h.official === official && h.text === official);
  if (exact) return official;
  const includes = hits.find((h) => h.official === official);
  return includes ? official : null;
}

async function selectOfficialModel(send, evalJs, official) {
  const before = await evalJs(CURRENT_MODEL_JS);
  if (currentDisplayed(before, official)) {
    return { ok: true, model: official, already: true, hits: before };
  }

  const pickerExpr = `(() => {
    const official = ${JSON.stringify(OFFICIAL_MODELS)};
    const nodes = [...document.querySelectorAll('button, [role="button"], [role="combobox"], div, span')];
    const scored = [];
    for (const el of nodes) {
      const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 40) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      let score = 0;
      if (t === '选择模型' || t.includes('选择模型')) score += 5;
      if (t.includes('模型') && t.length <= 16) score += 3;
      if (official.some((n) => t === n || t.includes(n))) score += 2;
      if (el.getAttribute('data-testid') && /model/i.test(el.getAttribute('data-testid'))) score += 4;
      if (score > 0) scored.push({ score, t });
    }
    scored.sort((a, b) => b.score - a.score);
    if (!scored.length) return null;
    const want = scored[0].t;
    return [...document.querySelectorAll('button, [role="button"], [role="combobox"], div, span')].find((el) => {
      const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      const r = el.getBoundingClientRect();
      return t === want && r.width >= 8 && r.height >= 8;
    });
  })()`;

  const opened = await realClick(send, evalJs, pickerExpr);
  if (!opened.ok) {
    throw new Error("找不到豆包工作任务的「选择模型」入口，未发送任务：" + (opened.error || ""));
  }
  await sleep(600);

  const optionExpr = `(() => {
    const official = ${JSON.stringify(official)};
    const nodes = [...document.querySelectorAll('button, [role="option"], [role="menuitem"], li, div, span')];
    return nodes.find((el) => {
      const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      const r = el.getBoundingClientRect();
      return (t === official || t.startsWith(official)) && t.length <= 40 && r.width >= 8 && r.height >= 8;
    });
  })()`;
  const chosen = await realClick(send, evalJs, optionExpr);
  if (!chosen.ok) {
    throw new Error("已打开模型列表，但没有找到官方选项「" + official + "」，未发送任务");
  }
  await sleep(500);
  const after = await evalJs(CURRENT_MODEL_JS);
  if (!currentDisplayed(after, official)) {
    throw new Error("已点击「" + official + "」，但界面上没有确认为当前模型，未发送任务");
  }
  return { ok: true, model: official, already: false, hits: after };
}

const RUN_STATE_JS = `(() => {
  const ml = document.querySelector('[data-testid="message-list"]');
  const txt = ml ? (ml.innerText || '') : '';
  const secs = [...document.querySelectorAll('[data-testid="preamble-elapsed"]')];
  const lastSec = secs.length ? secs[secs.length - 1] : null;
  const elapsed = lastSec
    ? ((lastSec.querySelector('[data-testid="preamble-elapsed-timer"]')?.innerText || '').trim())
    : '';
  const nodes = [...document.querySelectorAll('div[class*="md-box-root"]')];
  const assistants = nodes.filter(n => !n.closest('[class*="justify-end"]'));
  const lastAssistant = assistants.length ? (assistants[assistants.length - 1].innerText || '').trim() : '';
  return {
    asking: /正在询问用户/.test(txt),
    running: /已处理/.test(elapsed),
    finished: /共用时/.test(elapsed),
    thinking: txt.includes('正在思考'),
    executing: /正在执行代码/.test(txt),
    elapsed,
    assistantCount: assistants.length,
    lastAssistant,
  };
})()`;

const FOCUS_JS = `(() => {
  const ed = document.querySelector('div.tiptap[contenteditable="true"]');
  if (!ed) return { ok: false, error: 'editor not found' };
  ed.focus();
  return { ok: true };
})()`;

async function waitForRun({ evalJs }, { marker, timeoutMs, baseline = 0 }) {
  const t0 = Date.now();
  let snapshot = null;
  const isNew = (s) => (s.assistantCount || 0) > baseline;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(3000);
    snapshot = await evalJs(RUN_STATE_JS);
    const busy = snapshot.running || snapshot.thinking || snapshot.executing;
    if (snapshot.asking && !busy) {
      return { status: "needs-user", snapshot, elapsedMs: Date.now() - t0 };
    }
    if (isNew(snapshot) && snapshot.lastAssistant.includes(marker) && !busy) {
      await sleep(2000);
      const confirm = await evalJs(RUN_STATE_JS);
      if (isNew(confirm) && confirm.lastAssistant.includes(marker) && !busy) {
        return { status: "done", snapshot: confirm, elapsedMs: Date.now() - t0 };
      }
      snapshot = confirm;
    }
  }
  return { status: "timeout", snapshot, elapsedMs: Date.now() - t0 };
}

function buildHandoffText({ project, task }) {
  const lines = [
    "【DSH 移交任务】",
    project ? `工作目录：${project}` : null,
    "",
    "任务：",
    task,
    "",
    "要求：",
    "1. 只在" + (project ? `上述目录（${project}）` : "指定的工作目录") + "内改动文件，不要触碰其他路径。",
    "2. 完成后用一句话总结你实际改动了哪些文件、做了什么。",
    "3. 如果无法完成，直接说明原因，不要假装完成。",
    "4. 遇到信息不足、数量对不上、选项不明确这类情况，按最合理的方式自行决定并说明你的依据，然后继续；",
    "   但涉及删除、覆盖、不可逆修改，或你无法确定会影响哪些文件时，必须停下来向调用方确认，不要自行决定。",
    "5. 全部工作结束后，在回复的最后一行单独输出这个标记（必须原样输出，不要加引号或解释）：",
    "HANDOFF-DONE",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export async function handoffWithModel({ project, task, model, timeoutMs = 900000 }) {
  if (!task) throw new Error("task text is required");
  if (project && !fs.existsSync(project)) throw new Error("project directory does not exist: " + project);
  const official = resolveOfficialDoubaoModel(model);
  if (!official) {
    throw new Error("已选模型「" + model + "」不是豆包工作任务的官方选项（自动 / 豆包 2.1 Lite / 豆包 2.1 Pro），未发送任务");
  }
  const text = buildHandoffText({ project, task });
  return withPage(async ({ page, send, evalJs }) => {
    const opened = await realClick(send, evalJs,
      `[...document.querySelectorAll('div[class*="sidebar_nav_item"]')].find(d => (d.innerText||'').replace(/\\s+/g,'').includes('新工作任务'))`);
    if (!opened.ok) throw new Error("无法打开「新工作任务」：" + (opened.error || ""));
    await sleep(2600);
    const selected = await selectOfficialModel(send, evalJs, official);
    const focus = await evalJs(FOCUS_JS);
    if (!focus.ok) throw new Error(focus.error || "editor not ready in task mode");
    const preRun = await evalJs(RUN_STATE_JS);
    await send("Input.insertText", { text });
    await sleep(600);
    const clicked = await realClick(send, evalJs, `document.querySelector('[data-testid="chat_input_send_button"]')`);
    if (!clicked.ok) throw new Error("send button not clickable");
    const r = await waitForRun({ evalJs }, { marker: "HANDOFF-DONE", timeoutMs, baseline: preRun.assistantCount || 0 });
    return {
      typed: true,
      model_requested: model,
      model_applied: official,
      model_already: !!selected.already,
      elapsedMs: r.elapsedMs,
      url: await evalJs("location.href"),
      completed: r.status === "done",
      needsUserInput: r.status === "needs-user",
      timedOut: r.status === "timeout",
      question: r.status === "needs-user" ? (r.snapshot.lastAssistant || "") : null,
      reply: (r.snapshot && r.snapshot.lastAssistant) || null,
    };
  });
}

const [cmd, ...rest] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith("doubao-work-task.mjs")) {
  if (cmd === "handoff") {
    const project = rest[0];
    const model = rest.at(-1);
    const task = rest.slice(1, -1).join(" ");
    handoffWithModel({ project, task, model })
      .then((out) => { console.log(JSON.stringify(out, null, 2)); })
      .catch((e) => { console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) }, null, 2)); process.exit(1); });
  }
}
