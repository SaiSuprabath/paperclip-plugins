import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { LinkType, PlanPayload, PlanTask, TaskLink } from "../shared/types.js";
import { WorkCalendar, addCalendarDays, diffCalendarDays, parseIsoDate } from "../shared/cpm.js";
import { fmtDate } from "./util.js";

export type Zoom = "day" | "week" | "month";
const PX: Record<Zoom, number> = { day: 28, week: 12, month: 4.5 };
const ROW_H = 30;
const HEAD_H = 44;
const COLS = [
  { key: "ind", label: "", w: 26 },
  { key: "id", label: "ID", w: 36 },
  { key: "name", label: "Task Name", w: 280 },
  { key: "dur", label: "Duration", w: 76 },
  { key: "start", label: "Start", w: 96 },
  { key: "finish", label: "Finish", w: 96 },
  { key: "pred", label: "Predecessors", w: 110 },
  { key: "res", label: "Resource Names", w: 170 },
  { key: "pct", label: "% Comp.", w: 60 },
] as const;
const LEFT_W = COLS.reduce((a, c) => a + c.w, 0);
const LEFT_COLS = COLS.map((c) => `${c.w}px`).join(" ");
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

export interface PredecessorSpec { predecessorIssueId: string; type: LinkType; lagDays: number }

export interface GanttProps {
  plan: PlanPayload;
  zoom: Zoom;
  showCritical: boolean;
  showBaseline: boolean;
  showLinks: boolean;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onMove(issueId: string, newStartIso: string): void;
  onResize(issueId: string, newDurationDays: number): void;
  onLink(predecessorId: string, successorId: string): void;
  onEditLink(link: TaskLink, patch: { type: LinkType; lagDays: number } | null): void;
  onRename(issueId: string, title: string): void;
  onSetDuration(issueId: string, days: number): void;
  onSetPredecessors(issueId: string, preds: PredecessorSpec[]): void;
  onAssignNames(issueId: string, names: string[]): void;
  onSetPercent(issueId: string, pct: number): void;
  onToggleCollapse(issueId: string, collapsed: boolean): void;
  onInsert(anchorIssueId: string | null, position: "above" | "below", isMilestone: boolean): void;
  onDelete(issueId: string): void;
  onIndent(issueId: string): void;
  onOutdent(issueId: string): void;
  onSetMilestone(issueId: string, milestone: boolean): void;
  onOpenInfo(issueId: string): void;
}

function startOfWeek(iso: string): string {
  const d = parseIsoDate(iso);
  return addCalendarDays(iso, -((d.getUTCDay() + 6) % 7));
}

/** "2FS+1d, 3SS" → specs (ids are 1-based row numbers in the full outline). */
export function parsePredecessors(text: string, idsByRow: string[]): { specs: PredecessorSpec[]; errors: string[] } {
  const specs: PredecessorSpec[] = [];
  const errors: string[] = [];
  for (const part of text.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*d?)?$/i);
    if (!m) { errors.push(`Cannot read "${part}"`); continue; }
    const row = Number(m[1]);
    const id = idsByRow[row - 1];
    if (!id) { errors.push(`No task with ID ${row}`); continue; }
    const lag = m[4] ? Number(m[4]) * (m[3] === "-" ? -1 : 1) : 0;
    specs.push({ predecessorIssueId: id, type: ((m[2] ?? "FS").toUpperCase() as LinkType), lagDays: lag });
  }
  return { specs, errors };
}

export function formatPredecessors(t: PlanTask, rowOf: Map<string, number>): string {
  return t.predecessors
    .map((p) => `${rowOf.get(p.issueId) ?? "?"}${p.type === "FS" ? "" : p.type}${p.lagDays ? (p.lagDays > 0 ? `+${p.lagDays}d` : `${p.lagDays}d`) : ""}`)
    .join(",");
}

function EditableCell({ value, display, editing, onStart, onCommit, onCancel, type = "text", align, className, placeholder }: {
  value: string; display?: React.ReactNode; editing: boolean; onStart(): void; onCommit(v: string): void; onCancel(): void; type?: "text" | "date" | "number"; align?: "right"; className?: string; placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, editing]);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);
  if (editing) {
    return (
      <input
        ref={ref}
        className="pm-cell-input"
        type={type}
        value={draft}
        placeholder={placeholder}
        style={align === "right" ? { textAlign: "right" } : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => (draft !== value ? onCommit(draft) : onCancel())}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); draft !== value ? onCommit(draft) : onCancel(); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          if (e.key === "Tab") { draft !== value ? onCommit(draft) : onCancel(); }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return <div className={`pm-cell ${className ?? ""}`} style={align === "right" ? { textAlign: "right" } : undefined} onClick={onStart} title="Click to edit">{display ?? value}</div>;
}

export function Gantt(props: GanttProps) {
  const { plan, zoom, showCritical, showBaseline, showLinks, selectedId, onSelect } = props;
  const px = PX[zoom];
  const all = plan.tasks;
  const cal = useMemo(() => new WorkCalendar(plan.plan.startDate, plan.calendar), [plan.plan.startDate, plan.calendar]);
  const idsByRow = useMemo(() => all.map((t) => t.issueId), [all]);
  const rowOf = useMemo(() => new Map(all.map((t, i) => [t.issueId, i + 1])), [all]);

  // Hide descendants of collapsed summaries.
  const visible = useMemo(() => {
    const out: PlanTask[] = [];
    const hidden = new Set<string>();
    for (const t of all) {
      if (t.parentIssueId && hidden.has(t.parentIssueId)) { hidden.add(t.issueId); continue; }
      out.push(t);
      if (t.isSummary && t.collapsed) hidden.add(t.issueId);
    }
    return out;
  }, [all]);
  const rowIndex = useMemo(() => new Map(visible.map((t, i) => [t.issueId, i])), [visible]);

  const range = useMemo(() => {
    const dates = [plan.plan.startDate, plan.today];
    for (const t of all) { dates.push(t.start, t.finish); if (t.baselineStart) dates.push(t.baselineStart); if (t.baselineFinish) dates.push(t.baselineFinish); }
    const sorted = [...dates].sort();
    const from = startOfWeek(addCalendarDays(sorted[0]!, -7));
    const to = addCalendarDays(sorted.at(-1)!, zoom === "month" ? 60 : 28);
    return { from, to, days: diffCalendarDays(from, to) + 1 };
  }, [all, plan.plan.startDate, plan.today, zoom]);
  const x = (iso: string) => diffCalendarDays(range.from, iso) * px;
  const width = range.days * px;
  const height = Math.max(visible.length * ROW_H, 60);

  const months = useMemo(() => {
    const out: { label: string; x: number; w: number }[] = [];
    let cur = range.from;
    while (cur <= range.to) {
      const d = parseIsoDate(cur);
      const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const end = monthEnd < range.to ? monthEnd : range.to;
      out.push({ label: new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(d), x: x(cur), w: (diffCalendarDays(cur, end) + 1) * px });
      cur = addCalendarDays(end, 1);
    }
    return out;
  }, [range, px]);
  const minor = useMemo(() => {
    const out: { label: string; x: number; w: number; weekend: boolean }[] = [];
    if (zoom === "day") {
      let cur = range.from;
      for (let i = 0; i < range.days; i++) { out.push({ label: DAY_LETTERS[parseIsoDate(cur).getUTCDay()]!, x: i * px, w: px, weekend: !cal.isWorkingDay(cur) }); cur = addCalendarDays(cur, 1); }
    } else {
      let cur = startOfWeek(range.from);
      while (cur <= range.to) { out.push({ label: zoom === "week" ? fmtDate(cur) : "", x: x(cur), w: 7 * px, weekend: false }); cur = addCalendarDays(cur, 7); }
    }
    return out;
  }, [range, px, zoom, cal]);
  const weekends = useMemo(() => {
    if (zoom === "month") return [] as { x: number; w: number }[];
    const out: { x: number; w: number }[] = [];
    let cur = range.from;
    for (let i = 0; i < range.days; i++) { if (!cal.isWorkingDay(cur)) out.push({ x: i * px, w: px }); cur = addCalendarDays(cur, 1); }
    return out;
  }, [range, px, zoom, cal]);

  // ---- editing state
  const [editing, setEditing] = useState<{ id: string; col: string } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [linkEdit, setLinkEdit] = useState<{ link: TaskLink; x: number; y: number; type: LinkType; lag: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!menu && !linkEdit) return;
    const close = () => { setMenu(null); setLinkEdit(null); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", (e) => e.key === "Escape" && close());
    return () => window.removeEventListener("click", close);
  }, [menu, linkEdit]);
  useEffect(() => { if (error) { const t = setTimeout(() => setError(null), 4000); return () => clearTimeout(t); } }, [error]);

  // ---- drag state (bars)
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize" | "link"; startX: number; dx: number; startY: number; dy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const onPointerDown = (e: ReactPointerEvent, id: string, mode: "move" | "resize" | "link") => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id, mode, startX: e.clientX, dx: 0, startY: e.clientY, dy: 0 });
  };
  const onPointerMove = (e: ReactPointerEvent) => { if (drag) setDrag({ ...drag, dx: e.clientX - drag.startX, dy: e.clientY - drag.startY }); };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (!drag) return;
    const t = all.find((k) => k.issueId === drag.id);
    const days = Math.round(drag.dx / px);
    if (t) {
      if (drag.mode === "move") { if (days !== 0 && !t.isSummary) props.onMove(t.issueId, cal.nextWorkingDay(addCalendarDays(t.start, days))); else onSelect(t.issueId); }
      else if (drag.mode === "resize") { const newFinish = cal.prevWorkingDay(addCalendarDays(t.finish, days)); const dur = Math.max(1, cal.workingDaysBetween(t.start, newFinish) + 1); if (dur !== t.durationDays) props.onResize(t.issueId, dur); }
      else if (drag.mode === "link") { const rect = svgRef.current?.getBoundingClientRect(); if (rect) { const target = visible[Math.floor((e.clientY - rect.top) / ROW_H)]; if (target && target.issueId !== t.issueId) props.onLink(t.issueId, target.issueId); } }
    }
    setDrag(null);
  };
  const barGeom = (t: PlanTask) => {
    let x1 = x(t.start);
    let x2 = x(t.finish) + px;
    if (drag && drag.id === t.issueId) { if (drag.mode === "move") { x1 += drag.dx; x2 += drag.dx; } if (drag.mode === "resize") x2 = Math.max(x1 + px, x2 + drag.dx); }
    return { x1, x2 };
  };

  const resById = new Map(plan.resources.map((r) => [r.id, r]));
  const agentById = new Map(plan.agents.map((a) => [a.id, a.name]));
  const humanById = new Map(plan.humans.map((h) => [h.id, h.name]));
  const resourceNames = (t: PlanTask) => {
    const names = plan.assignments.filter((a) => a.issueId === t.issueId).map((a) => { const r = resById.get(a.resourceId); return r ? `${r.name}${a.unitsPct !== 100 ? `[${a.unitsPct}%]` : ""}` : null; }).filter(Boolean) as string[];
    if (names.length) return names.join(", ");
    if (t.assigneeAgentId) return agentById.get(t.assigneeAgentId) ?? "";
    if (t.assigneeUserId) return humanById.get(t.assigneeUserId) ?? "";
    return "";
  };
  const labelFor = (t: PlanTask) => resourceNames(t);

  // ---- keyboard on grid
  const onKey = (e: KeyboardEvent) => {
    if (editing) return;
    const i = selectedId ? visible.findIndex((t) => t.issueId === selectedId) : -1;
    if (e.key === "ArrowDown" && i < visible.length - 1) { e.preventDefault(); onSelect(visible[i + 1]!.issueId); }
    else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); onSelect(visible[i - 1]!.issueId); }
    else if (e.key === "Delete" && selectedId) { e.preventDefault(); if (confirm("Delete this task from the plan and cancel the issue?")) props.onDelete(selectedId); }
    else if (e.key === "Insert") { e.preventDefault(); props.onInsert(selectedId, "above", false); }
    else if (e.key === "F2" && selectedId) { e.preventDefault(); setEditing({ id: selectedId, col: "name" }); }
    else if (e.key === "Enter" && selectedId) { e.preventDefault(); props.onOpenInfo(selectedId); }
    else if (e.key === "Tab" && selectedId && e.altKey) { e.preventDefault(); e.shiftKey ? props.onOutdent(selectedId) : props.onIndent(selectedId); }
  };

  const cellClick = (t: PlanTask, col: string) => {
    if (selectedId === t.issueId) setEditing({ id: t.issueId, col });
    else onSelect(t.issueId);
  };
  const isEd = (t: PlanTask, col: string) => editing?.id === t.issueId && editing.col === col;
  const stop = () => setEditing(null);

  const indicator = (t: PlanTask) => {
    const icons: string[] = [];
    if (t.percentComplete >= 100) icons.push("✓");
    else if (t.finish < plan.today) icons.push("⚠");
    if (t.constraintType !== "asap" && !t.isSummary) icons.push("📌");
    if (t.notes) icons.push("🗒");
    return icons.join("");
  };

  const links = showLinks ? plan.links.map((l) => {
    const a = all.find((t) => t.issueId === l.predecessorIssueId);
    const b = all.find((t) => t.issueId === l.successorIssueId);
    if (!a || !b || !rowIndex.has(a.issueId) || !rowIndex.has(b.issueId)) return null;
    const ga = barGeom(a); const gb = barGeom(b);
    const ya = rowIndex.get(a.issueId)! * ROW_H + ROW_H / 2;
    const yb = rowIndex.get(b.issueId)! * ROW_H + ROW_H / 2;
    const critical = showCritical && a.critical && b.critical;
    const fromX = l.type === "SS" || l.type === "SF" ? ga.x1 : ga.x2;
    const toX = l.type === "FF" || l.type === "SF" ? gb.x2 : gb.x1;
    const dir = yb > ya ? 1 : -1;
    const d = toX >= fromX + 12
      ? `M${fromX},${ya} H${fromX + 6} V${yb - dir * 2} H${toX - 1}`
      : `M${fromX},${ya} H${fromX + 6} V${ya + dir * (ROW_H / 2 - 3)} H${toX - 8} V${yb} H${toX - 1}`;
    const color = critical ? "var(--pm-critical)" : "var(--pm-link)";
    return (
      <g key={l.id} className="pm-link" onClick={(e) => { e.stopPropagation(); setLinkEdit({ link: l, x: e.clientX, y: e.clientY, type: l.type, lag: String(l.lagDays) }); }}>
        <path d={d} fill="none" stroke="transparent" strokeWidth={10} />
        <path d={d} fill="none" stroke={color} strokeWidth={1.3} markerEnd={critical ? "url(#pm-arrow-crit)" : "url(#pm-arrow)"} />
      </g>
    );
  }) : null;

  const todayX = x(plan.today);

  return (
    <div className="pm-gantt" tabIndex={0} onKeyDown={onKey} onContextMenu={(e) => { const row = (e.target as HTMLElement).closest("[data-issue]")?.getAttribute("data-issue"); if (row) { e.preventDefault(); onSelect(row); setMenu({ id: row, x: e.clientX, y: e.clientY }); } }}>
      {error && <div className="pm-toast pm-toast-err">{error}</div>}
      <div className="pm-gantt-inner" style={{ gridTemplateColumns: `${LEFT_W}px ${width}px`, width: LEFT_W + width }}>
        <div className="pm-gantt-left">
          <div className="pm-gantt-left-head" style={{ gridTemplateColumns: LEFT_COLS, height: HEAD_H }}>
            {COLS.map((c) => <div key={c.key}>{c.label}</div>)}
          </div>
          {visible.map((t) => {
            const sel = selectedId === t.issueId;
            const rowNum = rowOf.get(t.issueId)!;
            return (
              <div key={t.issueId} data-issue={t.issueId} className={`pm-gantt-row ${sel ? "pm-selected" : ""} ${t.isSummary ? "pm-summary-row" : ""} ${t.percentComplete >= 100 && !t.isSummary ? "pm-done-row" : ""}`} style={{ gridTemplateColumns: LEFT_COLS, height: ROW_H }} onClick={() => onSelect(t.issueId)} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest(".pm-cell")) props.onOpenInfo(t.issueId); }}>
                <div className="pm-ind" title={t.constraintType !== "asap" ? `Constraint: ${t.constraintType.toUpperCase()} ${t.startDate ?? ""}` : undefined}>{indicator(t)}</div>
                <div className="pm-muted pm-mono pm-rownum">{rowNum}</div>
                <div className="pm-name-cell" style={{ paddingLeft: 6 + t.outlineLevel * 16 }}>
                  {t.isSummary ? <button className="pm-twisty" onClick={(e) => { e.stopPropagation(); props.onToggleCollapse(t.issueId, !t.collapsed); }}>{t.collapsed ? "▸" : "▾"}</button> : <span className="pm-twisty-space" />}
                  <EditableCell value={t.title} editing={isEd(t, "name")} onStart={() => cellClick(t, "name")} onCommit={(v) => { stop(); if (v.trim()) props.onRename(t.issueId, v.trim()); }} onCancel={stop} className={t.isSummary ? "pm-bold" : ""} display={<><span className="pm-task-id">{t.identifier}</span>{t.title}</>} />
                </div>
                <EditableCell value={t.isMilestone ? "0 days" : `${t.durationDays} day${t.durationDays === 1 ? "" : "s"}`} editing={isEd(t, "dur") && !t.isSummary} onStart={() => !t.isSummary && cellClick(t, "dur")} onCommit={(v) => { stop(); const n = Number(String(v).replace(/[^0-9.]/g, "")); if (!Number.isNaN(n)) { if (n === 0) props.onSetMilestone(t.issueId, true); else { if (t.isMilestone) props.onSetMilestone(t.issueId, false); props.onSetDuration(t.issueId, Math.round(n)); } } }} onCancel={stop} align="right" className={t.isSummary ? "pm-bold" : ""} />
                <EditableCell type="date" value={t.start} display={fmtDate(t.start, { day: "2-digit", month: "short", year: "2-digit" })} editing={isEd(t, "start") && !t.isSummary} onStart={() => !t.isSummary && cellClick(t, "start")} onCommit={(v) => { stop(); if (v) props.onMove(t.issueId, cal.nextWorkingDay(v)); }} onCancel={stop} className={t.isSummary ? "pm-bold" : ""} />
                <EditableCell type="date" value={t.finish} display={fmtDate(t.finish, { day: "2-digit", month: "short", year: "2-digit" })} editing={isEd(t, "finish") && !t.isSummary && !t.isMilestone} onStart={() => !t.isSummary && !t.isMilestone && cellClick(t, "finish")} onCommit={(v) => { stop(); if (v) { const fin = cal.prevWorkingDay(v); const dur = Math.max(1, cal.workingDaysBetween(t.start, fin) + 1); props.onSetDuration(t.issueId, dur); } }} onCancel={stop} className={t.isSummary ? "pm-bold" : ""} />
                <EditableCell value={formatPredecessors(t, rowOf)} editing={isEd(t, "pred")} onStart={() => cellClick(t, "pred")} placeholder="e.g. 2FS+1d,3SS" onCommit={(v) => { stop(); const { specs, errors } = parsePredecessors(v, idsByRow); if (errors.length) setError(errors.join("; ")); else props.onSetPredecessors(t.issueId, specs); }} onCancel={stop} />
                <EditableCell value={resourceNames(t)} editing={isEd(t, "res") && !t.isSummary} onStart={() => !t.isSummary && cellClick(t, "res")} placeholder="Name, Name[50%]" onCommit={(v) => { stop(); props.onAssignNames(t.issueId, v.split(/[,;]/).map((s) => s.trim()).filter(Boolean)); }} onCancel={stop} />
                <EditableCell type="number" value={String(t.percentComplete)} display={`${t.percentComplete}%`} editing={isEd(t, "pct") && !t.isSummary} onStart={() => !t.isSummary && cellClick(t, "pct")} onCommit={(v) => { stop(); const n = Math.min(100, Math.max(0, Math.round(Number(v)))); if (!Number.isNaN(n)) props.onSetPercent(t.issueId, n); }} onCancel={stop} align="right" />
              </div>
            );
          })}
          <div className="pm-gantt-row pm-new-row" style={{ gridTemplateColumns: LEFT_COLS, height: ROW_H }} onClick={() => props.onInsert(visible.at(-1)?.issueId ?? null, "below", false)}>
            <div /><div className="pm-muted pm-mono pm-rownum">{all.length + 1}</div><div className="pm-muted" style={{ paddingLeft: 24 }}>Click to add a new task…</div>
          </div>
        </div>

        <div className="pm-gantt-right">
          <svg className="pm-gantt-head-svg" width={width} height={HEAD_H}>
            <rect x={0} y={0} width={width} height={HEAD_H} fill="var(--pm-head-bg)" />
            {months.map((m, i) => (<g key={i}><line x1={m.x} y1={0} x2={m.x} y2={HEAD_H} stroke="var(--border)" /><text x={m.x + 5} y={15} fontSize={11} fill="var(--foreground)" fontWeight={600}>{m.label}</text></g>))}
            <line x1={0} y1={22} x2={width} y2={22} stroke="var(--border)" />
            {minor.map((m, i) => (<g key={i}><line x1={m.x} y1={22} x2={m.x} y2={HEAD_H} stroke="var(--border)" />{m.weekend && <rect x={m.x} y={22} width={m.w} height={HEAD_H - 22} fill="var(--pm-weekend)" />}{m.label && <text x={m.x + (zoom === "day" ? m.w / 2 : 4)} y={36} fontSize={10} textAnchor={zoom === "day" ? "middle" : "start"} fill="var(--muted-foreground)">{m.label}</text>}</g>))}
          </svg>
          <svg ref={svgRef} width={width} height={height} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => drag && setDrag(null)} onClick={() => onSelect(null)}>
            <defs>
              <marker id="pm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--pm-link)" /></marker>
              <marker id="pm-arrow-crit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--pm-critical)" /></marker>
            </defs>
            {weekends.map((w, i) => <rect key={i} x={w.x} y={0} width={w.w} height={height} fill="var(--pm-weekend)" />)}
            {visible.map((t, i) => <rect key={t.issueId} x={0} y={i * ROW_H} width={width} height={ROW_H} fill={selectedId === t.issueId ? "var(--pm-row-sel)" : "transparent"} />)}
            {visible.map((_, i) => <line key={i} x1={0} y1={(i + 1) * ROW_H} x2={width} y2={(i + 1) * ROW_H} stroke="var(--pm-grid)" />)}
            {minor.map((m, i) => <line key={`v${i}`} x1={m.x} y1={0} x2={m.x} y2={height} stroke="var(--pm-grid)" />)}
            {todayX >= 0 && todayX <= width && <line x1={todayX + px / 2} y1={0} x2={todayX + px / 2} y2={height} stroke="var(--pm-today)" strokeDasharray="4 3" strokeWidth={1.5} />}
            {links}
            {visible.map((t, i) => {
              const y = i * ROW_H;
              const { x1, x2 } = barGeom(t);
              const crit = showCritical && t.critical && t.percentComplete < 100;
              const done = t.percentComplete >= 100;
              const selected = selectedId === t.issueId;
              const label = labelFor(t);
              return (
                <g key={t.issueId} onClick={(e) => { e.stopPropagation(); onSelect(t.issueId); }}>
                  {showBaseline && t.baselineStart && t.baselineFinish && !t.isSummary && <rect x={x(t.baselineStart)} y={y + ROW_H - 7} width={Math.max(px, x(t.baselineFinish) + px - x(t.baselineStart))} height={4} fill="var(--pm-baseline)" />}
                  {t.isSummary ? (
                    <g>
                      <rect x={x1} y={y + 8} width={Math.max(px, x2 - x1)} height={6} fill="var(--pm-summary)" />
                      <polygon points={`${x1},${y + 8} ${x1 + 6},${y + 8} ${x1},${y + 18}`} fill="var(--pm-summary)" />
                      <polygon points={`${x2},${y + 8} ${x2 - 6},${y + 8} ${x2},${y + 18}`} fill="var(--pm-summary)" />
                      {selected && <rect x={x1 - 2} y={y + 5} width={x2 - x1 + 4} height={14} fill="none" stroke="var(--foreground)" strokeDasharray="2 2" />}
                    </g>
                  ) : t.isMilestone ? (
                    <g className="pm-bar" onPointerDown={(e) => onPointerDown(e, t.issueId, "move")}>
                      <polygon points={`${x1 + px / 2},${y + 7} ${x1 + px / 2 + 8},${y + ROW_H / 2} ${x1 + px / 2},${y + ROW_H - 7} ${x1 + px / 2 - 8},${y + ROW_H / 2}`} fill={crit ? "var(--pm-critical)" : "var(--pm-summary)"} stroke={selected ? "var(--foreground)" : "none"} strokeWidth={1.5} />
                      <text x={x1 + px / 2 + 12} y={y + ROW_H / 2 + 4} fontSize={10.5} fill="var(--foreground)">{fmtDate(t.start)}{label ? ` · ${label}` : ""}</text>
                    </g>
                  ) : (
                    <g>
                      <rect className="pm-bar" x={x1} y={y + 8} width={Math.max(px, x2 - x1)} height={ROW_H - 16} fill={crit ? "var(--pm-critical)" : "var(--pm-bar)"} stroke={selected ? "var(--foreground)" : crit ? "var(--pm-critical-dark)" : "var(--pm-bar-dark)"} strokeWidth={selected ? 1.5 : 0.8} opacity={done ? 0.7 : 1} onPointerDown={(e) => onPointerDown(e, t.issueId, "move")} />
                      {t.percentComplete > 0 && <rect x={x1 + 1} y={y + ROW_H / 2 - 1.5} width={Math.max(0, (x2 - x1 - 2) * (t.percentComplete / 100))} height={3} fill="var(--pm-progress)" pointerEvents="none" />}
                      {label && <text x={x2 + 6} y={y + ROW_H / 2 + 4} fontSize={10.5} fill="var(--foreground)" pointerEvents="none">{label}</text>}
                      <rect className="pm-bar-handle" x={x2 - 5} y={y + 8} width={5} height={ROW_H - 16} fill="transparent" onPointerDown={(e) => onPointerDown(e, t.issueId, "resize")} />
                      <circle className="pm-bar-handle" cx={x1 + (x2 - x1) / 2} cy={y + ROW_H - 4} r={3.5} fill="var(--card)" stroke="var(--muted-foreground)" style={{ cursor: "crosshair" }} onPointerDown={(e) => onPointerDown(e, t.issueId, "link")}><title>Drag to another task to link (Finish-to-Start)</title></circle>
                    </g>
                  )}
                </g>
              );
            })}
            {drag?.mode === "link" && (() => { const t = all.find((k) => k.issueId === drag.id); if (!t || !rowIndex.has(t.issueId)) return null; const g = barGeom(t); const y = rowIndex.get(t.issueId)! * ROW_H + ROW_H - 4; return <line x1={g.x1 + (g.x2 - g.x1) / 2} y1={y} x2={g.x1 + (g.x2 - g.x1) / 2 + drag.dx} y2={y + drag.dy} stroke="var(--pm-today)" strokeWidth={1.5} strokeDasharray="4 3" />; })()}
          </svg>
        </div>
      </div>

      {menu && (() => {
        const t = all.find((k) => k.issueId === menu.id);
        if (!t) return null;
        const item = (label: string, fn: () => void, disabled = false) => <button className="pm-menu-item" disabled={disabled} onClick={() => { setMenu(null); fn(); }}>{label}</button>;
        return (
          <div className="pm-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            {item("Insert task above", () => props.onInsert(t.issueId, "above", false))}
            {item("Insert task below", () => props.onInsert(t.issueId, "below", false))}
            {item("Insert milestone below", () => props.onInsert(t.issueId, "below", true))}
            <div className="pm-menu-sep" />
            {item("Indent task  (Alt+Tab)", () => props.onIndent(t.issueId), rowIndex.get(t.issueId) === 0)}
            {item("Outdent task  (Alt+Shift+Tab)", () => props.onOutdent(t.issueId), t.outlineLevel === 0)}
            {item(t.isMilestone ? "Unmark milestone" : "Mark as milestone", () => props.onSetMilestone(t.issueId, !t.isMilestone), t.isSummary)}
            <div className="pm-menu-sep" />
            {item("Task information…  (Enter)", () => props.onOpenInfo(t.issueId))}
            {item("Delete task  (Del)", () => { if (confirm(`Delete "${t.title}" from the plan and cancel the issue?`)) props.onDelete(t.issueId); })}
          </div>
        );
      })()}

      {linkEdit && (() => {
        const a = all.find((k) => k.issueId === linkEdit.link.predecessorIssueId);
        const b = all.find((k) => k.issueId === linkEdit.link.successorIssueId);
        return (
          <div className="pm-menu pm-linkedit" style={{ left: linkEdit.x, top: linkEdit.y }} onClick={(e) => e.stopPropagation()}>
            <div className="pm-section-title" style={{ margin: 0 }}>Task dependency</div>
            <div className="pm-sub">From: <b>{rowOf.get(a?.issueId ?? "")} {a?.title}</b></div>
            <div className="pm-sub">To: <b>{rowOf.get(b?.issueId ?? "")} {b?.title}</b></div>
            <div className="pm-row">
              <select className="pm-select" value={linkEdit.type} onChange={(e) => setLinkEdit({ ...linkEdit, type: e.target.value as LinkType })}>
                <option value="FS">Finish-to-Start (FS)</option><option value="SS">Start-to-Start (SS)</option><option value="FF">Finish-to-Finish (FF)</option><option value="SF">Start-to-Finish (SF)</option>
              </select>
              <label className="pm-sub">Lag <input className="pm-input" type="number" style={{ width: 64 }} value={linkEdit.lag} onChange={(e) => setLinkEdit({ ...linkEdit, lag: e.target.value })} />d</label>
            </div>
            <div className="pm-row" style={{ justifyContent: "flex-end" }}>
              <button className="pm-btn pm-danger" onClick={() => { props.onEditLink(linkEdit.link, null); setLinkEdit(null); }}>Delete</button>
              <button className="pm-btn" onClick={() => setLinkEdit(null)}>Cancel</button>
              <button className="pm-btn pm-primary" onClick={() => { props.onEditLink(linkEdit.link, { type: linkEdit.type, lagDays: Number(linkEdit.lag) || 0 }); setLinkEdit(null); }}>OK</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
