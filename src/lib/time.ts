/** Format timestamps for the operator in Asia/Shanghai. */
export function formatShanghai(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return (
    d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) +
    " Asia/Shanghai"
  );
}

export function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const ok = values.filter((v): v is string => Boolean(v && !Number.isNaN(Date.parse(v))));
  if (ok.length === 0) return null;
  return ok.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

import type { DashboardMock } from "./types";

export function dataFreshness(data: DashboardMock): string {
  const latest = latestTimestamp([
    ...data.events.map((e) => e.ts),
    data.codex_link.last_probe_at,
    ...(data.external_channels ?? []).map((c) => c.last_probe_at),
  ]);
  return formatShanghai(latest);
}
