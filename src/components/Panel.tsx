import type { ReactNode } from "react";
import { MotionFold } from "./Motion";

export function Panel({
  id,
  titleZh,
  titleEn,
  purpose,
  howto,
  tool,
  actions,
  children,
}: {
  id: string;
  titleZh: string;
  titleEn: string;
  purpose: string;
  howto: ReactNode;
  tool: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel" id={id}>
      <header className="panel-head is-compact">
        <div className="panel-titles">
          <h2 className="visually-hidden">
            {titleZh}
            <span className="title-en">{titleEn}</span>
          </h2>
          <p className="panel-purpose">{purpose}</p>
        </div>
        <div className="panel-head-aside">
          {actions}
          <code className="tool-badge" title="对应的 MCP 工具">
            {tool}
          </code>
        </div>
      </header>
      <MotionFold className="howto" summary="DIRECTORY NOTE / 说明">
        {typeof howto === "string" ? <p>{howto}</p> : howto}
      </MotionFold>
      {children}
    </section>
  );
}
