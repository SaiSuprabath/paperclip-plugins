import { useState } from "react";
import { CR_IMPACTS, CR_STATUSES, CR_TRANSITIONS, CR_TYPES, type ChangeRequest, type CrStatus, type ProjectOverview } from "../shared/types.js";
import { useChangeRequest } from "./api.js";
import { fmtDateFull } from "./util.js";

const COLS: { key: CrStatus | "closed"; label: string; statuses: CrStatus[] }[] = [
  { key: "draft", label: "Draft", statuses: ["draft"] },
  { key: "submitted", label: "Submitted", statuses: ["submitted"] },
  { key: "under_review", label: "Under review", statuses: ["under_review"] },
  { key: "approved", label: "Approved", statuses: ["approved"] },
  { key: "implemented", label: "Implemented", statuses: ["implemented"] },
  { key: "closed", label: "Rejected / withdrawn", statuses: ["rejected", "withdrawn"] },
];

const LABEL: Record<CrStatus, string> = { draft: "Draft", submitted: "Submit", under_review: "Start review", approved: "Approve", rejected: "Reject", implemented: "Mark implemented", withdrawn: "Withdraw" };

export interface ChangesProps {
  o: ProjectOverview;
  companyId: string | null;
  busy: boolean;
  issueHref(identifier: string | null): string | null;
  onCreate(input: Record<string, unknown>): Promise<unknown>;
  onUpdate(id: string, patch: Record<string, unknown>): Promise<unknown>;
  onTransition(id: string, to: CrStatus, note: string, opts: { createImplementationIssue?: boolean; targetSprintId?: string | null }): Promise<unknown>;
  onComment(id: string, note: string): Promise<unknown>;
}

export function ChangesView(p: ChangesProps) {
  const { o } = p;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = o.changeRequests.find((c) => c.id === selectedId) ?? null;
  const pending = o.changeRequests.filter((c) => ["submitted", "under_review"].includes(c.status)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
      <div className="pl-row" style={{ flexWrap: "wrap" }}>
        <span className="pl-sub">Change control: every scope, schedule, budget or requirement change is requested, assessed for impact, decided, then implemented. {pending > 0 && <strong>{pending} awaiting decision.</strong>}</span>
        <span style={{ flex: 1 }} />
        <button className="pl-btn pl-primary" onClick={() => setCreating((v) => !v)}>+ Change request</button>
      </div>
      {creating && <NewCr o={o} busy={p.busy} onCancel={() => setCreating(false)} onCreate={async (input) => { await p.onCreate(input); setCreating(false); }} />}
      <div className="pl-body" style={{ minHeight: 0 }}>
        <div className="pl-kanban">
          {COLS.map((col) => {
            const cards = o.changeRequests.filter((c) => col.statuses.includes(c.status));
            return (
              <div key={col.key} className="pl-col">
                <div className="pl-col-head"><span>{col.label}</span><span>{cards.length}</span></div>
                <div className="pl-col-body">
                  {cards.map((c) => (
                    <div key={c.id} className={`pl-crcard ${selectedId === c.id ? "pl-selected" : ""}`} onClick={() => setSelectedId(c.id)}>
                      <div className="pl-crnum">CR-{c.number} · {c.type}</div>
                      <div style={{ fontWeight: 500 }}>{c.title}</div>
                      <div className="pl-row" style={{ flexWrap: "wrap", gap: 4 }}>
                        <span className={`pl-chip pl-impact-${c.impact}`}>{c.impact} impact</span>
                        <span className="pl-chip">{c.priority}</span>
                        {c.requestedByName && <span className={`pl-chip ${c.requestedByType === "agent" ? "pl-agent" : "pl-human"}`}>{c.requestedByType === "agent" ? "🤖" : "👤"} {c.requestedByName}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {selected && <CrDrawer key={selected.id} cr={selected} p={p} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}

function NewCr({ o, busy, onCancel, onCreate }: { o: ProjectOverview; busy: boolean; onCancel(): void; onCreate(input: Record<string, unknown>): Promise<unknown> }) {
  const [f, setF] = useState({ title: "", description: "", type: "scope", impact: "medium", impactAssessment: "", priority: "medium", relatedIssueIds: [] as string[], submit: true });
  return (
    <div className="pl-card" style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <div className="pl-field" style={{ gridColumn: "1 / -1" }}><label>Title</label><input className="pl-input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Add SMS reminders to appointment flow" /></div>
      <div className="pl-field"><label>Type</label><select className="pl-select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{CR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
      <div className="pl-row">
        <div className="pl-field" style={{ flex: 1 }}><label>Impact</label><select className="pl-select" value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })}>{CR_IMPACTS.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <div className="pl-field" style={{ flex: 1 }}><label>Priority</label><select className="pl-select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{["critical", "high", "medium", "low"].map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
      </div>
      <div className="pl-field"><label>Description — what changes and why</label><textarea className="pl-textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="pl-field"><label>Impact assessment — scope, schedule, cost, quality, risk</label><textarea className="pl-textarea" value={f.impactAssessment} onChange={(e) => setF({ ...f, impactAssessment: e.target.value })} /></div>
      <div className="pl-field" style={{ gridColumn: "1 / -1" }}><label>Affected issues</label>
        <select className="pl-select" multiple style={{ height: 80 }} value={f.relatedIssueIds} onChange={(e) => setF({ ...f, relatedIssueIds: [...e.target.selectedOptions].map((x) => x.value) })}>
          {o.issues.filter((i) => i.status !== "cancelled").map((i) => <option key={i.id} value={i.id}>{i.identifier} {i.title}</option>)}
        </select>
      </div>
      <label className="pl-row pl-sub"><input type="checkbox" checked={f.submit} onChange={(e) => setF({ ...f, submit: e.target.checked })} /> Submit for review immediately (otherwise saved as draft)</label>
      <div className="pl-row" style={{ justifyContent: "flex-end" }}>
        <button className="pl-btn" onClick={onCancel}>Cancel</button>
        <button className="pl-btn pl-primary" disabled={busy || !f.title.trim() || !f.description.trim()} onClick={() => onCreate(f)}>Create</button>
      </div>
    </div>
  );
}

function CrDrawer({ cr, p, onClose }: { cr: ChangeRequest; p: ChangesProps; onClose(): void }) {
  const detail = useChangeRequest(p.companyId, cr.id);
  const [note, setNote] = useState("");
  const [createIssue, setCreateIssue] = useState(true);
  const [targetSprint, setTargetSprint] = useState<string>(cr.targetSprintId ?? "");
  const editable = cr.status === "draft" || cr.status === "submitted";
  const transitions = CR_TRANSITIONS[cr.status];
  const impl = cr.implementationIssueId ? p.o.issues.find((i) => i.id === cr.implementationIssueId) : null;
  const doTransition = async (to: CrStatus) => {
    if ((to === "rejected") && !note.trim()) { alert("Please add a decision note when rejecting."); return; }
    await p.onTransition(cr.id, to, note, { createImplementationIssue: to === "approved" ? createIssue : undefined, targetSprintId: targetSprint || null });
    setNote("");
    detail.refresh?.();
  };
  return (
    <aside className="pl-drawer" style={{ width: 420 }}>
      <div className="pl-drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pl-sub">CR-{cr.number} · {cr.type} · opened {fmtDateFull(cr.createdAt.slice(0, 10))}{cr.requestedByName ? ` by ${cr.requestedByName}` : ""}</div>
          {editable ? <input className="pl-input" style={{ fontWeight: 600, fontSize: 14, width: "100%" }} defaultValue={cr.title} onBlur={(e) => e.target.value.trim() && e.target.value !== cr.title && p.onUpdate(cr.id, { title: e.target.value })} /> : <h3>{cr.title}</h3>}
          <div className="pl-row" style={{ marginTop: 6, flexWrap: "wrap" }}>
            <span className={`pl-chip ${cr.status === "approved" || cr.status === "implemented" ? "pl-ok" : cr.status === "rejected" ? "pl-crit" : "pl-warn"}`}>{cr.status.replace("_", " ")}</span>
            <span className={`pl-chip pl-impact-${cr.impact}`}>{cr.impact} impact</span>
            <span className="pl-chip">{cr.priority}</span>
          </div>
        </div>
        <button className="pl-btn" onClick={onClose}>✕</button>
      </div>
      <div className="pl-drawer-body">
        <div className="pl-grid2">
          <div className="pl-field"><label>Type</label><select className="pl-select" value={cr.type} disabled={!editable} onChange={(e) => p.onUpdate(cr.id, { type: e.target.value })}>{CR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className="pl-field"><label>Impact</label><select className="pl-select" value={cr.impact} disabled={!editable} onChange={(e) => p.onUpdate(cr.id, { impact: e.target.value })}>{CR_IMPACTS.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className="pl-field"><label>Priority</label><select className="pl-select" value={cr.priority} disabled={cr.status === "implemented"} onChange={(e) => p.onUpdate(cr.id, { priority: e.target.value })}>{["critical", "high", "medium", "low"].map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className="pl-field"><label>Owner (implements if approved)</label>
            <select className="pl-select" value={cr.ownerAgentId ?? (cr.ownerUserId ? `u:${cr.ownerUserId}` : "")} disabled={cr.status === "implemented"} onChange={(e) => { const v = e.target.value; void p.onUpdate(cr.id, { ownerAgentId: v && !v.startsWith("u:") ? v : null, ownerUserId: v.startsWith("u:") ? v.slice(2) : null }); }}>
              <option value="">— none —</option>
              <optgroup label="Agents">{p.o.agents.map((a) => <option key={a.id} value={a.id}>🤖 {a.name}</option>)}</optgroup>
              <optgroup label="People">{p.o.humans.map((h) => <option key={h.id} value={`u:${h.id}`}>👤 {h.name}</option>)}</optgroup>
            </select>
          </div>
        </div>
        <div className="pl-field"><label>Description</label>{editable ? <textarea className="pl-textarea" defaultValue={cr.description ?? ""} onBlur={(e) => e.target.value !== (cr.description ?? "") && p.onUpdate(cr.id, { description: e.target.value })} /> : <div style={{ whiteSpace: "pre-wrap" }}>{cr.description || <em className="pl-sub">none</em>}</div>}</div>
        <div className="pl-field"><label>Impact assessment</label>{cr.status !== "implemented" ? <textarea className="pl-textarea" defaultValue={cr.impactAssessment ?? ""} placeholder="Scope · schedule · cost · quality · risk" onBlur={(e) => e.target.value !== (cr.impactAssessment ?? "") && p.onUpdate(cr.id, { impactAssessment: e.target.value })} /> : <div style={{ whiteSpace: "pre-wrap" }}>{cr.impactAssessment || <em className="pl-sub">none</em>}</div>}</div>
        {cr.relatedIssueIds.length > 0 && (
          <div className="pl-field"><label>Affected issues</label>
            <div className="pl-list">{cr.relatedIssueIds.map((id) => { const i = p.o.issues.find((x) => x.id === id); return <div key={id} className="pl-list-item"><span className="pl-grow"><span className="pl-task-id">{i?.identifier}</span>{i?.title ?? id}</span><span className="pl-chip">{i?.status.replace("_", " ")}</span></div>; })}</div>
          </div>
        )}
        {impl && <div className="pl-field"><label>Implementation issue</label><div className="pl-list-item"><span className="pl-grow"><span className="pl-task-id">{impl.identifier}</span>{impl.title}</span><span className="pl-chip">{impl.status.replace("_", " ")}</span>{p.issueHref(impl.identifier) && <a href={p.issueHref(impl.identifier)!} target="_blank" rel="noreferrer">↗</a>}</div></div>}
        {cr.decisionNote && <div className="pl-field"><label>Decision{cr.decidedBy ? ` · ${cr.decidedBy}` : ""}{cr.decidedAt ? ` · ${fmtDateFull(cr.decidedAt.slice(0, 10))}` : ""}</label><div style={{ whiteSpace: "pre-wrap" }}>{cr.decisionNote}</div></div>}

        {transitions.length > 0 && (
          <div className="pl-card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--muted)" }}>
            <div className="pl-section-title" style={{ margin: 0 }}>Decision</div>
            <textarea className="pl-textarea" placeholder="Note / rationale (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
            {transitions.includes("approved") && (
              <>
                <label className="pl-row pl-sub"><input type="checkbox" checked={createIssue} onChange={(e) => setCreateIssue(e.target.checked)} /> Create implementation issue on approval</label>
                {createIssue && <select className="pl-select" value={targetSprint} onChange={(e) => setTargetSprint(e.target.value)}><option value="">Backlog (no sprint)</option>{p.o.sprints.filter((s) => s.status !== "closed").map((s) => <option key={s.id} value={s.id}>{s.name} ({s.status})</option>)}</select>}
              </>
            )}
            <div className="pl-row" style={{ flexWrap: "wrap" }}>
              {transitions.map((to) => <button key={to} className={`pl-btn ${to === "approved" || to === "submitted" || to === "implemented" ? "pl-primary" : to === "rejected" || to === "withdrawn" ? "pl-danger" : ""}`} disabled={p.busy} onClick={() => doTransition(to)}>{LABEL[to]}</button>)}
            </div>
          </div>
        )}

        <div className="pl-section-title">Audit trail</div>
        <div className="pl-timeline">
          {(detail.data?.events ?? []).map((e) => (
            <div className="pl-tl-item" key={e.id}>
              <i style={{ background: e.kind === "transition" ? (e.toStatus === "approved" ? "var(--pl-done)" : e.toStatus === "rejected" ? "var(--pl-critical)" : "var(--pl-bar)") : "var(--muted-foreground)" }} />
              <div>
                <div>{e.kind === "transition" ? <><strong>{e.toStatus?.replace("_", " ")}</strong>{e.fromStatus ? <span className="pl-sub"> (from {e.fromStatus.replace("_", " ")})</span> : null}</> : e.kind === "comment" ? <strong>Comment</strong> : e.kind === "implementation_issue" ? <><strong>Implementation issue</strong> {e.note}</> : e.kind === "edited" ? <span className="pl-sub">Edited {e.note}</span> : <strong>{e.kind}</strong>}{e.actorName ? <span className="pl-sub"> · {e.actorType === "agent" ? "🤖" : "👤"} {e.actorName}</span> : null}</div>
                {e.note && e.kind !== "edited" && e.kind !== "implementation_issue" && <div style={{ whiteSpace: "pre-wrap" }}>{e.note}</div>}
                <div className="pl-tl-time">{new Date(e.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
        <CommentBox busy={p.busy} onSubmit={async (n) => { await p.onComment(cr.id, n); detail.refresh?.(); }} />
      </div>
    </aside>
  );
}

function CommentBox({ busy, onSubmit }: { busy: boolean; onSubmit(note: string): Promise<unknown> }) {
  const [v, setV] = useState("");
  return (
    <div className="pl-row">
      <input className="pl-input" style={{ flex: 1 }} placeholder="Add a comment to the audit trail" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && v.trim()) { await onSubmit(v.trim()); setV(""); } }} />
      <button className="pl-btn" disabled={busy || !v.trim()} onClick={async () => { await onSubmit(v.trim()); setV(""); }}>Post</button>
    </div>
  );
}

export { CR_STATUSES };
