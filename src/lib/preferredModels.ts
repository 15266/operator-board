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

/** Task override, then the interfaces-page choice for this AI, then a board default that belongs to this AI. */
export function resolveDispatchModel(opts: {
  taskModel?: string | null;
  preferred?: string | null;
  boardDefault?: string | null;
  catalog?: string[];
}): string | null {
  const task = (opts.taskModel || "").trim();
  if (task) return task;
  const preferred = (opts.preferred || "").trim();
  if (preferred) return preferred;
  const board = (opts.boardDefault || "").trim();
  if (!board) return null;
  const catalog = (opts.catalog || []).map((item) => item.trim()).filter(Boolean);
  if (catalog.length === 0) return board;
  const boardKey = normalizeModelKey(board);
  if (catalog.some((item) => item === board || normalizeModelKey(item) === boardKey)) return board;
  return null;
}
