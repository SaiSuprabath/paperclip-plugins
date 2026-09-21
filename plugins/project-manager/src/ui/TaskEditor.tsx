import { useEffect, useState } from "react";
import type { LinkType, PlanPayload, PlanTask } from "../shared/types.js";
import { fmtDate } from "./util.js";

export interface TaskEditorProps {
  plan: PlanPayload;
  task: PlanTask;
  busy: boolean;
  onClose(): void;
  onUpdate(patch: Record<string, unknown>): Promise<unknown>;
  onSetLink(predecessorIssueId: string, type: LinkType, lagDays: number): Promise<unknown>;
  onRemoveLink(predecessorIssueId: string): Promise<unknown>;
  onAssign(resourceIds: string[], unitsPct: number): Promise<unknown>;
  onRemove(cancelIssue: boolean): Promise<unknown>;
  onMoveOrder(direction: -1 | 1): Promise<unknown>;
  issueHref: string | null;
}

export function TaskEditor(p: TaskEditorProps) {
  const { plan, task } = p;
  const [duration, setDuration] = useState(String(task.durationDays));
  const [effort, setEffort] = useState(task.effortHours == null ? "" : String(task.effortHours));
  const [start, setStart] = useState(task.startDate ?? task.start);
  const [pct, setPct] = useState(task.percentComplete);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [predId, setPredId] = useState("");
  const [predType, setPredType] = useState<LinkType>("FS");
  const [predLag, setPredLag] = useState("0");
  const [units, setUnits] = useState(String(plan.assignments.find((a) => a.issueId === task.issueId)?.unitsPct ?? 100));

  useEffect(() => {
    setDuration(String(task.durationDays));
    setEffort(task.effortHours == null ? "" : String(task.effortHours));
    setStart(task.startDate ?? task.start);
    setPct(task.percentComplete);
    setNotes(task.notes ?? "");
    setUnits(String(plan.assignments.find((a) => a.issueId === task.issueId)?.unitsPct ?? 100));
  }, [task.issueId, task.durationDays, task.effortHours, task.startDate, task.start, task.percentComplete, task.notes, plan.assignments]);

  const assigned = new Set(plan.assignments.filter((a) => a.issueId === task.issueId).map((a) => a.resourceId));
  const candidates = plan.tasks.filter((t) => t.issueId !== task.issueId && !task.predecessors.some((x) => x.issueId === t.issueId) && !isDownstream(plan, task.issueId, t.issueId));
  const agentName = task.assigneeAgentId ? plan.agents.find((a) => a.id === task.assigneeAgentId)?.name : null;
  const humanName = task.assigneeUserId ? plan.humans.find((h) => h.id === task.assigneeUserId)?.name : null;

  const toggleResource = async (id: string) => {
    const next = new Set(assigned);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    await p.onAssign([...next], Number(units) || 100);
  };

  return (
    <aside className="pm-drawer">
      <div className="pm-drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pm-sub">
            {task.identifier}
            {p.issueHref && (
              <>
                {" · "}
                <a href={p.issueHref} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>open issue ↗</a>
              </>
            )}
          </div>
          <input className="pm-input" style={{ width: "100%", fontWeight: 600, fontSize: 14 }} key={task.issueId + task.title} defaultValue={task.title} onBlur={(e) => e.target.value.trim() && e.target.value !== task.title && p.onUpdate({ title: e.target.value.trim() })} />
          <div className="pm-row" style={{ marginTop: 6, flexWrap: "wrap" }}>
            <span className="pm-chip">{task.status.replace(/_/g, " ")}</span>
            <span className="pm-chip">{task.priority}</span>
            {task.critical && <span className="pm-chip pm-crit">critical path</span>}
            {!task.critical && <span className="pm-chip">float {task.totalFloat}d</span>}
            {task.levelingDelayDays > 0 && <span className="pm-chip pm-warn">leveled +{task.levelingDelayDays}d</span>}
          </div>
        </div>
        <button className="pm-btn" onClick={p.onClose} title="Close">✕</button>
      </div>
      <div className="pm-drawer-body">
        <div className="pm-field">
          <label>Summary task (outline parent)</label>
          <select className="pm-select" value={task.parentIssueId ?? ""} onChange={(e) => p.onUpdate({ parentIssueId: e.target.value || null })}>
            <option value="">— top level —</option>
            {plan.tasks.filter((t) => t.issueId !== task.issueId && !isDownstreamOutline(plan, task.issueId, t.issueId)).map((t) => <option key={t.issueId} value={t.issueId}>{"  ".repeat(t.outlineLevel)}{t.identifier} {t.title}</option>)}
          </select>
        </div>
        <div className="pm-grid2">
          <div className="pm-field">
            <label>Planned start</label>
            <input className="pm-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} onBlur={() => start && start !== (task.startDate ?? task.start) && p.onUpdate({ startDate: start, constraintType: task.constraintType === "asap" && task.predecessors.length > 0 ? "snet" : task.constraintType === "asap" ? "asap" : task.constraintType })} />
          </div>
          <div className="pm-field">
            <label>Constraint</label>
            <select className="pm-select" value={task.constraintType} onChange={(e) => p.onUpdate({ constraintType: e.target.value, startDate: start })}>
              <option value="asap">As soon as possible</option>
              <option value="snet">Start no earlier than</option>
              <option value="mso">Must start on</option>
            </select>
          </div>
          <div className="pm-field">
            <label>Duration (working days)</label>
            <input className="pm-input" type="number" min={0} step={1} value={duration} disabled={task.isMilestone} onChange={(e) => setDuration(e.target.value)} onBlur={() => Number(duration) !== task.durationDays && p.onUpdate({ durationDays: Number(duration) })} />
          </div>
          <div className="pm-field">
            <label>Effort (hours)</label>
            <input className="pm-input" type="number" min={0} step={1} value={effort} placeholder="auto" onChange={(e) => setEffort(e.target.value)} onBlur={() => (effort === "" ? null : Number(effort)) !== task.effortHours && p.onUpdate({ effortHours: effort === "" ? null : Number(effort) })} />
          </div>
        </div>
        <div className="pm-row">
          <label className="pm-row" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={task.isMilestone} onChange={(e) => p.onUpdate({ isMilestone: e.target.checked, ...(e.target.checked ? { durationDays: 0 } : { durationDays: Math.max(1, task.durationDays) }) })} />
            Milestone
          </label>
          <span className="pm-spacer" style={{ flex: 1 }} />
          <span className="pm-sub pm-mono">{fmtDate(task.start)} → {fmtDate(task.finish)}</span>
        </div>
        <div className="pm-field">
          <label>Percent complete · {pct}%</label>
          <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} onMouseUp={() => pct !== task.percentComplete && p.onUpdate({ percentComplete: pct })} onTouchEnd={() => pct !== task.percentComplete && p.onUpdate({ percentComplete: pct })} onKeyUp={() => pct !== task.percentComplete && p.onUpdate({ percentComplete: pct })} />
        </div>

        <div className="pm-section-title">Predecessors</div>
        <div className="pm-list">
          {task.predecessors.length === 0 && <div className="pm-sub">None — task starts at project start.</div>}
          {task.predecessors.map((pr) => {
            const t = plan.tasks.find((k) => k.issueId === pr.issueId);
            return (
              <div className="pm-list-item" key={pr.issueId}>
                <span className="pm-chip">{pr.type}{pr.lagDays ? (pr.lagDays > 0 ? `+${pr.lagDays}` : pr.lagDays) : ""}</span>
                <span className="pm-grow"><span className="pm-task-id">{t?.identifier}</span>{t?.title ?? pr.issueId}</span>
                <button className="pm-btn pm-danger" onClick={() => p.onRemoveLink(pr.issueId)} title="Remove dependency">✕</button>
              </div>
            );
          })}
          <div className="pm-row">
            <select className="pm-select" style={{ flex: 1 }} value={predId} onChange={(e) => setPredId(e.target.value)}>
              <option value="">Add predecessor…</option>
              {candidates.map((t) => <option key={t.issueId} value={t.issueId}>{t.identifier} {t.title}</option>)}
            </select>
            <select className="pm-select" value={predType} onChange={(e) => setPredType(e.target.value as LinkType)} title="Link type">
              <option value="FS">FS</option><option value="SS">SS</option><option value="FF">FF</option><option value="SF">SF</option>
            </select>
            <input className="pm-input" type="number" style={{ width: 64 }} value={predLag} onChange={(e) => setPredLag(e.target.value)} title="Lag (working days)" />
            <button className="pm-btn pm-primary" disabled={!predId || p.busy} onClick={async () => { await p.onSetLink(predId, predType, Number(predLag) || 0); setPredId(""); setPredLag("0"); }}>Add</button>
          </div>
        </div>

        <div className="pm-section-title">Resources</div>
        <div className="pm-sub">
          Paperclip assignee: {agentName ? <span className="pm-chip pm-agent">🤖 {agentName}</span> : humanName ? <span className="pm-chip pm-human">👤 {humanName}</span> : <em>unassigned</em>}
        </div>
        {plan.resources.length === 0 ? (
          <div className="pm-sub">No resources yet. Add people and import agents from the Resources tab.</div>
        ) : (
          <div className="pm-list">
            {plan.resources.filter((r) => r.active || assigned.has(r.id)).map((r) => (
              <label className="pm-list-item" key={r.id} style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={assigned.has(r.id)} onChange={() => toggleResource(r.id)} disabled={p.busy} />
                <span className={`pm-chip ${r.kind === "agent" ? "pm-agent" : "pm-human"}`}>{r.kind === "agent" ? "🤖" : "👤"}</span>
                <span className="pm-grow">{r.name}{r.role ? <span className="pm-muted"> · {r.role}</span> : null}</span>
                <span className="pm-sub pm-mono">{r.capacityHoursPerDay}h/d</span>
              </label>
            ))}
            <div className="pm-row">
              <label className="pm-sub">Units %</label>
              <input className="pm-input" type="number" min={1} max={200} value={units} onChange={(e) => setUnits(e.target.value)} onBlur={() => assigned.size > 0 && p.onAssign([...assigned], Number(units) || 100)} />
              <span className="pm-sub">The first selected resource becomes the issue assignee.</span>
            </div>
          </div>
        )}

        {(task.baselineStart || task.baselineFinish) && (
          <>
            <div className="pm-section-title">Baseline</div>
            <div className="pm-sub pm-mono">
              {fmtDate(task.baselineStart)} → {fmtDate(task.baselineFinish)}
              {task.baselineFinish && (
                <>
                  {" · "}
                  {(() => {
                    const d = Math.round((Date.parse(task.finish) - Date.parse(task.baselineFinish)) / 86_400_000);
                    return d > 0 ? <span className="pm-chip pm-crit">{d}d late</span> : d < 0 ? <span className="pm-chip pm-ok">{-d}d early</span> : <span className="pm-chip pm-ok">on baseline</span>;
                  })()}
                </>
              )}
            </div>
          </>
        )}

        <div className="pm-field">
          <label>Notes</label>
          <textarea className="pm-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (task.notes ?? "") && p.onUpdate({ notes })} />
        </div>

        <div className="pm-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
          <div className="pm-row">
            <button className="pm-btn" onClick={() => p.onMoveOrder(-1)} title="Move up">↑</button>
            <button className="pm-btn" onClick={() => p.onMoveOrder(1)} title="Move down">↓</button>
          </div>
          <button className="pm-btn pm-danger" disabled={p.busy} onClick={() => { if (confirm("Remove this task from the plan? The Paperclip issue is kept.")) void p.onRemove(false); }}>Remove from plan</button>
        </div>
      </div>
    </aside>
  );
}

/** True if `candidate` is downstream of `source` (adding it as a predecessor would create a cycle). */
function isDownstream(plan: PlanPayload, source: string, candidate: string): boolean {
  const seen = new Set<string>();
  const stack = [source];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === candidate) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = plan.tasks.find((k) => k.issueId === id);
    if (t) stack.push(...t.successors);
  }
  return false;
}

/** True if `candidate` is inside the outline subtree of `source`. */
function isDownstreamOutline(plan: PlanPayload, source: string, candidate: string): boolean {
  let cur: string | null = candidate;
  let guard = 0;
  while (cur && guard++ < 100) {
    if (cur === source) return true;
    cur = plan.tasks.find((t) => t.issueId === cur)?.parentIssueId ?? null;
  }
  return false;
}
