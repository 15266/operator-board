// WorkBuddy visible-GUI adapter.
// Official deeplink verified from WorkBuddy's own parser (renderer/assets/deeplink-*.js):
//   workbuddy://task?action=start&prompt=...&cwd=...&model=...
// The app opens a new sidebar task (「新建任务」 / prepareInput target type "new"),
// not a hidden ACP session. Jobs API is still unsafe (EADDRINUSE vs GUI serve).
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TASK_PROMPT_MAX = 8000;
// CreateProcess command-line budget (~32k) minus exe path; official prompt cap is 8000 chars.
export const TASK_URL_MAX = 24000;
const SEND_SCRIPT = fileURLToPath(new URL("./workbuddy-gui-send.ps1", import.meta.url));

export function buildWorkBuddyTaskUrl({ prompt, cwd, model } = {}) {
  let text = String(prompt ?? "").trim();
  if (!text) throw new Error("派发内容为空，无法在 WorkBuddy 窗口新建任务");
  const warnings = [];
  if (text.length > TASK_PROMPT_MAX) {
    warnings.push(`prompt 超过 ${TASK_PROMPT_MAX} 字，已截断`);
    text = text.slice(0, TASK_PROMPT_MAX);
  }
  const params = new URLSearchParams();
  params.set("action", "start");
  params.set("prompt", text);
  if (cwd) params.set("cwd", String(cwd));
  if (model) params.set("model", String(model));
  const url = `workbuddy://task?${params.toString()}`;
  return { url, prompt: text, warnings, tooLong: url.length > TASK_URL_MAX };
}

export function writePromptFile(prompt, recId) {
  const dir = os.tmpdir();
  const safeId = String(recId || "task").replace(/[^\w.-]+/g, "_").slice(0, 40);
  const file = path.join(dir, `operator-board-wb-${safeId}.txt`);
  fs.writeFileSync(file, String(prompt), "utf8");
  return file;
}

export function buildPromptFileTaskUrl(promptPath, { cwd, model } = {}) {
  const prompt = `请完整读取并执行下面这个 UTF-8 文本文件里的全部指令：\n${promptPath}`;
  return buildWorkBuddyTaskUrl({ prompt, cwd, model });
}

function spawnDetached(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.unref();
    setTimeout(resolve, 400);
  });
}

export function resolveWorkBuddyExe(exePath) {
  if (exePath && fs.existsSync(exePath)) return exePath;
  const fallback = "D:\\workbuddy\\WorkBuddy.exe";
  return fs.existsSync(fallback) ? fallback : "";
}

export function openWorkBuddyUrl(url, { exePath, execFileFn = execFile } = {}) {
  if (process.platform !== "win32") {
    return new Promise((resolve, reject) => {
      execFileFn("xdg-open", [url], (err) => (err ? reject(err) : resolve()));
    });
  }
  const exe = resolveWorkBuddyExe(exePath);
  if (exe) return spawnDetached(exe, [url]);
  // Start-Process uses ShellExecute and can carry a longer URL than rundll32.
  return new Promise((resolve, reject) => {
    execFileFn("powershell.exe", ["-NoProfile", "-Command", "Start-Process", "-LiteralPath", url], { windowsHide: true }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function sendWorkBuddyComposer({ execFileFn = execFile, scriptPath = SEND_SCRIPT, timeoutMs = 20000 } = {}) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("自动发送目前只支持 Windows 上的 WorkBuddy 窗口"));
  }
  return new Promise((resolve, reject) => {
    execFileFn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
      const out = String(stdout || "").trim();
      if (err) {
        const e = new Error(out || String(stderr || err.message || err));
        e.code = err.code;
        e.stdout = out;
        reject(e);
        return;
      }
      resolve(out);
    });
  });
}

export async function adapterWorkBuddyGui(rec, cwd, { update, openUrl, sendComposer, exePath, prefillWaitMs = 5000 } = {}) {
  const model = typeof rec.model === "string" && rec.model.trim() ? rec.model.trim() : "";
  let built = buildWorkBuddyTaskUrl({ prompt: rec.prompt, cwd, model: model || undefined });
  let promptFile = null;
  if (built.tooLong) {
    promptFile = writePromptFile(rec.prompt, rec.id || rec.task_id);
    built = buildPromptFileTaskUrl(promptFile, { cwd, model: model || undefined });
    if (built.tooLong) throw new Error("即使改用提示词文件，WorkBuddy 任务链接仍然过长");
  }
  update?.(rec, {
    via: "workbuddy://task（可见窗口新建任务并自动发送）",
    state: "running",
    evidence: {
      ...rec.evidence,
      cwd: cwd || null,
      model_requested: model || rec.evidence?.model_requested || null,
      model_applied: model || null,
      model_source: model ? "workbuddy://task?model=" : rec.evidence?.model_source || null,
      prompt_file: promptFile,
      deeplink: "workbuddy://task?action=start",
    },
  }, promptFile
    ? `指令较长，已写入临时文件并打开 WorkBuddy 可见任务：${promptFile}`
    : "正在打开 WorkBuddy 可见任务窗口");
  const open = openUrl || ((url) => openWorkBuddyUrl(url, { exePath }));
  await open(built.url);
  const send = sendComposer || sendWorkBuddyComposer;
  let sent = false;
  let sendDetail = "";
  try {
    await new Promise((r) => setTimeout(r, prefillWaitMs));
    sendDetail = await send();
    sent = /SENT_ENTER/.test(String(sendDetail));
    update?.(rec, {}, sent ? "已在 WorkBuddy 窗口按下发送" : `自动发送未确认：${sendDetail || "无回执"}`);
  } catch (e) {
    sendDetail = String(e.message || e);
    update?.(rec, {}, "窗口已打开，但自动发送没有成功：" + sendDetail);
  }
  const reply = sent
    ? "已在 WorkBuddy 窗口新建可见任务，并已自动按下发送。请到左侧「任务」列表查看后续过程。操作台不会再跟踪窗口里的回复。"
    : "已在 WorkBuddy 窗口新建可见任务，指令已填入输入框，但没能自动点发送。请到窗口里直接发送。原因：" + (sendDetail || "未知");
  update?.(rec, {
    reply,
    evidence: { ...rec.evidence, delivered: true, prompt_file: promptFile, auto_sent: sent, send_detail: sendDetail || null },
  }, sent ? "已投递到 WorkBuddy 可见窗口并自动发送" : "已投递到 WorkBuddy 可见窗口，自动发送未完成");
  rec._guiDelivered = true;
  return true;
}
