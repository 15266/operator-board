import type { DispatchPlan } from "../lib/types";
import { PANEL_COPY, ROLE_COPY, STEP_STATUS_LABEL } from "../lib/copy";
import { Panel } from "./Panel";

export function DispatchTimeline({
  plan,
  planQuota,
  quota,
  onQuotaChange,
}: {
  plan: DispatchPlan;
  planQuota: DispatchPlan;
  quota: boolean;
  onQuotaChange: (value: boolean) => void;
}) {
  const active = quota ? planQuota : plan;
  const copy = PANEL_COPY.dispatch;

  return (
    <Panel id="dispatch" {...copy}>
      <div className="toolbar">
        <label className="toggle">
          <input
            type="checkbox"
            checked={quota}
            onChange={(e) => onQuotaChange(e.target.checked)}
          />
          <span>
            模拟配额耗尽 <code>quota_exhausted</code>
            （跳过 <code>external_codex</code>，由执行官接管）
          </span>
        </label>
        {quota && <span className="pill warn">配额耗尽 · 执行官接管</span>}
      </div>
      <p className="goal">
        <span className="muted">本轮目标 goal</span> {active.goal}
      </p>
      <ol className="timeline">
        {active.steps.map((s) => {
          const status = s.status ?? "pending";
          const roleTitle = ROLE_COPY[s.role]?.title ?? s.role;
          return (
            <li key={`${active.quota_exhausted}-${s.order}`} className={`step status-${status}`}>
              <div className="step-rail">
                <span className="dot" aria-hidden="true" />
                <span className="order">{s.order}</span>
              </div>
              <div className="step-body">
                <div className="step-meta">
                  <span className="role-pair">
                    <span className="role-title">{roleTitle}</span>
                    <code className="role">{s.role}</code>
                  </span>
                  <code className="action">{s.action}</code>
                  <span className={`pill status-${status}`}>{STEP_STATUS_LABEL[status]}</span>
                  {s.skip_roles?.includes("external_codex") && (
                    <span className="pill warn">跳过 external_codex</span>
                  )}
                  {s.status === "skipped" && <span className="pill warn">因配额跳过</span>}
                  {s.failover_to && (
                    <span className="pill">
                      失败切换 failover → {ROLE_COPY[s.failover_to]?.title ?? s.failover_to}（
                      {s.failover_to}）
                    </span>
                  )}
                </div>
                <p>{s.brief}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="note muted">{active.protocol_note}</p>
    </Panel>
  );
}
