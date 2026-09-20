import { useState } from "react";
import { STAGES, STAGE_GATES, STAGE_LABELS, type ProjectOverview, type Stage } from "../shared/types.js";
import { fmtDate, fmtDateFull } from "./util.js";

export interface LifecycleProps {
  o: ProjectOverview;
  busy: boolean;
  onSetStage(stage: Stage, note: string): Promise<unknown>;
  onToggleGate(stage: Stage, gate: string, done: boolean): Promise<unknown>;
  onUpdate(patch: Record<string, unknown>): Promise<unknown>;
}

export function LifecycleView({ o, busy, onSetStage, onToggleGate, onUpdate }: LifecycleProps) {
  const lc = o.lifecycle;
  const idx = STAGES.indexOf(lc.stage);
  const [pending, setPending] = useState<Stage | null>(null);
  const [note, setNote] = useState("");
  const gatesFor = (s: Stage) => ({ all: STAGE_GATES[s], done: new Set(lc.gates[s] ?? []) });
  const cur = gatesFor(lc.stage);
  const open = o.changeRequests.filter((c) => ["submitted", "under_review"].includes(c.status)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0, overflow: "auto" }}>
      <div className="pl-stepper">
        {STAGES.map((s, i) => {
          const g = gatesFor(s);
          return (
            <div key={s} className={`pl-step ${s === lc.stage ? "pl-current" : i < idx ? "pl-past" : ""}`} onClick={() => s !== lc.stage && setPending(s)} title={`Move to ${STAGE_LABELS[s]}`}>
              <div className="pl-step-n">Stage {i + 1}{i < idx ? " · ✓" : s === lc.stage ? " · current" : ""}</div>
              <div className="pl-step-name">{STAGE_LABELS[s]}</div>
              <div className="pl-step-gates">{g.done.size}/{g.all.length} gates</div>
            </div>
          );
        })}
      </div>

      {pending && (
        <div className="pl-card" style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>Move project to {STAGE_LABELS[pending]}?</strong>
          {STAGES.indexOf(pending) > idx && cur.done.size < cur.all.length && <span className="pl-chip pl-warn">{cur.all.length - cur.done.size} gate(s) of {STAGE_LABELS[lc.stage]} still open</span>}
          <input className="pl-input" style={{ flex: 1, minWidth: 220 }} placeholder="Gate review note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="pl-btn pl-primary" disabled={busy} onClick={async () => { await onSetStage(pending, note); setPending(null); setNote(""); }}>Confirm</button>
          <button className="pl-btn" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}

      <div className="pl-kpis">
        <div className="pl-kpi"><div className="pl-kpi-label">Current stage</div><div className="pl-kpi-value">{STAGE_LABELS[lc.stage]}</div><div className="pl-kpi-hint">{cur.done.size}/{cur.all.length} exit gates met</div></div>
        <div className="pl-kpi"><div className="pl-kpi-label">Target launch</div><div className="pl-kpi-value"><input className="pl-input" type="date" key={lc.targetLaunch ?? "none"} defaultValue={lc.targetLaunch ?? ""} onBlur={(e) => (e.target.value || null) !== lc.targetLaunch && onUpdate({ targetLaunch: e.target.value || null })} style={{ height: 26, fontSize: 13, width: 150, padding: "0 4px" }} /></div><div className="pl-kpi-hint">{lc.targetLaunch ? `${Math.round((Date.parse(lc.targetLaunch) - Date.parse(o.today)) / 86_400_000)} days away` : "not set"}</div></div>
        <div className="pl-kpi"><div className="pl-kpi-label">Active sprint</div><div className="pl-kpi-value">{o.activeSprint?.name ?? "—"}</div><div className="pl-kpi-hint">{o.activeSprint ? `ends ${fmtDate(o.activeSprint.endDate)}` : `${o.sprints.filter((s) => s.status === "planning").length} planned`}</div></div>
        <div className={`pl-kpi ${open ? "pl-bad" : ""}`}><div className="pl-kpi-label">Change requests</div><div className="pl-kpi-value">{open}</div><div className="pl-kpi-hint">awaiting decision · {o.changeRequests.length} total</div></div>
        <div className="pl-kpi"><div className="pl-kpi-label">Backlog</div><div className="pl-kpi-value">{o.issues.filter((i) => !["done", "cancelled"].includes(i.status)).length}</div><div className="pl-kpi-hint">open issues · {o.issues.filter((i) => i.storyPoints == null && !["done", "cancelled"].includes(i.status)).length} unestimated</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
        <div className="pl-card">
          <div className="pl-card-head">Exit gates · {STAGE_LABELS[lc.stage]} <span className="pl-sub">tick each when the evidence exists</span></div>
          {cur.all.map((g) => {
            const done = cur.done.has(g);
            return (
              <label key={g} className={`pl-gate ${done ? "pl-done" : ""}`}>
                <input type="checkbox" checked={done} disabled={busy} onChange={(e) => onToggleGate(lc.stage, g, e.target.checked)} />
                <span>{g}</span>
              </label>
            );
          })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="pl-card">
            <div className="pl-card-head">Product vision</div>
            <div style={{ padding: 12 }}>
              <textarea className="pl-textarea" style={{ width: "100%", minHeight: 90 }} key={lc.vision ?? ""} defaultValue={lc.vision ?? ""} placeholder="For [customer] who [need], this product [does]… unlike [alternative], it [key differentiator]." onBlur={(e) => e.target.value !== (lc.vision ?? "") && onUpdate({ vision: e.target.value })} />
            </div>
          </div>
          <div className="pl-card">
            <div className="pl-card-head">Cadence</div>
            <div style={{ padding: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
              <label className="pl-field"><span className="pl-sub">Sprint length (days)</span><input className="pl-input" type="number" min={1} max={60} defaultValue={lc.sprintLengthDays} key={`len${lc.sprintLengthDays}`} onBlur={(e) => Number(e.target.value) !== lc.sprintLengthDays && onUpdate({ sprintLengthDays: Number(e.target.value) })} /></label>
              <label className="pl-field"><span className="pl-sub">Default capacity (points)</span><input className="pl-input" type="number" min={1} defaultValue={lc.defaultCapacityPoints} key={`cap${lc.defaultCapacityPoints}`} onBlur={(e) => Number(e.target.value) !== lc.defaultCapacityPoints && onUpdate({ defaultCapacityPoints: Number(e.target.value) })} /></label>
            </div>
          </div>
          <div className="pl-card">
            <div className="pl-card-head">Stage history</div>
            <div style={{ padding: "6px 12px" }} className="pl-timeline">
              {lc.history.length === 0 && <div className="pl-sub" style={{ padding: "6px 0" }}>Project has been in {STAGE_LABELS[lc.stage]} since it was added.</div>}
              {lc.history.map((h, i) => (
                <div className="pl-tl-item" key={i}>
                  <i />
                  <div>
                    <div>{h.fromStage ? `${STAGE_LABELS[h.fromStage as Stage] ?? h.fromStage} → ` : ""}<strong>{STAGE_LABELS[h.toStage as Stage] ?? h.toStage}</strong>{h.actor ? <span className="pl-sub"> · {h.actor}</span> : null}</div>
                    {h.note && <div className="pl-sub">{h.note}</div>}
                    <div className="pl-tl-time">{fmtDateFull(h.createdAt.slice(0, 10))}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
