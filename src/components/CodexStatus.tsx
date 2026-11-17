import type { CodexLink } from "../lib/types";
import { CODEX_STUB_LABEL, PANEL_COPY } from "../lib/copy";
import { formatShanghai } from "../lib/time";
import { Panel } from "./Panel";

export function CodexStatus({ link }: { link: CodexLink }) {
  const ok = link.stub_status === "ok" && link.cli_ok && link.auth_ok;
  const stub = CODEX_STUB_LABEL[link.stub_status] ?? link.stub_status;
  const copy = PANEL_COPY.codex;

  return (
    <Panel id="codex" {...copy}>
      <div className={`verdict ${ok ? "ok" : "bad"}`}>
        桩状态 stub_status = {stub}（{link.stub_status.toUpperCase()}）
        {ok ? " · mock 正常" : " · mock 异常"}
      </div>
      <div className="codex-grid">
        <Stat label="CLI 可用 cli_ok" value={yn(link.cli_ok)} good={link.cli_ok} raw={String(link.cli_ok)} />
        <Stat label="鉴权 auth_ok" value={yn(link.auth_ok)} good={link.auth_ok} raw={String(link.auth_ok)} />
        <Stat
          label="链路已核验 link_verified"
          value={yn(link.link_verified)}
          good={link.link_verified}
          raw={String(link.link_verified)}
        />
        <Stat
          label="配额耗尽 quota_exhausted"
          value={link.quota_exhausted ? "是 已耗尽" : "否 正常"}
          good={!link.quota_exhausted}
          raw={String(link.quota_exhausted)}
        />
        <Stat label="模式 mode" value={link.mode} />
        <Stat label="版本 version" value={link.version ?? "无"} raw={link.version ?? "null"} />
        <Stat label="机器 machine" value={link.machine_label} />
        <Stat label="会话 session" value={link.session ?? "无"} raw={link.session ?? "null"} />
      </div>
      <p className="hint">{link.notes}</p>
      <p className="muted">
        最近探测 last_probe_at：{formatShanghai(link.last_probe_at)} · 进程 processes：{" "}
        {link.processes.join(", ") || "（无）"}
      </p>
    </Panel>
  );
}

function yn(v: boolean): string {
  return v ? "是 · 正常" : "否 · 未通过";
}

function Stat({
  label,
  value,
  good,
  raw,
}: {
  label: string;
  value: string;
  good?: boolean;
  raw?: string;
}) {
  const tone = good === true ? "good" : good === false ? "bad" : "";
  return (
    <div className={`stat ${tone}`}>
      <span className="muted">{label}</span>
      <strong>
        {value}
        {raw && raw !== value ? <code className="claim-raw">{raw}</code> : null}
      </strong>
    </div>
  );
}
