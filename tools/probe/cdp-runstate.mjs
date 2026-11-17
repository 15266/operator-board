// cdp-runstate.mjs — 用 doubao-work-task.mjs 里 RUN_STATE_JS 的原样表达式取状态，
// 看 waitForRun 的哪个条件卡住了（isNew / busy / marker）。
const port = process.argv[2] || "9225";

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

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
const page = list.find((t) => t.type === "page" && !/devtools/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m.result); } });
await new Promise((r) => ws.addEventListener("open", r));

const res = await send("Runtime.evaluate", { expression: RUN_STATE_JS, returnByValue: true, awaitPromise: true });
const s = res.result.value;
const busy = s.running || s.thinking || s.executing || s.loading || s.hasStop;
console.log("assistantCount :", s.assistantCount);
console.log("lastAssistant  :", s.lastAssistant.length, "chars, marker=", s.lastAssistant.includes("HANDOFF-DONE"));
console.log("elapsed        :", JSON.stringify(s.elapsed));
console.log("flags          : asking=%s running=%s finished=%s thinking=%s executing=%s loading=%s hasStop=%s",
  s.asking, s.running, s.finished, s.thinking, s.executing, s.loading, s.hasStop);
console.log("=> busy        :", busy, busy ? "<-- 卡在这个条件上" : "");
console.log("--- lastAssistant 末尾 200 ---");
console.log(s.lastAssistant.slice(-200));
ws.close();
process.exit(0);
