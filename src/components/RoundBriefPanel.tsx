import type { ReactNode } from "react";
import type { RoundBrief } from "../lib/types";
import { BRIEF_FIELDS, PANEL_COPY } from "../lib/copy";
import { Panel } from "./Panel";

export function RoundBriefPanel({ brief }: { brief: RoundBrief }) {
  const copy = PANEL_COPY.brief;
  const fieldValue: Record<(typeof BRIEF_FIELDS)[number]["key"], ReactNode> = {
    goal: <p>{brief.goal}</p>,
    path: (
      <p>
        <code>{brief.path}</code>
      </p>
    ),
    success: <p>{brief.success}</p>,
    not_to_do: (
      <ul>
        {brief.not_to_do.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    ),
    evidence_paths: (
      <ul className="paths">
        {brief.evidence_paths.map((p) => (
          <li key={p}>
            <code>{p}</code>
          </li>
        ))}
      </ul>
    ),
  };

  return (
    <Panel id="brief" {...copy}>
      <div className="brief-grid">
        <BriefField label="轮次 Round" value={brief.round} />
        <BriefField label="执行方 Executor" value={brief.executor} />
        <BriefField
          label="配额 Quota"
          value={brief.quota_exhausted ? "已耗尽 exhausted" : "正常 ok"}
          warn={brief.quota_exhausted}
        />
      </div>
      <ol className="brief-five">
        {BRIEF_FIELDS.map((f) => (
          <li key={f.key} className="brief-block">
            <h3>
              <span className="brief-index">{f.index}</span>
              {f.label}
              <code>{f.en}</code>
            </h3>
            <p className="section-hint">{f.hint}</p>
            {fieldValue[f.key]}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function BriefField({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className={`brief-field ${warn ? "warn" : ""}`}>
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
