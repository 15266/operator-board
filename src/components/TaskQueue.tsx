import type { OpenItem } from "../lib/types";
import { ITEM_STATUS_LABEL, LANE_COPY, PANEL_COPY } from "../lib/copy";
import { Panel } from "./Panel";
import { EmptyState } from "./EmptyState";

export function TaskQueue({ items }: { items: OpenItem[] }) {
  const open = items.filter((i) => i.status === "open");
  const pickable = open
    .filter((i) => i.lane !== "human")
    .sort((a, b) => a.priority.localeCompare(b.priority));
  const picked = pickable[0] ?? null;
  const skippedHuman = open.filter((i) => i.lane === "human");
  const rest = open.filter((i) => i.id !== picked?.id && i.lane !== "human");
  const copy = PANEL_COPY.queue;

  return (
    <Panel id="queue" {...copy}>
      {picked ? (
        <article className="task-card p0">
          <div className="task-top">
            <span className="pill p0">{picked.priority}</span>
            <span className="pill lane">{laneLabel(picked.lane)}</span>
            <span className="pill status-active">已选取</span>
            <span className="pill">{ITEM_STATUS_LABEL[picked.status]}</span>
            <code className="id">{picked.id}</code>
          </div>
          <h3>{picked.title}</h3>
          {picked.notes && <p className="hint">{picked.notes}</p>}
        </article>
      ) : (
        <EmptyState
          title="没有可自动选取的任务"
          description="当前演示队列里没有开放的非人工项。人工验收轨不会被自动选取。要自己安排工作，请到左侧「任务」新建。"
        />
      )}
      {rest.length > 0 && (
        <div className="skipped">
          <h3 className="subhead">其余开放任务</h3>
          {rest.map((item) => (
            <article key={item.id} className="task-card">
              <div className="task-top">
                <span className={`pill ${item.priority === "P0" ? "p0" : ""}`}>{item.priority}</span>
                <span className="pill lane">{laneLabel(item.lane)}</span>
                <span className="pill">{ITEM_STATUS_LABEL[item.status]}</span>
                <code className="id">{item.id}</code>
              </div>
              <h3>{item.title}</h3>
            </article>
          ))}
        </div>
      )}
      {skippedHuman.length > 0 && (
        <div className="skipped">
          <h3 className="subhead">跳过的人工验收轨</h3>
          {skippedHuman.map((h) => (
            <article key={h.id} className="task-card human">
              <div className="task-top">
                <span className="pill">{h.priority}</span>
                <span className="pill lane human">{laneLabel(h.lane)}</span>
                <span className="pill warn">永不自动选取</span>
              </div>
              <h3>{h.title}</h3>
              {h.notes && <p className="hint">{h.notes}</p>}
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

function laneLabel(lane: string): string {
  const meta = LANE_COPY[lane];
  return meta ? `${meta.title} ${lane}` : lane;
}
