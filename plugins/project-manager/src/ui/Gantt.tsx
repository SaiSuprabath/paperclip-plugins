import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PlanPayload, PlanTask } from "../shared/types.js";
import { WorkCalendar, addCalendarDays, diffCalendarDays, parseIsoDate } from "../shared/cpm.js";
import { fmtDate } from "./util.js";

export type Zoom = "day" | "week" | "month";
const PX: Record<Zoom, number> = { day: 34, week: 14, month: 5 };
const ROW_H = 34;
const HEAD_H = 46;
const LEFT_COLS = "36px minmax(220px, 1fr) 56px 82px 82px 140px 52px";
const LEFT_W = 36 + 260 + 56 + 82 + 82 + 140 + 52;

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
}

function startOfWeek(iso: string): string {
  const d = parseIsoDate(iso);
  const dow = d.getUTCDay();
  const diff = (dow + 6) % 7; // Monday start
  return addCalendarDays(iso, -diff);
}

export function Gantt(props: GanttProps) {
  const { plan, zoom, showCritical, showBaseline, showLinks, selectedId, onSelect, onMove, onResize, onLink } = props;
  const px = PX[zoom];
  const tasks = plan.tasks;
  const cal = useMemo(() => new WorkCalendar(plan.plan.startDate, plan.calendar), [plan.plan.startDate, plan.calendar]);

  const range = useMemo(() => {
    const dates = [plan.plan.startDate, plan.today];
    for (const t of tasks) {
      dates.push(t.start, t.finish);
      if (t.baselineStart) dates.push(t.baselineStart);
      if (t.baselineFinish) dates.push(t.baselineFinish);
    }
    const sorted = [...dates].sort();
    const from = startOfWeek(addCalendarDays(sorted[0]!, -7));
    const to = addCalendarDays(sorted.at(-1)!, zoom === "month" ? 45 : 21);
    const days = diffCalendarDays(from, to) + 1;
    return { from, to, days };
  }, [tasks, plan.plan.startDate, plan.today, zoom]);

  const x = (iso: string) => diffCalendarDays(range.from, iso) * px;
  const width = range.days * px;
  const height = tasks.length * ROW_H;

  // Header ticks
  const months = useMemo(() => {
    const out: { label: string; x: number; w: number }[] = [];
    let cur = range.from;
    while (cur <= range.to) {
      const d = parseIsoDate(cur);
      const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const end = monthEnd < range.to ? monthEnd : range.to;
      const w = (diffCalendarDays(cur, end) + 1) * px;
      out.push({ label: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(d), x: x(cur), w });
      cur = addCalendarDays(end, 1);
    }
    return out;
  }, [range, px]);

  const minor = useMemo(() => {
    const out: { label: string; x: number; w: number; weekend: boolean }[] = [];
    if (zoom === "month") {
      let cur = startOfWeek(range.from);
      while (cur <= range.to) {
        out.push({ label: "", x: x(cur), w: 7 * px, weekend: false });
        cur = addCalendarDays(cur, 7);
      }
      return out;
    }
    if (zoom === "week") {
      let cur = startOfWeek(range.from);
      while (cur <= range.to) {
        out.push({ label: fmtDate(cur), x: x(cur), w: 7 * px, weekend: false });
        cur = addCalendarDays(cur, 7);
      }
      return out;
    }
    let cur = range.from;
    for (let i = 0; i < range.days; i++) {
      out.push({ label: String(parseIsoDate(cur).getUTCDate()), x: i * px, w: px, weekend: !cal.isWorkingDay(cur) });
      cur = addCalendarDays(cur, 1);
    }
    return out;
  }, [range, px, zoom, cal]);

  const weekends = useMemo(() => {
    if (zoom === "month") return [] as { x: number; w: number }[];
    const out: { x: number; w: number }[] = [];
    let cur = range.from;
    for (let i = 0; i < range.days; i++) {
      if (!cal.isWorkingDay(cur)) out.push({ x: i * px, w: px });
      cur = addCalendarDays(cur, 1);
    }
    return out;
  }, [range, px, zoom, cal]);

  // Drag state
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize" | "link"; startX: number; dx: number; startY: number; dy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const onPointerDown = (e: ReactPointerEvent, id: string, mode: "move" | "resize" | "link") => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id, mode, startX: e.clientX, dx: 0, startY: e.clientY, dy: 0 });
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, dx: e.clientX - drag.startX, dy: e.clientY - drag.startY });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (!drag) return;
    const t = tasks.find((k) => k.issueId === drag.id);
    const days = Math.round(drag.dx / px);
    if (t) {
      if (drag.mode === "move") {
        if (days !== 0) onMove(t.issueId, cal.nextWorkingDay(addCalendarDays(t.start, days)));
        else onSelect(t.issueId);
      } else if (drag.mode === "resize") {
        const newFinish = cal.prevWorkingDay(addCalendarDays(t.finish, days));
        const dur = Math.max(1, cal.workingDaysBetween(t.start, newFinish) + 1);
        if (dur !== t.durationDays) onResize(t.issueId, dur);
      } else if (drag.mode === "link") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect) {
          const row = Math.floor((e.clientY - rect.top) / ROW_H);
          const target = tasks[row];
          if (target && target.issueId !== t.issueId) onLink(t.issueId, target.issueId);
        }
      }
    }
    setDrag(null);
  };

  const rowIndex = new Map(tasks.map((t, i) => [t.issueId, i]));
  const barGeom = (t: PlanTask) => {
    let x1 = x(t.start);
    let x2 = x(t.finish) + px;
    if (drag && drag.id === t.issueId) {
      if (drag.mode === "move") { x1 += drag.dx; x2 += drag.dx; }
      if (drag.mode === "resize") x2 = Math.max(x1 + px, x2 + drag.dx);
    }
    return { x1, x2 };
  };

  const links = showLinks
    ? plan.links.map((l) => {
        const a = tasks.find((t) => t.issueId === l.predecessorIssueId);
        const b = tasks.find((t) => t.issueId === l.successorIssueId);
        if (!a || !b) return null;
        const ga = barGeom(a);
        const gb = barGeom(b);
        const ya = (rowIndex.get(a.issueId) ?? 0) * ROW_H + ROW_H / 2;
        const yb = (rowIndex.get(b.issueId) ?? 0) * ROW_H + ROW_H / 2;
        const critical = showCritical && a.critical && b.critical;
        const fromX = l.type === "SS" || l.type === "SF" ? ga.x1 : ga.x2;
        const toX = l.type === "FF" || l.type === "SF" ? gb.x2 : gb.x1;
        let d: string;
        if (toX >= fromX + 14) {
          const midX = fromX + 8;
          d = `M${fromX},${ya} H${midX} V${yb} H${toX - 2}`;
        } else {
          const dir = yb > ya ? 1 : -1;
          d = `M${fromX},${ya} H${fromX + 8} V${ya + dir * (ROW_H / 2 - 2)} H${toX - 10} V${yb} H${toX - 2}`;
        }
        return <path key={l.id} d={d} fill="none" stroke={critical ? "var(--pm-critical)" : "var(--muted-foreground)"} strokeWidth={critical ? 1.6 : 1.1} markerEnd={critical ? "url(#pm-arrow-crit)" : "url(#pm-arrow)"} opacity={0.9} />;
      })
    : null;

  const todayX = x(plan.today);
  const resById = new Map(plan.resources.map((r) => [r.id, r]));
  const agentById = new Map(plan.agents.map((a) => [a.id, a.name]));
  const humanById = new Map(plan.humans.map((h) => [h.id, h.name]));
  const whoLabel = (t: PlanTask) => {
    const names = plan.assignments.filter((a) => a.issueId === t.issueId).map((a) => resById.get(a.resourceId)?.name).filter(Boolean) as string[];
    if (names.length) return names.join(", ");
    if (t.assigneeAgentId) return agentById.get(t.assigneeAgentId) ?? "agent";
    if (t.assigneeUserId) return humanById.get(t.assigneeUserId) ?? "user";
    return "";
  };

  return (
    <div className="pm-gantt">
      <div className="pm-gantt-inner" style={{ gridTemplateColumns: `${LEFT_W}px ${width}px`, width: LEFT_W + width }}>
        <div className="pm-gantt-left">
          <div className="pm-gantt-left-head" style={{ gridTemplateColumns: LEFT_COLS, height: HEAD_H }}>
            <div>#</div><div>Task</div><div>Dur</div><div>Start</div><div>Finish</div><div>Resources</div><div>%</div>
          </div>
          {tasks.map((t, i) => (
            <div
              key={t.issueId}
              className={`pm-gantt-row ${selectedId === t.issueId ? "pm-selected" : ""} ${t.percentComplete >= 100 ? "pm-done-row" : ""}`}
              style={{ gridTemplateColumns: LEFT_COLS, height: ROW_H }}
              onClick={() => onSelect(t.issueId)}
              title={t.title}
            >
              <div className="pm-muted pm-mono">{i + 1}</div>
              <div>
                <span className={`pm-dot ${t.isMilestone ? "pm-ms" : showCritical && t.critical ? "pm-crit" : ""}`} />
                <span className="pm-task-id">{t.identifier}</span>
                <span className="pm-task-title">{t.title}</span>
              </div>
              <div className="pm-mono">{t.isMilestone ? "◆" : `${t.durationDays}d`}</div>
              <div className="pm-mono">{fmtDate(t.start)}</div>
              <div className="pm-mono">{fmtDate(t.finish)}</div>
              <div className="pm-muted">{whoLabel(t)}</div>
              <div className="pm-mono">{t.percentComplete}</div>
            </div>
          ))}
        </div>
        <div className="pm-gantt-right">
          <svg className="pm-gantt-head-svg" width={width} height={HEAD_H}>
            {months.map((m, i) => (
              <g key={i}>
                <line x1={m.x} y1={0} x2={m.x} y2={HEAD_H} stroke="var(--border)" />
                <text x={m.x + 6} y={16} fontSize={11.5} fill="var(--foreground)" fontWeight={600}>{m.label}</text>
              </g>
            ))}
            {minor.map((m, i) => (
              <g key={i}>
                <line x1={m.x} y1={24} x2={m.x} y2={HEAD_H} stroke="var(--border)" />
                {zoom === "day" && m.weekend && <rect x={m.x} y={24} width={m.w} height={HEAD_H - 24} fill="var(--pm-weekend)" />}
                {m.label && <text x={m.x + (zoom === "day" ? m.w / 2 : 4)} y={38} fontSize={10.5} textAnchor={zoom === "day" ? "middle" : "start"} fill="var(--muted-foreground)">{m.label}</text>}
              </g>
            ))}
          </svg>
          <svg
            ref={svgRef}
            width={width}
            height={Math.max(height, 40)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => drag && setDrag(null)}
            onClick={() => onSelect(null)}
          >
            <defs>
              <marker id="pm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)" />
              </marker>
              <marker id="pm-arrow-crit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--pm-critical)" />
              </marker>
            </defs>
            {weekends.map((w, i) => <rect key={i} x={w.x} y={0} width={w.w} height={height} fill="var(--pm-weekend)" />)}
            {tasks.map((_, i) => <line key={i} x1={0} y1={(i + 1) * ROW_H} x2={width} y2={(i + 1) * ROW_H} stroke="var(--border)" />)}
            {minor.map((m, i) => <line key={`v${i}`} x1={m.x} y1={0} x2={m.x} y2={height} stroke="var(--border)" opacity={zoom === "day" ? 0.5 : 1} />)}
            {todayX >= 0 && todayX <= width && <line x1={todayX + px / 2} y1={0} x2={todayX + px / 2} y2={height} stroke="var(--pm-today)" strokeDasharray="4 3" strokeWidth={1.5} />}
            {links}
            {tasks.map((t, i) => {
              const y = i * ROW_H;
              const { x1, x2 } = barGeom(t);
              const crit = showCritical && t.critical && t.percentComplete < 100;
              const done = t.percentComplete >= 100;
              const fill = done ? "var(--pm-done)" : crit ? "var(--pm-critical)" : "var(--pm-bar)";
              const fillDark = crit ? "var(--pm-critical-dark)" : "var(--pm-bar-dark)";
              const selected = selectedId === t.issueId;
              return (
                <g key={t.issueId} onClick={(e) => { e.stopPropagation(); onSelect(t.issueId); }}>
                  {showBaseline && t.baselineStart && t.baselineFinish && (
                    <rect x={x(t.baselineStart)} y={y + ROW_H - 8} width={Math.max(px, x(t.baselineFinish) + px - x(t.baselineStart))} height={4} rx={2} fill="var(--pm-baseline)" />
                  )}
                  {t.isMilestone ? (
                    <g className="pm-bar" onPointerDown={(e) => onPointerDown(e, t.issueId, "move")}>
                      <polygon points={`${x1 + px / 2},${y + 7} ${x1 + px / 2 + 9},${y + ROW_H / 2} ${x1 + px / 2},${y + ROW_H - 7} ${x1 + px / 2 - 9},${y + ROW_H / 2}`} fill={crit ? "var(--pm-critical)" : "var(--pm-milestone)"} stroke={selected ? "var(--foreground)" : "none"} strokeWidth={1.5} />
                      <text x={x1 + px / 2 + 14} y={y + ROW_H / 2 + 4} fontSize={11} fill="var(--foreground)">{t.title}</text>
                    </g>
                  ) : (
                    <g>
                      <rect className="pm-bar" x={x1} y={y + 8} width={Math.max(px, x2 - x1)} height={ROW_H - 16} rx={4} fill={fill} opacity={done ? 0.55 : 0.9} stroke={selected ? "var(--foreground)" : "none"} strokeWidth={1.5} onPointerDown={(e) => onPointerDown(e, t.issueId, "move")} />
                      {!done && t.percentComplete > 0 && <rect x={x1} y={y + 8} width={Math.max(0, (x2 - x1) * (t.percentComplete / 100))} height={ROW_H - 16} rx={4} fill={fillDark} pointerEvents="none" />}
                      {x2 - x1 > 40 && <text x={x1 + 6} y={y + ROW_H / 2 + 4} fontSize={11} fill="white" pointerEvents="none" style={{ mixBlendMode: "normal" }}>{t.title.length > (x2 - x1) / 6.5 ? t.title.slice(0, Math.max(3, Math.floor((x2 - x1) / 6.5) - 1)) + "…" : t.title}</text>}
                      <rect className="pm-bar-handle" x={x2 - 6} y={y + 8} width={6} height={ROW_H - 16} fill="transparent" onPointerDown={(e) => onPointerDown(e, t.issueId, "resize")} />
                      <circle className="pm-bar-handle" cx={x2 + 6} cy={y + ROW_H / 2} r={4} fill="var(--card)" stroke="var(--muted-foreground)" style={{ cursor: "crosshair" }} onPointerDown={(e) => onPointerDown(e, t.issueId, "link")}>
                        <title>Drag to a task to add a dependency</title>
                      </circle>
                    </g>
                  )}
                </g>
              );
            })}
            {drag?.mode === "link" && (() => {
              const t = tasks.find((k) => k.issueId === drag.id);
              if (!t) return null;
              const g = barGeom(t);
              const y = (rowIndex.get(t.issueId) ?? 0) * ROW_H + ROW_H / 2;
              return <line x1={g.x2 + 6} y1={y} x2={g.x2 + 6 + drag.dx} y2={y + drag.dy} stroke="var(--pm-today)" strokeWidth={1.5} strokeDasharray="4 3" />;
            })()}
          </svg>
        </div>
      </div>
    </div>
  );
}
