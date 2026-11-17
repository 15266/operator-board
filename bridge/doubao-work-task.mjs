#!/usr/bin/env node
// Board-local Doubao「新工作任务」handoff with official model selection.
// Modeled on dsh-doubao-bridge's CDP driver (real pointer events, HANDOFF-DONE).
// Official work-task models: live picker labels only (verified on this desktop).
// Does not invent unofficial IDs. Used only when a model was requested.
// Send is confirmed by the composer actually clearing; click is retried, then Enter.

import fs from "node:fs";

const ENDPOINT = process.env.DOUBAO_CDP || "http://127.0.0.1:9225";
const CHAT_PAGE = "doubao-chat/chat";
const OFFICIAL_MODELS = [
  "自动",
  "豆包 2.1 Lite",
  "豆包 2.1 Pro",
  "DeepSeek V4.1 Flash",
  "Kimi K3.1 Pro",
  "Kimi K3.1 Pro 高速",
  "Kimi K3",
  "GLM 5.3",
  "GLM 5.3 Flash",
  "DeepSeek V4 Pro",
];
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

async function realClick(send, evalJs, expr, opts = {}) {
  const rect = await evalJs(`(() => {
    const el = ${expr};
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const x = Math.round(r.x + r.width / 2);
    const y = Math.round(r.y + r.height / 2);
    const top = document.elementFromPoint(x, y);
    const blocked = !!(top && top !== el && !el.contains(top) && !top.contains(el));
    return {
      x,
      y,
      blocked,
      topTag: top ? top.tagName : null,
      topText: top ? String(top.innerText || top.getAttribute("aria-label") || "").replace(/\\s+/g, " ").slice(0, 40) : null,
    };
  })()`);
  if (!rect) return { ok: false, error: "element not found or zero-size" };
  if (opts.requireTop && rect.blocked) {
    return { ok: false, error: "click blocked by overlay: " + (rect.topText || rect.topTag || "?"), at: rect, blocked: true };
  }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await sleep(40);
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
  if (key === "kimik3.1pro" || key === "kimi3.1pro" || key === "kimi3pro") return "Kimi K3.1 Pro";
  if (key === "kimik3.1pro高速" || key === "kimi3.1pro高速") return "Kimi K3.1 Pro 高速";
  if (key === "kimik3" || key === "kimi3") return "Kimi K3";
  if (key === "deepseekv4.1flash" || key === "deepseekv41flash") return "DeepSeek V4.1 Flash";
  if (key === "deepseekv4pro") return "DeepSeek V4 Pro";
  if (key === "glm5.3flash") return "GLM 5.3 Flash";
  if (key === "glm5.3") return "GLM 5.3";
  return null;
}

export function looksComposerSent(before, after) {
  if (!before || !after) return false;
  if (before.hasMarker && !after.hasMarker) return true;
  if (before.len > 20 && after.len < 8) return true;
  return false;
}

export function parseWorkTaskChatId(url) {
  const s = String(url || "");
  const m = s.match(/doubao-chat\/chat\/([^/?#]+)/i);
  if (!m) return { kind: "none", id: null };
  const id = decodeURIComponent(m[1]);
  if (id.startsWith("local_")) return { kind: "local", id };
  if (/^\d+$/.test(id)) return { kind: "synced", id };
  return { kind: "other", id };
}

export function isSyncedWorkTaskUrl(url) {
  return parseWorkTaskChatId(url).kind === "synced";
}

export function canWatchWorkTaskSession(parsed) {
  return !!(parsed && (parsed.kind === "synced" || parsed.kind === "local"));
}

export function hasRunStarted(snapshot, baseline = 0) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if ((snapshot.assistantCount || 0) > baseline) return true;
  if (snapshot.thinking || snapshot.executing || snapshot.running || snapshot.finished) return true;
  const elapsed = String(snapshot.elapsed || "");
  if (elapsed && (/已处理/.test(elapsed) || /共用时/.test(elapsed))) return true;
  return false;
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

function longerOfficialNames(official) {
  return OFFICIAL_MODELS.filter((n) => n !== official && n.startsWith(official));
}

function compactOfficialText(s) {
  return String(s || "").replace(/\s+/g, "");
}

function textMatchesOfficial(t, official) {
  if (!t || !official) return false;
  const spaced = String(t).replace(/\s+/g, " ").trim();
  const ct = compactOfficialText(t);
  const co = compactOfficialText(official);
  if (!(ct.startsWith(co) || spaced === official || spaced.startsWith(official))) return false;
  return !longerOfficialNames(official).some((n) => {
    const cn = compactOfficialText(n);
    return ct.startsWith(cn) || spaced === n || spaced.startsWith(n);
  });
}

export function chipShowsOfficial(chipText, official) {
  const t = String(chipText || "").replace(/\s+/g, " ").trim();
  return textMatchesOfficial(t, official) || textMatchesOfficial(String(chipText || ""), official);
}

function currentDisplayed(hits, official) {
  if (!Array.isArray(hits)) return null;
  const exact = hits.find((h) => h.official === official && h.text === official);
  if (exact) return official;
  const includes = hits.find((h) => h.official === official && textMatchesOfficial(h.text, official));
  return includes ? official : null;
}

async function readModelChip(evalJs) {
  return evalJs(`(() => {
    const el = document.querySelector('[data-testid="chat_input_action_model"]');
    if (!el) return { ok: false, text: "" };
    const r = el.getBoundingClientRect();
    const inner = (el.innerText || "").replace(/\s+/g, " ").trim();
    const content = (el.textContent || "").replace(/\s+/g, " ").trim();
    return {
      ok: r.width >= 8 && r.height >= 8,
      text: content || inner,
      inner,
      content,
    };
  })()`);
}

async function selectOfficialModel(send, evalJs, official) {
  const t0 = Date.now();
  let chip = { ok: false, text: "" };
  while (Date.now() - t0 < 8000) {
    chip = await readModelChip(evalJs);
    if (chip && chip.ok) break;
    await sleep(250);
  }
  if (!(chip && chip.ok)) {
    throw new Error("找不到豆包工作任务的模型选择按钮，未发送任务");
  }
  if (chipShowsOfficial(chip.text, official)) {
    return { ok: true, model: official, already: true, chip: chip.text };
  }

  const opened = await realClick(send, evalJs, `document.querySelector('[data-testid="chat_input_action_model"]')`);
  if (!opened.ok) {
    throw new Error("找不到豆包工作任务的「选择模型」入口，未发送任务：" + (opened.error || ""));
  }
  await sleep(700);

  const optionExpr = "(() => {\n" +
    "    const official = " + JSON.stringify(official) + ";\n" +
    "    const all = " + JSON.stringify(OFFICIAL_MODELS) + ";\n" +
    "    const longer = all.filter((n) => n !== official && n.startsWith(official));\n" +
    "    const compact = (s) => String(s || '').replace(/\\s+/g, '');\n" +
    "    const match = (t) => {\n" +
    "      const ct = compact(t), co = compact(official);\n" +
    "      if (!(t === official || t.startsWith(official) || ct.startsWith(co))) return false;\n" +
    "      return !longer.some((n) => t === n || t.startsWith(n) || ct.startsWith(compact(n)));\n" +
    "    };\n" +
    "    const items = [...document.querySelectorAll('[role=\"menuitem\"]')].filter((el) => {\n" +
    "      const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();\n" +
    "      const r = el.getBoundingClientRect();\n" +
    "      return match(t) && r.width >= 8 && r.height >= 8;\n" +
    "    });\n" +
    "    return items[0] || null;\n" +
    "  })()";
  const chosen = await realClick(send, evalJs, optionExpr);
  if (!chosen.ok) {
    throw new Error("已打开模型列表，但没有找到官方选项「" + official + "」，未发送任务");
  }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    chip = await readModelChip(evalJs);
    if (chip && chip.ok && chipShowsOfficial(chip.text, official)) {
      return { ok: true, model: official, already: false, chip: chip.text };
    }
    await sleep(200);
  }
  throw new Error("已点击「" + official + "」，但模型芯片仍显示「" + ((chip && chip.text) || "未知") + "」，未发送任务");
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
    loading: !!document.querySelector('[data-testid="message_loading"]'),
    hasStop: !!document.querySelector('[data-testid="chat_input_local_break_button"]'),
  };
})()`;

const FOCUS_JS = `(() => {
  const ed = document.querySelector('div.tiptap[contenteditable="true"]');
  if (!ed) return { ok: false, error: 'editor not found' };
  ed.focus();
  return { ok: true };
})()`;

const COMPOSER_JS = `(() => {
  const ed = document.querySelector('div.tiptap[contenteditable="true"]');
  const text = ed ? (ed.innerText || '') : '';
  const btn = document.querySelector('[data-testid="chat_input_send_button"]');
  const r = btn ? btn.getBoundingClientRect() : null;
  return {
    editorOk: !!ed,
    hasMarker: text.includes('HANDOFF-DONE'),
    len: text.replace(/\\s+/g, '').length,
    sendExists: !!btn,
    sendDisabled: btn ? !!(btn.disabled || btn.getAttribute('aria-disabled') === 'true') : true,
    sendVisible: !!(r && r.width > 0 && r.height > 0),
  };
})()`;

async function pressKey(send, key, opts = {}) {
  const table = {
    Enter: { code: "Enter", windowsVirtualKeyCode: 13 },
    Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  };
  const spec = table[key] || { code: key, windowsVirtualKeyCode: 0 };
  const modifiers = opts.ctrl ? 2 : 0;
  const payload = {
    type: "keyDown",
    key,
    code: spec.code,
    windowsVirtualKeyCode: spec.windowsVirtualKeyCode,
    nativeVirtualKeyCode: spec.windowsVirtualKeyCode,
    modifiers,
  };
  await send("Input.dispatchKeyEvent", payload);
  await send("Input.dispatchKeyEvent", { ...payload, type: "keyUp" });
}

async function pressShortcut(send, { key, code, vk, ctrl = false }) {
  const modifiers = ctrl ? 2 : 0;
  if (ctrl) {
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17,
      modifiers: 2,
    });
  }
  const payload = {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    modifiers,
  };
  await send("Input.dispatchKeyEvent", payload);
  await send("Input.dispatchKeyEvent", { ...payload, type: "keyUp" });
  if (ctrl) {
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      nativeVirtualKeyCode: 17,
      modifiers: 0,
    });
  }
}

const MODE_JS = `(() => {
  const el = document.querySelector('[data-testid="chat_input_action_mode"]');
  return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
})()`;

// 对话 / 工作任务·本地电脑 / 工作任务·云电脑 / 工作任务·<设备名>
export function isWorkTaskMode(modeText) {
  return /工作/.test(String(modeText || ""));
}

export function isLocalWorkTaskMode(modeText) {
  return /本地电脑/.test(String(modeText || ""));
}

// The board can only write to this machine, so a 云电脑 / 设备 task would be a
// silent no-op. Switch the composer back to 本地电脑 instead of failing quietly.
async function ensureLocalWorkTaskMode(send, evalJs) {
  let mode = await evalJs(MODE_JS);
  if (isLocalWorkTaskMode(mode)) return { ok: true, mode, switched: false };
  const opened = await realClick(send, evalJs, `document.querySelector('[data-testid="chat_input_action_mode"]')`);
  if (!opened.ok) {
    throw new Error("找不到「对话 / 工作任务」模式入口（当前模式：" + (mode || "未知") + "），未发送任务");
  }
  await sleep(700);
  const picked = await realClick(send, evalJs, `(() => {
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    return items.find((el) => (el.innerText || '').replace(/\\s+/g, '').includes('本地电脑')) || null;
  })()`);
  if (!picked.ok) {
    await pressKey(send, "Escape");
    throw new Error("当前模式不是「本地电脑」（" + (mode || "未知") + "），且列表里没有「本地电脑」可切换，未发送任务");
  }
  await sleep(1000);
  mode = await evalJs(MODE_JS);
  if (!isLocalWorkTaskMode(mode)) {
    throw new Error("已尝试切到「本地电脑」，但模式仍是「" + (mode || "未知") + "」，未发送任务");
  }
  return { ok: true, mode, switched: true };
}

async function waitForNewTaskLanding(evalJs, { timeoutMs = 8000, intervalMs = 200 } = {}) {  const t0 = Date.now();
  let url = await evalJs("location.href");
  let composer = null;
  while (Date.now() - t0 < timeoutMs) {
    url = await evalJs("location.href");
    composer = await evalJs(COMPOSER_JS);
    if (isNewTaskLanding(url) && composer && composer.editorOk) {
      return { ok: true, url, composer, elapsedMs: Date.now() - t0 };
    }
    await sleep(intervalMs);
  }
  return { ok: false, url, composer, elapsedMs: Date.now() - t0 };
}

async function openNewWorkTask(send, evalJs) {
  const here = await evalJs("location.href");
  const preComposer = await evalJs(COMPOSER_JS);
  const mode0 = await evalJs(MODE_JS);
  const blank = isNewTaskLanding(here) && preComposer && preComposer.editorOk && !(preComposer.len > 0);
  // A blank chat URL is NOT enough: after a restart Doubao lands on 对话 with the
  // 快速 chip, whose model list has none of the work-task models. Only an already
  // open 本地电脑 work task may skip the 新工作任务 click.
  if (blank && isLocalWorkTaskMode(mode0)) {
    return { already: true, via: "already", url: here, mode: mode0 };
  }
  if (blank && isWorkTaskMode(mode0)) {
    const m = await ensureLocalWorkTaskMode(send, evalJs);
    return { already: true, via: "local-mode", url: here, mode: m.mode };
  }
  let opened = await realClick(send, evalJs, `document.querySelector('[data-testid="create_office_task_button"]')`);
  if (!opened.ok) {
    opened = await realClick(send, evalJs,
      `[...document.querySelectorAll('div[class*="sidebar_nav_item"]')].find(d => (d.innerText||'').replace(/\\s+/g,'').includes('新工作任务'))`);
  }
  let landed = await waitForNewTaskLanding(evalJs, { timeoutMs: 4000 });
  if (landed.ok) return { already: false, via: "click", url: landed.url, mode: await localModeAfterOpen(send, evalJs) };
  await pressShortcut(send, { key: "n", code: "KeyN", vk: 78, ctrl: true });
  landed = await waitForNewTaskLanding(evalJs, { timeoutMs: 4000 });
  if (landed.ok) return { already: false, via: "ctrl-n", url: landed.url, mode: await localModeAfterOpen(send, evalJs) };
  const target = String(here || "").startsWith("doubao://") ? "doubao://doubao-chat/chat" : "chrome://doubao-chat/chat";
  try { await send("Page.navigate", { url: target }); } catch {}
  landed = await waitForNewTaskLanding(evalJs, { timeoutMs: 6000 });
  if (landed.ok) return { already: false, via: "navigate", url: landed.url, mode: await localModeAfterOpen(send, evalJs) };
  throw new Error("无法打开空白的「新工作任务」页（当前地址 " + (landed.url || here) + "），未发送任务");
}

async function localModeAfterOpen(send, evalJs) {
  const m = await ensureLocalWorkTaskMode(send, evalJs);
  return m.mode;
}

async function dismissOverlays(send, evalJs) {
  await pressKey(send, "Escape");
  await sleep(250);
  await evalJs(FOCUS_JS);
}

async function submitComposer(send, evalJs) {
  const before = await evalJs(COMPOSER_JS);
  if (!before.editorOk) throw new Error("发送前找不到输入框");
  if (!before.hasMarker && before.len < 8) throw new Error("输入框里没有任务文本，未发送");

  try { await send("Page.bringToFront"); } catch {}
  await evalJs(FOCUS_JS);

  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const s = await evalJs(COMPOSER_JS);
    if (s.sendExists && s.sendVisible && !s.sendDisabled) break;
    await sleep(200);
  }
  const ready = await evalJs(COMPOSER_JS);
  if (!(ready.sendExists && ready.sendVisible && !ready.sendDisabled)) {
    throw new Error("任务文本已进入输入框，但发送按钮仍不可用，未发送");
  }

  const attempts = [];
  for (let i = 0; i < 3; i++) {
    if (i === 1) {
      await dismissOverlays(send, evalJs);
      await sleep(200);
    }
    const clicked = await realClick(send, evalJs, `document.querySelector('[data-testid="chat_input_send_button"]')`, { requireTop: i > 0 });
    attempts.push({ method: "click", i, ok: clicked.ok, error: clicked.error || null, blocked: !!clicked.blocked });
    await sleep(800);
    const after = await evalJs(COMPOSER_JS);
    if (looksComposerSent(before, after)) return { ok: true, via: "click", attempts, after };
  }

  await evalJs(FOCUS_JS);
  await sleep(150);
  await pressKey(send, "Enter");
  await sleep(800);
  let after = await evalJs(COMPOSER_JS);
  if (looksComposerSent(before, after)) return { ok: true, via: "enter", attempts, after };

  await evalJs(FOCUS_JS);
  await pressKey(send, "Enter", { ctrl: true });
  await sleep(800);
  after = await evalJs(COMPOSER_JS);
  if (looksComposerSent(before, after)) return { ok: true, via: "ctrl-enter", attempts, after };

  throw new Error("任务已写入输入框，但发送未生效（点击发送和回车都没发出去）");
}

export function isNewTaskLanding(url) {
  return parseWorkTaskChatId(url).kind === "none" && /doubao-chat\/chat\/?$/i.test(String(url || "").split("?")[0]);
}

async function waitForSyncedWorkTask(evalJs, { timeoutMs = 45000, intervalMs = 400 } = {}) {
  const t0 = Date.now();
  let url = await evalJs("location.href");
  let parsed = parseWorkTaskChatId(url);
  while (Date.now() - t0 < timeoutMs) {
    url = await evalJs("location.href");
    parsed = parseWorkTaskChatId(url);
    if (parsed.kind === "synced") {
      return { ok: true, url, chatId: parsed.id, kind: parsed.kind, elapsedMs: Date.now() - t0 };
    }
    try {
      const snap = await evalJs(RUN_STATE_JS);
      if (hasRunStarted(snap, snap.assistantCount || 0) || snap.thinking || snap.executing || snap.running) {
        return { ok: true, url, chatId: parsed.id, kind: parsed.kind, elapsedMs: Date.now() - t0, early: true };
      }
    } catch {}
    await sleep(intervalMs);
  }
  url = await evalJs("location.href");
  parsed = parseWorkTaskChatId(url);
  // A successful send often lands on a local_ chat first. Keep watching that
  // session in waitForRun instead of aborting and clicking stop.
  if (canWatchWorkTaskSession(parsed)) {
    return { ok: true, url, chatId: parsed.id, kind: parsed.kind, elapsedMs: Date.now() - t0, unsynced: parsed.kind !== "synced" };
  }
  throw new Error("任务已发送，但没有出现会话号（当前地址 " + url + "），已停止等待");
}

async function fillComposer(send, evalJs, text) {
  const editorExpr = `document.querySelector('div.tiptap[contenteditable="true"]')`;
  const clicked = await realClick(send, evalJs, editorExpr);
  if (!clicked.ok) throw new Error("无法点到输入框：" + (clicked.error || ""));
  await sleep(150);
  const leftover = await evalJs(COMPOSER_JS);
  if (leftover.len > 0) {
    await evalJs(`(() => {
      const ed = document.querySelector('div.tiptap[contenteditable="true"]');
      if (!ed) return false;
      ed.focus();
      document.execCommand("selectAll");
      document.execCommand("delete");
      return true;
    })()`);
    await sleep(150);
  }
  const inserted = await evalJs("(() => {\n" +
    "    const ed = document.querySelector('div.tiptap[contenteditable=\"true\"]');\n" +
    "    if (!ed) return { ok: false, error: 'editor not found' };\n" +
    "    ed.focus();\n" +
    "    const ok = document.execCommand('insertText', false, " + JSON.stringify(text) + ");\n" +
    "    return { ok, method: 'execCommand' };\n" +
    "  })()");
  await sleep(300);
  let typed = await evalJs(COMPOSER_JS);
  if (!typed.hasMarker) {
    await realClick(send, evalJs, editorExpr);
    await sleep(100);
    await send("Input.insertText", { text });
    await sleep(400);
    typed = await evalJs(COMPOSER_JS);
    if (!typed.hasMarker) throw new Error("任务文本没有进入输入框，未发送");
  }
  const deadline = Date.now() + 8000;
  let ready = null;
  while (Date.now() < deadline) {
    typed = await evalJs(COMPOSER_JS);
    if (typed.hasMarker && typed.sendExists && typed.sendVisible && !typed.sendDisabled) {
      await sleep(400);
      const confirm = await evalJs(COMPOSER_JS);
      if (confirm.hasMarker && confirm.sendExists && confirm.sendVisible && !confirm.sendDisabled) {
        ready = confirm;
        break;
      }
    }
    await sleep(200);
  }
  if (!ready) throw new Error("任务文本已进入输入框，但发送按钮仍不可用，未发送");
  return ready;
}

async function waitForComposerReady(evalJs, { timeoutMs = 8000, intervalMs = 250 } = {}) {
  const t0 = Date.now();
  let focus = { ok: false };
  while (Date.now() - t0 < timeoutMs) {
    focus = await evalJs(FOCUS_JS);
    if (focus && focus.ok) return focus;
    await sleep(intervalMs);
  }
  throw new Error((focus && focus.error) || "新工作任务页的输入框没有就绪，未发送任务");
}

export async function waitForRun({ evalJs }, { marker, timeoutMs, baseline = 0, baselineText = "", firstTokenMs = 150000, sleepMs = 3000 }) {
  const t0 = Date.now();
  let snapshot = null;
  const isNew = (s) => (s.assistantCount || 0) > baseline;
  // A finished task can leave assistantCount unchanged (the work-task view reuses its reply node),
  // so requiring a higher count alone hangs a run that already printed the marker: measured
  // 2026-11-17, busy=false + marker present + "共用时 6 分 49 秒" for many minutes, killed at 15 min.
  // Treat "the last reply is no longer the one we started with" as progress too.
  const advanced = (s) => isNew(s) || !!(s.lastAssistant && s.lastAssistant !== baselineText);
  let polls = 0;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(sleepMs);
    snapshot = await evalJs(RUN_STATE_JS);
    const busy = snapshot.running || snapshot.thinking || snapshot.executing || snapshot.loading || snapshot.hasStop;
    if (++polls % 5 === 0) {
      // Leave a trace in stderr: the bridge surfaces it if this run times out.
      process.stderr.write(`[handoff] poll=${polls} count=${snapshot.assistantCount}/${baseline} marker=${snapshot.lastAssistant.includes(marker)} busy=${busy} elapsed="${snapshot.elapsed}"\n`);
    }
    if (snapshot.asking && !busy) {
      return { status: "needs-user", snapshot, elapsedMs: Date.now() - t0 };
    }
    if (advanced(snapshot) && snapshot.lastAssistant.includes(marker) && !busy) {
      await sleep(Math.min(2000, sleepMs));
      const confirm = await evalJs(RUN_STATE_JS);
      const confirmBusy = confirm.running || confirm.thinking || confirm.executing || confirm.loading || confirm.hasStop;
      if (advanced(confirm) && confirm.lastAssistant.includes(marker) && !confirmBusy) {
        return { status: "done", snapshot: confirm, elapsedMs: Date.now() - t0 };
      }
      snapshot = confirm;
    }
    if (!hasRunStarted(snapshot, baseline) && (Date.now() - t0) >= firstTokenMs) {
      return { status: "no-first-token", snapshot, elapsedMs: Date.now() - t0 };
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
    throw new Error("已选模型「" + model + "」不是当前豆包工作任务模型列表中的选项，未发送任务");
  }
  const text = buildHandoffText({ project, task });
  return withPage(async ({ page, send, evalJs }) => {
    try { await send("Page.bringToFront"); } catch {}
    await openNewWorkTask(send, evalJs);
    await waitForComposerReady(evalJs);
    const selected = await selectOfficialModel(send, evalJs, official);
    const preRun = await evalJs(RUN_STATE_JS);
    await fillComposer(send, evalJs, text);
    const submitted = await submitComposer(send, evalJs);
    let synced;
    try {
      synced = await waitForSyncedWorkTask(evalJs, { timeoutMs: 45000 });
    } catch (err) {
      try {
        await realClick(send, evalJs, `document.querySelector('[data-testid="chat_input_local_break_button"]')`);
      } catch {}
      throw err;
    }
    const r = await waitForRun({ evalJs }, { marker: "HANDOFF-DONE", timeoutMs, baseline: preRun.assistantCount || 0, baselineText: preRun.lastAssistant || "" });
    const url = await evalJs("location.href");
    const chat = parseWorkTaskChatId(url);
    if (r.status === "no-first-token") {
      try {
        await realClick(send, evalJs, `document.querySelector('[data-testid="chat_input_local_break_button"]')`);
      } catch {}
      throw new Error("任务已发送，但豆包在限定时间内没有开始生成回复（当前会话 " + url + "），未继续等待");
    }
    return {
      typed: true,
      sent_via: submitted.via,
      model_requested: model,
      model_applied: official,
      model_already: !!selected.already,
      elapsedMs: r.elapsedMs,
      url,
      chat_id: chat.id,
      chat_kind: chat.kind,
      synced_chat: synced.chatId,
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
