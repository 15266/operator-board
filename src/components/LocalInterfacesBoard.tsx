import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { MotionFold, MotionSurface } from "./Motion";
import { Panel } from "./Panel";
import { extractCard, markUserNav, onContentPresented, waveStyle } from "../lib/motion";
import { ACTION, COL_HEADER, PANEL_COPY } from "../lib/copy";
import { ArchiveText } from "./ArchiveText";
import {
  INTERFACE_STATUS_LABEL,
  SESSION_PENDING_SENTENCE,
  postScanProbe,
  postScanPromote,
  prefilledAdvancedOpen,
  rowAuthRef,
  rowBaseUrl,
  rowTransport,
  saveScannerSecret,
  shouldShowKeyField,
  type ActionResult,
  type InterfaceRow,
  type InterfaceUiStatus,
  type ScannerBoardView,
} from "../lib/scannerBoard";
import { loadPreferredModels, savePreferredModel } from "../lib/preferredModels";

function StatusText({ status }: { status: InterfaceUiStatus }) {
  const meta = INTERFACE_STATUS_LABEL[status];
  return (
    <span className={`status-text tone-${meta.tone}`}>
      {meta.text}
      <code className="claim-raw">{meta.code}</code>
    </span>
  );
}

function shanghai(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（Asia/Shanghai）`;
}

function InterfaceHowto() {
  return (
    <div className="howto-body">
      <p>
        本页采用「先总览、再点进详情」的两级结构：总览只回答「登记了哪些扫描器、本次扫描各处于什么状态」，密钥和高级字段放在详情。布局依据 Grafana
        dashboard best practices（从一般到具体，总览回答一个问题，详情靠点击进入；不要把总览挤满）：
        {" "}
        <a href="https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/">
          grafana.com/docs/…/best-practices
        </a>
        。侧栏 + hash（<code>#interfaces</code> / <code>#interfaces/:id</code>）沿用本看板任务页的既有结构。
      </p>
      <p>
        行、名称和状态全部来自扫描器注册表 <code>registry.json</code> 与 <code>POST /bridge/scan</code> 的{" "}
        <code>DiscoveryRecord</code>。新增一种本机 AI，只需增加扫描器插件并写入注册表，本页会自动多一行；页面里没有按厂商写死的分支。
        <code>_template</code> / <code>status: skeleton</code> 不会当成已发现的活接口。
      </p>
      <p>下列产品只作交互参考，不能当成同一种发现模型，也不表示它们已在本机连接（不复制商标或铬件）：</p>
      <ul>
        <li>
          <strong>AnythingLLM</strong> 最接近「打开即可发现」：并行探测 <code>127.0.0.1</code> /{" "}
          <code>host.docker.internal</code> / <code>172.17.0.1</code>，常见端口如 11434 与 1234/v1，超时约 2 秒；成功后预填{" "}
          <code>base_url</code> 并收起高级项。第一次进入本页可自动扫描一次，之后请用「扫描本机常见端口」。
        </li>
        <li>
          <strong>Open WebUI</strong> 走 Admin → Connections，启动时对已声明端口做约 1 秒 TCP（如 11434 / 12434），另有独立的
          Verify。本台<strong>不</strong>照搬「只靠 toast、列表上没有文字状态」的做法，状态必须常驻文字 + 成对色。
        </li>
        <li>
          <strong>Continue</strong> <em>不会</em>扫描多个地址：它使用已配置的默认 URL，再对这个 URL 做{" "}
          <code>AUTODETECT</code>（<code>GET /api/tags</code>）。不要把 Continue 写成多地址端口扫描。
        </li>
        <li>
          <strong>LibreChat</strong> <em>没有</em>本机端口自动发现。可借鉴的只有云端「Set API Key，<code>baseURL</code>{" "}
          可选」对话框；不要学它为本地服务在配置里写一个假占位密钥。
        </li>
      </ul>
      <p>
        已发现只表示短探测（例如 <code>GET /api/tags</code>、<code>/api/version</code>、<code>/v1/models</code> 或
        TCP）有应答，不是 <code>chat_bridge=ok</code>，也不是工具核实。填写密钥或发现进程不等于已核实。列出模型 ≠{" "}
        <code>tools_verified</code>。
      </p>
    </div>
  );
}

export function LocalInterfacesBoard({
  board,
  selectedId,
  onSelect,
}: {
  board: ScannerBoardView;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const copy = PANEL_COPY.interfaces;
  const selected = selectedId ? board.rows.find((row) => row.scanner_id === selectedId) ?? null : null;
  const boardRef = useRef<HTMLDivElement>(null);
  // Where focus should land after the list ↔ detail switch actually commits.
  const pendingFocus = useRef<"list" | "detail" | null>(null);

  useEffect(() => {
    return onContentPresented(() => {
      const intent = pendingFocus.current;
      if (!intent) return;
      const root = boardRef.current;
      pendingFocus.current = null;
      if (!root) return;
      const target =
        intent === "detail"
          ? root.querySelector<HTMLElement>(".interface-detail")
          : root.querySelector<HTMLElement>("a.interface-card");
      target?.focus({ preventScroll: true });
    });
  }, [selectedId]);

  function openInterface(id: string, element: HTMLElement | null) {
    markUserNav();
    pendingFocus.current = "detail";
    extractCard(element, () => onSelect(id));
  }

  function backToAll() {
    markUserNav();
    pendingFocus.current = "list";
    onSelect(null);
  }

  const actions = (
    <button
      type="button"
      className="icon-btn add-channel-btn"
      onClick={() => void board.refresh()}
      disabled={board.scanning}
      aria-busy={board.scanning}
    >
      {board.scanning ? (
        <ArchiveText zh={ACTION.scanning.zh} en={ACTION.scanning.en} />
      ) : (
        <ArchiveText zh={ACTION.scanPorts.zh} en={ACTION.scanPorts.en} />
      )}
    </button>
  );

  return (
    <Panel
      id="interfaces"
      titleZh={copy.titleZh}
      titleEn={copy.titleEn}
      purpose={copy.purpose}
      howto={<InterfaceHowto />}
      tool={copy.tool}
      actions={board.example || !selected ? actions : undefined}
    >
      <div className="interface-board-root" ref={boardRef}>
        {board.example ? (
          <p className="callout callout-warn" role="status">
            <strong className="callout-title">这是示例，不是本机实机扫描</strong>
            下列行来自只读的 <code>registry.json</code> 与 <code>scanners.example.json</code> 副本。每条示例的{" "}
            <code>tools_verified</code> 均为 <code>false</code>，<code>chat_bridge</code> 均为 <code>unverified</code>
            。不能把它们写成这台机器上已经扫到或已连通。
          </p>
        ) : null}

        {!board.example && (board.catalogAvailability === "missing_route" || board.catalogAvailability === "offline") && !board.scanned ? (
          <EmptyState
            title={board.catalogAvailability === "offline" ? "本机桥接未接通" : "本机桥接尚未提供扫描接口"}
            titleEn={board.catalogAvailability === "offline" ? "BRIDGE OFFLINE" : "SCAN ROUTE MISSING"}
            description={
              <>
                无法读取 <code>GET /bridge/scanners</code>
                {board.catalogAvailability === "missing_route" ? " 或 " : "，也就还不能调用 "}
                <code>POST /bridge/scan</code>
                。{board.lastError ? `（${board.lastError}）` : null}
                没有编造本机发现结果。若只要看版式，可以打开标注过的示例。
              </>
            }
            action={
              <button type="button" className="icon-btn add-channel-btn" onClick={board.useExample}>
                <ArchiveText zh={ACTION.viewExample.zh} en={ACTION.viewExample.en} />
              </button>
            }
          />
        ) : selectedId && !selected ? (
          <EmptyState
            title="未找到该扫描器"
            titleEn="ENTRY NOT FOUND"
            description="地址里的 id 不在当前注册表中。可能尚未登记，或它是仅供复制的骨架模板。"
            action={
              <button type="button" className="icon-btn" onClick={backToAll}>
                <ArchiveText zh={ACTION.allInterfaces.zh} en={ACTION.allInterfaces.en} />
              </button>
            }
          />
        ) : selected ? (
          <MotionSurface token={selected.scanner_id} className="interface-detail" focusable>
            {() => (
              <InterfaceDetail
                row={selected}
                board={board}
                onBack={() => {
                  markUserNav();
                  pendingFocus.current = "list";
                  onSelect(null);
                }}
              />
            )}
          </MotionSurface>
        ) : (
          <InterfaceList board={board} onOpen={openInterface} />
        )}
      </div>
    </Panel>
  );
}

function InterfaceList({
  board,
  onOpen,
}: {
  board: ScannerBoardView;
  onOpen: (id: string, element: HTMLElement | null) => void;
}) {
  if (!board.example && !board.scanned && board.catalogAvailability === "ok") {
    return (
      <EmptyState
        title={board.scanning ? "正在扫描本机常见端口" : "尚未扫描"}
        titleEn={board.scanning ? "SCANNING LOCAL PORTS" : "NOT YET SCANNED"}
        description="第一次进入本页会自动请求一次 POST /bridge/scan（live 默认 false）。扫描成功只更新发现态，不会把 chat_bridge 标为已通。"
      />
    );
  }

  if (board.rows.length === 0) {
    return (
      <EmptyState
        title="注册表里还没有可展示的扫描器"
        titleEn="EMPTY REGISTRY"
        description="跳过了骨架模板。向 registry.json 增加一条非 skeleton 的扫描器后，这里会自动多一行，不必改本页代码。"
      />
    );
  }

  return (
    <div className="ifx-archive interface-list-wrap" aria-busy={board.scanning}>
      <div className={`scan-veil${board.scanning ? " is-active" : ""}`} aria-hidden="true">
        <span className="scan-band" />
      </div>

      <header className="ifx-masthead">
        <p className="ifx-mast-kicker">
          <span>Local Interface Index</span>
          <span>{board.example ? "example ledger" : board.scanned ? "registry / scan" : "registry"}</span>
        </p>
        <p className="ifx-mast-line">
          共 {board.summary.total} 条登记，{board.summary.discovered} 条已发现。点任意行抽取详情。
        </p>
        <dl className="ifx-stats">
          <div>
            <dt>登记</dt>
            <dd>{board.summary.total}</dd>
          </div>
          <div>
            <dt>已发现</dt>
            <dd>{board.summary.discovered}</dd>
          </div>
          <div>
            <dt>缺密钥</dt>
            <dd>{board.summary.missing_key}</dd>
          </div>
          <div>
            <dt>未验证</dt>
            <dd>{board.summary.registered_unverified}</dd>
          </div>
          <div>
            <dt>未找到</dt>
            <dd>{board.summary.not_found}</dd>
          </div>
        </dl>
      </header>

      {board.scanning ? (
        <p className="scan-note" role="status">
          <span className="scan-note-dot" aria-hidden="true" />
          正在扫描本机常见端口 · 结果会逐行覆盖下方档案
        </p>
      ) : null}


      <MotionFold className="ifx-fold" summary="扫描口径与限制">
        <p>
          行按注册表列出扫描器，并与最近一次 <code>DiscoveryRecord</code> 合并；没有记录显示「未找到」。扫到只表示服务有应答，不是{" "}
          <code>chat_bridge</code> 已通，也不会改工具核实。云端提供商若声明 <code>auth.mode=user_secret</code>
          ，通常只需在详情里粘贴密钥。
        </p>
      </MotionFold>

      <div className="ifx-table-head" aria-hidden="true">
        <span>{COL_HEADER.no}</span>
        <span>{COL_HEADER.interface}</span>
        <span>{COL_HEADER.transport}</span>
        <span>{COL_HEADER.endpoint}</span>
        <span>{COL_HEADER.status}</span>
        <span />
      </div>

      <ul className="interface-grid ifx-rows motion-cards">
        {board.rows.map((row, index) => {
          const baseUrl = rowBaseUrl(row);
          const kind = rowTransport(row);
          return (
            <li key={row.scanner_id} style={waveStyle(index)}>
              <a
                href={`#interfaces/${encodeURIComponent(row.scanner_id)}`}
                className="channel-card interface-card ifx-row motion-card"
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(row.scanner_id, e.currentTarget);
                }}
              >
                <span className="ifx-no">{String(index + 1).padStart(2, "0")}</span>
                <span className="ifx-name">
                  <strong>{row.display_name}</strong>
                  <small>{row.scanner_id}</small>
                  {row.sessionPendingVerify ? <em className="ifx-flag">待实机核实</em> : null}
                </span>
                <span className="ifx-kind">
                  {kind ? <code>{kind}</code> : <span className="ifx-dash">—</span>}
                </span>
                <span className="ifx-endpoint">
                  {baseUrl ? <code>{baseUrl}</code> : <span className="ifx-dash">未预填</span>}
                </span>
                <span className="ifx-status">
                  <StatusText status={row.uiStatus} />
                </span>
                <span className="ifx-arrow" aria-hidden="true">
                  →
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InterfaceDetail({
  row,
  board,
  onBack,
}: {
  row: InterfaceRow;
  board: ScannerBoardView;
  onBack: () => void;
}) {
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRef, setSavedRef] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(() => prefilledAdvancedOpen(row));

  useEffect(() => {
    setSecret("");
    setShowSecret(false);
    setSaveError(null);
    setSavedRef(null);
    setCustomModel("");
    {
      const preferred = loadPreferredModels()[row.scanner_id] || "";
      const names = new Set(
        [row.record?.evidence.current_model, ...(row.record?.evidence.model_names ?? [])].filter(
          (item): item is string => Boolean(item),
        ),
      );
      if (preferred && names.has(preferred)) {
        setSelectedModel(preferred);
        setCustomModel("");
      } else if (preferred) {
        setSelectedModel("");
        setCustomModel(preferred);
      } else {
        setSelectedModel(row.record?.evidence.current_model ?? "");
        setCustomModel("");
      }
    }
    setConfirmPromote(false);
    setActionMessage(null);
    setAdvancedOpen(prefilledAdvancedOpen(row));
  }, [row.scanner_id]);

  const authRef = rowAuthRef(row);
  const baseUrl = rowBaseUrl(row);
  const catalogNames = row.record?.evidence.model_names ?? [];
  const currentModel = row.record?.evidence.current_model;
  const catalogInfo = row.record?.evidence.model_catalog;
  const models = Array.from(new Set([currentModel, ...catalogNames].filter((x): x is string => Boolean(x))));
  const showKey = shouldShowKeyField(row) && !savedRef;
  const kind = rowTransport(row);
  const probeReason =
    board.probeWired === false ? "桥接尚未提供 POST /bridge/scan/probe，无法执行此操作。" : null;
  const promoteReason =
    board.promoteWired === false ? "桥接尚未提供 POST /bridge/scan/promote，无法登记实例草稿。" : null;

  async function onSaveKey(event: FormEvent) {
    event.preventDefault();
    if (!authRef) {
      setSaveError("此记录没有可写入的环境变量名 auth_ref。");
      return;
    }
    const value = secret;
    setSaving(true);
    setSaveError(null);
    const result = await saveScannerSecret(row.scanner_id, authRef, value);
    setSaving(false);
    if (result.ok) {
      setSecret("");
      setShowSecret(false);
      setSavedRef(result.auth_ref ?? authRef);
      board.markCredentialsWired(true);
    } else {
      if (result.error?.includes("尚未提供")) board.markCredentialsWired(false);
      setSaveError(result.error ?? "保存失败");
    }
  }

  async function runProbe(kind: "config" | "verify" | "live") {
    setActionBusy(kind);
    setActionMessage(null);
    const result: ActionResult = await postScanProbe(row.scanner_id, kind === "live");
    setActionBusy(null);
    if (!result.wired) {
      board.markProbeWired(false);
      setActionMessage(result.error ?? probeReason ?? "此操作尚未接通");
      return;
    }
    board.markProbeWired(true);
    if (!result.ok) {
      setActionMessage(result.error ?? "探测失败");
      return;
    }
    if (kind === "live") {
      setActionMessage("已请求实机探活。即便成功，也只有后续核实流程才能把 chat_bridge 标为已通，并且仍不会改工具层。");
    } else if (kind === "verify") {
      setActionMessage("已请求验证连接（目录 / 版本探测）。这只升级发现态，不是 chat_bridge=ok。");
    } else {
      setActionMessage("已请求检查配置（非 live）。此项不得把 chat_bridge 标绿。");
    }
  }

  async function runPromote() {
    if (!confirmPromote) {
      setActionMessage("请先勾选确认，才会把此接口登记为实例草稿。");
      return;
    }
    setActionBusy("promote");
    setActionMessage(null);
    const result = await postScanPromote(row.scanner_id);
    setActionBusy(null);
    if (!result.wired) {
      board.markPromoteWired(false);
      setActionMessage(result.error ?? promoteReason ?? "此操作尚未接通");
      return;
    }
    board.markPromoteWired(true);
    if (!result.ok || !result.draft) {
      setActionMessage(result.error ?? "登记草稿失败");
      return;
    }
    board.registerLocalDraft(result.draft);
    setActionMessage(
      `已确认并保存实例草稿（变量名 ${result.draft.auth_ref ?? "（无）"}，不含密钥）。四层仍是未验证，不能写成已连通。`,
    );
  }

  const evidence = row.record?.evidence;
  const entryNo = board.rows.findIndex((item) => item.scanner_id === row.scanner_id) + 1;
  const hasAdvancedFacts = !!(
    baseUrl ||
    evidence?.open_ports?.length ||
    evidence?.path_hits?.length ||
    evidence?.install_dirs?.length ||
    evidence?.process_names?.length
  );

  return (
    <>
      <p className="workspace-crumb">
        <button type="button" className="text-btn" onClick={onBack}>
          <ArchiveText zh={ACTION.allInterfaces.zh} en={ACTION.allInterfaces.en} />
        </button>
        <span aria-hidden="true"> / </span>
        <span>{row.display_name}</span>
      </p>
      <header className="interface-detail-head ifx-detail-head">
        <h3>
          <span className="ifx-detail-no">
            ENTRY {entryNo > 0 ? String(entryNo).padStart(2, "0") : "—"} ·{" "}
            {board.example ? "EXAMPLE" : "REGISTRY"}
          </span>
          {row.display_name}
          {kind ? <code className="title-en">{kind}</code> : null}
        </h3>
        <div className="ifx-detail-side">
          <StatusText status={row.uiStatus} />
          <small>{row.scanner_id}</small>
        </div>
      </header>
      {row.sessionPendingVerify ? (
        <p className="callout callout-info" role="status">
          {SESSION_PENDING_SENTENCE}。已有会话仍不能写成已连通。
        </p>
      ) : null}
      <MotionFold className="ifx-fold" summary="核实口径">
        <p>
          已发现或已保存密钥 ≠ 已核实对话或插件。发现记录里的 <code>chat_bridge</code> 保持{" "}
          <code>unverified</code>，<code>tools_verified</code> 保持 <code>false</code>。
        </p>
      </MotionFold>

      {savedRef ? (
        <p className="interface-saved" role="status">
          密钥已交给环境变量 <code>{savedRef}</code>。界面不会再次显示密钥本身。这不会把{" "}
          <code>chat_bridge</code> 升级为已通。
        </p>
      ) : null}

      {showKey ? (
        <form className="interface-secret-form" onSubmit={onSaveKey} autoComplete="off">
          <label className="field" htmlFor={`secret-${row.scanner_id}`}>
            密钥（只保存在本机桥接进程环境；不会写入 instances.json 或仓库）
            <span className="secret-input-row">
              <input
                id={`secret-${row.scanner_id}`}
                type={showSecret ? "text" : "password"}
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                name={`scanner-secret-${row.scanner_id}`}
              />
              <button
                type="button"
                className="icon-btn"
                aria-pressed={showSecret}
                aria-label={showSecret ? "隐藏密钥" : "显示密钥"}
                onClick={() => setShowSecret((v) => !v)}
              >
                {showSecret ? "隐藏" : "显示"}
              </button>
            </span>
          </label>
          {authRef ? (
            <p className="field-hint">
              环境变量名 <code>auth_ref</code> / <code>api_key_env</code>：<code>{authRef}</code>
            </p>
          ) : (
            <p className="form-error">此扫描器声明需要密钥，但记录里没有合法的变量名。</p>
          )}
          {saveError ? (
            <p className="form-error" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="icon-btn add-channel-btn" disabled={saving || !authRef}>
              {saving ? "正在保存…" : "保存到环境变量"}
            </button>
          </div>
        </form>
      ) : (row.record?.auth.mode ?? row.catalog.auth_mode) === "none" ||
        row.record?.auth.needs_user_secret === false ? (
        <p className="muted">
          此扫描器的清单声明通常不必填写密钥（<code>auth.mode</code> 为{" "}
          <code>{row.record?.auth.mode ?? row.catalog.auth_mode ?? "none"}</code>
          ）。这不是按某个厂商 id 写死的例外。
        </p>
      ) : authRef && !showKey ? (
        <p className="muted">
          变量名 <code>{authRef}</code> 已登记。未再打开密钥框，因为当前记录不要求补填密钥。
        </p>
      ) : null}

      <MotionFold
        className="interface-advanced"
        summary="高级（可选）"
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
      >
        <p className="field-hint">
          探测成功后会预填 <code>base_url</code> / endpoint。端口、安装路径和进程信息若出现在证据里，只作只读展示，不是必填项。使用本接口不必手填这些字段。
        </p>
        <dl className="interface-advanced-list">
          <div>
            <dt>
              接口根地址 <code>base_url</code>
            </dt>
            <dd>{baseUrl ? <code>{baseUrl}</code> : "尚未预填"}</dd>
          </div>
          {evidence?.open_ports?.length ? (
            <div>
              <dt>已观察端口（只读）</dt>
              <dd>
                {evidence.open_ports.map((p) => (
                  <code key={`${p.host}:${p.port}`}>
                    {p.host}:{p.port}
                  </code>
                ))}
              </dd>
            </div>
          ) : null}
          {evidence?.path_hits?.length ? (
            <div>
              <dt>PATH 命中（只读）</dt>
              <dd>
                {evidence.path_hits.map((p) => (
                  <code key={p}>{p}</code>
                ))}
              </dd>
            </div>
          ) : null}
          {evidence?.install_dirs?.length ? (
            <div>
              <dt>安装目录（只读）</dt>
              <dd>
                {evidence.install_dirs.map((p) => (
                  <code key={p}>{p}</code>
                ))}
              </dd>
            </div>
          ) : null}
          {evidence?.process_names?.length ? (
            <div>
              <dt>进程名（只读）</dt>
              <dd>{evidence.process_names.join("、")}</dd>
            </div>
          ) : null}
          {!hasAdvancedFacts ? <p className="muted">此次记录未返回高级字段。不必手填端口或路径。</p> : null}
        </dl>
      </MotionFold>

      <div className="interface-models">
        <label className="field" htmlFor={`model-${row.scanner_id}`}>
          模型 <code>model</code>
          {models.length > 0 ? (
            <select
              id={`model-${row.scanner_id}`}
              value={selectedModel}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedModel(value);
                if (!customModel.trim()) savePreferredModel(row.scanner_id, value || null);
              }}
            >
              <option value="">未选择（列出模型 ≠ 工具核实）</option>
              {models.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <select id={`model-${row.scanner_id}`} disabled value="">
              <option value="">未列出模型</option>
            </select>
          )}
        </label>
        <label className="field" htmlFor={`model-custom-${row.scanner_id}`}>
          可选：手填模型名（不会把 <code>tools_verified</code> 标真）
          <input
            id={`model-custom-${row.scanner_id}`}
            value={customModel}
            onChange={(e) => {
              const value = e.target.value;
              setCustomModel(value);
              savePreferredModel(row.scanner_id, value.trim() || selectedModel || null);
            }}
          />
        </label>
        {(() => {
          const catalogOk = catalogInfo?.ok === true && catalogNames.length > 0;
          const published = catalogInfo?.source === "published_docs" && catalogNames.length > 0;
          const asOf = catalogInfo?.published_as_of;
          let hintText = "可以手填模型名。在本页选中的模型，会在任务页派发该 AI 时使用。列出模型不等于已经核实可派发。";
          if (row.uiStatus === "not_found") {
            hintText = "尚未发现此接口，因此没有请求模型目录。";
          } else if (published) {
            hintText = asOf
              ? `已填入官方公开模型名单（截至 ${asOf}），不是本机接口返回的实时目录。列出模型不等于已经核实可派发，也可以手填。`
              : "已填入官方公开模型名单，不是本机接口返回的实时目录。列出模型不等于已经核实可派发，也可以手填。";
          } else if (catalogOk) {
            hintText = "已从本机接口请求到模型目录。列出模型不等于已经核实可派发。";
          } else if (currentModel && catalogInfo?.attempted) {
            hintText = "已请求模型目录，这个接口没有返回完整列表。已填入当前选用的模型，也可以手填。";
          } else if (currentModel && catalogInfo && catalogInfo.attempted === false) {
            hintText = "这个接口没有官方模型目录接口。已填入当前选用的模型，也可以手填。";
          } else if (catalogInfo?.attempted) {
            hintText = "已请求模型目录，这个接口没有返回列表，可以手填模型名。";
          } else if (catalogInfo && catalogInfo.attempted === false) {
            hintText = "这个接口没有官方模型目录接口，可以手填模型名。";
          }
          if (row.uiStatus !== "not_found" && !hintText.includes("会在任务页派发")) {
            hintText += "在本页选中的模型，会在任务页派发该 AI 时使用。";
          }
          return <p className="field-hint">{hintText}</p>;
        })()}
      </div>

      <div className="interface-actions">
        <h3 className="subhead">探测动作（文案必须分开）</h3>
        <div className="form-actions">
          <button
            type="button"
            className="icon-btn"
            disabled={!!probeReason || actionBusy !== null || board.example}
            onClick={() => void runProbe("config")}
          >
            检查配置
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={!!probeReason || actionBusy !== null || board.example}
            onClick={() => void runProbe("verify")}
          >
            验证连接
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={!!probeReason || actionBusy !== null || board.example}
            onClick={() => void runProbe("live")}
          >
            实机探活
          </button>
        </div>
        <ul className="interface-action-notes">
          <li>检查配置：<code>probe</code>（非 live），只看配置是否齐全，不得把 <code>chat_bridge</code> 标绿。</li>
          <li>验证连接：目录 / 版本探测，只升级发现态。</li>
          <li>实机探活：live / 一次聊天；只有这一项以后才可能标记 <code>chat_bridge</code>，仍不会改工具层。</li>
        </ul>
        {probeReason ? <p className="muted">{probeReason}</p> : null}
        {board.example ? <p className="muted">示例模式下不会向本机桥接发送探测请求。</p> : null}

        <label className="interface-confirm">
          <input
            type="checkbox"
            checked={confirmPromote}
            onChange={(e) => setConfirmPromote(e.target.checked)}
          />
          我确认把此接口登记为实例草稿（只含 <code>auth_ref</code> 名和 endpoint，不含密钥）
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="icon-btn add-channel-btn"
            disabled={!confirmPromote || !!promoteReason || actionBusy !== null || board.example}
            onClick={() => void runPromote()}
          >
            确认后登记草稿
          </button>
        </div>
        {promoteReason ? <p className="muted">{promoteReason}</p> : null}
        {actionMessage ? (
          <p className="callout callout-info" role="status">
            {actionMessage}
          </p>
        ) : null}
      </div>

      <section className="interface-layers" aria-label="核实分层">
        <h3 className="subhead">核实分层（发现不得把它们标成已通）</h3>
        <ul className="channel-layers">
          <li className="layer-chip tone-unverified">
            <span className="layer-name">
              对话桥 <code>chat_bridge</code>
              <span className="status-text tone-unverified">
                未验证
                <code className="claim-raw">{row.record?.chat_bridge ?? "unverified"}</code>
              </span>
            </span>
            <span className="layer-summary">发现或保存密钥都不会把这一层写成 ok。</span>
          </li>
          <li className="layer-chip tone-unverified">
            <span className="layer-name">
              工具核实 <code>tools_verified</code>
              <span className="status-text tone-unverified">
                未验证
                <code className="claim-raw">{String(row.record?.tools_verified ?? false)}</code>
              </span>
            </span>
            <span className="layer-summary">列出模型或目录不是工具核实。</span>
          </li>
          <li className="layer-chip">
            <span className="layer-name">
              发现记录 <code>DiscoveryRecord.status</code>
              <span className="status-text tone-neutral">
                {row.record?.status ?? "（无记录）"}
                <code className="claim-raw">{row.record?.status ?? "none"}</code>
              </span>
            </span>
            <span className="layer-summary">这是扫描器结果，不能改名为 chat_bridge=ok。</span>
          </li>
        </ul>
        {row.record?.notes ? <p className="muted">{row.record.notes}</p> : null}
      </section>
    </>
  );
}

export function interfaceStatusShort(status: InterfaceUiStatus): string {
  return INTERFACE_STATUS_LABEL[status].text;
}

export function InterfacesHowtoNote(): ReactNode {
  return <InterfaceHowto />;
}

export function hashWantsExample(hash: string): boolean {
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return /(?:^|&)fixture=1(?:&|$)/.test(query);
}

export { shanghai };
