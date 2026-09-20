import { useHostContext, useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import type { PluginPageProps, PluginDetailTabProps, PluginSidebarProps, PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { PlannerApp } from "./PlannerApp.js";
import { usePortfolio } from "./api.js";
import { fmtDate } from "./util.js";

function pagePath(companyPrefix: string | null): string {
  return companyPrefix ? `/${companyPrefix}/project-manager` : "/project-manager";
}

export function ProjectManagerPage({ context }: PluginPageProps) {
  return (
    <div className="pm-root">
      <PlannerApp companyId={context.companyId} companyPrefix={context.companyPrefix} />
    </div>
  );
}

export function ProjectScheduleTab({ context }: PluginDetailTabProps) {
  return (
    <div className="pm-root">
      <PlannerApp companyId={context.companyId} companyPrefix={context.companyPrefix} initialProjectId={context.entityId} embedded />
    </div>
  );
}

export function PmSidebarLink(_props: PluginSidebarProps) {
  const ctx = useHostContext();
  const nav = useHostNavigation();
  const href = pagePath(ctx.companyPrefix);
  return (
    <a className="pm-sidebar-link" {...nav.linkProps(href)} title="Project Manager: Gantt, critical path, resources">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M2 4h6M2 8h9M2 12h5" />
        <path d="M10 3.5l3 0M12.5 7.5l1.5 0M9 11.5l4 0" opacity="0.6" />
      </svg>
      <span>Project Manager</span>
    </a>
  );
}

export function PmDashboardWidget({ context }: PluginWidgetProps) {
  const nav = useHostNavigation();
  const { data, loading, error } = usePortfolio(context.companyId);
  const href = pagePath(context.companyPrefix);
  return (
    <div className="pm-root">
      <div className="pm-widget">
        <h4>
          <span>Portfolio schedule health</span>
          <span style={{ flex: 1 }} />
          <a {...nav.linkProps(href)} className="pm-sub">Open planner →</a>
        </h4>
        {loading && !data && <div className="pm-sub">Computing schedules…</div>}
        {error && <div className="pm-error">{error.message}</div>}
        {data && data.length === 0 && <div className="pm-sub">No projects yet.</div>}
        {data?.map((row) => {
          const s = row.summary;
          const slip = s?.slippageDays ?? null;
          return (
            <div className="pm-widget-row" key={row.projectId}>
              <a {...nav.linkProps(`${href}?project=${row.projectId}`)} style={{ textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span className="pm-dot" style={{ background: row.color ?? undefined }} />
                {row.name}
              </a>
              <span className="pm-mono pm-sub">{s ? `finish ${fmtDate(s.projectFinish)}` : "—"}</span>
              {s ? (
                slip === null ? (
                  <span className="pm-chip">{s.criticalCount} critical</span>
                ) : slip > 0 ? (
                  <span className="pm-chip pm-crit">+{slip}d late</span>
                ) : (
                  <span className="pm-chip pm-ok">on track</span>
                )
              ) : (
                <span className="pm-chip pm-warn">n/a</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
