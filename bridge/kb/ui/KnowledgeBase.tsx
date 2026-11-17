import { useEffect, useState } from "react";
import {
  DISPATCH_LABEL,
  fetchKbEntries,
  fetchKbEntry,
  kbArtifactUrl,
  type DispatchState,
  type KbEntry,
  type KbEntrySummary,
} from "../lib/bridge";
import { MotionFold } from "./Motion";

/** Reuse the dispatch labels; unknown states are shown verbatim, never upgraded. */
function stateLabel(state: string): { text: string; tone: string } {
  return DISPATCH_LABEL[state as DispatchState] ?? { text: state, tone: "neutral" };
}

function useKbEntries(online: boolean, projectId: string | null, enabled: boolean) {
  const [entries, setEntries] = useState<KbEntrySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!online || !enabled) return;
    let alive = true;
    async function load() {
      const r = await fetchKbEntries({ project_id: projectId ?? undefined, limit: 30 });
      if (!alive) return;
      setEntries(r.entries);
      setTotal(r.total);
      setError(r.error);
    }
    void load();
    const t = window.setInterval(load, 15000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [online, projectId, enabled]);
  return { entries, total, error };
}

function KbRow({ entry }: { entry: KbEntrySummary }) {
  const [detail, setDetail] = useState<KbEntry | null>(null);
  const label = stateLabel(entry.state);
  async function toggle() {
    if (detail) return setDetail(null);
    setDetail(await fetchKbEntry(entry.id));
  }
  return (
    <li className="kb-row">
      <p>
        <button type="button" className="text-btn" onClick={() => void toggle()} aria-expanded={!!detail}>
          {entry.title || entry.dispatch_id}
        </button>
        <span className="muted">
          {" "}· <code>{entry.executor}</code>
          {entry.model ? <> · <code>{entry.model}</code></> : null}
          {" "}· <span className={`status-text tone-${label.tone}`}>{label.text}</span>
          {" "}· 产物 {entry.artifact_count}
          {" "}· <code className="id">{entry.uri}</code>
        </span>
      </p>
      {detail ? (
        <div className="dispatch-result">
          {detail.reply ? <blockquote className="dispatch-reply">{detail.reply.slice(0, 600)}</blockquote> : <p className="muted">没有回复。</p>}
          {detail.artifacts_note ? <p className="callout callout-info">产物按时间窗口收集，可能混入同时段其他派发的文件，需人工核对。</p> : null}
          {detail.artifacts.length ? (
            <ul className="muted">
              {detail.artifacts.map((a, i) => (
                <li key={`${a.root}:${a.path}`}>
                  <a href={kbArtifactUrl(detail.id, i)} target="_blank" rel="noreferrer">
                    {a.path}
                  </a>{" "}
                  <code title={a.sha256}>{a.sha256.slice(0, 12)}</code> · {a.size}B
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Small read-only list of recent KB entries (completed dispatches). */
export function KnowledgeBasePanel({ online, projectId }: { online: boolean; projectId: string | null }) {
  const [open, setOpen] = useState(false);
  const [onlyProject, setOnlyProject] = useState(true);
  const { entries, total, error } = useKbEntries(online, onlyProject ? projectId : null, open);
  return (
    <MotionFold className="howto project-pref-details" summary="知识库" open={open} onOpenChange={setOpen}>
      {!online ? <p className="muted">桥接未连接，读不到知识库。</p> : null}
      {error ? <p className="callout callout-warn">{error}</p> : null}
      <label className="toggle">
        <input type="checkbox" checked={onlyProject} onChange={(e) => setOnlyProject(e.target.checked)} />
        <span>只看本项目</span>
      </label>
      <p className="hint">
        每次派发结束自动入库（回复、执行器 / 模型、产物 sha256）。状态原样显示：只有「已核实」算成功。共 {total} 条。
      </p>
      {entries.length ? (
        <ul className="kb-list">
          {entries.map((entry) => (
            <KbRow key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="muted">还没有条目。</p>
      )}
    </MotionFold>
  );
}

/** Optional multi-select of KB entries for a task; the ids are sent as kb_refs on dispatch. */
export function KbRefPicker({
  online,
  projectId,
  value,
  onChange,
}: {
  online: boolean;
  projectId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { entries, error } = useKbEntries(online, null, open);
  const sorted = [...entries].sort((a, b) => Number(b.project_id === projectId) - Number(a.project_id === projectId));
  const known = new Set(entries.map((e) => e.id));
  function toggle(id: string, on: boolean) {
    onChange(on ? [...value.filter((x) => x !== id), id] : value.filter((x) => x !== id));
  }
  return (
    <MotionFold className="howto" summary={`引用知识库（已选 ${value.length}）`} open={open} onOpenChange={setOpen}>
      <p className="hint">
        勾选的条目会在派发时附到任务说明末尾的「前序产物」段，并把产物复制到工作目录 <code>kb_refs/&lt;id&gt;/</code>（复制后校验 sha256）。
      </p>
      {error ? <p className="callout callout-warn">{error}</p> : null}
      {value.filter((id) => open && entries.length && !known.has(id)).map((id) => (
        <label key={id} className="toggle">
          <input type="checkbox" checked onChange={() => toggle(id, false)} />
          <span>
            <code>{id}</code> <span className="muted">（不在最近列表里；若已不存在，派发会被拒绝）</span>
          </span>
        </label>
      ))}
      {sorted.map((entry) => {
        const label = stateLabel(entry.state);
        return (
          <label key={entry.id} className="toggle">
            <input type="checkbox" checked={value.includes(entry.id)} onChange={(e) => toggle(entry.id, e.target.checked)} />
            <span>
              {entry.title || entry.dispatch_id} <span className="muted">· <code>{entry.executor}</code> ·{" "}</span>
              <span className={`status-text tone-${label.tone}`}>{label.text}</span>
              <span className="muted"> · 产物 {entry.artifact_count}</span>
            </span>
          </label>
        );
      })}
      {open && !entries.length && !error ? <p className="muted">知识库还没有条目。</p> : null}
    </MotionFold>
  );
}
