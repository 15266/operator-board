import test from "node:test";
import assert from "node:assert/strict";
import {
  looksComposerSent,
  resolveOfficialDoubaoModel,
  parseWorkTaskChatId,
  isSyncedWorkTaskUrl,
  isNewTaskLanding,
  hasRunStarted,
  chipShowsOfficial,
  canWatchWorkTaskSession,
  isWorkTaskMode,
  isLocalWorkTaskMode,
  waitForRun,
} from "./doubao-work-task.mjs";

const snap = (o) => ({ asking: false, running: false, finished: false, thinking: false, executing: false, elapsed: "", assistantCount: 9, lastAssistant: "", loading: false, hasStop: false, ...o });

test("waitForRun: a finished reply counts as progress even when assistantCount stays put", async () => {
  // Live state 2026-11-17: same bubble reused, marker present, "共用时 6 分 49 秒", busy=false.
  // The old isNew-only gate waited until the 15-minute timeout.
  const done = snap({ finished: true, elapsed: "共用时 6 分 49 秒", lastAssistant: "…写完了\nAKILI-R3-AUDSUP-1117\nHANDOFF-DONE" });
  let calls = 0;
  const r = await waitForRun({ evalJs: async () => { calls++; return done; } },
    { marker: "HANDOFF-DONE", timeoutMs: 5000, baseline: 9, baselineText: "旧回复", sleepMs: 1 });
  assert.equal(r.status, "done");
  assert.ok(calls >= 2, "must confirm with a second poll before declaring done");
});

test("waitForRun: the same reply we started with is not progress (no false done)", async () => {
  const stale = snap({ finished: true, elapsed: "共用时 6 分 49 秒", lastAssistant: "旧回复 HANDOFF-DONE" });
  const r = await waitForRun({ evalJs: async () => stale },
    { marker: "HANDOFF-DONE", timeoutMs: 60, baseline: 9, baselineText: "旧回复 HANDOFF-DONE", sleepMs: 1 });
  assert.equal(r.status, "timeout");
});

test("waitForRun: marker present but still busy is not done", async () => {
  const busy = snap({ hasStop: true, lastAssistant: "…HANDOFF-DONE", assistantCount: 10 });
  const r = await waitForRun({ evalJs: async () => busy },
    { marker: "HANDOFF-DONE", timeoutMs: 60, baseline: 9, baselineText: "旧回复", sleepMs: 1 });
  assert.equal(r.status, "timeout");
});

test("looksComposerSent: marker left the composer", () => {
  assert.equal(looksComposerSent({ hasMarker: true, len: 200 }, { hasMarker: false, len: 1 }), true);
});

test("looksComposerSent: long draft cleared even without marker field change", () => {
  assert.equal(looksComposerSent({ hasMarker: false, len: 80 }, { hasMarker: false, len: 0 }), true);
});

test("looksComposerSent: unchanged draft is not sent", () => {
  assert.equal(looksComposerSent({ hasMarker: true, len: 200 }, { hasMarker: true, len: 200 }), false);
});

test("resolveOfficialDoubaoModel keeps official names", () => {
  assert.equal(resolveOfficialDoubaoModel("自动"), "自动");
  assert.equal(resolveOfficialDoubaoModel("auto"), "自动");
  assert.equal(resolveOfficialDoubaoModel("豆包 2.1 Lite"), "豆包 2.1 Lite");
  assert.equal(resolveOfficialDoubaoModel("Kimi K3.1 Pro"), "Kimi K3.1 Pro");
  assert.equal(resolveOfficialDoubaoModel("kimi3pro"), "Kimi K3.1 Pro");
  assert.equal(resolveOfficialDoubaoModel("kimipro"), "Kimi K3.1 Pro");
  assert.equal(resolveOfficialDoubaoModel("Kimi Pro"), "Kimi K3.1 Pro");
  assert.equal(resolveOfficialDoubaoModel("kimipro高速"), "Kimi K3.1 Pro 高速");
  assert.equal(resolveOfficialDoubaoModel("Kimi K3.1 Pro 高速"), "Kimi K3.1 Pro 高速");
  assert.equal(resolveOfficialDoubaoModel("not-a-model"), null);
});

test("parseWorkTaskChatId distinguishes synced, local, and bare chat URLs", () => {
  assert.deepEqual(parseWorkTaskChatId("doubao://doubao-chat/chat/38454043499194882"), { kind: "synced", id: "38454043499194882" });
  assert.deepEqual(parseWorkTaskChatId("chrome://doubao-chat/chat/local_2481971921101292"), { kind: "local", id: "local_2481971921101292" });
  assert.deepEqual(parseWorkTaskChatId("doubao://doubao-chat/chat/local_2091181782381117"), { kind: "local", id: "local_2091181782381117" });
  assert.deepEqual(parseWorkTaskChatId("doubao://doubao-chat/chat"), { kind: "none", id: null });
  assert.deepEqual(parseWorkTaskChatId("doubao://doubao-launcher/chat?viewId=101"), { kind: "none", id: null });
  assert.equal(isSyncedWorkTaskUrl("doubao://doubao-chat/chat/38454043499194882"), true);
  assert.equal(isSyncedWorkTaskUrl("chrome://doubao-chat/chat/local_2481971921101292"), false);
  assert.equal(isSyncedWorkTaskUrl("doubao://doubao-chat/chat"), false);
  assert.equal(isNewTaskLanding("doubao://doubao-chat/chat"), true);
  assert.equal(isNewTaskLanding("chrome://doubao-chat/chat"), true);
  assert.equal(isNewTaskLanding("chrome://doubao-chat/chat/38454043499194882"), false);
  assert.equal(isNewTaskLanding("chrome://doubao-chat/chat/local_2481971921101292"), false);
});

test("hasRunStarted ignores loading-only hangs and treats thinking or new assistant text as started", () => {
  assert.equal(hasRunStarted({ loading: true, hasStop: true, assistantCount: 0, lastAssistant: "" }, 0), false);
  assert.equal(hasRunStarted({ thinking: true, assistantCount: 0, lastAssistant: "" }, 0), true);
  assert.equal(hasRunStarted({ running: true, elapsed: "已处理 00:12", assistantCount: 0 }, 0), true);
  assert.equal(hasRunStarted({ assistantCount: 1, lastAssistant: "开始写文档" }, 0), true);
  assert.equal(hasRunStarted({ assistantCount: 1, lastAssistant: "旧回复" }, 1), false);
});

test("chipShowsOfficial matches the model chip including thinking suffix, not a longer official name", () => {
  assert.equal(chipShowsOfficial("Kimi K3.1 Pro 中", "Kimi K3.1 Pro"), true);
  assert.equal(chipShowsOfficial("Kimi K3.1 Pro 0.95x", "Kimi K3.1 Pro"), true);
  assert.equal(chipShowsOfficial("Kimi K3.1 Pro 高速 中", "Kimi K3.1 Pro"), false);
  assert.equal(chipShowsOfficial("Kimi K3.1 Pro 高速 中", "Kimi K3.1 Pro 高速"), true);
  assert.equal(chipShowsOfficial("豆包 2.1 Lite 中", "Kimi K3.1 Pro"), false);
  assert.equal(chipShowsOfficial("GLM 5.3 Flash 0.08x", "GLM 5.3"), false);
  assert.equal(chipShowsOfficial("GLM 5.3 0.80x", "GLM 5.3"), true);
  assert.equal(chipShowsOfficial("DeepSeek V4.1 Flash 高", "DeepSeek V4.1 Flash"), true);
  assert.equal(chipShowsOfficial("DeepSeek V4.1 Flash\n高", "DeepSeek V4.1 Flash"), true);
  assert.equal(chipShowsOfficial("DeepSeek V4.1 Fla sh 高", "DeepSeek V4.1 Flash"), true);
  assert.equal(chipShowsOfficial("DeepSeek V4.1 Fla h\n高", "DeepSeek V4.1 Flash"), false);
  assert.equal(chipShowsOfficial("DeepSeek V4 Pro 高", "DeepSeek V4.1 Flash"), false);
});

test("canWatchWorkTaskSession accepts synced and local chats after send, not a bare landing", () => {  const local = parseWorkTaskChatId("chrome://doubao-chat/chat/local_2315524923311322");
  const synced = parseWorkTaskChatId("chrome://doubao-chat/chat/38454043499194882");
  const bare = parseWorkTaskChatId("chrome://doubao-chat/chat");
  assert.equal(local.kind, "local");
  assert.equal(canWatchWorkTaskSession(local), true);
  assert.equal(canWatchWorkTaskSession(synced), true);
  assert.equal(canWatchWorkTaskSession(bare), false);
  assert.equal(isNewTaskLanding("chrome://doubao-chat/chat/local_2315524923311322"), false);
});

test("composer mode: only 工作任务·本地电脑 counts as a work task that may skip the 新工作任务 click", () => {
  assert.equal(isWorkTaskMode("对话"), false);
  assert.equal(isWorkTaskMode("快速"), false);
  assert.equal(isLocalWorkTaskMode("对话"), false);
  assert.equal(isWorkTaskMode("工作任务 本地电脑"), true);
  assert.equal(isLocalWorkTaskMode("工作任务 本地电脑"), true);
  assert.equal(isWorkTaskMode("工作任务 云电脑"), true);
  assert.equal(isLocalWorkTaskMode("工作任务 云电脑"), false);
  assert.equal(isLocalWorkTaskMode("工作任务 SX007747"), false);
  // the exact post-restart state that used to be mistaken for a ready work task
  assert.equal(isLocalWorkTaskMode(""), false);
});
