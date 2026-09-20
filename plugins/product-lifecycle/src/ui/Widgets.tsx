import { useHostContext, useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import type { PluginPageProps, PluginDetailTabProps, PluginSidebarProps, PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { App } from "./App.js";
import { usePortfolio } from "./api.js";
import { STAGE_LABELS, type Stage } from "../shared/types.js";
import { fmtDate } from "./util.js";

const pagePath = (prefix: string | null) => (prefix ? `/${prefix}/product-lifecycle` : "/product-lifecycle");

export function ProductLifecyclePage({ context }: PluginPageProps) {
  return <div className="pl-root"><App companyId={context.companyId} companyPrefix={context.companyPrefix} /></div>;
}

export function ProjectSprintsTab({ context }: PluginDetailTabProps) {
  return <div className="pl-root"><App companyId={context.companyId} companyPrefix={context.companyPrefix} initialProjectId={context.entityId} embedded /></div>;
}

export function PlSidebarLink(_props: PluginSidebarProps) {
  const ctx = useHostContext();
  const nav = useHostNavigation();
  return (
    <a className="pl-sidebar-link" {...nav.linkProps(pagePath(ctx.companyPrefix))} title="Product Lifecycle: stages, sprints, change management">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12c2-6 4-8 6-8s4 2 6 8" /><path d="M2 12h12" /><circle cx="8" cy="4" r="1.2" fill="currentColor" />
      </svg>
      <span>Product Lifecycle</span>
    </a>
  );
}

export function PlDashboardWidget({ context }: PluginWidgetProps) {
  const nav = useHostNavigation();
  const { data, loading, error } = usePortfolio(context.companyId);
  const href = pagePath(context.companyPrefix);
  return (
    <div className="pl-root">
      <div className="pl-widget">
        <h4><span>Sprints & change requests</span><span style={{ flex: 1 }} /><a {...nav.linkProps(href)} className="pl-sub">Open →</a></h4>
        {loading && !data && <div className="pl-sub">Loading…</div>}
        {error && <div className="pl-error">{error.message}</div>}
        {data?.length === 0 && <div className="pl-sub">No projects yet.</div>}
        {data?.map((r) => (
          <div className="pl-widget-row" key={r.projectId}>
            <a {...nav.linkProps(`${href}?project=${r.projectId}`)} style={{ textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span className="pl-dot" style={{ background: r.color ?? undefined }} />{r.name} <span className="pl-chip">{STAGE_LABELS[r.stage as Stage] ?? r.stage}</span>
            </a>
            <span className="pl-sub pl-mono">{r.activeSprint ? `${r.activeSprint.name} · ${r.activeSprint.done}/${r.activeSprint.committed}pt · ends ${fmtDate(r.activeSprint.endDate)}` : "no active sprint"}</span>
            {r.openChanges > 0 ? <span className="pl-chip pl-warn">{r.openChanges} CR pending</span> : r.approvedChanges > 0 ? <span className="pl-chip pl-ok">{r.approvedChanges} CR approved</span> : <span className="pl-chip">no open CRs</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
