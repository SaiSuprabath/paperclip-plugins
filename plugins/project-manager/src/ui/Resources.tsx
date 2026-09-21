import { useMemo, useState } from "react";
import type { PlanPayload, Resource } from "../shared/types.js";
import { WorkCalendar, addCalendarDays, computeSchedule, computeAllocation, parseIsoDate } from "../shared/cpm.js";
import { fmtDate } from "./util.js";

export interface ResourcesProps {
  plan: PlanPayload;
  busy: boolean;
  onUpsert(resource: Partial<Resource>): Promise<unknown>;
  onDelete(id: string): Promise<unknown>;
  onImportAgents(): Promise<unknown>;
  onUpdateCalendar(cal: PlanPayload["calendar"]): Promise<unknown>;
}

const SHEET_COLS: { key: string; label: string; w: number }[] = [
  { key: "id", label: "ID", w: 36 },
  { key: "name", label: "Resource Name", w: 200 },
  { key: "kind", label: "Type", w: 90 },
  { key: "linked", label: "Paperclip identity", w: 190 },
  { key: "initials", label: "Initials", w: 70 },
  { key: "group", label: "Group", w: 120 },
  { key: "max", label: "Max. Units", w: 84 },
  { key: "hours", label: "Hours/Day", w: 84 },
  { key: "std", label: "Std. Rate", w: 90 },
  { key: "ovt", label: "Ovt. Rate", w: 90 },
  { key: "role", label: "Role / Title", w: 140 },
  { key: "active", label: "Active", w: 60 },
  { key: "del", label: "", w: 40 },
];

function Cell({ value, onCommit, type = "text", placeholder, align }: { value: string; onCommit(v: string): void; type?: string; placeholder?: string; align?: "right" }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!edit) return <div className="pm-cell" style={align ? { textAlign: align } : undefined} onClick={() => { setDraft(value); setEdit(true); }}>{value || <span className="pm-muted">{placeholder ?? ""}</span>}</div>;
  return <input autoFocus className="pm-cell-input" type={type} value={draft} style={align ? { textAlign: align } : undefined} onChange={(e) => setDraft(e.target.value)} onBlur={() => { setEdit(false); if (draft !== value) onCommit(draft); }} onKeyDown={(e) => { if (e.key === "Enter") { setEdit(false); if (draft !== value) onCommit(draft); } if (e.key === "Escape") setEdit(false); }} />;
}

export function ResourceSheet(p: ResourcesProps) {
  const { plan } = p;
  const [newName, setNewName] = useState("");
  const save = (r: Resource, patch: Partial<Resource>) => p.onUpsert({ ...r, ...patch });
  const linkedLabel = (r: Resource) => (r.agentId ? plan.agents.find((a) => a.id === r.agentId)?.name ?? "agent" : r.userId ? plan.humans.find((h) => h.id === r.userId)?.name ?? "user" : "");
  return (
    <div className="pm-card" style={{ overflow: "auto" }}>
      <div className="pm-card-head">Resource Sheet <span className="pm-sub">click a cell to edit · humans and AI agents</span><span className="pm-spacer" /><button className="pm-btn" disabled={p.busy} onClick={() => p.onImportAgents()}>Import Paperclip agents</button></div>
      <div className="pm-sheet" style={{ gridTemplateColumns: SHEET_COLS.map((c) => `${c.w}px`).join(" ") }}>
        {SHEET_COLS.map((c) => <div key={c.key} className="pm-sheet-head">{c.label}</div>)}
        {plan.resources.map((r, i) => (
          <div key={r.id} className={`pm-sheet-row ${r.active ? "" : "pm-inactive"}`} style={{ display: "contents" }}>
            <div className="pm-cell pm-muted pm-mono">{i + 1}</div>
            <Cell value={r.name} onCommit={(v) => v.trim() && save(r, { name: v.trim() })} />
            <div className="pm-cell"><select className="pm-cell-select" value={r.kind} onChange={(e) => save(r, { kind: e.target.value as Resource["kind"], agentId: null, userId: null })}><option value="human">Human</option><option value="agent">AI agent</option></select></div>
            <div className="pm-cell">
              {r.kind === "agent" ? (
                <select className="pm-cell-select" value={r.agentId ?? ""} onChange={(e) => save(r, { agentId: e.target.value || null })}><option value="">— not linked —</option>{plan.agents.map((a) => <option key={a.id} value={a.id}>🤖 {a.name}</option>)}</select>
              ) : (
                <select className="pm-cell-select" value={r.userId ?? ""} onChange={(e) => save(r, { userId: e.target.value || null })}><option value="">— not a Paperclip user —</option>{plan.humans.map((h) => <option key={h.id} value={h.id}>👤 {h.name}</option>)}</select>
              )}
              {linkedLabel(r) && <span className="pm-sub" style={{ display: "none" }}>{linkedLabel(r)}</span>}
            </div>
            <Cell value={r.initials ?? ""} onCommit={(v) => save(r, { initials: v.trim() || null })} />
            <Cell value={r.groupName ?? ""} onCommit={(v) => save(r, { groupName: v.trim() || null })} placeholder="—" />
            <Cell value={`${r.maxUnitsPct}%`} align="right" onCommit={(v) => save(r, { maxUnitsPct: Math.max(0, Number(v.replace(/[^0-9.]/g, "")) || 100) })} />
            <Cell value={`${r.capacityHoursPerDay}h`} align="right" onCommit={(v) => save(r, { capacityHoursPerDay: Math.max(1, Number(v.replace(/[^0-9.]/g, "")) || 8) })} />
            <Cell value={r.costPerHour != null ? `$${r.costPerHour}/h` : ""} align="right" placeholder="$0/h" onCommit={(v) => save(r, { costPerHour: v.trim() === "" ? null : Number(v.replace(/[^0-9.]/g, "")) })} />
            <Cell value={r.overtimeRate != null ? `$${r.overtimeRate}/h` : ""} align="right" placeholder="$0/h" onCommit={(v) => save(r, { overtimeRate: v.trim() === "" ? null : Number(v.replace(/[^0-9.]/g, "")) })} />
            <Cell value={r.role ?? ""} onCommit={(v) => save(r, { role: v.trim() || null })} placeholder="—" />
            <div className="pm-cell" style={{ textAlign: "center" }}><input type="checkbox" checked={r.active} onChange={(e) => save(r, { active: e.target.checked })} /></div>
            <div className="pm-cell" style={{ textAlign: "center" }}><button className="pm-btn pm-danger" style={{ height: 22, padding: "0 6px" }} disabled={p.busy} title="Delete resource" onClick={() => confirm(`Delete resource "${r.name}" and its assignments?`) && p.onDelete(r.id)}>✕</button></div>
          </div>
        ))}
        <div className="pm-cell pm-muted pm-mono">{plan.resources.length + 1}</div>
        <div className="pm-cell" style={{ gridColumn: "2 / -1" }}>
          <input className="pm-cell-input" placeholder="Type a name and press Enter to add a human resource…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && newName.trim()) { await p.onUpsert({ kind: "human", name: newName.trim(), capacityHoursPerDay: 8, active: true, maxUnitsPct: 100 }); setNewName(""); } }} />
        </div>
      </div>
    </div>
  );
}

export function ResourceUsage(p: ResourcesProps) {
  const { plan } = p;
  const cal = useMemo(() => new WorkCalendar(plan.plan.startDate, plan.calendar), [plan.plan.startDate, plan.calendar]);
  const heat = useMemo(() => {
    const live = plan.tasks.filter((t) => !t.isSummary && t.status !== "cancelled" && t.percentComplete < 100);
    const schedule = computeSchedule(
      live.map((t) => ({ id: t.issueId, duration: t.isMilestone ? 0 : t.durationDays, predecessors: t.predecessors.filter((x) => live.some((l) => l.issueId === x.issueId)).map((x) => ({ id: x.issueId, type: x.type, lag: x.lagDays })), constraintType: t.constraintType, constraintDate: t.startDate, levelingDelay: t.levelingDelayDays })),
      plan.plan.startDate,
      plan.calendar,
    );
    const durations = new Map(live.map((t) => [t.issueId, t.isMilestone ? 0 : t.durationDays]));
    const effort = new Map(live.map((t) => [t.issueId, t.effortHours]));
    const alloc = computeAllocation(schedule, durations, plan.assignments.filter((a) => durations.has(a.issueId)).map((a) => ({ taskId: a.issueId, resourceId: a.resourceId, unitsPct: a.unitsPct, effortHours: effort.get(a.issueId) ?? null })), plan.resources.map((r) => ({ id: r.id, capacityHoursPerDay: r.capacityHoursPerDay })), plan.calendar.hoursPerDay);
    const first = live.length ? live.map((t) => t.start).sort()[0]! : plan.today;
    const last = live.length ? live.map((t) => t.finish).sort().at(-1)! : plan.today;
    const weeks: { start: string; label: string; idxFrom: number; idxTo: number; workdays: number }[] = [];
    let cur = addCalendarDays(first, -((parseIsoDate(first).getUTCDay() + 6) % 7));
    let guard = 0;
    while (cur <= last && guard++ < 104) {
      let workdays = 0;
      for (let i = 0; i < 7; i++) if (cal.isWorkingDay(addCalendarDays(cur, i))) workdays++;
      weeks.push({ start: cur, label: fmtDate(cur), idxFrom: cal.toIndex(cur), idxTo: cal.toIndex(addCalendarDays(cur, 7)), workdays });
      cur = addCalendarDays(cur, 7);
    }
    const perResource = new Map<string, number[]>();
    const tasksByResource = new Map<string, string[]>();
    for (const r of plan.resources) {
      const byDay = alloc.get(r.id) ?? new Map<number, number>();
      perResource.set(r.id, weeks.map((w) => { let h = 0; for (let d = w.idxFrom; d < w.idxTo; d++) h += byDay.get(d) ?? 0; return h; }));
      tasksByResource.set(r.id, plan.assignments.filter((a) => a.resourceId === r.id && durations.has(a.issueId)).map((a) => live.find((t) => t.issueId === a.issueId)?.title ?? ""));
    }
    return { weeks, perResource, tasksByResource };
  }, [plan, cal]);
  const heatColor = (u: number) => (u <= 0 ? "var(--muted)" : u <= 0.5 ? "oklch(75% 0.12 150 / 0.35)" : u <= 0.85 ? "oklch(72% 0.14 150 / 0.6)" : u <= 1 ? "oklch(78% 0.15 80 / 0.7)" : "oklch(62% 0.2 25 / 0.75)");
  const toggleDay = (d: number) => { const set = new Set(plan.calendar.workingDays); set.has(d) ? set.delete(d) : set.add(d); void p.onUpdateCalendar({ ...plan.calendar, workingDays: [...set].sort() }); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="pm-card">
        <div className="pm-card-head">Resource Usage <span className="pm-sub">hours scheduled per week vs capacity · remaining work only</span><span className="pm-spacer" />
          <span className="pm-legend"><span><i style={{ background: "oklch(75% 0.12 150 / 0.35)" }} />≤50%</span><span><i style={{ background: "oklch(72% 0.14 150 / 0.6)" }} />≤85%</span><span><i style={{ background: "oklch(78% 0.15 80 / 0.7)" }} />≤100%</span><span><i style={{ background: "oklch(62% 0.2 25 / 0.75)" }} />over-allocated</span></span>
        </div>
        {plan.resources.length === 0 || heat.weeks.length === 0 ? <div className="pm-empty">Assign resources to tasks (Resource Names column) to see usage.</div> : (
          <div style={{ padding: 12, overflowX: "auto" }}>
            <div className="pm-heat" style={{ gridTemplateColumns: `200px repeat(${heat.weeks.length}, minmax(48px, 1fr))` }}>
              <div />
              {heat.weeks.map((w) => <div key={w.start} className="pm-heat-head">{w.label}</div>)}
              {plan.resources.map((r) => (
                <ResourceRow key={r.id} r={r} hours={heat.perResource.get(r.id) ?? []} weeks={heat.weeks} heatColor={heatColor} tasks={heat.tasksByResource.get(r.id) ?? []} />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="pm-card">
        <div className="pm-card-head">Working calendar <span className="pm-sub">company-wide · used for all durations and the critical path</span></div>
        <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <div className="pm-seg">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => <button key={d} className={plan.calendar.workingDays.includes(i) ? "pm-active" : ""} onClick={() => toggleDay(i)}>{d}</button>)}</div>
          <label className="pm-row pm-sub">Hours per day <input className="pm-input" type="number" min={1} max={24} defaultValue={plan.calendar.hoursPerDay} onBlur={(e) => Number(e.target.value) !== plan.calendar.hoursPerDay && p.onUpdateCalendar({ ...plan.calendar, hoursPerDay: Number(e.target.value) })} /></label>
          <label className="pm-row pm-sub">Holidays (ISO dates, comma-separated) <input className="pm-input" style={{ width: 320 }} defaultValue={plan.calendar.holidays.join(", ")} onBlur={(e) => { const hol = e.target.value.split(",").map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)); if (hol.join() !== plan.calendar.holidays.join()) void p.onUpdateCalendar({ ...plan.calendar, holidays: hol }); }} /></label>
        </div>
      </div>
    </div>
  );
}

function ResourceRow({ r, hours, weeks, heatColor, tasks }: { r: Resource; hours: number[]; weeks: { workdays: number; start: string }[]; heatColor(u: number): string; tasks: string[] }) {
  return (
    <>
      <div className="pm-heat-label" title={tasks.join("\n")}><span className={`pm-chip ${r.kind === "agent" ? "pm-agent" : "pm-human"}`}>{r.kind === "agent" ? "🤖" : "👤"}</span> {r.name} <span className="pm-muted">({tasks.length})</span></div>
      {weeks.map((w, i) => { const cap = r.capacityHoursPerDay * (r.maxUnitsPct / 100) * w.workdays; const h = hours[i] ?? 0; const util = cap > 0 ? h / cap : 0; return <div key={w.start} className="pm-heat-cell" style={{ background: heatColor(util) }} title={`${r.name} · week of ${fmtDate(w.start)}: ${Math.round(h)}h of ${Math.round(cap)}h (${Math.round(util * 100)}%)`}>{h > 0 ? `${Math.round(h)}h` : ""}</div>; })}
    </>
  );
}
