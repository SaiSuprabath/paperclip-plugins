import { useMemo, useState } from "react";
import type { EvmPayload, PlanPayload } from "../shared/types.js";
import { fmtDate } from "./util.js";

export interface EvmProps {
  plan: PlanPayload;
  evm: EvmPayload | null;
  loading: boolean;
  busy: boolean;
  onUpdateSettings(patch: Record<string, unknown>): Promise<unknown>;
  onUpdateTaskCosts(issueId: string, patch: Record<string, unknown>): Promise<unknown>;
  onRecordStatus(): Promise<unknown>;
}

export function money(n: number | null | undefined, currency: string, digits = 0): string {
  if (n == null) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: digits }).format(n); } catch { return `${currency} ${Math.round(n)}`; }
}

function Cell({ value, onCommit, placeholder }: { value: string; onCommit(v: string): void; placeholder?: string }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!edit) return <div className="pm-cell" style={{ textAlign: "right", justifyContent: "flex-end" }} onClick={() => { setDraft(value); setEdit(true); }}>{value || <span className="pm-muted">{placeholder ?? ""}</span>}</div>;
  return <input autoFocus className="pm-cell-input" style={{ textAlign: "right" }} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { setEdit(false); if (draft !== value) onCommit(draft); }} onKeyDown={(e) => { if (e.key === "Enter") { setEdit(false); if (draft !== value) onCommit(draft); } if (e.key === "Escape") setEdit(false); }} />;
}

export function SCurve({ evm, height = 260 }: { evm: EvmPayload; height?: number }) {
  const W = 900, H = height, L = 64, R = 20, T = 16, B = 34;
  const pts = evm.curve;
  const maxY = Math.max(evm.metrics.bac, ...pts.map((p) => Math.max(p.pv, p.ev ?? 0, p.ac ?? 0)), 1) * 1.05;
  const t0 = Date.parse(pts[0]?.date ?? evm.metrics.statusDate);
  const t1 = Math.max(Date.parse(pts.at(-1)?.date ?? evm.metrics.statusDate), t0 + 86_400_000);
  const xFor = (iso: string) => L + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - L - R);
  const yFor = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const path = (key: "pv" | "ev" | "ac") => pts.filter((p) => p[key] != null).map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.date).toFixed(1)},${yFor(p[key] as number).toFixed(1)}`).join(" ");
  const status = evm.metrics.statusDate;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);
  const monthTicks = useMemo(() => { const out: { x: number; label: string }[] = []; const d = new Date(t0); d.setUTCDate(1); while (d.getTime() <= t1) { const iso = d.toISOString().slice(0, 10); if (d.getTime() >= t0) out.push({ x: xFor(iso), label: new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(d) }); d.setUTCMonth(d.getUTCMonth() + 1); } return out; }, [t0, t1]);
  const last = pts.filter((p) => p.ev != null).at(-1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={yFor(v)} y2={yFor(v)} stroke="var(--border)" /><text x={L - 8} y={yFor(v) + 4} fontSize={10.5} textAnchor="end" fill="var(--muted-foreground)">{money(v, evm.currency)}</text></g>)}
      {monthTicks.map((m) => <g key={m.x}><line x1={m.x} x2={m.x} y1={T} y2={H - B} stroke="var(--border)" strokeDasharray="2 3" /><text x={m.x + 3} y={H - B + 14} fontSize={10.5} fill="var(--muted-foreground)">{m.label}</text></g>)}
      <line x1={L} x2={W - R} y1={yFor(evm.metrics.bac)} y2={yFor(evm.metrics.bac)} stroke="var(--muted-foreground)" strokeDasharray="6 4" />
      <text x={W - R} y={yFor(evm.metrics.bac) - 4} fontSize={10.5} textAnchor="end" fill="var(--muted-foreground)">BAC {money(evm.metrics.bac, evm.currency)}</text>
      <path d={path("pv")} fill="none" stroke="var(--pm-pv)" strokeWidth={2.2} />
      <path d={path("ac")} fill="none" stroke="var(--pm-ac)" strokeWidth={2.2} />
      <path d={path("ev")} fill="none" stroke="var(--pm-ev)" strokeWidth={2.6} />
      {last && <circle cx={xFor(last.date)} cy={yFor(last.ev!)} r={4} fill="var(--pm-ev)" />}
      {last && last.ac != null && <circle cx={xFor(last.date)} cy={yFor(last.ac)} r={4} fill="var(--pm-ac)" />}
      <line x1={xFor(status)} x2={xFor(status)} y1={T} y2={H - B} stroke="var(--pm-today)" strokeDasharray="4 3" strokeWidth={1.5} />
      <text x={xFor(status) + 4} y={T + 10} fontSize={10.5} fill="var(--pm-today)">status {fmtDate(status)}</text>
      <line x1={xFor(evm.metrics.forecastFinish)} x2={xFor(evm.metrics.forecastFinish)} y1={T} y2={H - B} stroke="var(--pm-critical)" strokeDasharray="2 3" />
      <text x={xFor(evm.metrics.forecastFinish) - 4} y={H - B - 4} fontSize={10.5} textAnchor="end" fill="var(--pm-critical)">forecast {fmtDate(evm.metrics.forecastFinish)}</text>
      <g fontSize={11}>
        <rect x={L + 8} y={H - 14} width={12} height={3} fill="var(--pm-pv)" /><text x={L + 24} y={H - 10} fill="var(--foreground)">Planned value (PV)</text>
        <rect x={L + 150} y={H - 14} width={12} height={3} fill="var(--pm-ev)" /><text x={L + 166} y={H - 10} fill="var(--foreground)">Earned value (EV)</text>
        <rect x={L + 290} y={H - 14} width={12} height={3} fill="var(--pm-ac)" /><text x={L + 306} y={H - 10} fill="var(--foreground)">Actual cost (AC)</text>
      </g>
    </svg>
  );
}

export function EvmView(p: EvmProps) {
  const { plan, evm } = p;
  const cur = plan.plan.currency;
  const s = plan.plan;
  const [showAll, setShowAll] = useState(false);
  if (!evm) return <div className="pm-empty">{p.loading ? "Computing earned value…" : "No data"}</div>;
  const m = evm.metrics;
  const ragClass = m.rag === "red" ? "pm-bad" : m.rag === "amber" ? "pm-warn-kpi" : "pm-good";
  const idx = (v: number | null) => (v == null ? "—" : v.toFixed(2));
  const tone = (v: number | null) => (v == null ? "" : v < 0.9 ? "pm-bad" : v < 0.97 ? "pm-warn-kpi" : "pm-good");
  const rows = showAll ? evm.tasks : evm.tasks.filter((t) => t.plannedCost > 0 || t.actualCost > 0 || t.isSummary);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "auto", flex: 1, minHeight: 0 }}>
      <div className="pm-kpis">
        <div className={`pm-kpi ${ragClass}`}><div className="pm-kpi-label">Overall status</div><div className="pm-kpi-value">{m.rag === "green" ? "🟢 Green" : m.rag === "amber" ? "🟡 Amber" : "🔴 Red"}</div><div className="pm-kpi-hint">{m.ragReasons.join("; ") || "on plan"}</div></div>
        <div className={`pm-kpi ${tone(m.spi)}`}><div className="pm-kpi-label">SPI · schedule</div><div className="pm-kpi-value">{idx(m.spi)}</div><div className="pm-kpi-hint">SV {money(m.sv, cur)} · {m.pctComplete}% earned vs {m.pctPlanned}% planned</div></div>
        <div className={`pm-kpi ${tone(m.cpi)}`}><div className="pm-kpi-label">CPI · cost</div><div className="pm-kpi-value">{idx(m.cpi)}</div><div className="pm-kpi-hint">CV {money(m.cv, cur)} · spent {m.pctSpent}% of budget</div></div>
        <div className="pm-kpi"><div className="pm-kpi-label">Budget (BAC)</div><div className="pm-kpi-value">{money(m.bac, cur)}</div><div className="pm-kpi-hint">PV {money(m.pv, cur)} · EV {money(m.ev, cur)} · AC {money(m.ac, cur)}</div></div>
        <div className={`pm-kpi ${m.vac < 0 ? "pm-bad" : ""}`}><div className="pm-kpi-label">Estimate at completion</div><div className="pm-kpi-value">{money(m.eac, cur)}</div><div className="pm-kpi-hint">ETC {money(m.etc, cur)} · VAC {money(m.vac, cur)} · TCPI {idx(m.tcpi)}</div></div>
        <div className={`pm-kpi ${m.forecastFinish > m.plannedFinish ? "pm-bad" : ""}`}><div className="pm-kpi-label">Forecast finish</div><div className="pm-kpi-value">{fmtDate(m.forecastFinish)}</div><div className="pm-kpi-hint">baseline {fmtDate(m.plannedFinish)} · current {fmtDate(plan.summary.projectFinish)}</div></div>
      </div>

      <div className="pm-card">
        <div className="pm-card-head">S-curve · plan vs actual <span className="pm-sub">cumulative cost over time · updated on each status snapshot</span><span className="pm-spacer" />
          <span className="pm-sub">{evm.snapshots.length} snapshot(s)</span>
          <button className="pm-btn pm-primary" disabled={p.busy} onClick={() => p.onRecordStatus()} title="Record today's PV/EV/AC point (also done automatically every Monday)">Update status now</button>
        </div>
        <div style={{ padding: "8px 12px" }}><SCurve evm={evm} /></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <div className="pm-card">
          <div className="pm-card-head">Cost by task <span className="pm-sub">planned from resource rates × hours unless overridden · actual = logged hours × rate + AI agent spend</span><span className="pm-spacer" /><label className="pm-sub pm-row"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show all</label></div>
          <div className="pm-sheet" style={{ gridTemplateColumns: "minmax(200px, 1fr) 110px 90px 110px 90px 90px 70px" }}>
            {["Task", "Planned cost", "Plan hrs", "Actual cost", "Actual hrs", "Earned", "%"].map((h) => <div key={h} className="pm-sheet-head" style={h !== "Task" ? { textAlign: "right" } : undefined}>{h}</div>)}
            {rows.map((t) => (
              <div key={t.issueId} style={{ display: "contents" }}>
                <div className="pm-cell" style={{ paddingLeft: 6 + t.outlineLevel * 14, fontWeight: t.isSummary ? 600 : 400, cursor: "default" }}><span className="pm-task-id">{t.identifier}</span>{t.title}{t.resources ? <span className="pm-muted"> · {t.resources}</span> : null}</div>
                {t.isSummary ? <div className="pm-cell pm-mono" style={{ justifyContent: "flex-end", fontWeight: 600, cursor: "default" }}>{money(t.plannedCost, cur)}</div> : <Cell value={t.plannedCost ? String(t.plannedCost) : ""} placeholder="auto" onCommit={(v) => p.onUpdateTaskCosts(t.issueId, { plannedCost: v.trim() === "" ? null : Number(v.replace(/[^0-9.]/g, "")) })} />}
                <div className="pm-cell pm-mono" style={{ justifyContent: "flex-end", cursor: "default" }}>{t.plannedHours ? `${t.plannedHours}h` : ""}</div>
                {t.isSummary ? <div className="pm-cell pm-mono" style={{ justifyContent: "flex-end", fontWeight: 600, cursor: "default" }}>{money(t.actualCost, cur)}</div> : <Cell value={t.actualCost ? String(t.actualCost) : ""} placeholder={t.agentCost ? `AI ${money(t.agentCost, cur, 2)}` : "0"} onCommit={(v) => p.onUpdateTaskCosts(t.issueId, { actualCost: v.trim() === "" ? null : Number(v.replace(/[^0-9.]/g, "")) })} />}
                {t.isSummary ? <div className="pm-cell pm-mono" style={{ justifyContent: "flex-end", cursor: "default" }}>{t.actualHours ? `${t.actualHours}h` : ""}</div> : <Cell value={t.actualHours ? String(t.actualHours) : ""} placeholder="0h" onCommit={(v) => p.onUpdateTaskCosts(t.issueId, { actualHours: v.trim() === "" ? null : Number(v.replace(/[^0-9.]/g, "")) })} />}
                <div className="pm-cell pm-mono" style={{ justifyContent: "flex-end", cursor: "default" }}>{money(t.earnedValue, cur)}</div>
                <div className="pm-cell pm-mono" style={{ justifyContent: "flex-end", cursor: "default" }}>{t.percentComplete}%</div>
              </div>
            ))}
            {rows.length === 0 && <div className="pm-cell pm-muted" style={{ gridColumn: "1 / -1", padding: 16 }}>Give resources an hourly rate on the Resource Sheet, or type a planned cost per task, to build the budget.</div>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="pm-card">
            <div className="pm-card-head">Project budget & governance</div>
            <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label className="pm-field"><span className="pm-sub">Budget at completion</span><input className="pm-input" type="number" min={0} key={`b${s.budgetAmount}`} defaultValue={s.budgetAmount ?? ""} placeholder={`auto ${money(evm.tasks.filter((t) => !t.isSummary).reduce((a, t) => a + t.plannedCost, 0), cur)}`} onBlur={(e) => (e.target.value === "" ? null : Number(e.target.value)) !== s.budgetAmount && p.onUpdateSettings({ budgetAmount: e.target.value === "" ? null : Number(e.target.value) })} /></label>
              <label className="pm-field"><span className="pm-sub">Currency</span><input className="pm-input" key={`c${s.currency}`} defaultValue={s.currency} maxLength={3} onBlur={(e) => e.target.value.trim() && e.target.value.toUpperCase() !== s.currency && p.onUpdateSettings({ currency: e.target.value })} /></label>
              <label className="pm-field"><span className="pm-sub">Status date</span><input className="pm-input" type="date" key={`sd${s.statusDate}`} defaultValue={s.statusDate ?? ""} onBlur={(e) => (e.target.value || null) !== s.statusDate && p.onUpdateSettings({ statusDate: e.target.value || null })} /></label>
              <label className="pm-field"><span className="pm-sub">RAG override</span><select className="pm-select" value={s.ragOverride ?? ""} onChange={(e) => p.onUpdateSettings({ ragOverride: e.target.value || null })}><option value="">automatic</option><option value="green">Green</option><option value="amber">Amber</option><option value="red">Red</option></select></label>
              <label className="pm-field"><span className="pm-sub">Sponsor</span><input className="pm-input" key={`sp${s.sponsor}`} defaultValue={s.sponsor ?? ""} onBlur={(e) => (e.target.value || null) !== s.sponsor && p.onUpdateSettings({ sponsor: e.target.value })} /></label>
              <label className="pm-field"><span className="pm-sub">Project manager</span><input className="pm-input" key={`pm${s.pmName}`} defaultValue={s.pmName ?? ""} onBlur={(e) => (e.target.value || null) !== s.pmName && p.onUpdateSettings({ pmName: e.target.value })} /></label>
            </div>
          </div>
          <div className="pm-card">
            <div className="pm-card-head">Cost by resource</div>
            <table className="pm-table">
              <thead><tr><th>Resource</th><th className="pm-num">Tasks</th><th className="pm-num">Planned hrs</th><th className="pm-num">Planned cost</th></tr></thead>
              <tbody>
                {evm.resources.map((r) => <tr key={r.resourceId}><td><span className={`pm-chip ${r.kind === "agent" ? "pm-agent" : "pm-human"}`}>{r.kind === "agent" ? "🤖" : "👤"}</span> {r.name}</td><td className="pm-num">{r.taskCount}</td><td className="pm-num">{r.plannedHours}h</td><td className="pm-num">{money(r.plannedCost, cur)}</td></tr>)}
                {evm.resources.length === 0 && <tr><td colSpan={4} className="pm-muted" style={{ textAlign: "center", padding: 16 }}>No resources assigned yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
