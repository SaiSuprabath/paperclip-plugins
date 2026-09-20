import { useMemo, useState } from "react";
import type { PlanPayload, Resource } from "../shared/types.js";
import { WorkCalendar, addCalendarDays, computeSchedule, computeAllocation, diffCalendarDays, parseIsoDate } from "../shared/cpm.js";
import { fmtDate } from "./util.js";

export interface ResourcesProps {
  plan: PlanPayload;
  busy: boolean;
  onUpsert(resource: Partial<Resource>): Promise<unknown>;
  onDelete(id: string): Promise<unknown>;
  onImportAgents(): Promise<unknown>;
  onUpdateCalendar(cal: PlanPayload["calendar"]): Promise<unknown>;
  onSelectTask(id: string): void;
}

const EMPTY: Partial<Resource> = { kind: "human", name: "", email: "", role: "", capacityHoursPerDay: 8, costPerHour: null, userId: null, agentId: null, active: true };

export function ResourcesView(p: ResourcesProps) {
  const { plan } = p;
  const [draft, setDraft] = useState<Partial<Resource>>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);

  const cal = useMemo(() => new WorkCalendar(plan.plan.startDate, plan.calendar), [plan.plan.startDate, plan.calendar]);

  // Weekly allocation heatmap over the plan range.
  const heat = useMemo(() => {
    const live = plan.tasks.filter((t) => t.status !== "cancelled" && t.percentComplete < 100);
    const schedule = computeSchedule(
      live.map((t) => ({ id: t.issueId, duration: t.isMilestone ? 0 : t.durationDays, predecessors: t.predecessors.map((x) => ({ id: x.issueId, type: x.type, lag: x.lagDays })), constraintType: t.constraintType, constraintDate: t.startDate, levelingDelay: t.levelingDelayDays })),
      plan.plan.startDate,
      plan.calendar,
    );
    const durations = new Map(live.map((t) => [t.issueId, t.isMilestone ? 0 : t.durationDays]));
    const effort = new Map(live.map((t) => [t.issueId, t.effortHours]));
    const alloc = computeAllocation(
      schedule,
      durations,
      plan.assignments.filter((a) => durations.has(a.issueId)).map((a) => ({ taskId: a.issueId, resourceId: a.resourceId, unitsPct: a.unitsPct, effortHours: effort.get(a.issueId) ?? null })),
      plan.resources.map((r) => ({ id: r.id, capacityHoursPerDay: r.capacityHoursPerDay })),
      plan.calendar.hoursPerDay,
    );
    // Weeks
    const first = live.length ? live.map((t) => t.start).sort()[0]! : plan.today;
    const last = live.length ? live.map((t) => t.finish).sort().at(-1)! : plan.today;
    const startMon = addCalendarDays(first, -((parseIsoDate(first).getUTCDay() + 6) % 7));
    const weeks: { start: string; label: string; idxFrom: number; idxTo: number; workdays: number }[] = [];
    let cur = startMon;
    let guard = 0;
    while (cur <= last && guard++ < 104) {
      const end = addCalendarDays(cur, 6);
      let workdays = 0;
      for (let i = 0; i < 7; i++) if (cal.isWorkingDay(addCalendarDays(cur, i))) workdays++;
      weeks.push({ start: cur, label: fmtDate(cur), idxFrom: cal.toIndex(cur), idxTo: cal.toIndex(addCalendarDays(end, 1)), workdays });
      cur = addCalendarDays(cur, 7);
    }
    const perResource = new Map<string, number[]>();
    const tasksByResource = new Map<string, Set<string>>();
    for (const r of plan.resources) {
      const byDay = alloc.get(r.id) ?? new Map<number, number>();
      perResource.set(r.id, weeks.map((w) => { let h = 0; for (let d = w.idxFrom; d < w.idxTo; d++) h += byDay.get(d) ?? 0; return h; }));
      tasksByResource.set(r.id, new Set(plan.assignments.filter((a) => a.resourceId === r.id && durations.has(a.issueId)).map((a) => a.issueId)));
    }
    return { weeks, perResource, tasksByResource };
  }, [plan, cal]);

  const save = async () => {
    if (!draft.name?.trim()) return;
    await p.onUpsert({ ...draft, id: editing ?? undefined });
    setDraft(EMPTY);
    setEditing(null);
  };

  const heatColor = (util: number) => {
    if (util <= 0) return "var(--muted)";
    if (util <= 0.5) return "oklch(75% 0.12 150 / 0.35)";
    if (util <= 0.85) return "oklch(72% 0.14 150 / 0.6)";
    if (util <= 1.0) return "oklch(78% 0.15 80 / 0.7)";
    return "oklch(62% 0.2 25 / 0.75)";
  };

  const toggleDay = (d: number) => {
    const set = new Set(plan.calendar.workingDays);
    if (set.has(d)) set.delete(d); else set.add(d);
    void p.onUpdateCalendar({ ...plan.calendar, workingDays: [...set].sort() });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0, overflow: "auto" }}>
      <div className="pm-card">
        <div className="pm-card-head">
          Resource pool <span className="pm-sub">{plan.resources.length} resources · humans and agents</span>
          <span className="pm-spacer" />
          <button className="pm-btn" disabled={p.busy} onClick={() => p.onImportAgents()} title="Create a resource for every Paperclip agent in this company">Import agents</button>
        </div>
        <table className="pm-table">
          <thead>
            <tr><th>Name</th><th>Kind</th><th>Role</th><th>Linked to</th><th className="pm-num">Capacity</th><th className="pm-num">Rate</th><th className="pm-num">Tasks</th><th className="pm-num">Hours</th><th></th></tr>
          </thead>
          <tbody>
            {plan.resources.map((r) => {
              const hours = (heat.perResource.get(r.id) ?? []).reduce((a, b) => a + b, 0);
              return (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                  <td><span className="pm-dot" style={{ background: r.color ?? (r.kind === "agent" ? "var(--pm-bar)" : "var(--pm-done)") }} />{r.name}{r.email ? <span className="pm-muted"> · {r.email}</span> : null}</td>
                  <td><span className={`pm-chip ${r.kind === "agent" ? "pm-agent" : "pm-human"}`}>{r.kind}</span></td>
                  <td className="pm-muted">{r.role ?? "—"}</td>
                  <td className="pm-muted">{r.agentId ? plan.agents.find((a) => a.id === r.agentId)?.name ?? "agent" : r.userId ? plan.humans.find((h) => h.id === r.userId)?.name ?? "user" : "—"}</td>
                  <td className="pm-num">{r.capacityHoursPerDay}h/d</td>
                  <td className="pm-num">{r.costPerHour != null ? `$${r.costPerHour}/h` : "—"}</td>
                  <td className="pm-num">{heat.tasksByResource.get(r.id)?.size ?? 0}</td>
                  <td className="pm-num">{Math.round(hours)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="pm-btn" onClick={() => { setEditing(r.id); setDraft({ ...r }); }}>Edit</button>{" "}
                    <button className="pm-btn pm-danger" disabled={p.busy} onClick={() => { if (confirm(`Delete resource "${r.name}" and its assignments?`)) void p.onDelete(r.id); }}>✕</button>
                  </td>
                </tr>
              );
            })}
            {plan.resources.length === 0 && <tr><td colSpan={9} className="pm-muted" style={{ textAlign: "center", padding: 24 }}>No resources yet. Import your agents, then add the humans on the team.</td></tr>}
          </tbody>
        </table>
        <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <div className="pm-field"><label>{editing ? "Edit resource" : "Add resource"}</label>
            <select className="pm-select" value={draft.kind ?? "human"} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Resource["kind"], agentId: null, userId: null })}>
              <option value="human">Human</option><option value="agent">Agent</option>
            </select>
          </div>
          <div className="pm-field"><label>Name</label><input className="pm-input" style={{ width: 180 }} value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Jane Doe" /></div>
          {draft.kind === "agent" ? (
            <div className="pm-field"><label>Paperclip agent</label>
              <select className="pm-select" value={draft.agentId ?? ""} onChange={(e) => { const a = plan.agents.find((x) => x.id === e.target.value); setDraft({ ...draft, agentId: e.target.value || null, name: draft.name || a?.name || "", role: draft.role || a?.role || "" }); }}>
                <option value="">— none —</option>
                {plan.agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
              </select>
            </div>
          ) : (
            <>
              <div className="pm-field"><label>Email</label><input className="pm-input" style={{ width: 180 }} value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></div>
              <div className="pm-field"><label>Paperclip user</label>
                <select className="pm-select" value={draft.userId ?? ""} onChange={(e) => { const h = plan.humans.find((x) => x.id === e.target.value); setDraft({ ...draft, userId: e.target.value || null, name: draft.name || h?.name || "", email: draft.email || h?.email || "" }); }}>
                  <option value="">— not a Paperclip user —</option>
                  {plan.humans.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="pm-field"><label>Role</label><input className="pm-input" style={{ width: 140 }} value={draft.role ?? ""} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="Engineer" /></div>
          <div className="pm-field"><label>Hours / day</label><input className="pm-input" type="number" min={1} max={24} value={draft.capacityHoursPerDay ?? 8} onChange={(e) => setDraft({ ...draft, capacityHoursPerDay: Number(e.target.value) })} /></div>
          <div className="pm-field"><label>Rate $/h</label><input className="pm-input" type="number" min={0} value={draft.costPerHour ?? ""} onChange={(e) => setDraft({ ...draft, costPerHour: e.target.value === "" ? null : Number(e.target.value) })} /></div>
          <label className="pm-row pm-sub" style={{ gap: 6, height: 30 }}><input type="checkbox" checked={draft.active !== false} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />Active</label>
          <button className="pm-btn pm-primary" disabled={p.busy || !draft.name?.trim()} onClick={save}>{editing ? "Save" : "Add"}</button>
          {editing && <button className="pm-btn" onClick={() => { setEditing(null); setDraft(EMPTY); }}>Cancel</button>}
        </div>
      </div>

      <div className="pm-card">
        <div className="pm-card-head">Weekly allocation <span className="pm-sub">hours scheduled vs capacity · remaining work only</span>
          <span className="pm-spacer" />
          <span className="pm-legend"><span><i style={{ background: "oklch(75% 0.12 150 / 0.35)" }} />≤50%</span><span><i style={{ background: "oklch(72% 0.14 150 / 0.6)" }} />≤85%</span><span><i style={{ background: "oklch(78% 0.15 80 / 0.7)" }} />≤100%</span><span><i style={{ background: "oklch(62% 0.2 25 / 0.75)" }} />over-allocated</span></span>
        </div>
        {plan.resources.length === 0 || heat.weeks.length === 0 ? (
          <div className="pm-empty">Assign resources to tasks to see the allocation heatmap.</div>
        ) : (
          <div style={{ padding: 12, overflowX: "auto" }}>
            <div className="pm-heat" style={{ gridTemplateColumns: `180px repeat(${heat.weeks.length}, minmax(46px, 1fr))` }}>
              <div />
              {heat.weeks.map((w) => <div key={w.start} className="pm-heat-head">{w.label}</div>)}
              {plan.resources.map((r) => (
                <ResourceRow key={r.id} r={r} hours={heat.perResource.get(r.id) ?? []} weeks={heat.weeks} heatColor={heatColor} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="pm-card">
        <div className="pm-card-head">Working calendar <span className="pm-sub">company-wide</span></div>
        <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <div className="pm-seg">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
              <button key={d} className={plan.calendar.workingDays.includes(i) ? "pm-active" : ""} onClick={() => toggleDay(i)}>{d}</button>
            ))}
          </div>
          <label className="pm-row pm-sub">Hours per day <input className="pm-input" type="number" min={1} max={24} defaultValue={plan.calendar.hoursPerDay} onBlur={(e) => Number(e.target.value) !== plan.calendar.hoursPerDay && p.onUpdateCalendar({ ...plan.calendar, hoursPerDay: Number(e.target.value) })} /></label>
          <label className="pm-row pm-sub">Holidays (comma-separated ISO dates)
            <input className="pm-input" style={{ width: 320 }} defaultValue={plan.calendar.holidays.join(", ")} onBlur={(e) => { const hol = e.target.value.split(",").map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)); if (hol.join() !== plan.calendar.holidays.join()) void p.onUpdateCalendar({ ...plan.calendar, holidays: hol }); }} />
          </label>
        </div>
      </div>
    </div>
  );
}

function ResourceRow({ r, hours, weeks, heatColor }: { r: Resource; hours: number[]; weeks: { workdays: number; start: string }[]; heatColor(u: number): string }) {
  return (
    <>
      <div className="pm-heat-label"><span className={`pm-chip ${r.kind === "agent" ? "pm-agent" : "pm-human"}`}>{r.kind === "agent" ? "🤖" : "👤"}</span> {r.name}</div>
      {weeks.map((w, i) => {
        const cap = r.capacityHoursPerDay * w.workdays;
        const h = hours[i] ?? 0;
        const util = cap > 0 ? h / cap : 0;
        return (
          <div key={w.start} className="pm-heat-cell" style={{ background: heatColor(util) }} title={`${r.name} · week of ${fmtDate(w.start)}: ${Math.round(h)}h of ${cap}h (${Math.round(util * 100)}%)`}>
            {h > 0 ? `${Math.round(util * 100)}%` : ""}
          </div>
        );
      })}
    </>
  );
}

// re-export for consumers that want date math
export { diffCalendarDays };
