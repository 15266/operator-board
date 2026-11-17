// ---- Local knowledge base (bridge/kb). Additive: appended to src/lib/bridge.ts. ----
export interface KbArtifact {
  path: string;
  root: "cwd" | "board";
  size: number;
  sha256: string;
  mtime?: string | null;
  attribution: "reported_by_adapter" | "time_window";
}

export interface KbEntrySummary {
  id: string;
  uri: string;
  dispatch_id: string;
  task_id: string | null;
  project_id: string | null;
  title: string;
  executor: string;
  model: string | null;
  /** DispatchRecord.state verbatim. */
  state: string;
  success: boolean;
  artifact_count: number;
  refs: string[];
  reply_excerpt: string | null;
  created_at: string;
  dispatch_finished_at: string | null;
}

export interface KbEntry extends Omit<KbEntrySummary, "artifact_count" | "reply_excerpt"> {
  reply: string | null;
  reply_truncated: boolean;
  prompt: string | null;
  error: string | null;
  artifacts: KbArtifact[];
  artifacts_note?: string | null;
  overlapping_dispatches?: string[];
  cwd: string | null;
}

export interface KbQuery {
  q?: string;
  executor?: string;
  project_id?: string;
  task_id?: string;
  state?: string;
  limit?: number;
}

export async function fetchKbEntries(query: KbQuery = {}): Promise<{ entries: KbEntrySummary[]; total: number; error: string | null }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  try {
    const r = await fetch(`${BRIDGE_URL}/bridge/kb${params.toString() ? `?${params.toString()}` : ""}`);
    const j = (await r.json().catch(() => null)) as { entries?: KbEntrySummary[]; total?: number; error?: string } | null;
    if (!r.ok || !j || !Array.isArray(j.entries)) return { entries: [], total: 0, error: j?.error ?? `HTTP ${r.status}` };
    return { entries: j.entries, total: j.total ?? j.entries.length, error: null };
  } catch (e) {
    return { entries: [], total: 0, error: `知识库不可用：${(e as Error).message}` };
  }
}

export async function fetchKbEntry(id: string): Promise<KbEntry | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/bridge/kb/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { entry?: KbEntry };
    return j.entry ?? null;
  } catch {
    return null;
  }
}

export function kbArtifactUrl(id: string, index: number): string {
  return `${BRIDGE_URL}/bridge/kb/${encodeURIComponent(id)}/artifacts/${index}`;
}
