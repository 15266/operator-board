import { useState } from "react";
import type { DashboardMock, EvidenceLane } from "../lib/types";
import { CLAIM_LABEL, LANE_COPY, LANE_SEPARATION_NOTE, PANEL_COPY } from "../lib/copy";
import { Panel } from "./Panel";

const LANES: EvidenceLane[] = ["compile", "automated", "visual_pie", "human"];

export function EvidenceValidator({
  samples,
}: {
  samples: DashboardMock["evidence_samples"];
}) {
  const [idx, setIdx] = useState(0);
  const sample = samples[idx];
  const copy = PANEL_COPY.evidence;

  return (
    <Panel id="evidence" {...copy}>
      <p className="lane-legend">{LANE_SEPARATION_NOTE}</p>
      <div className="toolbar">
        {samples.map((s, i) => (
          <button
            key={s.label}
            type="button"
            className={`chip ${i === idx ? "active" : ""}`}
            onClick={() => setIdx(i)}
            aria-pressed={i === idx}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className={`verdict ${sample.validation.ok ? "ok" : "bad"}`}>
        {sample.validation.ok ? "结构通过 · OK" : "拒绝 · REJECT（假手感 / 混轨）"}
      </div>
      <div className="lane-row">
        {LANES.map((lane) => {
          const found = sample.validation.lanes_found[lane];
          const raw = sample.claims[lane];
          const claim = raw ? (CLAIM_LABEL[raw] ?? raw) : "—";
          return (
            <div key={lane} className={`lane-cell ${found ? "found" : "missing"}`}>
              <span className="lane-name">
                {LANE_COPY[lane].title} <code>{lane}</code>
              </span>
              <strong>
                {claim}
                {raw && CLAIM_LABEL[raw] ? (
                  <code className="claim-raw">{raw}</code>
                ) : null}
              </strong>
              <span className={`lane-flag ${found ? "on" : ""}`}>{found ? "已记录" : "未出现"}</span>
              <p className="section-hint">{LANE_COPY[lane].meaning}</p>
            </div>
          );
        })}
      </div>
      {sample.claims.feel && (
        <p className="feel-flag">
          检测到 feel 字段：<code>{sample.claims.feel}</code>
          （禁止在没有人工轨证明时宣称通过）
        </p>
      )}
      <div className="brief-block">
        <h3>报告原文 report_text</h3>
        <pre className="code-block">{sample.report_text}</pre>
      </div>
      {sample.validation.errors.length > 0 && (
        <ul className="err-list">
          {sample.validation.errors.map((e) => (
            <li key={e}>错误：{e}</li>
          ))}
        </ul>
      )}
      {sample.validation.warnings.length > 0 && (
        <ul className="warn-list">
          {sample.validation.warnings.map((w) => (
            <li key={w}>警告：{w}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
