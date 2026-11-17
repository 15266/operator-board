// cdp-snapshot.mjs — 只读快照：豆包页面当前在生成？停住？标记出现了吗？
// 用法: node probe/cdp-snapshot.mjs [9225]
const port = process.argv[2] || "9225";

const EXPR = `(() => {
  const q = (s) => document.querySelector(s);
  const nodes = [...document.querySelectorAll('div[class*="md-box-root"]')];
  const last = nodes[nodes.length - 1];
  const text = last ? (last.innerText || "") : "";
  return JSON.stringify({
    url: location.href,
    hasStop: !!q('[data-testid="chat_input_local_break_button"]'),
    loading: !!q('[data-testid="message_loading"]'),
    assistantBubbles: nodes.length,
    markerInLast: text.includes("HANDOFF-DONE"),
    lastLen: text.length,
    lastTail: text.slice(-260),
  });
})()`;

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
const pages = list.filter((t) => t.type === "page" && !/devtools/.test(t.url));
if (!pages.length) { console.log("没有可用的页面"); process.exit(1); }
const page = pages[0];
console.log("page:", page.url.slice(0, 90));

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
});

await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });

const r = await send("Runtime.evaluate", { expression: EXPR, returnByValue: true, awaitPromise: true });
const raw = r.result?.value;
try {
  const o = JSON.parse(raw);
  console.log("url          :", o.url);
  console.log("hasStop      :", o.hasStop, "(true=仍在生成)");
  console.log("loading      :", o.loading);
  console.log("assistantBubbles:", o.assistantBubbles);
  console.log("markerInLast :", o.markerInLast);
  console.log("lastLen      :", o.lastLen);
  console.log("--- 末尾 260 字 ---");
  console.log(o.lastTail);
} catch {
  console.log("原始返回:", String(raw).slice(0, 500));
}
ws.close();
process.exit(0);
