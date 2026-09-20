import { useCallback, useEffect, useMemo, useState } from "react";
import { useHostLocation, useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import { STAGE_LABELS, type CrStatus, type Stage } from "../shared/types.js";
import { useAction, useOverview, useProjects, useToasts } from "./api.js";
import { LifecycleView } from "./Lifecycle.js";
import { SprintsView } from "./Sprints.js";
import { ChangesView } from "./Changes.js";

type Tab = "lifecycle" | "sprints" | "changes";

export function App({ companyId, companyPrefix, initialProjectId, embedded }: { companyId: string | null; companyPrefix: string | null; initialProjectId?: string | null; embedded?: boolean }) {
  const nav = useHostNavigation();
  const loc = useHostLocation();
  const queryProject = useMemo(() => new URLSearchParams(loc.search).get("project"), [loc.search]);
  const projects = useProjects(companyId);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId ?? queryProject ?? null);
  useEffect(() => { if (!projectId && projects.data?.length) setProjectId(projects.data[0]!.id); }, [projects.data, projectId]);
  const overview = useOverview(companyId, projectId);
  const refresh = useCallback(() => { overview.refresh?.(); }, [overview]);
  const { toasts, push } = useToasts();
  const [tab, setTab] = useState<Tab>("sprints");

  const a = {
    setStage: useAction("set-stage", companyId, refresh, push),
    toggleGate: useAction("toggle-gate", companyId, refresh, push),
    updateLifecycle: useAction("update-lifecycle", companyId, refresh, push),
    createSprint: useAction("create-sprint", companyId, refresh, push),
    updateSprint: useAction("update-sprint", companyId, refresh, push),
    deleteSprint: useAction("delete-sprint", companyId, refresh, push),
    startSprint: useAction("start-sprint", companyId, refresh, push),
    completeSprint: useAction("complete-sprint", companyId, refresh, push),
    addToSprint: useAction("add-to-sprint", companyId, refresh, push),
    removeFromSprint: useAction("remove-from-sprint", companyId, refresh, push),
    setPoints: useAction("set-points", companyId, refresh, push),
    setStatus: useAction("set-issue-status", companyId, refresh, push),
    assign: useAction("assign-issue", companyId, refresh, push),
    createIssue: useAction("create-issue", companyId, refresh, push),
    createCr: useAction("create-change-request", companyId, refresh, push),
    updateCr: useAction("update-change-request", companyId, refresh, push),
    transitionCr: useAction("transition-change-request", companyId, refresh, push),
    commentCr: useAction("comment-change-request", companyId, refresh, push),
  };
  const busy = Object.values(a).some((x) => x.busy);
  const o = overview.data ?? null;
  const issueHref = (identifier: string | null) => (identifier && companyPrefix ? nav.resolveHref(`/${companyPrefix}/issues/${identifier}`) : null);
  const pending = o?.changeRequests.filter((c) => ["submitted", "under_review"].includes(c.status)).length ?? 0;

  return (
    <div className={`pl-page ${embedded ? "pl-embedded" : ""}`}>
      <div className="pl-toolbar">
        {!embedded && <div><h1 className="pl-title">Product Lifecycle</h1><div className="pl-sub">stages & gates · sprint planning · change management</div></div>}
        {!embedded && (
          <select className="pl-select" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)} style={{ minWidth: 200 }}>
            {!projects.data?.length && <option value="">No projects</option>}
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {o && <span className="pl-chip">{STAGE_LABELS[o.lifecycle.stage]}</span>}
        <div className="pl-seg">
          <button className={tab === "lifecycle" ? "pl-active" : ""} onClick={() => setTab("lifecycle")}>Lifecycle</button>
          <button className={tab === "sprints" ? "pl-active" : ""} onClick={() => setTab("sprints")}>Sprints</button>
          <button className={tab === "changes" ? "pl-active" : ""} onClick={() => setTab("changes")}>Changes{pending > 0 ? ` (${pending})` : ""}</button>
        </div>
        <span className="pl-spacer" />
        <button className="pl-btn" disabled={overview.loading} onClick={refresh} title="Refresh">↻</button>
      </div>
      {overview.error && <div className="pl-error">{overview.error.message}</div>}
      {projects.error && <div className="pl-error">{projects.error.message}</div>}
      {!projectId && <div className="pl-empty">Create a project in Paperclip first.</div>}
      {projectId && overview.loading && !o && <div className="pl-empty">Loading…</div>}
      {o && tab === "lifecycle" && (
        <LifecycleView o={o} busy={busy}
          onSetStage={(stage: Stage, note) => a.setStage.fn({ projectId, stage, note }, `Moved to ${STAGE_LABELS[stage]}`)}
          onToggleGate={(stage, gate, done) => a.toggleGate.fn({ projectId, stage, gate, done })}
          onUpdate={(patch) => a.updateLifecycle.fn({ projectId, patch })} />
      )}
      {o && tab === "sprints" && (
        <SprintsView o={o} busy={busy} issueHref={issueHref}
          onCreateSprint={(input) => a.createSprint.fn({ projectId, ...input }, "Sprint created")}
          onUpdateSprint={(sprintId, patch) => a.updateSprint.fn({ sprintId, patch })}
          onDeleteSprint={(sprintId) => a.deleteSprint.fn({ sprintId }, "Sprint deleted")}
          onStart={(sprintId) => a.startSprint.fn({ sprintId }, "Sprint started")}
          onComplete={async (sprintId, carryOver) => { const r = (await a.completeSprint.fn({ sprintId, carryOver })) as { done: number; committed: number; carried: number }; push(`Sprint completed: ${r.done}/${r.committed} points, ${r.carried} carried over`); }}
          onAdd={(sprintId, issueId, storyPoints) => a.addToSprint.fn({ sprintId, issueId, storyPoints })}
          onRemove={(sprintId, issueId) => a.removeFromSprint.fn({ sprintId, issueId })}
          onSetPoints={(issueId, pts) => a.setPoints.fn({ issueId, storyPoints: pts })}
          onSetStatus={(issueId, status) => a.setStatus.fn({ issueId, status })}
          onAssign={(issueId, agentId, userId) => a.assign.fn({ issueId, assigneeAgentId: agentId, assigneeUserId: userId })}
          onCreateIssue={(input) => a.createIssue.fn({ projectId, ...input }, "Backlog item created")} />
      )}
      {o && tab === "changes" && (
        <ChangesView o={o} companyId={companyId} busy={busy} issueHref={issueHref}
          onCreate={(input) => a.createCr.fn({ projectId, ...input }, "Change request created")}
          onUpdate={(id, patch) => a.updateCr.fn({ id, patch })}
          onTransition={(id, to: CrStatus, note, opts) => a.transitionCr.fn({ id, to, note, ...opts }, `Change request ${to.replace("_", " ")}`)}
          onComment={(id, note) => a.commentCr.fn({ id, note })} />
      )}
      {toasts.map((t) => <div key={t.id} className={`pl-toast ${t.kind === "err" ? "pl-toast-err" : ""}`}>{t.message}</div>)}
    </div>
  );
}
