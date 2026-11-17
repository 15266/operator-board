import { useEffect, useState } from "react";
import { fetchKbEntries, kbArtifactUrl, type KbEntry, type KbEntrySummary } from "../lib/bridge";
import {
  fetchArtifact,
  KB_TREE_SOURCE_LABEL,
  kindLabel,
  loadKbTreeProvider,
  projectNodeId,
  rollupLabel,
  stateLabel,
  treeIssueLabel,
  ARTIFACT_SECRET_BLOCKED,
  type ArtifactCheck,
  type KbCrumb,
  type KbNodeDetail,
  type KbTreeNode,
  type KbTreeProvider,
} from "../lib/kbTree";
import { useKbSnapshotStatus } from "../lib/kbSnapshot";
import { formatShanghai } from "../lib/time";
import { MotionFold } from "./Motion";

const NONE = "无此信息";

/** `#…?open=kb&kbnode=<node_id>` opens the fold / a node on load (deep links, screenshots). */
function hashParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const query = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get(name);
}
function hashWantsOpen(name: string): boolean {
  return (hashParam("open") ?? "").split(",").includes(name);
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

function RollupText({ node }: { node: KbTreeNode }) {
  const r = node.rollup;
  const c = r?.counts;
  if (!r || !c || !c.total) return <span className="muted">进度 {NONE}</span>;
  const label = rollupLabel(String(r.state));
  return (
    <>
      <span className={`status-text tone-${label.tone}`}>{label.text}</span>
      <span className="muted">
        {" "}· 已核实 {c.verified}/{c.total}
        {c.failed ? ` · 失败 ${c.failed}` : ""}
        {c.running ? ` · 进行中 ${c.running}` : ""}
        {c.needs_check ? ` · 待核实 ${c.needs_check}` : ""}
      </span>
    </>
  );
}

/** Fetch-before-open link: 403 → 「已按安全规则不提供」, 409/410 → reason; X-KB-Source: blob noted. */
function ArtifactLink({ url, label, blob, blobReason }: { url: string; label: string; blob?: boolean; blobReason?: string | null }) {
  const [check, setCheck] = useState<ArtifactCheck | null>(null);
  const [busy, setBusy] = useState(false);
  if (blob === false && blobReason) {
    return (
      <span className="muted">
        {label} · {blobReason.startsWith("secret_pattern") ? ARTIFACT_SECRET_BLOCKED : `不可下载：${blobReason}`}
      </span>
    );
  }
  if (check?.ok) {
    return (
      <>
        <a href={check.objectUrl} target="_blank" rel="noreferrer">{label}</a>
        <span className="muted">{check.fromBlob ? " · 来自知识库副本" : ""}</span>
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className="text-btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void fetchArtifact(url).then((r) => {
            setCheck(r);
            setBusy(false);
          });
        }}
      >
        {busy ? "读取中…" : label}
      </button>
      {check && !check.ok ? <span className="muted"> · {check.message}</span> : null}
    </>
  );
}

/** The bridge titles a project by its id until it has a board snapshot; prefer the board's own name. */
function boardProjectName(projectId: string): string | null {
  try {
    const list = JSON.parse(window.localStorage.getItem("operator-board-projects") || "[]") as { project_id?: string; name?: string }[];
    const hit = Array.isArray(list) ? list.find((p) => p && p.project_id === projectId) : undefined;
    return hit && typeof hit.name === "string" && hit.name.trim() ? hit.name : null;
  } catch {
    return null;
  }
}

function titleOf(n: { id: string; kind: string; title: string }): string {
  if (n.kind === "project" && n.id.startsWith("p:") && (!n.title || n.title === n.id.slice(2))) {
    return boardProjectName(n.id.slice(2)) ?? (n.title || n.id);
  }
  return n.title || n.id;
}

function NodeMeta({ node }: { node: KbTreeNode }) {
  const own = node.state ? stateLabel(node.state) : null;
  return (
    <span className="muted">
      {" "}· {kindLabel(node.kind)}
      {own ? <> · <span className={`status-text tone-${own.tone}`}>{own.text}</span></> : null}
      {node.kind !== "dispatch" || node.has_children ? <> · <RollupText node={node} /></> : null}
      {node.has_children && typeof node.child_count === "number" ? ` · 子节点 ${node.child_count}` : ""}
      {node.executor ? <> · <code>{node.executor}</code></> : null}
      {node.model ? <> · <code>{node.model}</code></> : null}
      {node.at ? ` · ${formatShanghai(node.at)}` : ""}
      {node.tree_issue ? <> · <span className="status-text tone-warn">{treeIssueLabel(node.tree_issue)}</span></> : null}
      {node.kind === "artifact" && node.links?.content ? (
        <>
          {" "}· <ArtifactLink url={node.links.content} label="打开产物" blob={node.refs?.blob} />
          {node.refs?.sha256 ? <> <code title={node.refs.sha256}>{node.refs.sha256.slice(0, 12)}</code></> : null}
        </>
      ) : null}
    </span>
  );
}

interface CheckRow {
  name?: string;
  ok?: boolean;
  detail?: string;
  type?: string;
  target?: string;
  /** Advisory row (e.g. the executor's own stop reason): shown in amber, never decides the verdict. */
  warn?: boolean;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Sandbox + checks as text (每项检查：名称 · 通过/未通过 · detail). Works for KB entries and dispatch records. */
function SandboxAndChecks({ sandbox, sandboxSource, projectDir, checks }: { sandbox: string | null; sandboxSource: string | null; projectDir: string | null; checks: CheckRow[] }) {
  return (
    <>
      <p className="muted">
        沙箱 <code>sandbox</code>：{sandbox ?? NONE}
        {sandboxSource ? <>（来源 <code>{sandboxSource}</code>）</> : null}
        {projectDir ? <> · 项目目录 <code>{projectDir}</code></> : null}
      </p>
      {checks.length ? (
        <ul className="dispatch-checks">
          {checks.map((c, i) => (
            <li key={`${c.name ?? c.type ?? "check"}-${i}`}>
              {c.name || c.type || NONE} ·{" "}
              {c.warn ? (
                <span className="status-text tone-warn">提醒</span>
              ) : (
                <span className={`status-text tone-${c.ok ? "ok" : "bad"}`}>{c.ok ? "通过" : "未通过"}</span>
              )}
              {c.detail ? <span className="muted"> · {c.detail}</span> : null}
              {c.target ? <span className="muted"> · <code>{c.target}</code></span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">检查 <code>checks</code>：{NONE}</p>
      )}
    </>
  );
}

function EntryDetail({ entry, dispatch }: { entry: KbEntry; dispatch?: Record<string, unknown> }) {
  const ev = (entry.evidence ?? (dispatch?.evidence as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const checks = (entry.checks?.length ? entry.checks : Array.isArray(dispatch?.checks) ? (dispatch?.checks as CheckRow[]) : []) as CheckRow[];
  return (
    <div className="dispatch-result">
      <p className="muted">
        执行器 <code>{entry.executor || NONE}</code> · 模型 <code>{entry.model || NONE}</code> · 入库 {entry.created_at ? formatShanghai(entry.created_at) : NONE}
        {" "}· <code className="id">{entry.uri}</code>
      </p>
      <SandboxAndChecks
        sandbox={str(entry.sandbox) ?? str(ev.sandbox)}
        sandboxSource={str(entry.sandbox_source) ?? str(ev.sandbox_source)}
        projectDir={str(entry.project_dir) ?? str(ev.project_dir)}
        checks={checks}
      />
      {entry.reply ? (
        <blockquote className="dispatch-reply">
          {entry.reply.slice(0, 1200)}
          {entry.reply_truncated || entry.reply.length > 1200 ? "…（已截断）" : ""}
        </blockquote>
      ) : (
        <p className="muted">回复：{NONE}</p>
      )}
      {entry.error ? <p className="callout callout-warn">{entry.error}</p> : null}
      {entry.artifacts_note ? <p className="callout callout-info">产物按时间窗口收集，可能混入同时段其他派发的文件，需人工核对。</p> : null}
      {entry.overlapping_dispatches?.length ? (
        <p className="callout callout-warn">
          同时段还有 {entry.overlapping_dispatches.length} 个派发（{entry.overlapping_dispatches.join("、")}），产物需人工核对。
        </p>
      ) : null}
      {entry.artifacts?.length ? (
        <ul className="muted">
          {entry.artifacts.map((a, i) => (
            <li key={`${a.root}:${a.path}`}>
              <ArtifactLink url={kbArtifactUrl(entry.id, i)} label={a.path} blob={a.blob} blobReason={a.blob_reason} />{" "}
              <code title={a.sha256}>{a.sha256.slice(0, 12)}</code> · {a.size}B
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">产物：{NONE}</p>
      )}
      {entry.prompt ? (
        <MotionFold className="howto" summary="任务说明 prompt">
          <blockquote className="dispatch-reply">{entry.prompt.slice(0, 2000)}</blockquote>
        </MotionFold>
      ) : null}
    </div>
  );
}

function NodeDetail({ detail }: { detail: KbNodeDetail }) {
  if (!detail) return null;
  if (detail.entry) return <EntryDetail entry={detail.entry} dispatch={detail.dispatch} />;
  if (detail.dispatch) {
    const d = detail.dispatch;
    const ev = (d.evidence ?? {}) as Record<string, unknown>;
    const l = str(d.state) ? stateLabel(String(d.state)) : null;
    return (
      <div className="dispatch-result">
        <p className="muted">
          派发 <code>{str(d.id) ?? NONE}</code> · 执行器 <code>{str(d.executor) ?? NONE}</code>
          {l ? <> · <span className={`status-text tone-${l.tone}`}>{l.text}</span></> : null}
        </p>
        <SandboxAndChecks
          sandbox={str(d.sandbox) ?? str(ev.sandbox)}
          sandboxSource={str(ev.sandbox_source)}
          projectDir={str(d.project_dir) ?? str(ev.project_dir)}
          checks={Array.isArray(d.checks) ? (d.checks as CheckRow[]) : []}
        />
        {str(d.reply) ? <blockquote className="dispatch-reply">{String(d.reply).slice(0, 1200)}</blockquote> : <p className="muted">回复：{NONE}</p>}
      </div>
    );
  }
  if (Array.isArray(detail.versions)) {
    return (
      <>
        <h4 className="subhead">文档版本 · Versions</h4>
        {detail.versions.length ? (
          <ul className="muted">
            {detail.versions.map((v, i) => (
              <li key={`${v.version ?? i}`}>
                第 {v.version ?? "?"} 版 · {v.title || NONE} · {v.at ? formatShanghai(v.at) : NONE}
                {v.sha256 ? <> · <code title={v.sha256}>{v.sha256.slice(0, 12)}</code></> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">版本：{NONE}</p>
        )}
      </>
    );
  }
  if (Array.isArray(detail.events)) {
    if (!detail.events.length) return null;
    return (
      <>
        <h4 className="subhead">最近进展 · Timeline</h4>
        <ul className="muted">
          {detail.events.slice(0, 20).map((t, i) => {
            const st = t.to_state ?? t.state ?? null;
            const l = st ? stateLabel(st) : null;
            return (
              <li key={`${t.at ?? ""}-${i}`}>
                {t.at ? formatShanghai(t.at) : NONE} · {t.kind ?? NONE} · {t.summary || t.title || NONE}
                {l ? <> · <span className={`status-text tone-${l.tone}`}>{l.text}</span></> : null}
              </li>
            );
          })}
        </ul>
      </>
    );
  }
  return null;
}

/**
 * Knowledge base as a drill-down progress tree: project → n levels → dispatch → artifact.
 * Breadcrumb path bar + current level's children, loaded one level at a time
 * (GitHub file browser / VS Code breadcrumbs + TreeDataProvider / Finder path bar / okf-studio IndexTree).
 */
export function KnowledgeBasePanel({ online, projectId }: { online: boolean; projectId: string | null }) {
  const [open, setOpen] = useState(() => hashWantsOpen("kb"));
  const [provider, setProvider] = useState<KbTreeProvider | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [currentId, setCurrentId] = useState<string | null>(
    () => hashParam("kbnode") ?? (projectId ? projectNodeId(projectId) : null),
  );
  const [crumbs, setCrumbs] = useState<KbCrumb[]>([]);
  const [node, setNode] = useState<KbTreeNode | null>(null);
  const [detail, setDetail] = useState<KbNodeDetail>(null);
  const [children, setChildren] = useState<KbTreeNode[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const snapshot = useKbSnapshotStatus();

  useEffect(() => {
    if (!open || !online) return;
    let alive = true;
    void loadKbTreeProvider().then((r) => {
      if (!alive) return;
      setProvider(r.provider);
      setLoadError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [open, online, reloadKey]);

  useEffect(() => {
    if (!provider) return;
    let alive = true;
    setBusy(true);
    void (async () => {
      let n: KbTreeNode | null = null;
      let bc: KbCrumb[] = [];
      let d: KbNodeDetail = null;
      let err: string | null = null;
      if (currentId) {
        const page = await provider.getNode(currentId);
        n = page.node;
        bc = page.breadcrumbs;
        d = page.detail;
        err = page.error;
      }
      const kids = !currentId || n?.has_children ? await provider.getChildren(currentId) : { children: [], next_cursor: null, total: 0, error: null };
      if (!alive) return;
      setNode(n);
      setCrumbs(bc);
      setDetail(d);
      setChildren(kids.children);
      setCursor(kids.next_cursor);
      setLevelError(currentId && !n ? (projectId && currentId === projectNodeId(projectId) ? "本项目还没有知识库条目。" : err ?? `找不到节点 ${currentId}`) : err ?? kids.error);
      setBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [provider, currentId, projectId]);

  async function loadMore() {
    if (!provider || !cursor) return;
    const more = await provider.getChildren(currentId, cursor);
    setChildren((prev) => [...prev, ...more.children]);
    setCursor(more.next_cursor);
  }

  return (
    <MotionFold className="howto project-pref-details" summary="知识库" open={open} onOpenChange={setOpen}>
      <p className="hint">
        这是什么：项目的进度树。每一层往下是更细的进度，最底层是一次次派发的结果（回复、产物、检查、任务说明）。
        怎么用：点节点进入下一级，点上方路径回到上一级。状态都用文字标注，只有「已核实」算完成。
      </p>
      {!online ? <p className="muted">桥接未连接，读不到知识库。</p> : null}
      {online && provider ? (
        <p className="muted">
          数据来源：<code>{KB_TREE_SOURCE_LABEL[provider.mode]}</code>
          {provider.note ? ` · ${provider.note}` : ""}
          {" "}·{" "}
          <button type="button" className="text-btn" onClick={() => setReloadKey((k) => k + 1)} disabled={busy}>
            {busy ? "读取中…" : "刷新"}
          </button>
        </p>
      ) : null}
      {snapshot.state === "unsynced" || snapshot.state === "rejected" ? (
        <p className="muted">项目快照未同步（{snapshot.error ?? NONE}）</p>
      ) : null}
      {online && loadError ? <p className="callout callout-warn">{loadError}</p> : null}

      {provider ? (
        <>
          <nav aria-label="知识库路径">
            <p>
              {currentId ? (
                <button type="button" className="text-btn" onClick={() => setCurrentId(null)}>
                  全部项目
                </button>
              ) : (
                <strong aria-current="page">全部项目</strong>
              )}
              {crumbs.map((c, i) => (
                <span key={c.id}>
                  {" › "}
                  {i === crumbs.length - 1 ? (
                    <strong aria-current="page">{titleOf(c)}</strong>
                  ) : (
                    <button type="button" className="text-btn" onClick={() => setCurrentId(c.id)}>
                      {titleOf(c)}
                    </button>
                  )}
                </span>
              ))}
            </p>
          </nav>

          {node ? (
            <p>
              <strong>{titleOf(node)}</strong>
              <NodeMeta node={node} />
            </p>
          ) : null}
          {levelError ? <p className="callout callout-warn">{levelError}</p> : null}

          {children.length ? (
            <ul className="kb-list">
              {children.map((c) => (
                <li key={c.id} className="kb-row">
                  <p>
                    <button type="button" className="text-btn" onClick={() => setCurrentId(c.id)}>
                      {titleOf(c)}
                    </button>
                    <NodeMeta node={c} />
                  </p>
                </li>
              ))}
            </ul>
          ) : !busy && !levelError && (!node || node.has_children) ? (
            <p className="muted">这一层还没有节点。</p>
          ) : null}
          {cursor ? (
            <p>
              <button type="button" className="text-btn" onClick={() => void loadMore()}>
                加载更多
              </button>
            </p>
          ) : null}

          <NodeDetail detail={detail} />
        </>
      ) : null}
    </MotionFold>
  );
}

/** Optional multi-select of dispatch-level KB entries; ids are sent as kb_refs on dispatch. */
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
