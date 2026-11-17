import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { killTree, sanitizeCodexEnv } from "./procUtil.mjs";

const fakeChild = (pid = 4242) => { const c = { pid, exitCode: null, signalCode: null, killed: 0, kill() { this.killed++; } }; return c; };

test("non-windows keeps child.kill()", async () => {
  const c = fakeChild(); const r = await killTree(c, { platform: "linux" });
  assert.equal(r.method, "kill"); assert.equal(c.killed, 1);
});

test("windows: our child -> taskkill /PID /T /F", async () => {
  const c = fakeChild(); const calls = [];
  const execFile = (cmd, args, opts, cb) => { calls.push([cmd, args]); cb(null, ""); };
  const r = await killTree(c, { platform: "win32", parentPid: 100, execFile, queryParent: async () => 100 });
  assert.equal(r.method, "taskkill /T /F");
  assert.deepEqual(calls, [["taskkill.exe", ["/PID", "4242", "/T", "/F"]]]);
  assert.equal(c.killed, 0);
});

test("windows: pid re-check mismatch -> no taskkill, falls back to child.kill()", async () => {
  const c = fakeChild(); let ran = false;
  const r = await killTree(c, { platform: "win32", parentPid: 100, execFile: () => { ran = true; }, queryParent: async () => 999 });
  assert.equal(ran, false); assert.equal(r.method, "kill"); assert.equal(c.killed, 1);
});

test("windows: lookup failure falls back; exited child is left alone", async () => {
  const c = fakeChild();
  assert.equal((await killTree(c, { platform: "win32", queryParent: async () => null })).method, "kill");
  const done = fakeChild(); done.exitCode = 0;
  assert.equal((await killTree(done, { platform: "win32" })).method, "none"); assert.equal(done.killed, 0);
});

test("windows: taskkill error falls back to child.kill()", async () => {
  const c = fakeChild();
  const r = await killTree(c, { platform: "win32", parentPid: 1, queryParent: async () => 1, execFile: (a, b, o, cb) => cb(new Error("boom")) });
  assert.equal(r.method, "kill"); assert.equal(c.killed, 1);
});

test("sanitizeCodexEnv drops inherited CODEX_* and injected secrets, keeps CODEX_HOME and proxies", () => {
  const env = { PATH: "p", CODEX_HOME: "C:\\h", CODEX_THREAD_ID: "t", CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "x", CODEX_SANDBOX: "seatbelt", CODEX_SANDBOX_NETWORK_DISABLED: "1", CODEX_MAX: "30", codex_cmd: "c",
    HTTP_PROXY: "h", https_proxy: "h2", ALL_PROXY: "a", no_proxy: "n", WB_TOKEN: "s", CODEBUDDY_GATEWAY_PASSWORD: "s",
    OPENAI_API_KEY: "user-own", OLLAMA_API_KEY: "injected", _AUTH_SOURCE_OLLAMA_API_KEY: "user" };
  const out = sanitizeCodexEnv(env);
  assert.deepEqual(Object.keys(out).sort(), ["ALL_PROXY", "CODEX_HOME", "HTTP_PROXY", "OPENAI_API_KEY", "PATH", "https_proxy", "no_proxy"].sort());
  assert.equal(env.CODEX_THREAD_ID, "t", "input not mutated");
  const injected = sanitizeCodexEnv({ OPENAI_API_KEY: "for-lmstudio", _AUTH_SOURCE_OPENAI_API_KEY: "user" });
  assert.equal("OPENAI_API_KEY" in injected, false);
  assert.equal("CODEX_HOME" in sanitizeCodexEnv({ CODEX_HOME: "x" }, { keepCodexHome: false }), false);
});

test("windows integration: grandchild dies with the tree", { skip: process.platform !== "win32" }, async () => {
  const code = "const {spawn}=require('child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(g.pid);setInterval(()=>{},1000);";
  const child = spawn(process.execPath, ["-e", code], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  const gpid = await new Promise((res) => child.stdout.once("data", (d) => res(Number(String(d).trim()))));
  const alive = (pid) => { try { return execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" }).includes(String(pid)); } catch { return false; } };
  assert.equal(alive(gpid), true);
  const closed = new Promise((res) => child.once("close", res));
  const r = await killTree(child);
  await closed;
  await new Promise((res) => setTimeout(res, 500));
  assert.equal(r.method, "taskkill /T /F");
  assert.equal(alive(gpid), false, "grandchild should be gone");
});
