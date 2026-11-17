/** Per-AI model the operator picked on the interfaces page. Used when dispatching that AI. */

export const PREFERRED_MODELS_KEY = "operator-board-preferred-models";
export const PREFERRED_MODELS_EVENT = "operator-board-preferred-models-changed";

export type PreferredModels = Record<string, string>;

export function loadPreferredModels(): PreferredModels {
  try {
    const raw = localStorage.getItem(PREFERRED_MODELS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: PreferredModels = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === "string" && key && typeof value === "string" && value.trim()) {
        out[key] = value.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function savePreferredModel(scannerId: string, model: string | null): void {
  if (!scannerId) return;
  const next = loadPreferredModels();
  const value = (model || "").trim();
  if (value) next[scannerId] = value;
  else delete next[scannerId];
  try {
    localStorage.setItem(PREFERRED_MODELS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PREFERRED_MODELS_EVENT, { detail: next }));
  } catch {
    /* ignore quota / private mode */
  }
}

export function preferredModelFor(scannerId: string | null | undefined): string {
  if (!scannerId) return "";
  return loadPreferredModels()[scannerId] || "";
}

export function subscribePreferredModels(onChange: (next: PreferredModels) => void): () => void {
  const handler = () => onChange(loadPreferredModels());
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREFERRED_MODELS_KEY) handler();
  };
  window.addEventListener(PREFERRED_MODELS_EVENT, handler);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PREFERRED_MODELS_EVENT, handler);
    window.removeEventListener("storage", onStorage);
  };
}

export function catalogModelsFromEvidence(evidence: {
  current_model?: string;
  model_names?: string[];
} | null | undefined): string[] {
  if (!evidence) return [];
  const names = Array.isArray(evidence.model_names) ? evidence.model_names : [];
  return Array.from(
    new Set([evidence.current_model, ...names].filter((item): item is string => Boolean(item && String(item).trim()))),
  );
}

function normalizeModelKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/**
 * Unofficial UI / published-docs label -> official catalog id.
 * Same table as bridge/modelResolve.mjs. Applied only when the official id
 * or official name is already in the catalog passed to resolveDispatchModel.
 */
const DISPATCH_MODEL_ALIASES: Record<string, string> = {
  "deepseek-v4-flash": "deepseek-v4.1-flash",
};

function catalogHasOfficial(catalog: string[], officialId: string): string | null {
  const exactId = catalog.find((item) => item === officialId);
  if (exactId) return exactId;
  const key = normalizeModelKey(officialId);
  const officialName = catalog.find((item) => normalizeModelKey(item) === key);
  return officialName || null;
}

/** If the requested label has an explicit alias and the official target is in the catalog, return that official entry. */
export function mapDispatchModelAlias(requested: string, catalog: string[]): string {
  const want = requested.trim();
  if (!want) return want;
  const aliasTarget = DISPATCH_MODEL_ALIASES[normalizeModelKey(want)];
  if (!aliasTarget) return want;
  return catalogHasOfficial(catalog, aliasTarget) || want;
}

/** Task override, then the interfaces-page choice for this AI, then a board default that belongs to this AI. */
export function resolveDispatchModel(opts: {
  /** Optional. When passed and empty, there is no executor and therefore no model. Omit for the old behaviour. */
  executorId?: string | null;
  taskModel?: string | null;
  preferred?: string | null;
  boardDefault?: string | null;
  catalog?: string[];
}): string | null {
  if ("executorId" in opts && !opts.executorId) return null;
  const catalog = (opts.catalog || []).map((item) => item.trim()).filter(Boolean);
  const task = (opts.taskModel || "").trim();
  if (task) return mapDispatchModelAlias(task, catalog);
  const preferred = (opts.preferred || "").trim();
  if (preferred) return mapDispatchModelAlias(preferred, catalog);
  const board = (opts.boardDefault || "").trim();
  if (!board) return null;
  if (catalog.length === 0) return mapDispatchModelAlias(board, catalog);
  const boardKey = normalizeModelKey(board);
  const inCatalog = catalog.some((item) => item === board || normalizeModelKey(item) === boardKey);
  const aliasTarget = DISPATCH_MODEL_ALIASES[boardKey];
  const official = aliasTarget ? catalogHasOfficial(catalog, aliasTarget) : null;
  if (!inCatalog && !official) return null;
  return mapDispatchModelAlias(board, catalog);
}
