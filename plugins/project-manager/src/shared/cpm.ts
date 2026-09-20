// Critical Path Method scheduling engine with working-day calendar support.
// Pure functions: shared by the worker (server) and the UI bundle (browser).
import type { CalendarDef, ConstraintType, LinkType } from "./types.js";

export interface CpmTaskInput {
  id: string;
  /** Duration in working days. 0 = milestone. */
  duration: number;
  predecessors: { id: string; type: LinkType; lag: number }[];
  constraintType?: ConstraintType;
  /** ISO date used by `snet` (start no earlier than) and `mso` (must start on). */
  constraintDate?: string | null;
  /** Extra delay added by resource leveling (working days). */
  levelingDelay?: number;
}

export interface CpmTaskResult {
  id: string;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
  start: string;
  finish: string;
  lateStart: string;
  lateFinish: string;
  constraintConflict: boolean;
}

export interface CpmResult {
  tasks: Map<string, CpmTaskResult>;
  order: string[];
  projectFinishIndex: number;
  projectFinish: string;
  durationDays: number;
  criticalPath: string[];
  cycles: string[][];
  droppedLinks: { from: string; to: string }[];
}

const DAY_MS = 86_400_000;

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(iso: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(iso).getTime() + days * DAY_MS));
}

export function diffCalendarDays(a: string, b: string): number {
  return Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / DAY_MS);
}

export const DEFAULT_CALENDAR: CalendarDef = { workingDays: [1, 2, 3, 4, 5], holidays: [], hoursPerDay: 8 };

/**
 * Maps between ISO dates and working-day indices relative to an origin date.
 * Index 0 is the first working day on or after the origin.
 */
export class WorkCalendar {
  private readonly working: Set<number>;
  private readonly holidays: Set<string>;
  readonly hoursPerDay: number;
  private readonly cacheIdxToDate = new Map<number, string>();
  private readonly cacheDateToIdx = new Map<string, number>();
  readonly origin: string;

  constructor(origin: string, def: CalendarDef = DEFAULT_CALENDAR) {
    const days = def.workingDays.length > 0 ? def.workingDays : DEFAULT_CALENDAR.workingDays;
    this.working = new Set(days);
    this.holidays = new Set(def.holidays ?? []);
    this.hoursPerDay = def.hoursPerDay > 0 ? def.hoursPerDay : 8;
    this.origin = this.nextWorkingDay(origin);
  }

  isWorkingDay(iso: string): boolean {
    const d = parseIsoDate(iso);
    return this.working.has(d.getUTCDay()) && !this.holidays.has(iso);
  }

  nextWorkingDay(iso: string): string {
    let cur = iso.slice(0, 10);
    let guard = 0;
    while (!this.isWorkingDay(cur) && guard++ < 400) cur = addCalendarDays(cur, 1);
    return cur;
  }

  prevWorkingDay(iso: string): string {
    let cur = iso.slice(0, 10);
    let guard = 0;
    while (!this.isWorkingDay(cur) && guard++ < 400) cur = addCalendarDays(cur, -1);
    return cur;
  }

  /** ISO date for working-day index (may be negative). */
  toDate(index: number): string {
    const cached = this.cacheIdxToDate.get(index);
    if (cached) return cached;
    let cur = this.origin;
    let remaining = Math.trunc(index);
    const step = remaining >= 0 ? 1 : -1;
    while (remaining !== 0) {
      cur = addCalendarDays(cur, step);
      if (this.isWorkingDay(cur)) remaining -= step;
    }
    this.cacheIdxToDate.set(index, cur);
    return cur;
  }

  /** Working-day index of an ISO date (rounded forward to the next working day). */
  toIndex(iso: string): number {
    const day = this.nextWorkingDay(iso.slice(0, 10));
    const cached = this.cacheDateToIdx.get(day);
    if (cached !== undefined) return cached;
    const delta = diffCalendarDays(this.origin, day);
    let idx = 0;
    if (delta > 0) {
      let cur = this.origin;
      for (let i = 0; i < delta; i++) {
        cur = addCalendarDays(cur, 1);
        if (this.isWorkingDay(cur)) idx++;
      }
    } else if (delta < 0) {
      let cur = this.origin;
      for (let i = 0; i < -delta; i++) {
        cur = addCalendarDays(cur, -1);
        if (this.isWorkingDay(cur)) idx--;
      }
    }
    this.cacheDateToIdx.set(day, idx);
    return idx;
  }

  /** Number of working days between two ISO dates (start inclusive, end exclusive). */
  workingDaysBetween(fromIso: string, toIso: string): number {
    return this.toIndex(toIso) - this.toIndex(fromIso);
  }

  /** Inclusive finish date for a task starting at index `es` with `duration` working days. */
  finishDate(es: number, duration: number): string {
    return duration <= 0 ? this.toDate(es) : this.toDate(es + duration - 1);
  }
}

interface Node {
  id: string;
  dur: number;
  preds: { id: string; type: LinkType; lag: number }[];
  succs: { id: string; type: LinkType; lag: number }[];
  constraintType: ConstraintType;
  constraintIdx: number | null;
  levelingDelay: number;
}

function topoSort(nodes: Map<string, Node>): { order: string[]; cycles: string[][]; dropped: { from: string; to: string }[] } {
  const indeg = new Map<string, number>();
  for (const n of nodes.values()) indeg.set(n.id, 0);
  for (const n of nodes.values()) for (const p of n.preds) if (nodes.has(p.id)) indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
  const queue = [...nodes.values()].filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id).sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of nodes.get(id)!.succs) {
      if (!nodes.has(s.id)) continue;
      const v = (indeg.get(s.id) ?? 0) - 1;
      indeg.set(s.id, v);
      if (v === 0) queue.push(s.id);
    }
  }
  const cycles: string[][] = [];
  const dropped: { from: string; to: string }[] = [];
  if (order.length < nodes.size) {
    // Break cycles: drop predecessor links of remaining nodes that point to other remaining nodes.
    const remaining = new Set([...nodes.keys()].filter((id) => !order.includes(id)));
    cycles.push([...remaining]);
    for (const id of remaining) {
      const n = nodes.get(id)!;
      const keep: typeof n.preds = [];
      for (const p of n.preds) {
        if (remaining.has(p.id)) {
          dropped.push({ from: p.id, to: id });
          const pn = nodes.get(p.id)!;
          pn.succs = pn.succs.filter((s) => s.id !== id);
        } else keep.push(p);
      }
      n.preds = keep;
    }
    // Re-run with cycles broken (guaranteed acyclic now).
    const again = topoSort(nodes);
    return { order: again.order, cycles, dropped: [...dropped, ...again.dropped] };
  }
  return { order, cycles, dropped };
}

/**
 * Compute early/late dates, float and the critical path for a set of tasks.
 * @param projectStart ISO date; index 0 of the working calendar.
 */
export function computeSchedule(tasks: CpmTaskInput[], projectStart: string, calendarDef: CalendarDef = DEFAULT_CALENDAR): CpmResult {
  const cal = new WorkCalendar(projectStart, calendarDef);
  const nodes = new Map<string, Node>();
  for (const t of tasks) {
    nodes.set(t.id, {
      id: t.id,
      dur: Math.max(0, Math.round(t.duration)),
      preds: t.predecessors.filter((p) => p.id !== t.id).map((p) => ({ ...p, lag: Math.round(p.lag || 0) })),
      succs: [],
      constraintType: t.constraintType ?? "asap",
      constraintIdx: t.constraintDate ? cal.toIndex(t.constraintDate) : null,
      levelingDelay: Math.max(0, Math.round(t.levelingDelay ?? 0)),
    });
  }
  for (const n of nodes.values()) for (const p of n.preds) nodes.get(p.id)?.succs.push({ id: n.id, type: p.type, lag: p.lag });

  const { order, cycles, dropped } = topoSort(nodes);
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const conflict = new Map<string, boolean>();

  // Forward pass
  for (const id of order) {
    const n = nodes.get(id)!;
    let start = 0;
    for (const p of n.preds) {
      const pes = es.get(p.id);
      const pef = ef.get(p.id);
      if (pes === undefined || pef === undefined) continue;
      switch (p.type) {
        case "FS": start = Math.max(start, pef + p.lag); break;
        case "SS": start = Math.max(start, pes + p.lag); break;
        case "FF": start = Math.max(start, pef + p.lag - n.dur); break;
        case "SF": start = Math.max(start, pes + p.lag - n.dur); break;
      }
    }
    let hadConflict = false;
    if (n.constraintIdx !== null) {
      if (n.constraintType === "snet") start = Math.max(start, n.constraintIdx);
      else if (n.constraintType === "mso") {
        hadConflict = start > n.constraintIdx;
        start = n.constraintIdx;
      } else if (n.preds.length === 0) {
        // ASAP with no predecessors honours an explicitly stored start.
        start = Math.max(start, n.constraintIdx);
      }
    }
    start += n.levelingDelay;
    es.set(id, start);
    ef.set(id, start + n.dur);
    conflict.set(id, hadConflict);
  }

  const projectFinishIndex = Math.max(0, ...order.map((id) => ef.get(id) ?? 0));

  // Backward pass
  const ls = new Map<string, number>();
  const lf = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const n = nodes.get(id)!;
    let finish = projectFinishIndex;
    for (const s of n.succs) {
      const sls = ls.get(s.id);
      const slf = lf.get(s.id);
      if (sls === undefined || slf === undefined) continue;
      switch (s.type) {
        case "FS": finish = Math.min(finish, sls - s.lag); break;
        case "SS": finish = Math.min(finish, sls - s.lag + n.dur); break;
        case "FF": finish = Math.min(finish, slf - s.lag); break;
        case "SF": finish = Math.min(finish, slf - s.lag + n.dur); break;
      }
    }
    // A "must start on" task pins its own late start.
    if (n.constraintType === "mso" && n.constraintIdx !== null) finish = Math.min(finish, n.constraintIdx + n.dur);
    lf.set(id, finish);
    ls.set(id, finish - n.dur);
  }

  const results = new Map<string, CpmTaskResult>();
  for (const id of order) {
    const n = nodes.get(id)!;
    const _es = es.get(id)!;
    const _ef = ef.get(id)!;
    const _ls = ls.get(id)!;
    const _lf = lf.get(id)!;
    const totalFloat = _ls - _es;
    // Free float: how much this task can slip without delaying any successor's early start.
    let freeFloat = projectFinishIndex - _ef;
    for (const s of n.succs) {
      const ses = es.get(s.id);
      const sef = ef.get(s.id);
      if (ses === undefined || sef === undefined) continue;
      switch (s.type) {
        case "FS": freeFloat = Math.min(freeFloat, ses - s.lag - _ef); break;
        case "SS": freeFloat = Math.min(freeFloat, ses - s.lag - _es); break;
        case "FF": freeFloat = Math.min(freeFloat, sef - s.lag - _ef); break;
        case "SF": freeFloat = Math.min(freeFloat, sef - s.lag - _es); break;
      }
    }
    results.set(id, {
      id,
      es: _es,
      ef: _ef,
      ls: _ls,
      lf: _lf,
      totalFloat,
      freeFloat: Math.max(0, freeFloat),
      critical: totalFloat <= 0,
      start: cal.toDate(_es),
      finish: cal.finishDate(_es, n.dur),
      lateStart: cal.toDate(_ls),
      lateFinish: cal.finishDate(_ls, n.dur),
      constraintConflict: conflict.get(id) ?? false,
    });
  }

  const criticalPath = order.filter((id) => results.get(id)!.critical).sort((a, b) => results.get(a)!.es - results.get(b)!.es || results.get(a)!.ef - results.get(b)!.ef);
  const finishDate = projectFinishIndex > 0 ? cal.toDate(projectFinishIndex - 1) : cal.toDate(0);
  return {
    tasks: results,
    order,
    projectFinishIndex,
    projectFinish: finishDate,
    durationDays: projectFinishIndex,
    criticalPath,
    cycles,
    droppedLinks: dropped,
  };
}

// ---------------------------------------------------------------------------
// Resource allocation & leveling
// ---------------------------------------------------------------------------

export interface AllocationInput {
  taskId: string;
  resourceId: string;
  unitsPct: number;
  effortHours: number | null;
}

export interface ResourceCapacity {
  id: string;
  capacityHoursPerDay: number;
}

/** Hours per working-day index per resource. */
export type AllocationMap = Map<string, Map<number, number>>;

export function computeAllocation(
  schedule: CpmResult,
  durations: Map<string, number>,
  assignments: AllocationInput[],
  resources: ResourceCapacity[],
  hoursPerDay: number,
): AllocationMap {
  const alloc: AllocationMap = new Map();
  const capById = new Map(resources.map((r) => [r.id, r.capacityHoursPerDay]));
  for (const a of assignments) {
    const t = schedule.tasks.get(a.taskId);
    if (!t) continue;
    const dur = Math.max(1, durations.get(a.taskId) ?? 1);
    const cap = capById.get(a.resourceId) ?? hoursPerDay;
    const perDay = a.effortHours != null && a.effortHours > 0 ? a.effortHours / dur : cap * (a.unitsPct / 100);
    let byDay = alloc.get(a.resourceId);
    if (!byDay) alloc.set(a.resourceId, (byDay = new Map()));
    const days = (durations.get(a.taskId) ?? 0) <= 0 ? 0 : dur;
    for (let d = t.es; d < t.es + days; d++) byDay.set(d, (byDay.get(d) ?? 0) + perDay);
  }
  return alloc;
}

/**
 * Serial resource leveling: walk tasks in early-start order (critical first), and delay any
 * task whose assigned resources would exceed capacity. Returns leveling delays (working days) per task.
 */
export function levelResources(
  tasks: CpmTaskInput[],
  projectStart: string,
  calendarDef: CalendarDef,
  assignments: AllocationInput[],
  resources: ResourceCapacity[],
  options: { maxDelay?: number } = {},
): Map<string, number> {
  const maxDelay = options.maxDelay ?? 120;
  const delays = new Map<string, number>(tasks.map((t) => [t.id, 0]));
  const byTask = new Map<string, AllocationInput[]>();
  for (const a of assignments) {
    if (!byTask.has(a.taskId)) byTask.set(a.taskId, []);
    byTask.get(a.taskId)!.push(a);
  }
  const capById = new Map(resources.map((r) => [r.id, r.capacityHoursPerDay]));
  const used: AllocationMap = new Map();
  const hoursPerDay = calendarDef.hoursPerDay || 8;

  let schedule = computeSchedule(tasks.map((t) => ({ ...t, levelingDelay: 0 })), projectStart, calendarDef);
  const priority = [...schedule.order].sort((a, b) => {
    const ta = schedule.tasks.get(a)!;
    const tb = schedule.tasks.get(b)!;
    return ta.es - tb.es || ta.totalFloat - tb.totalFloat;
  });

  for (const id of priority) {
    const input = tasks.find((t) => t.id === id)!;
    const asg = byTask.get(id) ?? [];
    if (asg.length === 0 || input.duration <= 0) continue;
    // Recompute with current delays so predecessors' shifts are reflected.
    schedule = computeSchedule(tasks.map((t) => ({ ...t, levelingDelay: delays.get(t.id) ?? 0 })), projectStart, calendarDef);
    const t = schedule.tasks.get(id)!;
    const dur = Math.max(1, Math.round(input.duration));
    let delay = 0;
    const fits = (startIdx: number) => {
      for (const a of asg) {
        const cap = capById.get(a.resourceId) ?? hoursPerDay;
        const perDay = a.effortHours != null && a.effortHours > 0 ? a.effortHours / dur : cap * (a.unitsPct / 100);
        const byDay = used.get(a.resourceId);
        for (let d = startIdx; d < startIdx + dur; d++) {
          if ((byDay?.get(d) ?? 0) + perDay > cap + 1e-9) return false;
        }
      }
      return true;
    };
    while (!fits(t.es + delay) && delay < maxDelay) delay++;
    delays.set(id, delay);
    for (const a of asg) {
      const cap = capById.get(a.resourceId) ?? hoursPerDay;
      const perDay = a.effortHours != null && a.effortHours > 0 ? a.effortHours / dur : cap * (a.unitsPct / 100);
      let byDay = used.get(a.resourceId);
      if (!byDay) used.set(a.resourceId, (byDay = new Map()));
      for (let d = t.es + delay; d < t.es + delay + dur; d++) byDay.set(d, (byDay.get(d) ?? 0) + perDay);
    }
  }
  return delays;
}
