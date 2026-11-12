import type { ExternalChannel } from "./types";
import type { InterfaceRow } from "./scannerBoard";

export const LOCAL_EXECUTOR_LABELS: Record<string, { zh: string; en: string }> = {
  workbuddy: { zh: "WorkBuddy", en: "WORKBUDDY" },
  codex: { zh: "Codex", en: "CODEX" },
  doubao: { zh: "豆包", en: "DOUBAO" },
  ollama: { zh: "Ollama", en: "OLLAMA" },
};

const PREFERRED_ORDER = ["workbuddy", "codex", "doubao", "ollama"];

/** A live scan actually found this interface. Example catalogs and 未找到 rows stay out. */
export function isDetectedExecutorRow(row: InterfaceRow): boolean {
  if (row.source === "example") return false;
  return row.uiStatus === "discovered" || row.uiStatus === "missing_key";
}

function stubExecutor(id: string, title: string, titleEn: string): ExternalChannel {
  return {
    id,
    title,
    title_en: titleEn,
    kind: id,
    endpoint: null,
    optional: false,
    layers: [],
    tools: [],
    inventory_claimed: 0,
    inventory_verified: 0,
    notes: "",
    last_probe_at: null,
  };
}

/**
 * Executors the meeting form can assign: only interfaces this machine has
 * already probed and found. Not a preset catalog, and not the channels page list.
 */
export function mergeExecutorChannels(
  registered: ExternalChannel[],
  scannerRows: InterfaceRow[] = [],
): ExternalChannel[] {
  const byId = new Map<string, ExternalChannel>();

  for (const row of scannerRows) {
    if (!isDetectedExecutorRow(row)) continue;
    const labels = LOCAL_EXECUTOR_LABELS[row.scanner_id];
    byId.set(
      row.scanner_id,
      stubExecutor(
        row.scanner_id,
        row.display_name.trim() || labels?.zh || row.scanner_id,
        labels?.en ?? row.scanner_id.toUpperCase(),
      ),
    );
  }

  for (const channel of registered) {
    if (!channel.id || !byId.has(channel.id)) continue;
    byId.set(channel.id, channel);
  }

  const head: ExternalChannel[] = [];
  for (const id of PREFERRED_ORDER) {
    const item = byId.get(id);
    if (!item) continue;
    byId.delete(id);
    head.push(item);
  }
  return [...head, ...byId.values()];
}

/**
 * King reports should land in a desktop window the user can open.
 * CLI-only adapters (Codex, Ollama) cannot be king. Prefer transport when
 * known: desktop_bridge is GUI, cli is not. WorkBuddy and Doubao are desktop apps.
 */
export function isGuiKingExecutor(id: string, transport?: string | null): boolean {
  const kind = (transport || "").trim().toLowerCase();
  if (kind === "cli") return false;
  if (kind === "desktop_bridge") return true;
  return id === "workbuddy" || id === "doubao";
}
