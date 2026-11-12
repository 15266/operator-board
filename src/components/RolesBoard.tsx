import type { Role } from "../lib/types";
import { CAPABILITY_LABEL, CORE_ROLES, PANEL_COPY, ROLE_COPY } from "../lib/copy";
import { Panel } from "./Panel";

export function RolesBoard({ roles }: { roles: Record<string, Role> }) {
  const entries = Object.values(roles);
  const core = entries.filter((r) => (CORE_ROLES as readonly string[]).includes(r.name));
  const optional = entries.filter((r) => !(CORE_ROLES as readonly string[]).includes(r.name));
  const copy = PANEL_COPY.roles;

  return (
    <Panel id="roles" {...copy}>
      <h3 className="subhead">核心角色</h3>
      <div className="role-grid">
        {core.map((r) => (
          <RoleCard key={r.name} role={r} />
        ))}
      </div>
      <h3 className="subhead">可选适配器</h3>
      <p className="section-hint">按需接入，不是每次派工都要上场。</p>
      <div className="role-grid optional">
        {optional.map((r) => (
          <RoleCard key={r.name} role={r} optional />
        ))}
      </div>
    </Panel>
  );
}

function RoleCard({ role, optional }: { role: Role; optional?: boolean }) {
  const meta = ROLE_COPY[role.name];
  return (
    <article className={`role-card ${optional ? "is-optional" : "is-core"}`}>
      <div className="role-card-top">
        <div>
          <strong>{meta?.title ?? role.name}</strong>
          <div className="role-ids">
            <span className="role-en">{englishName(role.name)}</span>
            <code>{role.name}</code>
          </div>
        </div>
        <span className={`pill ${optional ? "" : "status-active"}`}>
          {optional ? "可选" : "核心"}
        </span>
      </div>
      <p className="hint">{meta?.meaning ?? role.teammate_hint}</p>
      <h4 className="mini-label">能力</h4>
      <ul className="caps">
        {role.capabilities.map((c) => (
          <li key={c}>
            <code>{c}</code>
            {CAPABILITY_LABEL[c] ? <span>{CAPABILITY_LABEL[c]}</span> : null}
          </li>
        ))}
      </ul>
      <p className="teammate muted">对接提示：{role.teammate_hint}</p>
    </article>
  );
}

function englishName(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
