import { useCallback, useEffect, useMemo, useState } from "react";
import { useHostLocation, useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import type { LinkType, Resource } from "../shared/types.js";
import { useAction, useComms, useEvm, usePlan, useProjects, useToasts } from "./api.js";
import { Gantt, type Zoom, type PredecessorSpec } from "./Gantt.js";
import { TaskEditor } from "./TaskEditor.js";
import { ResourceSheet, ResourceUsage } from "./Resources.js";
import { CriticalPathView } from "./CriticalPath.js";
import { EvmView } from "./Evm.js";
import { CommsView } from "./Comms.js";
import { fmtDate, fmtDateFull } from "./util.js";

type View = "gantt" | "critical" | "sheet" | "usage" | "evm" | "comms";

export interface PlannerAppProps {
  companyId: string | null;
  companyPrefix: string | null;
  initialProjectId?: string | null;
  embedded?: boolean;
}

export function PlannerApp({ companyId, companyPrefix, initialProjectId, embedded }: PlannerAppProps) {
  const nav = useHostNavigation();
  const loc = useHostLocation();
  const queryProject = useMemo(() => new URLSearchParams(loc.search).get("project"), [loc.search]);
  const projects = useProjects(companyId);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId ?? queryProject ?? null);
  useEffect(() => {
    if (!projectId && projects.data?.length) setProjectId(projects.data[0]!.id);
  }, [projects.data, projectId]);

  const plan = usePlan(companyId, projectId);
  const [view, setView] = useState<View>("gantt");
  const evm = useEvm(companyId, projectId, view === "evm" || view === "comms");
  const comms = useComms(companyId, projectId, view === "comms");
  const refresh = useCallback(() => { plan.refresh?.(); if (view === "evm") evm.refresh?.(); if (view === "comms") { evm.refresh?.(); comms.refresh?.(); } }, [plan, evm, comms, view]);
  const { toasts, push } = useToasts();

  const [zoom, setZoom] = useState<Zoom>("week");
  const [showCritical, setShowCritical] = useState(true);
  const [showBaseline, setShowBaseline] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDuration, setNewDuration] = useState("3");
  const [newPred, setNewPred] = useState("");
  const [newAssignee, setNewAssignee] = useState("");

  const updateTask = useAction("update-task", companyId, refresh, push);
  const setLink = useAction("set-link", companyId, refresh, push);
  const removeLink = useAction("remove-link", companyId, refresh, push);
  const assign = useAction("assign", companyId, refresh, push);
  const createTask = useAction("create-task", companyId, refresh, push);
  const removeTask = useAction("remove-task", companyId, refresh, push);
  const reorder = useAction("reorder-tasks", companyId, refresh, push);
  const saveBaseline = useAction("save-baseline", companyId, refresh, push);
  const clearBaseline = useAction("clear-baseline", companyId, refresh, push);
  const level = useAction("level-resources", companyId, refresh, push);
  const clearLeveling = useAction("clear-leveling", companyId, refresh, push);
  const upsertResource = useAction("upsert-resource", companyId, refresh, push);
  const deleteResource = useAction("delete-resource", companyId, refresh, push);
  const importAgents = useAction("import-agents", companyId, refresh, push);
  const updateCalendar = useAction("update-calendar", companyId, refresh, push);
  const updatePlan = useAction("update-plan", companyId, refresh, push);
  const setPredecessors = useAction("set-predecessors", companyId, refresh, push);
  const assignByNames = useAction("assign-by-names", companyId, refresh, push);
  const insertTask = useAction("insert-task", companyId, refresh, push);
  const deleteTask = useAction("delete-task", companyId, refresh, push);
  const updateSettings = useAction("update-project-settings", companyId, refresh, push);
  const updateTaskCosts = useAction("update-task-costs", companyId, refresh, push);
  const recordStatus = useAction("record-status", companyId, refresh, push);
  const genReport = useAction("generate-status-report", companyId, refresh, push);
  const sendReport = useAction("send-status-report", companyId, undefined, push);
  const nudgeOne = useAction("nudge", companyId, refresh, push);
  const nudgeAll = useAction("nudge-all", companyId, refresh, push);
  const upStake = useAction("upsert-stakeholder", companyId, refresh, push);
  const delStake = useAction("delete-stakeholder", companyId, refresh, push);
  const upComm = useAction("upsert-comm-item", companyId, refresh, push);
  const delComm = useAction("delete-comm-item", companyId, refresh, push);
  const upRaid = useAction("upsert-raid-item", companyId, refresh, push);
  const delRaid = useAction("delete-raid-item", companyId, refresh, push);
  const busy = [updateSettings, updateTaskCosts, recordStatus, genReport, sendReport, nudgeOne, nudgeAll, upStake, delStake, upComm, delComm, upRaid, delRaid, updateTask, setLink, removeLink, assign, createTask, removeTask, reorder, saveBaseline, clearBaseline, level, clearLeveling, upsertResource, deleteResource, importAgents, updateCalendar, updatePlan, setPredecessors, assignByNames, insertTask, deleteTask].some((a) => a.busy);

  const data = plan.data;
  const selected = data?.tasks.find((t) => t.issueId === selectedId) ?? null;
  const issueHref = (identifier: string | null) => (identifier && companyPrefix ? nav.resolveHref(`/${companyPrefix}/issues/${identifier}`) : null);

  const onCreate = async () => {
    if (!projectId || !newTitle.trim()) return;
    const agent = data?.agents.find((a) => a.id === newAssignee);
    const human = data?.humans.find((h) => h.id === newAssignee);
    await createTask.fn({ projectId, title: newTitle.trim(), durationDays: Number(newDuration) || 1, predecessorIssueId: newPred || undefined, assigneeAgentId: agent?.id, assigneeUserId: human?.id }, "Task created");
    setNewTitle("");
    setNewPred("");
    setAdding(false);
  };

  const moveOrder = async (dir: -1 | 1) => {
    if (!data || !selected) return;
    const ids = data.tasks.map((t) => t.issueId);
    const i = ids.indexOf(selected.issueId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await reorder.fn({ issueIds: ids });
  };

  const indent = async (id: string) => {
    if (!data) return;
    const i = data.tasks.findIndex((t) => t.issueId === id);
    const t = data.tasks[i];
    if (!t || i === 0) return;
    // New parent = nearest task above at the same outline level (MS Project semantics).
    for (let j = i - 1; j >= 0; j--) {
      const c = data.tasks[j]!;
      if (c.outlineLevel === t.outlineLevel) { await updateTask.fn({ issueId: id, patch: { parentIssueId: c.issueId } }); return; }
      if (c.outlineLevel < t.outlineLevel) break;
    }
    push("Nothing above this task to indent under", "err");
  };
  const outdent = async (id: string) => {
    if (!data) return;
    const t = data.tasks.find((k) => k.issueId === id);
    if (!t?.parentIssueId) return;
    const parent = data.tasks.find((k) => k.issueId === t.parentIssueId);
    await updateTask.fn({ issueId: id, patch: { parentIssueId: parent?.parentIssueId ?? null } });
  };
  const s = data?.summary;

  return (
    <div className={`pm-page ${embedded ? "pm-embedded" : ""}`}>
      <div className="pm-toolbar">
        {!embedded && (
          <div>
            <h1 className="pm-title">Project Manager</h1>
            <div className="pm-sub">Gantt · critical path · resource planning for humans and agents</div>
          </div>
        )}
        {!embedded && (
          <select className="pm-select" value={projectId ?? ""} onChange={(e) => { setProjectId(e.target.value || null); setSelectedId(null); }} style={{ minWidth: 200 }}>
            {!projects.data?.length && <option value="">No projects</option>}
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div className="pm-seg">
          <button className={view === "gantt" ? "pm-active" : ""} onClick={() => setView("gantt")}>Gantt Chart</button>
          <button className={view === "critical" ? "pm-active" : ""} onClick={() => setView("critical")}>Critical Path</button>
          <button className={view === "sheet" ? "pm-active" : ""} onClick={() => setView("sheet")}>Resource Sheet</button>
          <button className={view === "usage" ? "pm-active" : ""} onClick={() => setView("usage")}>Resource Usage</button>
          <button className={view === "evm" ? "pm-active" : ""} onClick={() => setView("evm")}>S-Curve & Budget</button>
          <button className={view === "comms" ? "pm-active" : ""} onClick={() => setView("comms")}>Communications</button>
        </div>
        {view === "gantt" && (
          <>
            <div className="pm-seg">
              <button className={zoom === "day" ? "pm-active" : ""} onClick={() => setZoom("day")}>Day</button>
              <button className={zoom === "week" ? "pm-active" : ""} onClick={() => setZoom("week")}>Week</button>
              <button className={zoom === "month" ? "pm-active" : ""} onClick={() => setZoom("month")}>Month</button>
            </div>
            <button className={`pm-btn ${showCritical ? "pm-active" : ""}`} onClick={() => setShowCritical(!showCritical)}>Critical path</button>
            <button className={`pm-btn ${showLinks ? "pm-active" : ""}`} onClick={() => setShowLinks(!showLinks)}>Links</button>
            <button className={`pm-btn ${showBaseline ? "pm-active" : ""}`} onClick={() => setShowBaseline(!showBaseline)}>Baseline</button>
          </>
        )}
        <span className="pm-spacer" />
        <button className="pm-btn pm-primary" disabled={!projectId} onClick={() => setAdding((v) => !v)}>+ Task</button>
        <button className="pm-btn" disabled={!selectedId} onClick={() => selectedId && setInfoOpen(true)} title="Task information (Enter)">Task info</button>
        <button className="pm-btn" disabled={!projectId || busy} onClick={() => saveBaseline.fn({ projectId }, "Baseline saved")} title="Snapshot current dates as the baseline">Save baseline</button>
        {data?.plan.baselineSavedAt && <button className="pm-btn" disabled={busy} onClick={() => { if (confirm("Clear the saved baseline?")) void clearBaseline.fn({ projectId }, "Baseline cleared"); }}>Clear baseline</button>}
        <button className="pm-btn" disabled={!projectId || busy} onClick={async () => { const r = (await level.fn({ projectId })) as { delayedTasks: number }; push(`Leveled: ${r.delayedTasks} task(s) delayed to fit capacity`); }} title="Delay tasks so no resource exceeds its daily capacity">Level resources</button>
        {data?.tasks.some((t) => t.levelingDelayDays > 0) && <button className="pm-btn" disabled={busy} onClick={() => clearLeveling.fn({ projectId }, "Leveling cleared")}>Undo leveling</button>}
        <button className="pm-btn" disabled={plan.loading} onClick={refresh} title="Re-read issues and recalculate">↻</button>
      </div>

      {adding && projectId && (
        <div className="pm-card" style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <div className="pm-field" style={{ flex: 1, minWidth: 220 }}><label>New task (creates a Paperclip issue in this project)</label><input className="pm-input" autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onCreate()} placeholder="Task title" /></div>
          <div className="pm-field"><label>Duration (days)</label><input className="pm-input" type="number" min={0} value={newDuration} onChange={(e) => setNewDuration(e.target.value)} /></div>
          <div className="pm-field"><label>After</label>
            <select className="pm-select" value={newPred} onChange={(e) => setNewPred(e.target.value)} style={{ maxWidth: 240 }}>
              <option value="">— project start —</option>
              {data?.tasks.map((t) => <option key={t.issueId} value={t.issueId}>{t.identifier} {t.title}</option>)}
            </select>
          </div>
          <div className="pm-field"><label>Assign to</label>
            <select className="pm-select" value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">— unassigned —</option>
              <optgroup label="Agents">{data?.agents.map((a) => <option key={a.id} value={a.id}>🤖 {a.name}</option>)}</optgroup>
              <optgroup label="People">{data?.humans.map((h) => <option key={h.id} value={h.id}>👤 {h.name}</option>)}</optgroup>
            </select>
          </div>
          <button className="pm-btn pm-primary" disabled={!newTitle.trim() || busy} onClick={onCreate}>Create</button>
          <button className="pm-btn" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}

      {plan.error && <div className="pm-error">{plan.error.message}</div>}
      {projects.error && <div className="pm-error">{projects.error.message}</div>}

      {s && data && (
        <div className="pm-kpis">
          <div className="pm-kpi"><div className="pm-kpi-label">Project finish</div><div className="pm-kpi-value">{fmtDate(s.projectFinish)}</div><div className="pm-kpi-hint">{s.durationDays} working days from {fmtDate(s.projectStart)}</div></div>
          <div className={`pm-kpi ${s.slippageDays != null && s.slippageDays > 0 ? "pm-bad" : s.slippageDays != null ? "pm-good" : ""}`}><div className="pm-kpi-label">Vs baseline</div><div className="pm-kpi-value">{s.slippageDays == null ? "—" : s.slippageDays > 0 ? `+${s.slippageDays}d` : s.slippageDays < 0 ? `${s.slippageDays}d` : "on plan"}</div><div className="pm-kpi-hint">{s.baselineFinish ? `baseline ${fmtDateFull(s.baselineFinish)}` : "no baseline saved"}</div></div>
          <div className={`pm-kpi ${s.criticalCount > 0 ? "pm-bad" : ""}`}><div className="pm-kpi-label">Critical tasks</div><div className="pm-kpi-value">{s.criticalCount}</div><div className="pm-kpi-hint">of {s.taskCount} tasks · zero float</div></div>
          <div className={`pm-kpi ${s.overdueCount > 0 ? "pm-bad" : ""}`}><div className="pm-kpi-label">Overdue</div><div className="pm-kpi-value">{s.overdueCount}</div><div className="pm-kpi-hint">planned finish before today</div></div>
          <div className="pm-kpi"><div className="pm-kpi-label">Complete</div><div className="pm-kpi-value">{s.percentComplete}%</div><div className="pm-kpi-hint">{s.completedCount} done · {data.resources.length} resources</div></div>
          <div className="pm-kpi"><div className="pm-kpi-label">Plan start</div><div className="pm-kpi-value"><input className="pm-input" type="date" defaultValue={data.plan.startDate} key={data.plan.startDate} onBlur={(e) => e.target.value && e.target.value !== data.plan.startDate && updatePlan.fn({ projectId, patch: { startDate: e.target.value } }, "Plan start updated")} style={{ height: 26, fontSize: 13, width: 140, padding: "0 4px" }} /></div><div className="pm-kpi-hint">day 0 of the working calendar</div></div>
        </div>
      )}

      <div className="pm-body">
        <div className="pm-main">
          {!projectId && <div className="pm-empty">Create a project in Paperclip first, then plan it here.</div>}
          {projectId && plan.loading && !data && <div className="pm-empty">Loading plan…</div>}
          {data && data.tasks.length === 0 && view === "gantt" && <div className="pm-empty">This project has no issues yet. Add a task above, or create issues in Paperclip and they will appear here.</div>}
          {data && (view === "gantt" && data.tasks.length > 0) && (
            <Gantt
              plan={data}
              zoom={zoom}
              showCritical={showCritical}
              showBaseline={showBaseline}
              showLinks={showLinks}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={(id, start) => { const t = data.tasks.find((k) => k.issueId === id); void updateTask.fn({ issueId: id, patch: { startDate: start, constraintType: t && t.constraintType === "mso" ? "mso" : "snet" } }); }}
              onResize={(id, dur) => void updateTask.fn({ issueId: id, patch: { durationDays: dur } })}
              onLink={(pred, succ) => void setLink.fn({ projectId, predecessorIssueId: pred, successorIssueId: succ, type: "FS", lagDays: 0 }, "Dependency added")}
              onEditLink={(link, patch) => patch ? void setLink.fn({ projectId, predecessorIssueId: link.predecessorIssueId, successorIssueId: link.successorIssueId, type: patch.type, lagDays: patch.lagDays }, "Dependency updated") : void removeLink.fn({ projectId, predecessorIssueId: link.predecessorIssueId, successorIssueId: link.successorIssueId }, "Dependency removed")}
              onRename={(id, title) => void updateTask.fn({ issueId: id, patch: { title } })}
              onSetDuration={(id, days) => void updateTask.fn({ issueId: id, patch: { durationDays: days } })}
              onSetPredecessors={(id, preds: PredecessorSpec[]) => void setPredecessors.fn({ projectId, issueId: id, predecessors: preds })}
              onAssignNames={(id, names) => void assignByNames.fn({ issueId: id, names })}
              onSetPercent={(id, pct) => void updateTask.fn({ issueId: id, patch: { percentComplete: pct } })}
              onToggleCollapse={(id, collapsed) => void updateTask.fn({ issueId: id, patch: { collapsed } })}
              onInsert={async (anchor, position, isMilestone) => { const r = (await insertTask.fn({ projectId, anchorIssueId: anchor, position, isMilestone, title: isMilestone ? "New milestone" : "New task", durationDays: 1 })) as { issueId: string }; setSelectedId(r.issueId); }}
              onDelete={(id) => { void deleteTask.fn({ issueId: id, cancelIssue: true }, "Task deleted"); if (selectedId === id) setSelectedId(null); }}
              onIndent={indent}
              onOutdent={outdent}
              onSetMilestone={(id, m) => void updateTask.fn({ issueId: id, patch: m ? { isMilestone: true, durationDays: 0 } : { isMilestone: false, durationDays: 1 } })}
              onOpenInfo={(id) => { setSelectedId(id); setInfoOpen(true); }}
            />
          )}
          {data && view === "critical" && <CriticalPathView plan={data} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); }} />}
          {data && view === "evm" && (
            <EvmView plan={data} evm={evm.data ?? null} loading={evm.loading} busy={busy}
              onUpdateSettings={(patch) => updateSettings.fn({ projectId, patch }, "Settings saved")}
              onUpdateTaskCosts={(issueId, patch) => updateTaskCosts.fn({ issueId, patch })}
              onRecordStatus={() => recordStatus.fn({ projectId }, "Status snapshot recorded")} />
          )}
          {data && view === "comms" && (
            <CommsView plan={data} comms={comms.data ?? null} loading={comms.loading} busy={busy} toast={push}
              onGenerateReport={() => genReport.fn({ projectId })}
              onSendReport={(reportId, to) => sendReport.fn({ reportId, to }) as Promise<{ sent: boolean; mailto: string; error?: string }>}
              onNudge={(issueId, message) => nudgeOne.fn({ projectId, issueId, message }) as Promise<{ channel: string; mailto?: string; queued?: boolean; error?: string }>}
              onNudgeAll={(kinds) => nudgeAll.fn({ projectId, kinds }) as Promise<{ count: number }>}
              onUpsertStakeholder={(item) => upStake.fn({ projectId, item })}
              onDeleteStakeholder={(id) => delStake.fn({ id })}
              onUpsertComm={(item) => upComm.fn({ projectId, item })}
              onDeleteComm={(id) => delComm.fn({ id })}
              onUpsertRaid={(item) => upRaid.fn({ projectId, item })}
              onDeleteRaid={(id) => delRaid.fn({ id })}
              onUpdateSettings={(patch) => updateSettings.fn({ projectId, patch }, "Settings saved")} />
          )}
          {data && (view === "sheet" || view === "usage") && (() => {
            const rp = {
              plan: data,
              busy,
              onUpsert: (r: Partial<Resource>) => upsertResource.fn({ resource: r }, "Resource saved"),
              onDelete: (id: string) => deleteResource.fn({ resourceId: id }, "Resource deleted"),
              onImportAgents: async () => { const r = (await importAgents.fn({})) as { created: number }; push(`Imported ${r.created} agent(s)`); },
              onUpdateCalendar: (cal: typeof data.calendar) => updateCalendar.fn({ calendar: cal }, "Calendar updated"),
            };
            return view === "sheet" ? <ResourceSheet {...rp} /> : <ResourceUsage {...rp} />;
          })()}
          {data && view === "gantt" && data.tasks.length > 0 && (
            <div className="pm-legend" style={{ marginTop: 8 }}>
              <span><i style={{ background: "var(--pm-bar)" }} />task</span>
              <span><i style={{ background: "var(--pm-critical)" }} />critical path</span>
              <span><i style={{ background: "var(--pm-done)" }} />done</span>
              <span><i style={{ background: "var(--pm-milestone)" }} />milestone</span>
              <span><i style={{ background: "var(--pm-baseline)" }} />baseline</span>
              <span><i style={{ background: "var(--pm-today)" }} />today</span>
              <span className="pm-muted">Click a cell to edit · right-click a row for insert / indent / delete · drag bars to move, right edge to resize, ○ handle to link · click an arrow to change FS/SS/FF/SF and lag · Enter opens Task Information.</span>
            </div>
          )}
        </div>
        {selected && data && infoOpen && (
          <TaskEditor
            plan={data}
            task={selected}
            busy={busy}
            issueHref={issueHref(selected.identifier)}
            onClose={() => setInfoOpen(false)}
            onUpdate={(patch) => updateTask.fn({ issueId: selected.issueId, patch })}
            onSetLink={(pred: string, type: LinkType, lag: number) => setLink.fn({ projectId, predecessorIssueId: pred, successorIssueId: selected.issueId, type, lagDays: lag }, "Dependency added")}
            onRemoveLink={(pred) => removeLink.fn({ projectId, predecessorIssueId: pred, successorIssueId: selected.issueId }, "Dependency removed")}
            onAssign={(ids, units) => assign.fn({ issueId: selected.issueId, resourceIds: ids, unitsPct: units })}
            onRemove={async (cancelIssue) => { await removeTask.fn({ issueId: selected.issueId, cancelIssue }, "Task removed from plan"); setSelectedId(null); }}
            onMoveOrder={moveOrder}
          />
        )}
      </div>

      {toasts.map((t) => <div key={t.id} className={`pm-toast ${t.kind === "err" ? "pm-toast-err" : ""}`}>{t.message}</div>)}
    </div>
  );
}
