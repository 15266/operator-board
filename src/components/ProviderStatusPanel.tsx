import { useEffect, useState } from "react";
import type { DiscoverReport } from "../lib/bridge";
import {
  loadProviders,
  loadProviderSnapshot,
  PROCESS_ROLE_LABEL,
  type ProviderInfo,
  type ProviderProcessRole,
  type ProviderSnapshot,
} from "../lib/providerStatus";
import { formatShanghai } from "../lib/time";
import { MotionFold } from "./Motion";

const NONE = "无此信息";

/** `#channels?open=providers,codex` opens folds on load (deep links / screenshots). */
function hashOpens(): string[] {
  if (typeof window === "undefined") return [];
  const query = window.location.hash.split("?")[1] ?? "";
  return (new URLSearchParams(query).get("open") ?? "").split(",").filter(Boolean);
}

function val(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === "" ? NONE : String(v);
}

function time(v: string | null | undefined): string {
  return v ? formatShanghai(v) : NONE;
}

function Unavailable({ reason }: { reason?: string | null }) {
  return (
    <p>
      <span className="status-text tone-warn">不可用</span>
      <span className="muted"> · {reason || NONE}</span>
    </p>
  );
}

function ProviderEntry({ provider, defaultOpen }: { provider: ProviderInfo; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState<ProviderSnapshot | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setSnap(await loadProviderSnapshot(provider));
    setLoadedAt(new Date().toISOString());
    setBusy(false);
  }

  useEffect(() => {
    if (open && !snap && !busy) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const s = snap?.status;
  const headline = !snap ? "未读取" : s?.available ? "可读" : "不可用";
  const tone = !snap ? "neutral" : s?.available ? "ok" : "warn";

  return (
    <MotionFold
      className="howto"
      summary={
        <>
          {provider.name} <code>{provider.id}</code> · <span className={`status-text tone-${tone}`}>{headline}</span>
        </>
      }
      open={open}
      onOpenChange={setOpen}
    >
      <p>
        <button type="button" className="text-btn" onClick={() => void load()} disabled={busy}>
          {busy ? "读取中…" : "刷新"}
        </button>
        <span className="muted">
          {loadedAt ? ` · 读取于 ${formatShanghai(loadedAt)}` : ""}
          {snap ? ` · 数据路径 ${snap.via === "provider_route" ? "通用接口" : snap.via === "codex_adapter" ? "Codex 适配（/bridge/codex/*）" : "无"}` : ""}
        </span>
      </p>

      {snap ? (
        <>
          <h4 className="subhead">状态 · Status</h4>
          <p className="hint">这是什么：账号套餐、额度窗口与记录时间，只读快照，不代表可派发。</p>
          {s?.available ? (
            <>
              <ul className="muted">
                <li>套餐 <code>plan</code>：{val(s.plan)}</li>
                <li>模型 <code>model</code>：{val(s.model)}</li>
                <li>
                  额度 <code>limits</code>：
                  {s.limits.length
                    ? s.limits.map((l, i) => (
                        <span key={`${l.name}-${i}`}>
                          {i ? " · " : ""}
                          {val(l.name)} 已用 {typeof l.used_percent === "number" ? `${l.used_percent}%` : NONE}，重置 {time(l.resets_at)}
                        </span>
                      ))
                    : NONE}
                </li>
                <li>来源 <code>source</code>：{val(s.source)}</li>
                <li>记录时间 <code>recorded_at</code>：{time(s.recorded_at)}</li>
                {(s.notes ?? []).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              {s.reason ? <p className="callout callout-warn">{s.reason}</p> : null}
            </>
          ) : (
            <Unavailable reason={s?.reason} />
          )}

          <h4 className="subhead">会话 · Sessions</h4>
          <p className="hint">这是什么：本机最近的会话记录（最多 10 条）。会话存在不代表已连通。</p>
          {snap.sessions.available ? (
            snap.sessions.items.length ? (
              <>
                <p className="hint">共 {val(snap.sessions.total)} 条，显示 {snap.sessions.items.length} 条。</p>
                <ul className="kb-list">
                  {snap.sessions.items.map((x, i) => (
                    <li key={x.session_id || i} className="kb-row">
                      <p>
                        {x.title || <code className="id">{val(x.session_id)}</code>}
                        <span className="muted">
                          {" "}· 更新 {time(x.updated_at)}
                          {" "}· 关联派发 {x.dispatch_id ? <code className="id">{x.dispatch_id}</code> : NONE}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">没有读到会话。</p>
            )
          ) : (
            <Unavailable reason={snap.sessions.reason} />
          )}

          <MotionFold className="howto" summary={`高级 · 进程（${snap.processes.items.length}）`} defaultOpen={hashOpens().includes("processes")}>
            <p className="hint">这是什么：本机相关进程清单，只读；这里不提供结束或停止操作。</p>
            {snap.processes.available ? (
              snap.processes.items.length ? (
                <>
                  <ul className="muted">
                    {snap.processes.items.map((x) => (
                      <li key={x.pid}>
                        PID <code>{x.pid}</code> · {val(x.name)} · 角色{" "}
                        <span className="status-text tone-neutral">
                          {PROCESS_ROLE_LABEL[x.role as ProviderProcessRole] ?? x.role}
                        </span>{" "}
                        <code>{x.role}</code> · 启动 {time(x.started_at)}
                      </li>
                    ))}
                  </ul>
                  {snap.processes.note ? <p className="hint">{snap.processes.note}</p> : null}
                </>
              ) : (
                <p className="muted">没有相关进程。</p>
              )
            ) : (
              <Unavailable reason={snap.processes.reason} />
            )}
          </MotionFold>
        </>
      ) : null}
    </MotionFold>
  );
}

/**
 * External AI status: one read-only collapsible entry per provider (status / sessions / processes).
 * Requests only when an entry is opened or 「刷新」 is pressed; no background polling, no stop/kill actions.
 */
export function ProviderStatusPanel({ online, discover }: { online: boolean; discover: DiscoverReport | null }) {
  const opens = hashOpens();
  const [open, setOpen] = useState(() => opens.includes("providers"));
  const [list, setList] = useState<Awaited<ReturnType<typeof loadProviders>> | null>(null);

  useEffect(() => {
    if (!open || !online) return;
    let alive = true;
    void loadProviders(discover).then((r) => {
      if (alive) setList(r);
    });
    return () => {
      alive = false;
    };
  }, [open, online, discover]);

  return (
    <MotionFold className="howto project-pref-details" summary="外部 AI 状态 · External AI status" open={open} onOpenChange={setOpen}>
      <p className="hint">
        这是什么 / 怎么用：只读查看本机各 AI 提供方的账号额度、会话和进程，不会启动或关闭任何应用，也不派发。展开某一项时读一次，需要最新数据请点「刷新」。
        通用路由 <code>GET /bridge/providers</code>、<code>/bridge/provider/&lt;id&gt;/status|sessions|processes</code>；Codex 暂由 <code>/bridge/codex/*</code> 适配。
      </p>
      {!online ? <p className="muted">桥接未连接，读不到外部 AI 状态。</p> : null}
      {online && list ? (
        <>
          <p className="muted">
            提供方来源：<code>{list.listSource}</code>
            {list.listNote ? ` · ${list.listNote}` : ""}
          </p>
          {list.providers.length ? (
            list.providers.map((p) => <ProviderEntry key={p.id} provider={p} defaultOpen={opens.includes(p.id)} />)
          ) : (
            <p className="muted">没有发现可显示的 AI 提供方。</p>
          )}
        </>
      ) : null}
    </MotionFold>
  );
}
