import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TASK_PROMPT_MAX,
  TASK_URL_MAX,
  buildWorkBuddyTaskUrl,
  buildPromptFileTaskUrl,
  writePromptFile,
  adapterWorkBuddyGui,
} from "./workbuddy-gui.mjs";

test("builds a task start URL with prompt, cwd and model", () => {
  const { url, prompt, tooLong } = buildWorkBuddyTaskUrl({
    prompt: "hello task",
    cwd: "C:\\Users\\demo\\project",
    model: "glm-flash",
  });
  assert.equal(prompt, "hello task");
  assert.equal(tooLong, false);
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "workbuddy:");
  assert.equal(parsed.hostname, "task");
  assert.equal(parsed.searchParams.get("action"), "start");
  assert.equal(parsed.searchParams.get("prompt"), "hello task");
  assert.equal(parsed.searchParams.get("cwd"), "C:\\Users\\demo\\project");
  assert.equal(parsed.searchParams.get("model"), "glm-flash");
});

test("rejects an empty prompt", () => {
  assert.throws(() => buildWorkBuddyTaskUrl({ prompt: "  " }), /派发内容为空/);
});

test("truncates prompts over the official 8000-character cap", () => {
  const long = "字".repeat(TASK_PROMPT_MAX + 50);
  const built = buildWorkBuddyTaskUrl({ prompt: long });
  assert.equal(built.prompt.length, TASK_PROMPT_MAX);
  assert.match(built.warnings[0], /截断/);
});

test("marks oversized encoded URLs so the adapter can fall back to a file", () => {
  const built = buildWorkBuddyTaskUrl({ prompt: "测".repeat(7000), cwd: "C:\\work" });
  assert.equal(built.tooLong, built.url.length > TASK_URL_MAX);
  assert.ok(built.url.length > TASK_URL_MAX);
});

test("file fallback prompt stays short and still uses action=start", () => {
  const file = path.join(os.tmpdir(), "operator-board-wb-demo.txt");
  const built = buildPromptFileTaskUrl(file, { cwd: "C:\\work" });
  assert.equal(built.tooLong, false);
  const parsed = new URL(built.url);
  assert.equal(parsed.searchParams.get("action"), "start");
  assert.match(parsed.searchParams.get("prompt"), /UTF-8 文本文件/);
  assert.match(parsed.searchParams.get("prompt"), /operator-board-wb-demo\.txt/);
});

test("adapter opens the official task deeplink and records a visible delivery", async () => {
  const opened = [];
  const rec = { id: "d-test", prompt: "请在窗口里出现这条指令", model: "glm-flash", evidence: {} };
  const events = [];
  await adapterWorkBuddyGui(rec, "C:\\work\\operator-board", {
    update: (row, patch, event) => {
      Object.assign(row, patch);
      if (event) events.push(event);
    },
    openUrl: async (url) => { opened.push(url); },
    sendComposer: async () => "SENT_ENTER hwnd=1 pid=1",
    prefillWaitMs: 0,
  });
  assert.equal(opened.length, 1);
  const parsed = new URL(opened[0]);
  assert.equal(parsed.hostname, "task");
  assert.equal(parsed.searchParams.get("action"), "start");
  assert.equal(parsed.searchParams.get("prompt"), "请在窗口里出现这条指令");
  assert.equal(parsed.searchParams.get("cwd"), "C:\\work\\operator-board");
  assert.match(rec.via, /桌面交接/);
  assert.equal(rec.reply, null);
  assert.match(rec.evidence.user_action, /手动发送/);
  assert.equal(rec._guiDelivered, true);
  assert.equal(rec.evidence.delivered, false);
  assert.equal(rec.evidence.delivery_requested, true);
  assert.equal(rec.evidence.auto_sent, false);
  assert.equal(rec.evidence.model_applied, null);
});

test("a typical Chinese dispatch prompt is sent directly, not via a temp file", async () => {
  const opened = [];
  const rec = { id: "d-direct", prompt: "请在这个目录完成上传：\\nC:\\Users\\demo\\operator-board\\n" + "要求。".repeat(200), evidence: {} };
  await adapterWorkBuddyGui(rec, "C:\\work\\operator-board", {
    update: (row, patch) => Object.assign(row, patch),
    openUrl: async (url) => { opened.push(url); },
    sendComposer: async () => "SENT_ENTER hwnd=1 pid=1",
    prefillWaitMs: 0,
  });
  const parsed = new URL(opened[0]);
  assert.equal(parsed.searchParams.get("prompt"), rec.prompt);
  assert.equal(rec.evidence.prompt_file, null);
  assert.equal(rec.evidence.auto_sent, false);
});

test("adapter writes a temp file when the encoded URL would be too long", async () => {
  const opened = [];
  const rec = { id: "d-long", prompt: "任务内容" + "测".repeat(7000), evidence: {} };
  await adapterWorkBuddyGui(rec, "C:\\work", {
    update: (row, patch) => Object.assign(row, patch),
    openUrl: async (url) => { opened.push(url); },
    sendComposer: async () => "SENT_ENTER hwnd=1 pid=1",
    prefillWaitMs: 0,
  });
  const parsed = new URL(opened[0]);
  const prompt = parsed.searchParams.get("prompt");
  assert.match(prompt, /UTF-8 文本文件/);
  const file = rec.evidence.prompt_file;
  assert.ok(file && fs.existsSync(file));
  assert.ok(fs.readFileSync(file, "utf8").startsWith("任务内容"));
  fs.unlinkSync(file);
});

test("long ASCII prompts are preserved in file fallback instead of silently truncated", async()=>{
 const rec={id:'ascii-preserve',prompt:'A'.repeat(9000),evidence:{}};let openCount=0;
 await adapterWorkBuddyGui(rec,'C:\\work',{update:(row,patch)=>Object.assign(row,patch),openUrl:async()=>{openCount++;},sendComposer:async()=>{throw Error('must not send');}});
 assert.equal(openCount,1);assert.equal(fs.readFileSync(rec.evidence.prompt_file,'utf8'),rec.prompt);assert.equal(rec.reply,null);assert.equal(rec.evidence.delivered,false);fs.unlinkSync(rec.evidence.prompt_file);
});
test("handoff never invokes an automatic sender or claims a model response",async()=>{
 const rec={id:'manual-only',prompt:'test',evidence:{}};let sent=false;
 await adapterWorkBuddyGui(rec,'C:\\work',{update:(row,patch)=>Object.assign(row,patch),openUrl:async()=>{},sendComposer:async()=>{sent=true;}});
 assert.equal(sent,false);assert.equal(rec.reply,null);assert.equal(rec.evidence.model_applied,null);assert.equal(rec.evidence.auto_sent,false);assert.match(rec.evidence.user_action,/手动发送/);
});
test("opening errors propagate and never mark delivery",async()=>{
 const rec={id:'open-fails',prompt:'test',evidence:{}};
 await assert.rejects(adapterWorkBuddyGui(rec,'C:\\work',{update:(row,patch)=>Object.assign(row,patch),openUrl:async()=>{throw Error('fixture-open-failure');}}),/fixture-open-failure/);
 assert.notEqual(rec.evidence.delivered,true);assert.equal(rec._guiDelivered,undefined);
});
