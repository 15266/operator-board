// Shared helpers for mapping a user-selected model name onto an official
// session option value (id or display name). Do not invent unofficial IDs.

export function flattenSelectOptions(options) {
  if (!Array.isArray(options)) return [];
  const out = [];
  for (const item of options) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.options) && (item.group || item.name)) {
      out.push(...flattenSelectOptions(item.options));
      continue;
    }
    if (typeof item.value === "string" && item.value) out.push(item);
  }
  return out;
}

export function findModelOption(configOptions) {
  const list = Array.isArray(configOptions) ? configOptions : [];
  return (
    list.find((item) => item && (item.category === "model" || item.id === "model" || item.configId === "model")) ||
    null
  );
}

export function normalizeModelKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/**
 * Explicit aliases from unofficial UI / published-docs labels to an official
 * catalog id. Applied only when that official id, or the official option name,
 * is present in the live options. Not prefix matching: normalize(Deepseek-V4-Flash)
 * is "deepseek-v4-flash", which is not equal to "deepseek-v4.1-flash".
 */
export const MODEL_VALUE_ALIASES = Object.freeze({
  "deepseek-v4-flash": "deepseek-v4.1-flash",
});

function findOfficialOption(opts, target) {
  const want = String(target || "").trim();
  if (!want) return null;
  const exactValue = opts.find((item) => item.value === want);
  if (exactValue) return exactValue;
  const exactName = opts.find((item) => item.name === want);
  if (exactName) return exactName;
  const key = normalizeModelKey(want);
  return (
    opts.find(
      (item) => normalizeModelKey(item.value) === key || normalizeModelKey(item.name) === key,
    ) || null
  );
}

/** Return the official option value that matches a requested name or id, or null. */
export function resolveModelValue(option, requested) {
  const want = String(requested || "").trim();
  if (!want || !option) return null;
  const opts = flattenSelectOptions(option.options);
  const exactValue = opts.find((item) => item.value === want);
  if (exactValue) return exactValue.value;
  const exactName = opts.find((item) => item.name === want);
  if (exactName) return exactName.value;
  const key = normalizeModelKey(want);
  const normalized = opts.find(
    (item) => normalizeModelKey(item.value) === key || normalizeModelKey(item.name) === key,
  );
  if (normalized) return normalized.value;
  const aliasTarget = MODEL_VALUE_ALIASES[key];
  if (!aliasTarget) return null;
  const official = findOfficialOption(opts, aliasTarget);
  return official ? official.value : null;
}

export function optionNames(option) {
  return flattenSelectOptions(option?.options).map((item) => ({
    value: item.value,
    name: typeof item.name === "string" && item.name ? item.name : item.value,
  }));
}
