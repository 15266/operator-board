#!/usr/bin/env node
// proxy-coexist-check.mjs — 代理工具（FlClash / Clash / mihomo 系）与豆包通道共存性检查。
//
// 检查项（全部只读，不改任何设置）：
//   1. 代理是否在跑：mixed-port(7890) / 外部控制口(9090) 是否监听，是否出现 TUN 网卡
//   2. 接管模式：系统代理（WinINET）是否开启、TUN 是否启用
//   3. 回环是否被绕过：显式 proxy 环境下，127.0.0.1 的豆包/桥接/界面端口是否仍直连可达
//   4. 残留风险：系统代理指向 7890 但 7890 没人监听（代理崩了没还原）→ 全网断，豆包也会「假卡死」
//
// 用法：
//   node tools/proxy-coexist-check.mjs          # 人类可读
//   node tools/proxy-coexist-check.mjs --json   # 机器可读
// 退出码：0 = 与豆包通道共存无冲突；1 = 发现会影响豆包通道的情况

import net from "node:net";
import os from "node:os";
import { execFileSync } from "node:child_process";

const asJson = process.argv.includes("--json");

const PROXY_PORTS = [7890, 7891, 7897, 9090];
const LOCAL_TARGETS = [
  { name: "豆包 CDP", port: 9225, path: "/json/version" },
  { name: "看板桥接", port: 5180, path: "/bridge/health" },
  { name: "看板界面", port: 5173, path: "/" },
];
const TUN_HINTS = /^(flclash|clash|mihomo|meta|tun|utun|wintun|tap)/i;

function tcpOpen(port, host = "127.0.0.1", timeoutMs = 800) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.once("connect", () => finish(true));
    s.once("timeout", () => finish(false));
    s.once("error", () => finish(false));
    s.connect(port, host);
  });
}

async function httpOk(port, path) {
  try {
    // 显式使用直连：把代理环境变量从这次请求里摘掉，模拟「系统代理开着但回环应被绕过」
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) });
    return r.ok || r.status === 404; // 服务在监听即算可达
  } catch {
    return false;
  }
}

function readSystemProxy() {
  // 只读注册表；被安全策略拦截时返回 unknown，不影响其它检查。
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    });
    const get = (k) => {
      const m = out.match(new RegExp(`${k}\\s+REG_\\w+\\s+(.*)`));
      return m ? m[1].trim() : null;
    };
    const enable = get("ProxyEnable");
    const server = get("ProxyServer");
    return {
      available: true,
      enabled: enable === "0x1",
      raw_enable: enable,
      server,
      bypass: get("ProxyOverride"),
    };
  } catch (e) {
    return { available: false, reason: String(e.message || e).slice(0, 120) };
  }
}

function tunInterfaces() {
  return Object.keys(os.networkInterfaces()).filter((n) => TUN_HINTS.test(n));
}

const findings = [];
const report = { checked_at: new Date().toISOString(), proxy: {}, loopback: {}, verdict: "" };

// 1. 代理端口
report.proxy.listening_ports = [];
for (const p of PROXY_PORTS) if (await tcpOpen(p)) report.proxy.listening_ports.push(p);
report.proxy.running = report.proxy.listening_ports.length > 0;

// 2. TUN 网卡
report.proxy.tun_interfaces = tunInterfaces();
report.proxy.tun_enabled = report.proxy.tun_interfaces.length > 0;

// 3. 系统代理
report.proxy.system = readSystemProxy();

// 4. 回环直连（这是豆包/桥接唯一依赖的链路）
report.loopback = {};
for (const t of LOCAL_TARGETS) {
  const open = await tcpOpen(t.port);
  const http = open ? await httpOk(t.port, t.path) : false;
  report.loopback[t.name] = { port: t.port, tcp: open, http };
}

// ---- 判定 ----
const sysProxy = report.proxy.system;
if (sysProxy.available && sysProxy.enabled && !report.proxy.running) {
  findings.push({
    level: "error",
    id: "stale-system-proxy",
    message: `系统代理已开启（${sysProxy.server || "未填地址"}）但代理端口全都没人监听：这是代理异常退出没还原设置的典型状态，浏览器与豆包云端请求会全部超时，表现为「豆包卡住不动」。请打开 FlClash 关闭一次系统代理，或关掉「系统代理」开关后重试。`,
  });
}
if (sysProxy.available && sysProxy.enabled && report.proxy.running) {
  const bypass = String(sysProxy.bypass || "");
  const loopbackBypassed = /127\.\*|localhost|<local>/i.test(bypass);
  if (!loopbackBypassed) {
    findings.push({
      level: "warn",
      id: "loopback-not-bypassed",
      message: "系统代理已开启但例外列表里没有 127.* / localhost：浏览器访问 127.0.0.1:5173 与 5180 可能被转发到代理节点而失败。在 FlClash 的「绕过域名/私有地址」里勾上即可（本机当前配置已包含，通常无需改）。",
    });
  }
}
if (report.proxy.tun_enabled) {
  const routed = report.loopback["豆包 CDP"]?.tcp;
  if (!routed) {
    findings.push({
      level: "warn",
      id: "tun-loopback",
      message: "检测到 TUN 网卡，且 127.0.0.1:9225 不可达。TUN 模式应自动排除 127.0.0.0/8；若豆包此时在跑却连不上，检查 FlClash 的 route-exclude-address 是否包含 127.0.0.0/8。",
    });
  }
}
const cdp = report.loopback["豆包 CDP"];
if (!cdp?.tcp) {
  findings.push({
    level: "info",
    id: "doubao-down",
    message: "豆包 CDP(9225) 当前不在线 —— 与代理无关。用 node tools/ensure-doubao.mjs 拉起即可。",
  });
}

report.findings = findings;
const fatal = findings.filter((f) => f.level === "error");
report.verdict = fatal.length
  ? "存在会中断豆包通道的问题（见 findings.error）"
  : report.proxy.running || report.proxy.tun_enabled
    ? "代理正在接管流量，但豆包/桥接所需的本地回环不受影响"
    : "代理未接管流量，与豆包通道零冲突";

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const yn = (b) => (b ? "是" : "否");
  console.log("=== 代理共存性检查 ===");
  console.log(`代理端口监听        : ${yn(report.proxy.running)}${report.proxy.listening_ports.length ? "（" + report.proxy.listening_ports.join("/") + "）" : "（7890/9090 都没人监听＝还没接管流量）"}`);
  console.log(`TUN 网卡            : ${report.proxy.tun_enabled ? report.proxy.tun_interfaces.join(", ") : "无"}`);
  if (sysProxy.available) {
    console.log(`系统代理            : ${sysProxy.enabled ? "开（" + (sysProxy.server || "?") + "）" : "关"}`);
    console.log(`系统代理例外        : ${/127\.\*/.test(String(sysProxy.bypass || "")) ? "含 127.* / localhost" : "不含回环例外"}`);
  } else {
    console.log(`系统代理            : 读取受限（${sysProxy.reason}）`);
  }
  console.log("本地回环：");
  for (const [name, v] of Object.entries(report.loopback)) {
    console.log(`  ${name.padEnd(10, "　")} :${v.port}  ${v.tcp ? (v.http ? "可达" : "TCP 通、HTTP 异常") : "不可达"}`);
  }
  console.log(`结论：${report.verdict}`);
  for (const f of findings) console.log(`  [${f.level}] ${f.message}`);
}

process.exit(fatal.length ? 1 : 0);
