import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRateLimits, readAccount, listSessions, handleCodexHttp } from "./codexMgr.mjs";

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codexmgr-"));
  const day = path.join(home, "sessions", "2026", "11", "16");
  fs.mkdirSync(day, { recursive: true });
  const id = "01a1e018-fbee-7c33-93ea-179e74d3b275";
  const lines = [
    { type: "session_meta", payload: { id, cwd: "D:\\x", source: "exec" } },
    { timestamp: "2026-11-15T16:47:00.000Z", type: "event_msg", payload: { type: "token_count", rate_limits: { limit_id: "codex", plan_type: "plus", primary: { used_percent: 26, window_minutes: 300, resets_at: 1794765270 }, secondary: { used_percent: 43, window_minutes: 10080, resets_at: 1794963702 }, credits: { has_credits: false, unlimited: false, balance: "0" } } } },
  ];
  fs.writeFileSync(path.join(day, `rollout-2026-11-16T00-44-56-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  fs.writeFileSync(path.join(home, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { id_token: "SECRET-ID", access_token: "SECRET-AT", refresh_token: "SECRET-RT", account_id: "acc" }, last_refresh: "2026-11-13T00:00:00Z" }));
  return { home, id };
}

test("rate limits come from latest token_count", () => {
  const { home } = fakeHome();
  const r = readRateLimits(home);
  assert.equal(r.ok, true);
  assert.equal(r.plan_type, "plus");
  assert.equal(r.primary.used_percent, 26);
  assert.equal(r.secondary.window_minutes, 10080);
  assert.equal(r.primary.resets_at, new Date(1794765270 * 1000).toISOString());
  assert.equal("balance" in r.credits, false);
});

test("account summary never leaks token values", () => {
  const { home } = fakeHome();
  const a = readAccount(home);
  assert.equal(a.auth_mode, "chatgpt");
  assert.deepEqual(a.token_fields, ["access_token", "account_id", "id_token", "refresh_token"]);
  assert.doesNotMatch(JSON.stringify(a), /SECRET/);
});

test("sessions fallback links dispatch by session id", async () => {
  const { home, id } = fakeHome();
  const r = await listSessions({ home, dispatches: [{ id: "d-1", state: "verified", evidence: { session_id: id } }] });
  assert.equal(r.sessions[0].id, id);
  assert.equal(r.sessions[0].dispatch.id, "d-1");
  assert.equal(r.sessions[0].thread_url, `codex://threads/${id}`);
});

test("router only claims /bridge/codex and is GET-only", async () => {
  let got = null; const send = (c, b) => { got = { c, b }; };
  assert.equal(await handleCodexHttp(new URL("http://x/bridge/kb"), "GET", send), false);
  assert.equal(await handleCodexHttp(new URL("http://x/bridge/codex/status"), "POST", send), true);
  assert.equal(got.c, 405);
});
