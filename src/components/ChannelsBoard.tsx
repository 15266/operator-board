import {normalizeRegisteredChannel} from "../lib/registeredChannels";
import { AccessBoard } from "./AccessBoard";
import { ProviderStatusPanel } from "./ProviderStatusPanel";
import { interfaceGuidance } from "../lib/interfaceGuidance";
import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type {
  ChannelLayer,
  ChannelLayerKind,
  ChannelLayerStatus,
  ExternalChannel,
} from "../lib/types";
import {
  ACTION,
  BOOL_CLAIM_LABEL,
  CHANNEL_KIND_ALIASES,
  CHANNEL_KINDS,
  CHANNEL_PRINCIPLES,
  CHANNEL_PROBE,
  COL_HEADER,
  LAYER_COPY,
  LAYER_STATUS_LABEL,
  PANEL_COPY,
  SCREENSHOT_VERIFY_LABEL,
} from "../lib/copy";
import { ArchiveText } from "./ArchiveText";
import { formatShanghai } from "../lib/time";
import type { BridgeView, DiscoverReport } from "../lib/bridge";
import { matchProbeRow, useChannelProbe, type LiveProbeRow } from "../lib/channelProbe";
import { Panel } from "./Panel";
import { MotionReveal } from "./Motion";
import { waveStyle } from "../lib/motion";

const LAYER_ORDER: ChannelLayerKind[] = [
  "chat_bridge",
  "tool_inventory",
  "tool_verify",
  "quota",
];

const EXTRA_KEY = "operator-board-extra-channels";

export function loadRegisteredChannels(): ExternalChannel[] {
  try {
    const raw = localStorage.getItem(EXTRA_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ExternalChannel[];
    if (!Array.isArray(parsed)) return [];
    const rows=parsed.map(normalizeRegisteredChannel).filter((row):row is ExternalChannel=>row!==null);
    return [...new Map(rows.map(row=>[row.id,row])).values()];
  } catch {
    return [];
  }
}

export function persistRegisteredChannels(channels: ExternalChannel[]): void {
  try {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(channels));
  } catch {
    /* ignore quota / private mode */
  }
}

export function ChannelsBoard({
  channels,
  onRegister,
  onRemove,
  bridge,
}: {
  channels: ExternalChannel[];
  onRegister: (channel: ExternalChannel) => void;
  onRemove: (id: string) => void;
  bridge?: BridgeView;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const probe = useChannelProbe(bridge);
  const copy = PANEL_COPY.channels;
  const probeBusyLabel =
    probe.busy && probe.progress.total > 0
      ? CHANNEL_PROBE.probingProgress(probe.progress.done, probe.progress.total)
      : probe.busy
        ? ACTION.probing
        : ACTION.probeChannels;

  return (
    <Panel
      id="channels"
      {...copy}
      actions={
        <>
          {bridge ? (
            <button
              type="button"
              className="icon-btn add-channel-btn"
              onClick={() => void probe.run()}
              disabled={probe.busy || !bridge.online}
            >
              <ArchiveText zh={probeBusyLabel.zh} en={probeBusyLabel.en} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn add-channel-btn"
            onClick={() => {
              setFormOpen(true);
              requestAnimationFrame(() => {
                document.getElementById("channel-title")?.focus();
              });
            }}
          >
            <ArchiveText zh={ACTION.addChannel.zh} en={ACTION.addChannel.en} />
          </button>
        </>
      }
    >
      <ul className="channel-banners" aria-label="通道原则">
        {CHANNEL_PRINCIPLES.map((p) => (
          <li key={p.id} className="callout callout-info">
            <strong className="callout-title">{p.title}</strong>
            <p>{p.body}</p>
          </li>
        ))}
      </ul>

      {bridge ? <LocalDiscoverPanel bridge={bridge} /> : null}
      {bridge ? <AccessBoard discovery={bridge.discover} online={bridge.online} /> : null}

      {bridge ? <LiveProbePanel bridgeOnline={bridge.online} probe={probe} /> : null}
      {bridge ? <ProviderStatusPanel online={bridge.online} discover={bridge.discover} /> : null}

      <h3 className="subhead">CLAIMED / VERIFIED · 声称与已验证</h3>
      <p className="section-hint">{CHANNEL_PROBE.matrixHint}</p>
      <div className="table-wrap">
        <table className="channel-matrix">
          <caption className="visually-hidden">各通道四层状态与工具验证计数</caption>
          <thead>
            <tr>
              <th scope="col">{COL_HEADER.channel}</th>
              <th scope="col">{COL_HEADER.kind}</th>
              {LAYER_ORDER.map((k) => (
                <th key={k} scope="col">
                  {LAYER_COPY[k]?.title ?? k}
                  <code className="claim-raw">{k}</code>
                </th>
              ))}
              <th scope="col">{COL_HEADER.tools}</th>
              <th scope="col">{COL_HEADER.liveProbe}</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => {
              const live = probe.report ? matchProbeRow(ch, probe.report.rows) : undefined;
              const isDemo = ch.source !== "registered";
              return (
              <tr key={ch.id}>
                <th scope="row">
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setOpenChannelId((curr) => (curr === ch.id ? null : ch.id))}
                  >
                    {ch.title}
                  </button>
                  {ch.optional ? <span className="pill">可选</span> : null}
                  <span className={`pill ${isDemo ? "source-pill-demo" : "source-pill-registered"}`}>
                    {isDemo ? CHANNEL_PROBE.sourceDemo : CHANNEL_PROBE.sourceRegistered}
                  </span>
                </th>
                <td>
                  <code>{ch.kind}</code>
                </td>
                {LAYER_ORDER.map((k) => {
                  const layer = findLayer(ch, k);
                  const status = layer?.status ?? "unverified";
                  return (
                    <td key={k}>
                      <StatusText kind={k} status={status} />
                    </td>
                  );
                })}
                <td>
                  {ch.inventory_verified} / {ch.inventory_claimed}
                </td>
                <td className="probe-live-cell">
                  <LiveProbeSummary row={live} ran={!!probe.report} />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="subhead">REGISTERED CHANNELS / 已登记通道</h3>
      <p className="section-hint">
        默认只显示摘要。点「展开详情」查阅四层状态、工具对照和备注；一次只展开一条。点右侧虚线卡或顶部「添加通道」可再登记。
      </p>
      <div className="channel-grid motion-cards">
        {channels.map((ch, index) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            expanded={openChannelId === ch.id}
            onToggle={() => setOpenChannelId((curr) => (curr === ch.id ? null : ch.id))}
            onRemove={onRemove}
            style={waveStyle(index)}
          />
        ))}
        <AddChannelTile
          open={formOpen}
          onOpen={() => setFormOpen(true)}
          onClose={() => setFormOpen(false)}
          existingIds={channels.map((c) => c.id)}
          onRegister={(ch) => {
            onRegister(ch);
            setFormOpen(false);
          }}
          style={waveStyle(channels.length)}
        />
      </div>
    </Panel>
  );
}

function findLayer(ch: ExternalChannel, kind: ChannelLayerKind): ChannelLayer | undefined {
  return ch.layers.find((l) => l.kind === kind);
}

function StatusText({
  kind,
  status,
}: {
  kind: ChannelLayerKind | string;
  status: ChannelLayerStatus | string;
}) {
  const label = LAYER_STATUS_LABEL[kind]?.[status] ?? status;
  return (
    <span className={`status-text tone-${toneOf(status)}`}>
      {label}
      <code className="claim-raw">{status}</code>
    </span>
  );
}

function toneOf(status: string): string {
  if (status === "ok") return "ok";
  if (status === "partial") return "warn";
  if (status === "fail") return "bad";
  if (status === "na") return "neutral";
  return "unverified";
}

function kindLabel(kind: string): string {
  const canonical = CHANNEL_KIND_ALIASES[kind] ?? kind;
  return CHANNEL_KINDS.find((k) => k.id === canonical || k.id === kind)?.label ?? kind;
}

function channelSummaryLine(channel: ExternalChannel): string {
  const chat = findLayer(channel, "chat_bridge");
  const chatLabel = chat
    ? (LAYER_STATUS_LABEL.chat_bridge?.[chat.status] ?? chat.status)
    : "未验证";
  const verify = findLayer(channel, "tool_verify");
  const verifyLabel = verify
    ? (LAYER_STATUS_LABEL.tool_verify?.[verify.status] ?? verify.status)
    : "未验证";
  return `对话${chatLabel} · 工具 ${channel.inventory_verified}/${channel.inventory_claimed} · 插件${verifyLabel}`;
}

function ChannelCard({
  channel,
  expanded,
  onToggle,
  onRemove,
  style,
}: {
  channel: ExternalChannel;
  expanded: boolean;
  onToggle: () => void;
  onRemove: (id: string) => void;
  style?: CSSProperties;
}) {
  const registered = channel.source === "registered";
  return (
    <article
      className={`channel-card motion-card ${channel.optional ? "is-optional" : ""} ${expanded ? "is-expanded" : "is-collapsed"}`}
      style={style}
    >
      <header className="channel-card-top">
        <div>
          <strong>{channel.title}</strong>
          <span className="title-en">{channel.title_en}</span>
          <div className="role-ids">
            <code>{channel.kind}</code>
            <span className="role-en">{kindLabel(channel.kind)}</span>
          </div>
        </div>
        <div className="channel-card-flags">
          {channel.optional ? <span className="pill">可选</span> : null}
          {registered ? <span className="pill status-active">已登记</span> : <span className="pill">示例</span>}
          <button type="button" className="icon-btn" onClick={onToggle}>
            {expanded ? "收起" : "展开详情"}
          </button>
        </div>
      </header>
      {expanded ? null : (
        <p className="hint">{channelSummaryLine(channel)}</p>
      )}
      <MotionReveal open={expanded} className="channel-card-detail">
        <>
      {channel.product ? <p className="muted">{channel.product}</p> : null}
      <p className="channel-endpoint">
        接入点 <code>endpoint</code>：{channel.endpoint ? <code>{channel.endpoint}</code> : "（未填）"}
      </p>

      <h4 className="mini-label">分层状态</h4>
      <ul className="channel-layers">
        {LAYER_ORDER.map((k) => {
          const layer = findLayer(channel, k);
          const status = layer?.status ?? "unverified";
          return (
            <li key={k} className={`layer-chip tone-${toneOf(status)}`}>
              <span className="layer-name">
                {LAYER_COPY[k]?.title ?? k}
                <code>{k}</code>
              </span>
              <StatusText kind={k} status={status} />
              {layer?.summary ? <span className="layer-summary">{layer.summary}</span> : null}
            </li>
          );
        })}
      </ul>

      {channel.test_reply ? (
        <p className="test-reply">
          测试回复
          {channel.test_session ? (
            <>
              （会话 <code>{channel.test_session}</code>）
            </>
          ) : null}
          ：「{channel.test_reply}」
        </p>
      ) : null}

      {channel.screenshot_verify ? (
        <p className={`shot-verify tone-${toneOf(channel.screenshot_verify.status === "ok" ? "ok" : channel.screenshot_verify.status === "fail" ? "fail" : "unverified")}`}>
          <strong>
            {channel.screenshot_verify.label ||
              SCREENSHOT_VERIFY_LABEL[channel.screenshot_verify.status]}
          </strong>
          <code className="claim-raw">screenshot-verify={channel.screenshot_verify.status}</code>
          <span> {channel.screenshot_verify.detail}</span>
        </p>
      ) : null}

      {channel.tools.length > 0 ? (
        <>
          <h4 className="mini-label">工具对照</h4>
          <div className="table-wrap">
            <table className="tool-matrix">
              <thead>
                <tr>
                  <th scope="col">{COL_HEADER.tool}</th>
                  <th scope="col">{COL_HEADER.claimed}</th>
                  <th scope="col">{COL_HEADER.verified}</th>
                  <th scope="col">{COL_HEADER.note}</th>
                </tr>
              </thead>
              <tbody>
                {channel.tools.map((t) => (
                  <tr key={t.id}>
                    <th scope="row">
                      {t.name}
                      {t.api_name ? <code className="claim-raw">{t.api_name}</code> : null}
                    </th>
                    <td>
                      <span className={`status-text tone-${t.claimed ? "warn" : "neutral"}`}>
                        {t.claimed ? BOOL_CLAIM_LABEL.claimedYes : BOOL_CLAIM_LABEL.claimedNo}
                      </span>
                    </td>
                    <td>
                      <span className={`status-text tone-${t.verified ? "ok" : "unverified"}`}>
                        {t.verified ? BOOL_CLAIM_LABEL.verifiedYes : BOOL_CLAIM_LABEL.verifiedNo}
                      </span>
                    </td>
                    <td>{t.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted">尚未列出工具。登记不等于已有清单或验证。</p>
      )}

      <p className="hint">{channel.notes}</p>
      <p className="muted">
        最近探测 {formatShanghai(channel.last_probe_at)}
        {registered ? (
          <>
            {" · "}
            <button type="button" className="text-btn" onClick={() => onRemove(channel.id)}>
              移除
            </button>
          </>
        ) : null}
      </p>
        </>
      </MotionReveal>
      {expanded ? null : registered ? (
        <p className="muted">
          <button type="button" className="text-btn" onClick={() => onRemove(channel.id)}>
            移除
          </button>
        </p>
      ) : null}
    </article>
  );
}

function AddChannelTile({
  open,
  onOpen,
  onClose,
  onRegister,
  existingIds,
  style,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onRegister: (channel: ExternalChannel) => void;
  existingIds: string[];
  style?: CSSProperties;
}) {
  if (!open) {
    return (
      <button type="button" className="add-channel-tile" onClick={onOpen} style={style}>
        <span className="add-channel-plus" aria-hidden="true">
          +
        </span>
        <strong>
          <ArchiveText zh={ACTION.addChannel.zh} en={ACTION.addChannel.en} />
        </strong>
        <span>登记一个新的外部 AI：填写类型 kind 与接入点 endpoint。登记后仍需验证对话桥和插件。</span>
      </button>
    );
  }
  return (
    <AddChannelForm existingIds={existingIds} onCancel={onClose} onRegister={onRegister} />
  );
}

function slugify(value: string): string {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return ascii || "channel";
}

function emptyLayers(): ChannelLayer[] {
  return [
    { kind: "chat_bridge", status: "unverified", summary: "已登记，尚未做对话桥测试。" },
    { kind: "tool_inventory", status: "unverified", summary: "尚未列出 MCP / 工具。" },
    { kind: "tool_verify", status: "unverified", summary: "尚未逐项验证。" },
    { kind: "quota", status: "unverified", summary: "尚未探测配额。" },
  ];
}

function AddChannelForm({
  existingIds,
  onCancel,
  onRegister,
}: {
  existingIds: string[];
  onCancel: () => void;
  onRegister: (channel: ExternalChannel) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState(CHANNEL_KINDS[0]?.id ?? "custom");
  const [customKind, setCustomKind] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [error, setError] = useState<string | null>(null);

  const kindHint = useMemo(
    () => CHANNEL_KINDS.find((k) => k.id === kind)?.hint ?? "自定义类型需自行补适配器。",
    [kind],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const name = title.trim();
    const resolvedKind = (kind === "custom" ? customKind.trim() || "custom" : kind).replace(/\s+/g, "_");
    if (!name) {
      setError("请填写通道名称。");
      return;
    }
    if (!resolvedKind) {
      setError("请填写类型 kind。");
      return;
    }
    const base = `${resolvedKind}-${slugify(name)}`;
    let id = base;
    let n = 2;
    while (existingIds.includes(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    const ep = endpoint.trim() || null;
    onRegister({
      id,
      title: name,
      title_en: name,
      kind: resolvedKind,
      endpoint: ep,
      optional: true,
      source: "registered",
      layers: emptyLayers(),
      tools: [],
      inventory_claimed: 0,
      inventory_verified: 0,
      test_session: null,
      test_reply: null,
      screenshot_verify: null,
      notes: ep
        ? `已按 kind=${resolvedKind}、endpoint 登记。离线看板不会真的连出去；对话桥与插件仍是未验证。`
        : `已按 kind=${resolvedKind} 登记，但未填 endpoint。离线看板不会真的连出去；四层均未验证。`,
      last_probe_at: null,
    });
  }

  return (
    <form className="add-channel-form channel-card is-optional" onSubmit={handleSubmit}>
      <h3>
        <ArchiveText zh={ACTION.addChannel.zh} en={ACTION.addChannel.en} />
      </h3>
      <p className="section-hint">名称、类型 kind、接入点 endpoint。登记只写入本看板，不会调用真实接口。</p>
      {error ? <p className="form-error">{error}</p> : null}
      <label className="field">
        <span>名称</span>
        <input
          id="channel-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如 OpenHands 或自建助手"
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>类型 kind</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {CHANNEL_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}（{k.id}）
            </option>
          ))}
        </select>
      </label>
      {kind === "custom" ? (
        <label className="field">
          <span>自定义 kind</span>
          <input
            value={customKind}
            onChange={(e) => setCustomKind(e.target.value)}
            placeholder="my_adapter"
            autoComplete="off"
          />
        </label>
      ) : null}
      <p className="muted">{kindHint}</p>
      <label className="field">
        <span>接入点 endpoint</span>
        <input
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://…、stdio 命令或 desktop://App"
          autoComplete="off"
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="icon-btn add-channel-btn">
          <ArchiveText zh="登记到通道区" en="SAVE CHANNEL" />
        </button>
        <button type="button" className="icon-btn" onClick={onCancel}>
          <ArchiveText zh={ACTION.cancel.zh} en={ACTION.cancel.en} />
        </button>
      </div>
    </form>
  );
}


function liveProbeLine(row: LiveProbeRow): string {
  const parts: string[] = [];
  if (row.found === true) parts.push(CHANNEL_PROBE.found);
  else if (row.found === false) parts.push(CHANNEL_PROBE.notFound);
  if (row.listening === true) parts.push(CHANNEL_PROBE.listening);
  else if (row.listening === false) parts.push(CHANNEL_PROBE.notListening);
  if (row.catalog === "ok") parts.push(CHANNEL_PROBE.catalogOk);
  else if (row.catalog === "fail") parts.push(CHANNEL_PROBE.catalogFail);
  else if (row.origin === "discover-only" && !row.catalog_note) parts.push(CHANNEL_PROBE.noScanner);
  else parts.push(CHANNEL_PROBE.catalogNa);
  if (row.catalog_note) parts.push(row.catalog_note);
  if (row.model_count > 0) parts.push(CHANNEL_PROBE.models(row.model_count));
  if (row.auth_missing) {
    parts.push(row.auth_ref ? `${CHANNEL_PROBE.authMissing} ${row.auth_ref}` : CHANNEL_PROBE.authMissing);
  }
  if (row.error) parts.push(row.error);
  return parts.join(" · ");
}

function LiveProbeSummary({ row, ran }: { row?: LiveProbeRow; ran: boolean }) {
  if (!ran) {
    return <span className="muted">{CHANNEL_PROBE.notRun}</span>;
  }
  if (!row) {
    return <span className="muted">{CHANNEL_PROBE.noScanner}</span>;
  }
  return (
    <span className={`probe-live-summary tone-${probeTone(row)}`}>
      {liveProbeLine(row)}
    </span>
  );
}

function probeTone(row: LiveProbeRow): string {
  if (!row.wired) return "warn";
  if (row.error && row.catalog !== "ok") return "bad";
  if (row.auth_missing) return "warn";
  if (row.catalog === "ok" || row.found) return "info";
  if (row.found === false) return "unverified";
  return "neutral";
}

function LiveProbePanel({
  bridgeOnline,
  probe,
}: {
  bridgeOnline: boolean;
  probe: ReturnType<typeof useChannelProbe>;
}) {
  const report = probe.report;
  return (
    <section className="live-probe" aria-labelledby="live-probe-heading">
      <div className="live-probe-head">
        <h3 className="subhead" id="live-probe-heading">
          <ArchiveText zh={CHANNEL_PROBE.titleZh} en={CHANNEL_PROBE.titleEn} />
        </h3>
        <button
          type="button"
          className="icon-btn add-channel-btn"
          onClick={() => void probe.run()}
          disabled={probe.busy || !bridgeOnline}
        >
          <ArchiveText
            zh={
              probe.busy && probe.progress.total > 0
                ? CHANNEL_PROBE.probingProgress(probe.progress.done, probe.progress.total).zh
                : probe.busy
                  ? ACTION.probing.zh
                  : ACTION.probeChannels.zh
            }
            en={
              probe.busy && probe.progress.total > 0
                ? CHANNEL_PROBE.probingProgress(probe.progress.done, probe.progress.total).en
                : probe.busy
                  ? ACTION.probing.en
                  : ACTION.probeChannels.en
            }
          />
        </button>
      </div>
      <p className="section-hint">{CHANNEL_PROBE.hint}</p>
      {!bridgeOnline || probe.report?.offline ? <p className="callout callout-warn">{CHANNEL_PROBE.offline}</p> : null}
      {probe.report?.missing_route && !probe.busy ? (
        <p className="callout callout-warn">{CHANNEL_PROBE.missingRoute}</p>
      ) : null}
      <p className="hint" aria-live="polite">
        {probe.message}
      </p>
      {report ? (
        <>
          <p className="muted">
            本次探测 {formatShanghai(report.ran_at)}
            {report.discover_error ? ` · 发现：${report.discover_error}` : null}
            {report.health_error ? ` · 健康检查：${report.health_error}` : null}
          </p>
          {report.rows.length ? (
            <div className="table-wrap">
              <table className="channel-matrix">
                <caption className="visually-hidden">本页实机探测结果，不是对话桥或工具核实</caption>
                <thead>
                  <tr>
                    <th scope="col">{COL_HEADER.interface}</th>
                    <th scope="col">{COL_HEADER.kind}</th>
                    <th scope="col">{COL_HEADER.liveProbe}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">
                        {row.display_name}
                        {row.scanner_id ? <code className="claim-raw">{row.scanner_id}</code> : null}
                        <span className="pill source-pill-live">{CHANNEL_PROBE.sourceLive}</span>
                      </th>
                      <td>
                        <code>{row.kind ?? "—"}</code>
                      </td>
                      <td className="probe-live-cell">
                        <LiveProbeSummary row={row} ran />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="section-hint">{CHANNEL_PROBE.noTargets}</p>
          )}
          {report.health_notes.length ? (
            <div className="probe-facts">
              <h4 className="mini-label">{CHANNEL_PROBE.healthTitle}</h4>
              <ul>
                {report.health_notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.workbuddy_models.attempted ? (
            <p className="section-hint">
              {CHANNEL_PROBE.workbuddyModels}
              {report.workbuddy_models.ok
                ? `：${CHANNEL_PROBE.models(report.workbuddy_models.count)}${
                    report.workbuddy_models.current ? `，当前 ${report.workbuddy_models.current}` : ""
                  }`
                : `：${report.workbuddy_models.error ?? "未取得目录"}`}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

const AUTH_STATUS_LABEL: Record<string, string> = {
  none_required: "无需密钥",
  missing: "缺少凭据，请填写密钥",
  from_process_env: "已从本机进程读取，不必再填",
  from_env: "已在环境变量中",
  user_provided_ref: "已用本会话填写的密钥",
  unverified: "登录与对话能力未验证",
  desktop_login_unverified: "桌面登录态未核验（不向你要 API Key）",
};

function layerLabel(iface: { pid?: number | null; transport?: string; layers: { found: boolean; listening: boolean; authenticated: boolean; chat_ok: boolean } }) {
  const L = iface.layers;
  const parts = [
    L.found ? "已发现本机痕迹" : "未找到",
    iface.pid ? `正在运行（PID ${iface.pid}）` : "未发现运行进程",
    L.listening ? "服务端口可访问" : iface.transport === "cli" ? "CLI 不需要监听端口" : "未验证服务端口",
    L.authenticated ? "凭据已就位 authenticated" : "登录未核验",
    L.chat_ok ? "对话已验证" : "对话未核验",
  ];
  return parts.join(" · ");
}

function LocalDiscoverPanel({ bridge }: { bridge: BridgeView }) {
  const report: DiscoverReport | null = bridge.discover;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function onRefresh() {
    setBusy(true);
    setMessage(null);
    const err = await bridge.refreshDiscover();
    setBusy(false);
    setMessage(err || "已重新扫描本机（只读，未重启任何 AI 进程）");
  }

  async function onSubmit(interfaceId: string, authRef: string) {
    const secret = drafts[interfaceId] || "";
    if (!secret.trim()) {
      setMessage("请填写密钥后再保存。密钥只会进入桥接进程的环境变量，不会写入状态、日志或 Git。");
      return;
    }
    setBusy(true);
    setMessage(null);
    const err = await bridge.submitCredential(interfaceId, authRef, secret);
    setBusy(false);
    if (!err) {
      setDrafts((prev) => ({ ...prev, [interfaceId]: "" }));
      setMessage("密钥已交给桥接（只记环境变量名 " + authRef + "），未写入磁盘。");
    } else {
      setMessage(err);
    }
  }

  return (
    <section className="local-discover" aria-labelledby="local-discover-heading">
      <h3 className="subhead" id="local-discover-heading">
        本机接口发现 <code>GET /bridge/discover</code>
      </h3>
      <p className="section-hint">
        操作台会自动扫描本机进程、PATH、常见安装目录和环回端口。你不必填写端口、安装路径或进程号。
        只有「已经发现接口但缺少凭据」时才需要填写密钥。发现成功不等于可对话（<code>chat_ok</code> 不会由扫描置位）。
      </p>
      <p>
        <button type="button" className="icon-btn" onClick={() => void onRefresh()} disabled={busy || !bridge.online}>
          {busy ? "正在扫描…" : "刷新发现"}
        </button>
        {report?.scanned_at ? (
          <span className="section-hint"> 上次扫描 {formatShanghai(report.scanned_at)}（{report.machine?.hostname || "本机"}）</span>
        ) : (
          <span className="section-hint"> {bridge.online ? "尚未收到发现结果" : "桥接未启动，无法扫描"}</span>
        )}
      </p>
      {report?.interfaces.some(iface => iface.kind === "proxy") ? <p className="section-hint">网络环境：已发现本机代理服务（网络辅助设施，不属于 AI 软件，也不代表 AI 接口可用）。</p> : null}
      {report?.notes?.length ? <p className="section-hint">{report.notes.join("；")}</p> : null}
      {message ? <p className="callout callout-info">{message}</p> : null}
      {report?.interfaces?.length ? (
        <div className="table-wrap">
          <table className="channel-matrix">
            <caption className="visually-hidden">本机扫描到的 AI 接口</caption>
            <thead>
              <tr>
                <th scope="col">{COL_HEADER.interface}</th>
                <th scope="col">{COL_HEADER.transport}</th>
                <th scope="col">{COL_HEADER.layers}</th>
                <th scope="col">{COL_HEADER.credentials}</th>
              </tr>
            </thead>
            <tbody>
              {report.interfaces.filter((iface) => iface.kind !== "proxy").map((iface) => (
                <tr key={iface.id}>
                  <th scope="row">
                    {iface.display_name} <code>{iface.kind}</code>
                    {iface.source?.length ? <div className="section-hint">来源：{iface.source.join(" / ")}</div> : null}
                    {iface.notes?.length ? <div className="section-hint">{iface.notes.join("；")}</div> : null}
                    {iface.endpoint ? (
                      <div className="section-hint">
                        <code>{iface.endpoint}</code>
                      </div>
                    ) : iface.cli_path || iface.exe_path ? (
                      <div className="section-hint">
                        <code>{iface.cli_path || iface.exe_path}</code>
                      </div>
                    ) : null}
                  </th>
                  <td>
                    <code>{iface.transport}</code>
                  </td>
                  <td>{layerLabel(iface)}
                    <div className="section-hint">缺少什么：{interfaceGuidance(iface).missing}</div>
                    <div className="section-hint">你需要做：{interfaceGuidance(iface).user}</div>
                    <div className="section-hint">项目需要补充：{interfaceGuidance(iface).development}</div>
                  </td>
                  <td>
                    {AUTH_STATUS_LABEL[iface.auth_status] || iface.auth_status}
                    {iface.auth_ref ? (
                      <>
                        {" "}
                        <code>{iface.auth_ref}</code>
                      </>
                    ) : null}
                    {iface.auth_needed && iface.auth_ref ? (
                      <form
                        className="secret-form"
                        onSubmit={(e: FormEvent) => {
                          e.preventDefault();
                          void onSubmit(iface.id, iface.auth_ref as string);
                        }}
                      >
                        <label>
                          密钥
                          <input
                            type="password"
                            autoComplete="off"
                            name={`secret-${iface.id}`}
                            value={drafts[iface.id] || ""}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [iface.id]: e.target.value }))}
                          />
                        </label>
                        <button type="submit" className="icon-btn" disabled={busy}>
                          保存到环境变量
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="section-hint">还没有发现结果。桥接启动后会自动扫描；也可点「刷新发现」。</p>
      )}
      {report?.needs_credential?.length ? (
        <p className="callout callout-info">
          <strong className="callout-title">需要填写密钥</strong>
          {report.needs_credential.map((n) => n.prompt).join(" ")}
        </p>
      ) : null}
    </section>
  );
}
