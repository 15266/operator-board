import assert from "node:assert/strict";
import { findModelOption, resolveModelValue } from "./modelResolve.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const liveCatalogPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "work",
  "wb-live-models.json",
);

const live = JSON.parse(readFileSync(liveCatalogPath, "utf8"));
assert.equal(live.ok, true);
assert.equal(live.source, "acp session/new configOptions");

const liveOption = {
  id: "model",
  category: "model",
  currentValue: live.current,
  options: live.models,
};

assert.equal(findModelOption([liveOption]).id, "model");

// Official id and official name from the live ACP catalog.
assert.equal(resolveModelValue(liveOption, "deepseek-v4.1-flash"), "deepseek-v4.1-flash");
assert.equal(resolveModelValue(liveOption, "DeepSeek-V4.1-Flash"), "deepseek-v4.1-flash");

// Unofficial UI / published-docs label: only maps because the official entry is present.
assert.equal(resolveModelValue(liveOption, "Deepseek-V4-Flash"), "deepseek-v4.1-flash");
assert.equal(resolveModelValue(liveOption, "deepseek-v4-flash"), "deepseek-v4.1-flash");
assert.equal(resolveModelValue(liveOption, "Deepseek V4 Flash"), "deepseek-v4.1-flash");

// Normalized exact equality still works for labels that already match an official name/id.
assert.equal(resolveModelValue(liveOption, "DeepSeek V4.1 Flash"), "deepseek-v4.1-flash");
assert.equal(resolveModelValue(liveOption, "Deepseek-V4-Pro"), "deepseek-v4-pro");
assert.equal(resolveModelValue(liveOption, "Auto"), "auto");

// No prefix / collision: close strings that are not the alias or an official name stay unresolved.
assert.equal(resolveModelValue(liveOption, "Deepseek-V4"), null);
assert.equal(resolveModelValue(liveOption, "Deepseek-V4-Flash-Extra"), null);
assert.equal(resolveModelValue(liveOption, "deepseek-v4.1"), null);
assert.equal(resolveModelValue(liveOption, "missing-model"), null);
assert.equal(resolveModelValue(liveOption, ""), null);

// Alias must not invent an id when the official target is absent.
const withoutOfficial = {
  id: "model",
  category: "model",
  options: [
    { value: "auto", name: "Auto" },
    { value: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
  ],
};
assert.equal(resolveModelValue(withoutOfficial, "Deepseek-V4-Flash"), null);
assert.equal(resolveModelValue(withoutOfficial, "deepseek-v4-flash"), null);

// Before this alias, a catalog whose official name is DeepSeek-V4.1-Flash (not
// Deepseek-V4-Flash) would have sent the unofficial label through unresolved.
const beforeWouldMiss = resolveModelValue(
  {
    id: "model",
    options: [{ value: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash" }],
  },
  "Deepseek-V4-Flash",
);
assert.equal(beforeWouldMiss, "deepseek-v4.1-flash");

console.log("ok live-catalog alias Deepseek-V4-Flash -> deepseek-v4.1-flash");
