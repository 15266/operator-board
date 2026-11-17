// Push the board's projects to the bridge so the KB tree can see them (final v2, FRONTEND-INTEGRATION §1):
// POST /bridge/kb/projects/snapshot { projects, actor: "board" } once at startup and ~3 s (2–5 s window)
// after changes. Secret/token fields are stripped first. Failures never affect the board: silent
// backoff retries, no console noise. A 400 (bridge suspects a secret) is not retried; its error text is shown.
// No dispatch events are written here (the bridge derives those); /bridge/kb/events is not used yet.
import { useEffect, useSyncExternalStore } from "react";
import { BRIDGE_URL } from "./bridge";

/**
 * Field names that look like credentials. Narrower than a bare /key|auth/ so benign fields
 * (author, monkey, keyframe, key_points…) survive; whole-word key/auth still match.
 */
const SECRET_KEY = /(token|secret|password|passwd|credential|api[_-]?key|apikey|access[_-]?key|private[_-]?key|authorization|cookie|session[_-]?key|^key$|^auth$|_key$|_auth$)/i;
const STORAGE_KEY = "operator-board-projects";

/** Recursively drop any field whose key looks secret. Arrays keep their order. */
export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out;
  }
  return value;
}

export interface KbSnapshotStatus {
  state: "idle" | "synced" | "unsynced" | "rejected";
  error: string | null;
}
let status: KbSnapshotStatus = { state: "idle", error: null };
const listeners = new Set<() => void>();
function setStatus(next: KbSnapshotStatus) {
  if (status.state === next.state && status.error === next.error) return;
  status = next;
  listeners.forEach((l) => l());
}

export function useKbSnapshotStatus(): KbSnapshotStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => status,
  );
}

function storedProjects(fallback: unknown[]): unknown[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const j = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(j)) return j;
  } catch {
    /* fall back to in-memory */
  }
  return fallback;
}

/** "ok", a 400 rejection (server text, not retried), or a retryable failure with its cause. */
type PostResult = "ok" | { rejected: string } | { retry: string };

async function postSnapshot(projects: unknown[]): Promise<PostResult> {
  try {
    const r = await fetch(`${BRIDGE_URL}/bridge/kb/projects/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projects: stripSecrets(projects), actor: "board" }),
    });
    if (r.ok) return "ok";
    if (r.status === 400) {
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      return { rejected: j?.error ?? "HTTP 400" };
    }
    if (r.status === 404) return { retry: "桥接尚未提供 /bridge/kb/projects/snapshot" };
    return { retry: `HTTP ${r.status}` };
  } catch {
    return { retry: "桥接未连接" };
  }
}

const STARTUP_MS = 0;
const DEBOUNCE_MS = 3000;
const MAX_TRIES = 6;

/** Mount once (App). Sends at startup and after `projects` changes; does not touch dispatch logic. */
export function useKbProjectsSnapshot(projects: unknown[]): void {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let attempt = 0;
    const run = async () => {
      if (cancelled) return;
      const res = await postSnapshot(storedProjects(projects));
      if (cancelled) return;
      if (res === "ok") {
        setStatus({ state: "synced", error: null });
        return;
      }
      if ("rejected" in res) {
        setStatus({ state: "rejected", error: res.rejected });
        return;
      }
      setStatus({ state: "unsynced", error: res.retry });
      attempt++;
      if (attempt < MAX_TRIES) timer = window.setTimeout(run, Math.min(60000, 2000 * 2 ** attempt));
    };
    timer = window.setTimeout(run, status.state === "idle" ? STARTUP_MS : DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projects]);
}
