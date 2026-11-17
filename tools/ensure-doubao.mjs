#!/usr/bin/env node
// ensure-doubao.mjs — 保证豆包桌面版带 CDP 调试端口在跑（供桥接驱动「新工作任务」）。
//
// 为什么需要它：豆包每次重启都会丢掉 --remote-debugging-port，桥接就再也驱动不了它；
// 而在这里用 detached + unref 启动，父进程（start-board.ps1 / 终端）退出后豆包仍然存活。
// 注意：必须在「用户桌面进程」里启动（比如双击 start-board.ps1）。若从被作业对象托管的
// 沙箱/CI shell 里 spawn，进程会随命令结束被一并回收。
//
// 用法：
//   node tools/ensure-doubao.mjs            # 不在则启动，最多等 25s
//   node tools/ensure-doubao.mjs --check    # 只检查，不启动（退出码 0=在线 1=离线）
//   node tools/ensure-doubao.mjs --json     # 机器可读输出
//
// 退出码：0 = 在线（本来就活着或刚被拉起）；1 = 不在线（附原因）

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.DOUBAO_CDP_PORT || 9225);
const EXE =
  process.env.DOUBAO_EXE ||
  path.join(process.env.LOCALAPPDATA || "", "Doubao", "Application", "app", "Doubao.exe");
const ENDPOINT = `http://127.0.0.1:${PORT}`;

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const asJson = args.has("--json");

async function probe(timeoutMs = 1500) {
  try {
    const r = await fetch(`${ENDPOINT}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function say(obj) {
  if (asJson) console.log(JSON.stringify(obj, null, 2));
  else console.log(obj.message);
}

const pre = await probe();
if (pre) {
  say({ ok: true, already: true, endpoint: ENDPOINT, browser: pre.Browser, message: `豆包已在运行（CDP ${ENDPOINT}，${pre.Browser}）` });
  process.exit(0);
}

if (checkOnly) {
  say({ ok: false, already: false, endpoint: ENDPOINT, message: `豆包未运行（CDP ${ENDPOINT} 无响应）` });
  process.exit(1);
}

if (!fs.existsSync(EXE)) {
  say({ ok: false, endpoint: ENDPOINT, reason: "exe-missing", path: EXE, message: `找不到豆包主程序：${EXE}；请确认豆包已安装，或用 DOUBAO_EXE 指定路径` });
  process.exit(1);
}

const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
  detached: true,
  stdio: "ignore",
  windowsHide: false,
});
child.unref();

const deadline = Date.now() + 25000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 800));
  const v = await probe();
  if (v) {
    say({ ok: true, already: false, endpoint: ENDPOINT, pid: child.pid, browser: v.Browser, message: `已启动豆包（pid ${child.pid}，CDP ${ENDPOINT}，${v.Browser}）` });
    process.exit(0);
  }
}

say({ ok: false, endpoint: ENDPOINT, pid: child.pid, reason: "timeout", message: `启动 25s 后 CDP ${ENDPOINT} 仍无响应；可能被杀软/代理拦截，或有残留进程占着单实例锁` });
process.exit(1);
