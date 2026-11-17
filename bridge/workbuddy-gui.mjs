// WorkBuddy visible-GUI adapter.
// Official deeplink verified from WorkBuddy's own parser (renderer/assets/deeplink-*.js):
//   workbuddy://task?action=start&prompt=...&cwd=...&model=...
// The app opens a new sidebar task (「新建任务」 / prepareInput target type "new"),
// not a hidden ACP session. Jobs API is still unsafe (EADDRINUSE vs GUI serve).
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TASK_PROMPT_MAX = 8000;
// CreateProcess command-line budget (~32k) minus exe path; official prompt cap is 8000 chars.
export const TASK_URL_MAX = 24000;

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
  // Use the registered URI handler without a shell or simulated keyboard input.
  return new Promise((resolve, reject) => {
    execFileFn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function adapterWorkBuddyGui(rec, cwd, { update, openUrl, exePath } = {}) {
  const model = typeof rec.model === "string" && rec.model.trim() ? rec.model.trim() : "";
  let built = buildWorkBuddyTaskUrl({ prompt: rec.prompt, cwd, model: model || undefined });
  let promptFile = null;
  if (built.tooLong || String(rec.prompt).trim().length > TASK_PROMPT_MAX) {
    promptFile = writePromptFile(rec.prompt, rec.id || rec.task_id);
    built = buildPromptFileTaskUrl(promptFile, { cwd, model: model || undefined });
    if (built.tooLong) throw new Error("即使改用提示词文件，WorkBuddy 任务链接仍然过长");
  }
  update?.(rec, {
    via: "workbuddy://task（桌面交接，需手动发送）",
    state: "running",
    evidence: {
      ...rec.evidence,
      cwd: cwd || null,
      model_requested: model || rec.evidence?.model_requested || null,
      model_applied: null,
      model_source: model ? "workbuddy://task?model=" : rec.evidence?.model_source || null,
      prompt_file: promptFile,
      deeplink: "workbuddy://task?action=start",
    },
  }, promptFile
    ? `指令较长，已写入临时文件并打开 WorkBuddy 可见任务：${promptFile}`
    : "正在打开 WorkBuddy 可见任务窗口");
  const open = openUrl || ((url) => openWorkBuddyUrl(url, { exePath }));
  await open(built.url);
  // Opening a URL is a handoff request, not proof of delivery or a model reply.
  update?.(rec, {
    reply: null,
    evidence: { ...rec.evidence, delivery_requested: true, delivered: false, auto_sent: false,
      user_action: "请在 WorkBuddy 窗口检查任务内容并手动发送；完成后将回复复制回操作台。当前不自动回读结果。" },
  }, "已请求打开 WorkBuddy；等待用户检查并发送，未确认任务完成");
  rec._guiDelivered = true;
  return true;
}
