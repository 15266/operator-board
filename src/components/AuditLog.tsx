import type { AuditEvent } from "../lib/types";
import { PANEL_COPY, ROLE_COPY } from "../lib/copy";
import { formatShanghai } from "../lib/time";
import { Panel } from "./Panel";

const KIND_LABEL: Record<string, string> = {
  dispatch_plan_made: "已生成派工计划",
  task_picked: "已选取任务",
  evidence_validated: "已校验证据",
  codex_probe: "Codex 探测",
  quota_note: "配额备注",
};

export function AuditLog({ events }: { events: AuditEvent[] }) {
  const sorted = [...events].sort((a, b) => b.ts.localeCompare(a.ts));
  const copy = PANEL_COPY.audit;

  return (
    <Panel id="audit" {...copy}>
      <ul className="audit-list">
        {sorted.map((e, i) => (
          <li key={`${e.ts}-${i}`}>
            <time dateTime={e.ts}>{formatShanghai(e.ts)}</time>
            <div className="audit-tags">
              <span className="kind-label">{KIND_LABEL[e.kind] ?? e.kind}</span>
              <code className="kind">{e.kind}</code>
              {e.role && (
                <span className="role-pair">
                  <span>{ROLE_COPY[e.role]?.title ?? e.role}</span>
                  <code className="role">{e.role}</code>
                </span>
              )}
            </div>
            <span className="detail">
              {typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
