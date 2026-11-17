import type { ReactNode } from "react";

export function EmptyState({
  title,
  titleEn,
  description,
  action,
}: {
  title: string;
  titleEn?: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state motion-empty" role="status">
      <h3 className="empty-state-title">
        {title}
        {titleEn ? <span className="title-en">{titleEn}</span> : null}
      </h3>
      <p className="empty-state-desc">{description}</p>
      {action ? <div className="empty-state-actions">{action}</div> : null}
    </div>
  );
}
