import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, Issue, Agent, ToolResult } from "@paperclipai/plugin-sdk";
import { randomUUID } from "node:crypto";
import { computeSchedule, levelResources, DEFAULT_CALENDAR, WorkCalendar, toIsoDate, type CpmTaskInput } from "./shared/cpm.js";
import { registerPmOffice } from "./pm-office.js";
import type {
  Assignment,
  CalendarDef,
  ConstraintType,
  LinkType,
  PlanPayload,
  PlanSummary,
  PlanTask,
  PortfolioRow,
  Resource,
  TaskLink,
} from "./shared/types.js";

// The schema name is derived by the host from the plugin id; build.mjs injects the expected value
// and we double check against ctx.db.namespace at runtime.
const EXPECTED_NS = process.env.PM_DB_NAMESPACE ?? "";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown, d = 0): number => (v === null || v === undefined || v === "" ? d : Number(v));
const bool = (v: unknown): boolean => v === true || v === "t" || v === "true";
const dateStr = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return toIsoDate(v);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
};
const todayIso = () => new Date().toISOString().slice(0, 10);

function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`Missing required parameter "${key}"`);
  return v;
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const ns = ctx.db.namespace;
    if (EXPECTED_NS && ns !== EXPECTED_NS) {
      ctx.logger.warn("Database namespace differs from build-time expectation", { runtime: ns, expected: EXPECTED_NS });
    }
    const T = {
      calendars: `${ns}.calendars`,
      plans: `${ns}.project_plans`,
      tasks: `${ns}.task_schedule`,
      links: `${ns}.task_links`,
      resources: `${ns}.resources`,
      assignments: `${ns}.assignments`,
    };
    const q = <R = Row>(sql: string, params: unknown[] = []) => ctx.db.query<R>(sql, params);
    const x = (sql: string, params: unknown[] = []) => ctx.db.execute(sql, params);

    // ----------------------------------------------------------------------
    // Loaders
    // ----------------------------------------------------------------------
    async function loadCalendar(companyId: string): Promise<CalendarDef> {
      const rows = await q(`SELECT working_days, holidays, hours_per_day FROM ${T.calendars} WHERE company_id = $1`, [companyId]);
      const r = rows[0];
      if (!r) return DEFAULT_CALENDAR;
      const wd = Array.isArray(r.working_days) ? (r.working_days as number[]) : JSON.parse(String(r.working_days ?? "[1,2,3,4,5]"));
      const hol = Array.isArray(r.holidays) ? (r.holidays as string[]) : JSON.parse(String(r.holidays ?? "[]"));
      return { workingDays: wd, holidays: hol, hoursPerDay: num(r.hours_per_day, 8) };
    }

    async function ensurePlan(companyId: string, projectId: string, issues: Issue[]) {
      const rows = await q(`SELECT * FROM ${T.plans} WHERE project_id = $1`, [projectId]);
      if (rows[0]) return rows[0];
      const earliest = issues
        .map((i) => dateStr(i.createdAt))
        .filter((d): d is string => !!d)
        .sort()[0];
      const start = earliest ?? todayIso();
      await x(`INSERT INTO ${T.plans} (project_id, company_id, start_date) VALUES ($1, $2, $3) ON CONFLICT (project_id) DO NOTHING`, [projectId, companyId, start]);
      return { project_id: projectId, company_id: companyId, start_date: start, status_date: null, baseline_saved_at: null, settings: {} } as Row;
    }

    async function ensureTaskRows(companyId: string, projectId: string, issues: Issue[]) {
      const existing = await q<{ issue_id: string }>(`SELECT issue_id FROM ${T.tasks} WHERE project_id = $1`, [projectId]);
      const have = new Set(existing.map((r) => r.issue_id));
      let order = existing.length;
      for (const issue of issues) {
        if (have.has(issue.id)) continue;
        const done = issue.status === "done";
        const duration = issue.priority === "critical" ? 2 : 3;
        await x(
          `INSERT INTO ${T.tasks} (issue_id, company_id, project_id, duration_days, percent_complete, sort_order, start_date, constraint_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (issue_id) DO NOTHING`,
          [issue.id, companyId, projectId, duration, done ? 100 : issue.status === "in_progress" || issue.status === "in_review" ? 50 : 0, order++, dateStr(issue.createdAt), "asap"],
        );
      }
    }

    async function loadResources(companyId: string): Promise<Resource[]> {
      const rows = await q(`SELECT * FROM ${T.resources} WHERE company_id = $1 ORDER BY kind, name`, [companyId]);
      return rows.map((r) => ({
        id: String(r.id),
        companyId,
        kind: (str(r.kind) as Resource["kind"]) ?? "human",
        name: String(r.name),
        email: str(r.email),
        agentId: str(r.agent_id),
        userId: str(r.user_id),
        role: str(r.role),
        capacityHoursPerDay: num(r.capacity_hours_per_day, 8),
        costPerHour: r.cost_per_hour == null ? null : num(r.cost_per_hour),
        color: str(r.color),
        active: r.active === undefined ? true : bool(r.active),
        initials: str(r.initials),
        groupName: str(r.group_name),
        maxUnitsPct: num(r.max_units_pct, 100),
        overtimeRate: r.overtime_rate == null ? null : num(r.overtime_rate),
      }));
    }

    async function loadAssignments(companyId: string, projectIssueIds?: Set<string>): Promise<Assignment[]> {
      const rows = await q(`SELECT id, issue_id, resource_id, units_pct FROM ${T.assignments} WHERE company_id = $1`, [companyId]);
      return rows
        .map((r) => ({ id: String(r.id), issueId: String(r.issue_id), resourceId: String(r.resource_id), unitsPct: num(r.units_pct, 100) }))
        .filter((a) => !projectIssueIds || projectIssueIds.has(a.issueId));
    }

    async function loadLinks(projectId: string): Promise<TaskLink[]> {
      const rows = await q(`SELECT id, predecessor_issue_id, successor_issue_id, link_type, lag_days FROM ${T.links} WHERE project_id = $1`, [projectId]);
      return rows.map((r) => ({
        id: String(r.id),
        predecessorIssueId: String(r.predecessor_issue_id),
        successorIssueId: String(r.successor_issue_id),
        type: (str(r.link_type) as LinkType) ?? "FS",
        lagDays: num(r.lag_days, 0),
      }));
    }

    async function listHumans(companyId: string) {
      try {
        const members = await ctx.access.members.list({ companyId });
        return members
          .filter((m) => m.principalType === "user" && m.status === "active")
          .map((m) => {
            const user = (m as unknown as { user?: { name?: string | null; email?: string | null } }).user;
            return { id: m.principalId, name: user?.name ?? user?.email ?? m.principalId, email: user?.email ?? null };
          });
      } catch (err) {
        ctx.logger.warn("Could not list company members", { error: String(err) });
        return [];
      }
    }

    async function listAllIssues(companyId: string, projectId: string): Promise<Issue[]> {
      const out: Issue[] = [];
      let offset = 0;
      for (;;) {
        const page = await ctx.issues.list({ companyId, projectId, limit: 200, offset });
        out.push(...page);
        if (page.length < 200) break;
        offset += 200;
      }
      // Cancelled issues are not scheduled (deleting a task from the plan cancels its issue).
      return out.filter((i) => !i.archivedAt && i.status !== "cancelled");
    }

    // ----------------------------------------------------------------------
    // Plan assembly (issues + plugin rows + CPM)
    // ----------------------------------------------------------------------
    async function buildPlan(companyId: string, projectId: string): Promise<PlanPayload> {
      const project = await ctx.projects.get(projectId, companyId);
      if (!project) throw new Error("Project not found");
      const issues = await listAllIssues(companyId, projectId);
      const planRow = await ensurePlan(companyId, projectId, issues);
      await ensureTaskRows(companyId, projectId, issues);
      const calendar = await loadCalendar(companyId);
      const [taskRows, links, resources, agents, humans] = await Promise.all([
        q(`SELECT * FROM ${T.tasks} WHERE project_id = $1 ORDER BY sort_order, created_at`, [projectId]),
        loadLinks(projectId),
        loadResources(companyId),
        ctx.agents.list({ companyId, limit: 200 }),
        listHumans(companyId),
      ]);
      const issueById = new Map(issues.map((i) => [i.id, i]));
      const rows = taskRows.filter((r) => issueById.has(String(r.issue_id)));
      const ids = new Set(rows.map((r) => String(r.issue_id)));
      const assignments = await loadAssignments(companyId, ids);
      const validLinks = links.filter((l) => ids.has(l.predecessorIssueId) && ids.has(l.successorIssueId));
      const planStart = dateStr(planRow.start_date) ?? todayIso();
      const cal = new WorkCalendar(planStart, calendar);

      // ---- Outline (summary tasks). Plugin-side parent wins; falls back to the Paperclip parent issue.
      const rowById = new Map(rows.map((r) => [String(r.issue_id), r]));
      const parentOf = new Map<string, string | null>();
      for (const r of rows) {
        const id = String(r.issue_id);
        const explicit = str(r.parent_issue_id) || null;
        const fallback = issueById.get(id)?.parentId ?? null;
        let parent = explicit && ids.has(explicit) ? explicit : fallback && ids.has(fallback) && !explicit ? fallback : null;
        if (parent === id) parent = null;
        parentOf.set(id, parent);
      }
      // break accidental cycles
      for (const id of ids) {
        const seen = new Set<string>();
        let cur: string | null = id;
        while (cur) {
          if (seen.has(cur)) { parentOf.set(id, null); break; }
          seen.add(cur);
          cur = parentOf.get(cur) ?? null;
        }
      }
      const childrenOf = new Map<string, string[]>();
      for (const [id, p] of parentOf) {
        const key = p ?? "";
        if (!childrenOf.has(key)) childrenOf.set(key, []);
        childrenOf.get(key)!.push(id);
      }
      const bySort = (a: string, b: string) => num(rowById.get(a)!.sort_order) - num(rowById.get(b)!.sort_order);
      const ordered: { id: string; level: number }[] = [];
      const walk = (parent: string, level: number) => {
        for (const id of (childrenOf.get(parent) ?? []).sort(bySort)) {
          ordered.push({ id, level });
          walk(id, level + 1);
        }
      };
      walk("", 0);
      const isSummary = (id: string) => (childrenOf.get(id)?.length ?? 0) > 0;
      const leavesUnder = (id: string): string[] => (isSummary(id) ? (childrenOf.get(id) ?? []).flatMap(leavesUnder) : [id]);

      // ---- Expand links touching summary tasks to their leaf tasks.
      const leafPreds = new Map<string, { id: string; type: LinkType; lag: number }[]>();
      for (const l of validLinks) {
        const preds = leavesUnder(l.predecessorIssueId);
        const succs = leavesUnder(l.successorIssueId);
        for (const sId of succs) {
          if (!leafPreds.has(sId)) leafPreds.set(sId, []);
          for (const pId of preds) if (pId !== sId) leafPreds.get(sId)!.push({ id: pId, type: l.type, lag: l.lagDays });
        }
      }

      const leafIds = ordered.filter((o) => !isSummary(o.id)).map((o) => o.id);
      const inputs: CpmTaskInput[] = leafIds.map((id) => {
        const r = rowById.get(id)!;
        const issue = issueById.get(id)!;
        const cancelled = issue.status === "cancelled";
        return {
          id,
          duration: bool(r.is_milestone) ? 0 : cancelled ? 0 : Math.max(0, num(r.duration_days, 1)),
          predecessors: leafPreds.get(id) ?? [],
          constraintType: (str(r.constraint_type) as ConstraintType) ?? "asap",
          constraintDate: dateStr(r.start_date),
          levelingDelay: num(r.leveling_delay_days, 0),
        };
      });
      const cpm = computeSchedule(inputs, planStart, calendar);
      const today = todayIso();

      const tasks: PlanTask[] = ordered.map(({ id, level }) => {
        const r = rowById.get(id)!;
        const issue = issueById.get(id)!;
        const summary = isSummary(id);
        let start: string, finish: string, lateStart: string, lateFinish: string, totalFloat: number, freeFloat: number, critical: boolean, durationDays: number, pct: number;
        if (summary) {
          const leaves = leavesUnder(id).map((lid) => ({ c: cpm.tasks.get(lid)!, r: rowById.get(lid)!, i: issueById.get(lid)! })).filter((x) => x.c);
          start = leaves.map((x) => x.c.start).sort()[0] ?? planStart;
          finish = leaves.map((x) => x.c.finish).sort().at(-1) ?? start;
          lateStart = leaves.map((x) => x.c.lateStart).sort()[0] ?? start;
          lateFinish = leaves.map((x) => x.c.lateFinish).sort().at(-1) ?? finish;
          totalFloat = Math.min(...leaves.map((x) => x.c.totalFloat), Number.MAX_SAFE_INTEGER);
          if (totalFloat === Number.MAX_SAFE_INTEGER) totalFloat = 0;
          freeFloat = totalFloat;
          critical = leaves.some((x) => x.c.critical && x.i.status !== "cancelled");
          durationDays = Math.max(0, cal.workingDaysBetween(start, finish) + 1);
          const totalDur = leaves.reduce((a, x) => a + Math.max(1, num(x.r.duration_days, 1)), 0);
          pct = totalDur ? Math.round(leaves.reduce((a, x) => a + Math.max(1, num(x.r.duration_days, 1)) * (x.i.status === "done" ? 100 : num(x.r.percent_complete, 0)), 0) / totalDur) : 0;
        } else {
          const c = cpm.tasks.get(id)!;
          start = c.start; finish = c.finish; lateStart = c.lateStart; lateFinish = c.lateFinish;
          totalFloat = c.totalFloat; freeFloat = c.freeFloat; critical = c.critical && issue.status !== "cancelled";
          durationDays = num(r.duration_days, 1);
          pct = issue.status === "done" ? 100 : num(r.percent_complete, 0);
        }
        return {
          issueId: id,
          identifier: issue.identifier ?? null,
          title: issue.title,
          status: issue.status,
          priority: issue.priority,
          assigneeAgentId: issue.assigneeAgentId ?? null,
          assigneeUserId: issue.assigneeUserId ?? null,
          durationDays,
          effortHours: r.effort_hours == null ? null : num(r.effort_hours),
          startDate: dateStr(r.start_date),
          constraintType: (str(r.constraint_type) as ConstraintType) ?? "asap",
          percentComplete: pct,
          isMilestone: bool(r.is_milestone) && !summary,
          sortOrder: num(r.sort_order, 0),
          levelingDelayDays: num(r.leveling_delay_days, 0),
          notes: str(r.notes),
          baselineStart: dateStr(r.baseline_start),
          baselineFinish: dateStr(r.baseline_finish),
          parentIssueId: parentOf.get(id) ?? null,
          outlineLevel: level,
          isSummary: summary,
          collapsed: bool(r.collapsed),
          plannedCostOverride: r.planned_cost == null ? null : num(r.planned_cost),
          actualCostManual: r.actual_cost_manual == null ? null : num(r.actual_cost_manual),
          actualHours: r.actual_hours == null ? null : num(r.actual_hours),
          start, finish, lateStart, lateFinish, totalFloat, freeFloat, critical,
          predecessors: validLinks.filter((l) => l.successorIssueId === id).map((l) => ({ issueId: l.predecessorIssueId, type: l.type, lagDays: l.lagDays })),
          successors: validLinks.filter((l) => l.predecessorIssueId === id).map((l) => l.successorIssueId),
        };
      });

      const live = tasks.filter((t) => t.status !== "cancelled" && !t.isSummary);
      const baselineFinish = live.map((t) => t.baselineFinish).filter((d): d is string => !!d).sort().at(-1) ?? null;
      const summary: PlanSummary = {
        projectStart: planStart,
        projectFinish: cpm.projectFinish,
        durationDays: cpm.durationDays,
        taskCount: live.length,
        criticalCount: live.filter((t) => t.critical).length,
        completedCount: live.filter((t) => t.percentComplete >= 100).length,
        overdueCount: live.filter((t) => t.percentComplete < 100 && t.finish < today).length,
        slippageDays: baselineFinish ? Math.round((Date.parse(cpm.projectFinish) - Date.parse(baselineFinish)) / 86_400_000) : null,
        baselineFinish,
        percentComplete: live.length ? Math.round(live.reduce((s, t) => s + t.percentComplete, 0) / live.length) : 0,
      };

      return {
        project: { id: project.id, name: project.name, status: project.status, targetDate: project.targetDate, color: project.color },
        plan: {
          startDate: planStart,
          statusDate: dateStr(planRow.status_date),
          baselineSavedAt: str(planRow.baseline_saved_at),
          budgetAmount: planRow.budget_amount == null ? null : num(planRow.budget_amount),
          currency: str(planRow.currency) ?? "USD",
          sponsor: str(planRow.sponsor),
          pmName: str(planRow.pm_name),
          pmEmail: str(planRow.pm_email),
          ragOverride: str(planRow.rag_override),
          autoNudge: bool(planRow.auto_nudge),
          reportRecipients: str(planRow.report_recipients),
        },
        calendar,
        tasks,
        links: validLinks,
        resources,
        assignments,
        agents: (agents as Agent[]).filter((a) => a.status !== "terminated").map((a) => ({ id: a.id, name: a.name, role: a.role, status: a.status })),
        humans,
        summary,
        cycles: cpm.cycles,
        today,
      };
    }

    // ----------------------------------------------------------------------
    // Data providers (UI reads)
    // ----------------------------------------------------------------------
    ctx.data.register("projects", async (params) => {
      const companyId = requireString(params, "companyId");
      const projects = await ctx.projects.list({ companyId, limit: 200 });
      return projects
        .filter((p) => !p.archivedAt)
        .map((p) => ({ id: p.id, name: p.name, status: p.status, color: p.color, targetDate: p.targetDate }));
    });

    ctx.data.register("plan", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      if (!projectId) return null;
      return buildPlan(companyId, projectId);
    });

    ctx.data.register("portfolio", async (params) => {
      const companyId = requireString(params, "companyId");
      const projects = (await ctx.projects.list({ companyId, limit: 100 })).filter((p) => !p.archivedAt);
      const rows: PortfolioRow[] = [];
      for (const p of projects) {
        try {
          const plan = await buildPlan(companyId, p.id);
          rows.push({ projectId: p.id, name: p.name, status: p.status, color: p.color, summary: plan.summary });
        } catch (err) {
          ctx.logger.warn("portfolio: failed to build plan", { projectId: p.id, error: String(err) });
          rows.push({ projectId: p.id, name: p.name, status: p.status, color: p.color, summary: null });
        }
      }
      return rows;
    });

    ctx.data.register("resources", async (params) => {
      const companyId = requireString(params, "companyId");
      const [resources, agents, humans, assignments] = await Promise.all([
        loadResources(companyId),
        ctx.agents.list({ companyId, limit: 200 }),
        listHumans(companyId),
        loadAssignments(companyId),
      ]);
      return {
        resources,
        assignments,
        agents: (agents as Agent[]).filter((a) => a.status !== "terminated").map((a) => ({ id: a.id, name: a.name, role: a.role, status: a.status })),
        humans,
        calendar: await loadCalendar(companyId),
      };
    });

    // ----------------------------------------------------------------------
    // Actions (UI writes)
    // ----------------------------------------------------------------------
    ctx.actions.register("update-task", async (params) => {
      const companyId = requireString(params, "companyId");
      const issueId = requireString(params, "issueId");
      const patch = (params.patch ?? {}) as Record<string, unknown>;
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (col: string, v: unknown) => {
        values.push(v);
        fields.push(`${col} = $${values.length}`);
      };
      if ("durationDays" in patch) set("duration_days", Math.max(0, num(patch.durationDays, 1)));
      if ("effortHours" in patch) set("effort_hours", patch.effortHours == null || patch.effortHours === "" ? null : num(patch.effortHours));
      if ("startDate" in patch) set("start_date", patch.startDate ? String(patch.startDate).slice(0, 10) : null);
      if ("constraintType" in patch) set("constraint_type", ["asap", "snet", "mso"].includes(String(patch.constraintType)) ? String(patch.constraintType) : "asap");
      if ("percentComplete" in patch) set("percent_complete", Math.min(100, Math.max(0, Math.round(num(patch.percentComplete, 0)))));
      if ("isMilestone" in patch) set("is_milestone", Boolean(patch.isMilestone));
      if ("sortOrder" in patch) set("sort_order", Math.round(num(patch.sortOrder, 0)));
      if ("notes" in patch) set("notes", patch.notes == null ? null : String(patch.notes));
      if ("levelingDelayDays" in patch) set("leveling_delay_days", Math.max(0, Math.round(num(patch.levelingDelayDays, 0))));
      if ("collapsed" in patch) set("collapsed", Boolean(patch.collapsed));
      if ("parentIssueId" in patch) {
        const parent = patch.parentIssueId ? String(patch.parentIssueId) : null;
        if (parent) {
          if (parent === issueId) throw new Error("A task cannot be its own summary task");
          // reject cycles: walk up from the proposed parent
          let cur: string | null = parent;
          let guard = 0;
          while (cur && guard++ < 100) {
            if (cur === issueId) throw new Error("Cannot indent a task under one of its own subtasks");
            const rows: Row[] = await q(`SELECT parent_issue_id FROM ${T.tasks} WHERE issue_id = $1`, [cur]);
            cur = rows[0] ? str(rows[0].parent_issue_id) || null : null;
          }
        }
        set("parent_issue_id", parent ?? "");
      }
      if (fields.length === 0) return { ok: true, unchanged: true };
      set("updated_at", new Date().toISOString());
      values.push(issueId, companyId);
      await x(`UPDATE ${T.tasks} SET ${fields.join(", ")} WHERE issue_id = $${values.length - 1} AND company_id = $${values.length}`, values);

      // Optional mirror to Paperclip issue fields.
      const issuePatch: Record<string, unknown> = {};
      if (typeof patch.title === "string" && patch.title.trim()) issuePatch.title = patch.title.trim();
      if (typeof patch.priority === "string") issuePatch.priority = patch.priority;
      if (typeof patch.status === "string") issuePatch.status = patch.status;
      if (Object.keys(issuePatch).length > 0) await ctx.issues.update(issueId, issuePatch as never, companyId);
      return { ok: true };
    });

    ctx.actions.register("reorder-tasks", async (params) => {
      const companyId = requireString(params, "companyId");
      const ids = Array.isArray(params.issueIds) ? (params.issueIds as string[]) : [];
      let i = 0;
      for (const id of ids) {
        await x(`UPDATE ${T.tasks} SET sort_order = $1 WHERE issue_id = $2 AND company_id = $3`, [i++, id, companyId]);
      }
      return { ok: true };
    });

    ctx.actions.register("update-plan", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const patch = (params.patch ?? {}) as Record<string, unknown>;
      if (patch.startDate) await x(`UPDATE ${T.plans} SET start_date = $1, updated_at = now() WHERE project_id = $2 AND company_id = $3`, [String(patch.startDate).slice(0, 10), projectId, companyId]);
      if ("statusDate" in patch) await x(`UPDATE ${T.plans} SET status_date = $1, updated_at = now() WHERE project_id = $2 AND company_id = $3`, [patch.statusDate ? String(patch.statusDate).slice(0, 10) : null, projectId, companyId]);
      return { ok: true };
    });

    ctx.actions.register("update-calendar", async (params) => {
      const companyId = requireString(params, "companyId");
      const cal = (params.calendar ?? {}) as Partial<CalendarDef>;
      const wd = Array.isArray(cal.workingDays) && cal.workingDays.length ? cal.workingDays.map(Number) : DEFAULT_CALENDAR.workingDays;
      const hol = Array.isArray(cal.holidays) ? cal.holidays.map(String) : [];
      const hpd = num(cal.hoursPerDay, 8);
      await x(
        `INSERT INTO ${T.calendars} (company_id, working_days, holidays, hours_per_day, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, now()) ON CONFLICT (company_id) DO UPDATE SET working_days = $2::jsonb, holidays = $3::jsonb, hours_per_day = $4, updated_at = now()`,
        [companyId, JSON.stringify(wd), JSON.stringify(hol), hpd],
      );
      return { ok: true };
    });

    ctx.actions.register("set-link", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const predecessorIssueId = requireString(params, "predecessorIssueId");
      const successorIssueId = requireString(params, "successorIssueId");
      if (predecessorIssueId === successorIssueId) throw new Error("A task cannot depend on itself");
      const type = (["FS", "SS", "FF", "SF"].includes(String(params.type)) ? String(params.type) : "FS") as LinkType;
      const lag = Math.round(num(params.lagDays, 0));
      await x(
        `INSERT INTO ${T.links} (id, company_id, project_id, predecessor_issue_id, successor_issue_id, link_type, lag_days) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (predecessor_issue_id, successor_issue_id) DO UPDATE SET link_type = $6, lag_days = $7`,
        [randomUUID(), companyId, projectId, predecessorIssueId, successorIssueId, type, lag],
      );
      if (type === "FS") await mirrorBlockers(companyId, successorIssueId, projectId);
      return { ok: true };
    });

    ctx.actions.register("remove-link", async (params) => {
      const companyId = requireString(params, "companyId");
      const predecessorIssueId = requireString(params, "predecessorIssueId");
      const successorIssueId = requireString(params, "successorIssueId");
      const projectId = typeof params.projectId === "string" ? params.projectId : null;
      await x(`DELETE FROM ${T.links} WHERE company_id = $1 AND predecessor_issue_id = $2 AND successor_issue_id = $3`, [companyId, predecessorIssueId, successorIssueId]);
      if (projectId) await mirrorBlockers(companyId, successorIssueId, projectId);
      return { ok: true };
    });

    /** Keep Paperclip's "blocked by" relations in sync with FS predecessors so agents see blockers natively. */
    async function mirrorBlockers(companyId: string, successorIssueId: string, projectId: string) {
      try {
        const links = await loadLinks(projectId);
        const preds = links.filter((l) => l.successorIssueId === successorIssueId && l.type === "FS").map((l) => l.predecessorIssueId);
        const issue = await ctx.issues.get(successorIssueId, companyId);
        if (!issue) return;
        const existing = (issue.blockedBy ?? []).map((b) => b.id);
        const projectLinkPreds = new Set(links.filter((l) => l.successorIssueId === successorIssueId).map((l) => l.predecessorIssueId));
        // Preserve blockers set outside the plan; replace only the ones this plan manages.
        const keep = existing.filter((id) => !projectLinkPreds.has(id));
        const next = Array.from(new Set([...keep, ...preds]));
        if (next.length !== existing.length || next.some((id) => !existing.includes(id))) {
          await ctx.issues.update(successorIssueId, { blockedByIssueIds: next }, companyId);
        }
      } catch (err) {
        ctx.logger.warn("mirrorBlockers failed", { successorIssueId, error: String(err) });
      }
    }

    ctx.actions.register("upsert-resource", async (params) => {
      const companyId = requireString(params, "companyId");
      const r = (params.resource ?? {}) as Partial<Resource>;
      const id = r.id && String(r.id).length > 0 ? String(r.id) : randomUUID();
      const kind = r.kind === "agent" ? "agent" : "human";
      const name = String(r.name ?? "").trim();
      if (!name) throw new Error("Resource name is required");
      const initials = r.initials ?? name.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 3);
      await x(
        `INSERT INTO ${T.resources} (id, company_id, kind, name, email, agent_id, user_id, role, capacity_hours_per_day, cost_per_hour, color, active, initials, group_name, max_units_pct, overtime_rate, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now()) ON CONFLICT (id) DO UPDATE SET kind = $3, name = $4, email = $5, agent_id = $6, user_id = $7, role = $8, capacity_hours_per_day = $9, cost_per_hour = $10, color = $11, active = $12, initials = $13, group_name = $14, max_units_pct = $15, overtime_rate = $16, updated_at = now()`,
        [id, companyId, kind, name, r.email ?? null, r.agentId ?? null, r.userId ?? null, r.role ?? null, num(r.capacityHoursPerDay, 8), r.costPerHour == null ? null : num(r.costPerHour), r.color ?? null, r.active === undefined ? true : Boolean(r.active), initials, r.groupName ?? null, Math.max(0, Math.round(num(r.maxUnitsPct, 100))), r.overtimeRate == null ? null : num(r.overtimeRate)],
      );
      return { ok: true, id };
    });

    ctx.actions.register("delete-resource", async (params) => {
      const companyId = requireString(params, "companyId");
      const id = requireString(params, "resourceId");
      await x(`DELETE FROM ${T.assignments} WHERE company_id = $1 AND resource_id = $2`, [companyId, id]);
      await x(`DELETE FROM ${T.resources} WHERE company_id = $1 AND id = $2`, [companyId, id]);
      return { ok: true };
    });

    ctx.actions.register("import-agents", async (params) => {
      const companyId = requireString(params, "companyId");
      const [agents, resources] = await Promise.all([ctx.agents.list({ companyId, limit: 200 }), loadResources(companyId)]);
      const known = new Set(resources.map((r) => r.agentId).filter(Boolean));
      let created = 0;
      for (const a of agents as Agent[]) {
        if (a.status === "terminated" || known.has(a.id)) continue;
        await x(
          `INSERT INTO ${T.resources} (id, company_id, kind, name, agent_id, role, capacity_hours_per_day, active, initials, group_name) VALUES ($1, $2, 'agent', $3, $4, $5, $6, true, $7, 'Agents')`,
          [randomUUID(), companyId, a.name, a.id, a.title ?? a.role, 8, a.name.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 3)],
        );
        created++;
      }
      return { ok: true, created };
    });

    ctx.actions.register("assign", async (params) => {
      const companyId = requireString(params, "companyId");
      const issueId = requireString(params, "issueId");
      const resourceIds = Array.isArray(params.resourceIds) ? (params.resourceIds as string[]) : [];
      const unitsPct = Math.min(200, Math.max(1, Math.round(num(params.unitsPct, 100))));
      await x(`DELETE FROM ${T.assignments} WHERE company_id = $1 AND issue_id = $2`, [companyId, issueId]);
      for (const rid of resourceIds) {
        await x(`INSERT INTO ${T.assignments} (id, company_id, issue_id, resource_id, units_pct) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (issue_id, resource_id) DO UPDATE SET units_pct = $5`, [randomUUID(), companyId, issueId, rid, unitsPct]);
      }
      // Mirror the primary resource to the Paperclip assignee so agents actually get woken up for the work.
      if (params.syncAssignee !== false) {
        const resources = await loadResources(companyId);
        const primary = resources.find((r) => r.id === resourceIds[0]);
        if (primary?.kind === "agent" && primary.agentId) {
          await ctx.issues.update(issueId, { assigneeAgentId: primary.agentId, assigneeUserId: null }, companyId);
        } else if (primary?.kind === "human" && primary.userId) {
          await ctx.issues.update(issueId, { assigneeAgentId: null, assigneeUserId: primary.userId }, companyId);
        } else if (!primary && resourceIds.length === 0 && params.clearAssignee === true) {
          await ctx.issues.update(issueId, { assigneeAgentId: null, assigneeUserId: null }, companyId);
        }
      }
      return { ok: true };
    });

    ctx.actions.register("create-task", async (params, actionCtx) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const title = requireString(params, "title").trim();
      const issue = await ctx.issues.create({
        companyId,
        projectId,
        title,
        description: typeof params.description === "string" ? params.description : undefined,
        priority: (["critical", "high", "medium", "low"].includes(String(params.priority)) ? String(params.priority) : "medium") as Issue["priority"],
        status: "todo",
        assigneeAgentId: typeof params.assigneeAgentId === "string" && params.assigneeAgentId ? params.assigneeAgentId : undefined,
        assigneeUserId: typeof params.assigneeUserId === "string" && params.assigneeUserId ? params.assigneeUserId : undefined,
        originKind: "plugin:suprabath.project-manager:task",
        originId: projectId,
        actor: actionCtx.actor.userId || actionCtx.actor.agentId ? { actorUserId: actionCtx.actor.userId, actorAgentId: actionCtx.actor.agentId, actorRunId: actionCtx.actor.runId } : undefined,
      } as never);
      const countRows = await q<{ c: number }>(`SELECT count(*)::int AS c FROM ${T.tasks} WHERE project_id = $1`, [projectId]);
      await x(
        `INSERT INTO ${T.tasks} (issue_id, company_id, project_id, duration_days, start_date, constraint_type, is_milestone, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (issue_id) DO NOTHING`,
        [issue.id, companyId, projectId, Math.max(0, num(params.durationDays, 3)), params.startDate ? String(params.startDate).slice(0, 10) : null, params.startDate ? "snet" : "asap", Boolean(params.isMilestone), num(countRows[0]?.c, 0)],
      );
      if (typeof params.predecessorIssueId === "string" && params.predecessorIssueId) {
        await x(`INSERT INTO ${T.links} (id, company_id, project_id, predecessor_issue_id, successor_issue_id, link_type, lag_days) VALUES ($1, $2, $3, $4, $5, 'FS', 0) ON CONFLICT (predecessor_issue_id, successor_issue_id) DO NOTHING`, [randomUUID(), companyId, projectId, params.predecessorIssueId, issue.id]);
        await mirrorBlockers(companyId, issue.id, projectId);
      }
      return { ok: true, issueId: issue.id, identifier: issue.identifier };
    });

    ctx.actions.register("save-baseline", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const plan = await buildPlan(companyId, projectId);
      for (const t of plan.tasks) {
        await x(`UPDATE ${T.tasks} SET baseline_start = $1, baseline_finish = $2, updated_at = now() WHERE issue_id = $3 AND company_id = $4`, [t.start, t.finish, t.issueId, companyId]);
      }
      await x(`UPDATE ${T.plans} SET baseline_saved_at = now(), updated_at = now() WHERE project_id = $1 AND company_id = $2`, [projectId, companyId]);
      await ctx.activity.log({ companyId, message: `Project Manager: baseline saved for "${plan.project.name}" (${plan.tasks.length} tasks, finish ${plan.summary.projectFinish})` } as never).catch(() => undefined);
      return { ok: true, count: plan.tasks.length };
    });

    ctx.actions.register("clear-baseline", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      await x(`UPDATE ${T.tasks} SET baseline_start = NULL, baseline_finish = NULL, updated_at = now() WHERE project_id = $1 AND company_id = $2`, [projectId, companyId]);
      await x(`UPDATE ${T.plans} SET baseline_saved_at = NULL, updated_at = now() WHERE project_id = $1 AND company_id = $2`, [projectId, companyId]);
      return { ok: true };
    });

    ctx.actions.register("level-resources", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const plan = await buildPlan(companyId, projectId);
      const inputs: CpmTaskInput[] = plan.tasks.map((t) => ({
        id: t.issueId,
        duration: t.isMilestone || t.status === "cancelled" ? 0 : t.durationDays,
        predecessors: t.predecessors.map((p) => ({ id: p.issueId, type: p.type, lag: p.lagDays })),
        constraintType: t.constraintType,
        constraintDate: t.startDate,
        levelingDelay: 0,
      }));
      const effortById = new Map(plan.tasks.map((t) => [t.issueId, t.effortHours]));
      const delays = levelResources(
        inputs,
        plan.plan.startDate,
        plan.calendar,
        plan.assignments.filter((a) => (plan.tasks.find((t) => t.issueId === a.issueId)?.percentComplete ?? 100) < 100).map((a) => ({ taskId: a.issueId, resourceId: a.resourceId, unitsPct: a.unitsPct, effortHours: effortById.get(a.issueId) ?? null })),
        plan.resources.map((r) => ({ id: r.id, capacityHoursPerDay: r.capacityHoursPerDay })),
      );
      let changed = 0;
      for (const [id, delay] of delays) {
        const cur = plan.tasks.find((t) => t.issueId === id)?.levelingDelayDays ?? 0;
        if (cur !== delay) {
          await x(`UPDATE ${T.tasks} SET leveling_delay_days = $1, updated_at = now() WHERE issue_id = $2 AND company_id = $3`, [delay, id, companyId]);
          changed++;
        }
      }
      return { ok: true, changed, delayedTasks: [...delays.entries()].filter(([, d]) => d > 0).length };
    });

    ctx.actions.register("clear-leveling", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      await x(`UPDATE ${T.tasks} SET leveling_delay_days = 0, updated_at = now() WHERE project_id = $1 AND company_id = $2`, [projectId, companyId]);
      return { ok: true };
    });

    ctx.actions.register("remove-task", async (params) => {
      const companyId = requireString(params, "companyId");
      const issueId = requireString(params, "issueId");
      await x(`DELETE FROM ${T.links} WHERE company_id = $1 AND predecessor_issue_id = $2`, [companyId, issueId]);
      await x(`DELETE FROM ${T.links} WHERE company_id = $1 AND successor_issue_id = $2`, [companyId, issueId]);
      await x(`DELETE FROM ${T.assignments} WHERE company_id = $1 AND issue_id = $2`, [companyId, issueId]);
      await x(`DELETE FROM ${T.tasks} WHERE company_id = $1 AND issue_id = $2`, [companyId, issueId]);
      if (params.cancelIssue === true) await ctx.issues.update(issueId, { status: "cancelled" }, companyId);
      return { ok: true };
    });

    /** Replace all predecessors of a task (MS Project "Predecessors" cell semantics). */
    ctx.actions.register("set-predecessors", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const issueId = requireString(params, "issueId");
      const preds = (Array.isArray(params.predecessors) ? params.predecessors : []) as { predecessorIssueId: string; type?: string; lagDays?: number }[];
      await x(`DELETE FROM ${T.links} WHERE company_id = $1 AND successor_issue_id = $2`, [companyId, issueId]);
      for (const p of preds) {
        if (!p.predecessorIssueId || p.predecessorIssueId === issueId) continue;
        const type = ["FS", "SS", "FF", "SF"].includes(String(p.type)) ? String(p.type) : "FS";
        await x(
          `INSERT INTO ${T.links} (id, company_id, project_id, predecessor_issue_id, successor_issue_id, link_type, lag_days) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (predecessor_issue_id, successor_issue_id) DO UPDATE SET link_type = $6, lag_days = $7`,
          [randomUUID(), companyId, projectId, p.predecessorIssueId, issueId, type, Math.round(num(p.lagDays, 0))],
        );
      }
      await mirrorBlockers(companyId, issueId, projectId);
      return { ok: true, count: preds.length };
    });

    /** Assign by typing names (MS Project "Resource Names" cell): unknown names become new human resources. */
    ctx.actions.register("assign-by-names", async (params) => {
      const companyId = requireString(params, "companyId");
      const issueId = requireString(params, "issueId");
      const names = (Array.isArray(params.names) ? params.names : String(params.names ?? "").split(/[,;]/)).map((n) => String(n).trim()).filter(Boolean);
      const [resources, agents] = await Promise.all([loadResources(companyId), ctx.agents.list({ companyId, limit: 200 })]);
      const ids: string[] = [];
      let created = 0;
      for (const raw of names) {
        const m = raw.match(/^(.*?)(?:\s*\[(\d+)%\])?$/);
        const name = (m?.[1] ?? raw).trim();
        const lower = name.toLowerCase();
        let res = resources.find((r) => r.name.toLowerCase() === lower || (r.initials ?? "").toLowerCase() === lower);
        if (!res) {
          const agent = (agents as Agent[]).find((a) => a.name.toLowerCase() === lower && a.status !== "terminated");
          const id = randomUUID();
          const initials = name.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 3);
          await x(
            `INSERT INTO ${T.resources} (id, company_id, kind, name, agent_id, role, capacity_hours_per_day, active, initials, group_name) VALUES ($1, $2, $3, $4, $5, $6, 8, true, $7, $8)`,
            [id, companyId, agent ? "agent" : "human", agent?.name ?? name, agent?.id ?? null, agent?.title ?? agent?.role ?? null, initials, agent ? "Agents" : null],
          );
          created++;
          res = { id, kind: agent ? "agent" : "human", agentId: agent?.id ?? null, userId: null } as Resource;
          resources.push(res as Resource);
        }
        if (!ids.includes(res.id)) ids.push(res.id);
      }
      await x(`DELETE FROM ${T.assignments} WHERE company_id = $1 AND issue_id = $2`, [companyId, issueId]);
      let i = 0;
      for (const rid of ids) {
        const unitsMatch = names[i++]?.match(/\[(\d+)%\]/);
        await x(`INSERT INTO ${T.assignments} (id, company_id, issue_id, resource_id, units_pct) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (issue_id, resource_id) DO UPDATE SET units_pct = $5`, [randomUUID(), companyId, issueId, rid, unitsMatch ? Math.max(1, Number(unitsMatch[1])) : 100]);
      }
      const primary = resources.find((r) => r.id === ids[0]);
      if (primary?.kind === "agent" && primary.agentId) await ctx.issues.update(issueId, { assigneeAgentId: primary.agentId, assigneeUserId: null }, companyId);
      else if (primary?.kind === "human" && primary.userId) await ctx.issues.update(issueId, { assigneeAgentId: null, assigneeUserId: primary.userId }, companyId);
      else if (ids.length === 0) await ctx.issues.update(issueId, { assigneeAgentId: null, assigneeUserId: null }, companyId);
      return { ok: true, resourceIds: ids, created };
    });

    /** Insert a new task at a position in the outline (MS Project Insert Task). */
    ctx.actions.register("insert-task", async (params, actionCtx) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const title = (typeof params.title === "string" && params.title.trim()) || "New task";
      const anchor = typeof params.anchorIssueId === "string" ? params.anchorIssueId : null;
      const position = params.position === "above" ? "above" : "below";
      const anchorRow = anchor ? (await q(`SELECT parent_issue_id, sort_order FROM ${T.tasks} WHERE issue_id = $1`, [anchor]))[0] : null;
      const parentIssueId = typeof params.parentIssueId === "string" ? params.parentIssueId || null : anchorRow ? str(anchorRow.parent_issue_id) || null : null;
      const issue = await ctx.issues.create({
        companyId,
        projectId,
        parentId: parentIssueId ?? undefined,
        title,
        status: "todo",
        priority: "medium",
        originKind: "plugin:suprabath.project-manager:task",
        originId: projectId,
        actor: actionCtx.actor.userId || actionCtx.actor.agentId ? { actorUserId: actionCtx.actor.userId, actorAgentId: actionCtx.actor.agentId, actorRunId: actionCtx.actor.runId } : undefined,
      } as never);
      const isMilestone = Boolean(params.isMilestone);
      const duration = isMilestone ? 0 : Math.max(0, num(params.durationDays, 1));
      // Renumber: insert right after/before the anchor in global sort order.
      const rows = await q<{ issue_id: string; sort_order: number }>(`SELECT issue_id, sort_order FROM ${T.tasks} WHERE project_id = $1 ORDER BY sort_order, created_at`, [projectId]);
      const order = rows.map((r) => r.issue_id);
      let idx = anchor ? order.indexOf(anchor) : order.length - 1;
      if (idx < 0) idx = order.length - 1;
      order.splice(position === "above" ? idx : idx + 1, 0, issue.id);
      await x(
        `INSERT INTO ${T.tasks} (issue_id, company_id, project_id, duration_days, is_milestone, constraint_type, sort_order, parent_issue_id) VALUES ($1, $2, $3, $4, $5, 'asap', $6, $7) ON CONFLICT (issue_id) DO NOTHING`,
        [issue.id, companyId, projectId, duration, isMilestone, order.indexOf(issue.id), parentIssueId ?? ""],
      );
      let i = 0;
      for (const id of order) await x(`UPDATE ${T.tasks} SET sort_order = $1 WHERE issue_id = $2 AND company_id = $3`, [i++, id, companyId]);
      return { ok: true, issueId: issue.id, identifier: issue.identifier };
    });

    /** Delete a task from the plan (MS Project Delete Task). Paperclip issues cannot be deleted through the plugin SDK, so the issue is cancelled. */
    ctx.actions.register("delete-task", async (params) => {
      const companyId = requireString(params, "companyId");
      const issueId = requireString(params, "issueId");
      const row = (await q(`SELECT parent_issue_id FROM ${T.tasks} WHERE issue_id = $1 AND company_id = $2`, [issueId, companyId]))[0];
      if (!row) throw new Error("Task not found in plan");
      // Children move up one level.
      await x(`UPDATE ${T.tasks} SET parent_issue_id = $1 WHERE parent_issue_id = $2 AND company_id = $3`, [str(row.parent_issue_id) ?? "", issueId, companyId]);
      await x(`DELETE FROM ${T.links} WHERE company_id = $1 AND predecessor_issue_id = $2`, [companyId, issueId]);
      await x(`DELETE FROM ${T.links} WHERE company_id = $1 AND successor_issue_id = $2`, [companyId, issueId]);
      await x(`DELETE FROM ${T.assignments} WHERE company_id = $1 AND issue_id = $2`, [companyId, issueId]);
      await x(`DELETE FROM ${T.tasks} WHERE company_id = $1 AND issue_id = $2`, [companyId, issueId]);
      if (params.cancelIssue !== false) await ctx.issues.update(issueId, { status: "cancelled" }, companyId).catch((err) => ctx.logger.warn("cancel failed", { issueId, error: String(err) }));
      return { ok: true };
    });

    // ----------------------------------------------------------------------
    // Agent tools
    // ----------------------------------------------------------------------
    const toolDecl = (name: string) => ctx.manifest.tools!.find((t) => t.name === name)!;

    ctx.tools.register("pm_get_schedule", toolDecl("pm_get_schedule"), async (raw, run): Promise<ToolResult> => {
      const p = (raw ?? {}) as { projectId?: string; onlyCritical?: boolean };
      const projectId = p.projectId || run.projectId;
      if (!projectId) return { error: "No project in context. Pass projectId." };
      const plan = await buildPlan(run.companyId, projectId);
      const tasks = plan.tasks.filter((t) => t.status !== "cancelled" && (!p.onlyCritical || t.critical));
      const resById = new Map(plan.resources.map((r) => [r.id, r.name]));
      const lines = tasks.map((t) => {
        const who = plan.assignments.filter((a) => a.issueId === t.issueId).map((a) => resById.get(a.resourceId)).filter(Boolean).join(", ");
        return `${t.critical ? "★" : " "} ${t.identifier ?? t.issueId} ${t.title} — ${t.start} → ${t.finish} (${t.durationDays}d, ${t.percentComplete}%, float ${t.totalFloat}d)${who ? ` [${who}]` : ""}${t.predecessors.length ? ` after ${t.predecessors.map((x) => plan.tasks.find((q) => q.issueId === x.issueId)?.identifier ?? x.issueId).join(", ")}` : ""}`;
      });
      return {
        content: `Project "${plan.project.name}" finishes ${plan.summary.projectFinish} (${plan.summary.durationDays} working days). ★ = critical path.\n${lines.join("\n")}`,
        data: { summary: plan.summary, tasks },
      };
    });

    ctx.tools.register("pm_my_assignments", toolDecl("pm_my_assignments"), async (_raw, run): Promise<ToolResult> => {
      const projects = (await ctx.projects.list({ companyId: run.companyId, limit: 100 })).filter((p) => !p.archivedAt);
      const mine: { project: string; task: PlanTask }[] = [];
      for (const p of projects) {
        const plan = await buildPlan(run.companyId, p.id);
        const myResourceIds = new Set(plan.resources.filter((r) => r.agentId === run.agentId).map((r) => r.id));
        for (const t of plan.tasks) {
          if (t.status === "cancelled" || t.percentComplete >= 100) continue;
          const assigned = t.assigneeAgentId === run.agentId || plan.assignments.some((a) => a.issueId === t.issueId && myResourceIds.has(a.resourceId));
          if (assigned) mine.push({ project: p.name, task: t });
        }
      }
      mine.sort((a, b) => a.task.start.localeCompare(b.task.start));
      const content = mine.length
        ? mine.map(({ project, task: t }) => `${t.critical ? "★" : " "} [${project}] ${t.identifier ?? t.issueId} ${t.title}: ${t.start} → ${t.finish}, ${t.percentComplete}% done, float ${t.totalFloat}d`).join("\n")
        : "No scheduled tasks are assigned to you.";
      return { content, data: mine };
    });

    ctx.tools.register("pm_report_progress", toolDecl("pm_report_progress"), async (raw, run): Promise<ToolResult> => {
      const p = (raw ?? {}) as { issueId?: string; percentComplete?: number; note?: string };
      if (!p.issueId) return { error: "issueId is required" };
      const pct = Math.min(100, Math.max(0, Math.round(Number(p.percentComplete ?? 0))));
      const res = await x(`UPDATE ${T.tasks} SET percent_complete = $1, notes = COALESCE($2, notes), updated_at = now() WHERE issue_id = $3 AND company_id = $4`, [pct, p.note ?? null, p.issueId, run.companyId]);
      if (res.rowCount === 0) return { error: "Task is not part of a project plan" };
      return { content: `Recorded ${pct}% complete.`, data: { issueId: p.issueId, percentComplete: pct } };
    });

    // ----------------------------------------------------------------------
    // Events: keep schedule rows in step with Paperclip issues
    // ----------------------------------------------------------------------
    ctx.events.on("issue.created", async (event) => {
      try {
        const issueId = event.entityId;
        if (!issueId) return;
        const issue = await ctx.issues.get(issueId, event.companyId);
        if (!issue?.projectId) return;
        const plans = await q(`SELECT project_id FROM ${T.plans} WHERE project_id = $1`, [issue.projectId]);
        if (plans.length === 0) return; // project not planned yet; will be picked up when opened
        await ensureTaskRows(event.companyId, issue.projectId, [issue]);
      } catch (err) {
        ctx.logger.warn("issue.created handler failed", { error: String(err) });
      }
    });

    ctx.events.on("issue.updated", async (event) => {
      try {
        const issueId = event.entityId;
        if (!issueId) return;
        const issue = await ctx.issues.get(issueId, event.companyId);
        if (!issue) return;
        if (issue.status === "done") {
          await x(`UPDATE ${T.tasks} SET percent_complete = 100, updated_at = now() WHERE issue_id = $1 AND company_id = $2 AND percent_complete < 100`, [issueId, event.companyId]);
        } else if (issue.status === "in_progress") {
          await x(`UPDATE ${T.tasks} SET percent_complete = 10, updated_at = now() WHERE issue_id = $1 AND company_id = $2 AND percent_complete = 0`, [issueId, event.companyId]);
        }
        if (issue.projectId) {
          await x(`UPDATE ${T.tasks} SET project_id = $1 WHERE issue_id = $2 AND company_id = $3 AND project_id <> $1`, [issue.projectId, issueId, event.companyId]);
        }
      } catch (err) {
        ctx.logger.warn("issue.updated handler failed", { error: String(err) });
      }
    });

    // ----------------------------------------------------------------------
    // Scheduled job: portfolio health snapshot
    // ----------------------------------------------------------------------
    ctx.jobs.register("daily-health", async (job) => {
      const companies = await ctx.companies.list({ limit: 100 });
      for (const c of companies) {
        const projects = (await ctx.projects.list({ companyId: c.id, limit: 100 })).filter((p) => !p.archivedAt);
        const rows: PortfolioRow[] = [];
        for (const p of projects) {
          try {
            const plan = await buildPlan(c.id, p.id);
            rows.push({ projectId: p.id, name: p.name, status: p.status, color: p.color, summary: plan.summary });
            await office.recordSnapshot(c.id, p.id).catch((err) => ctx.logger.warn("daily-health: snapshot failed", { projectId: p.id, error: String(err) }));
            if ((plan.summary.slippageDays ?? 0) > 0) {
              await ctx.activity
                .log({ companyId: c.id, message: `Project Manager: "${p.name}" is ${plan.summary.slippageDays} day(s) behind baseline (finish ${plan.summary.projectFinish}).` } as never)
                .catch(() => undefined);
            }
          } catch (err) {
            ctx.logger.warn("daily-health: plan failed", { projectId: p.id, error: String(err) });
          }
        }
        await ctx.state.set({ scopeKind: "company", scopeId: c.id, stateKey: "portfolio-snapshot" }, { at: new Date().toISOString(), runId: job.runId, rows });
      }
    });

    const office = registerPmOffice({ ctx, T, q, x, buildPlan, requireString });
    void office;

    ctx.logger.info("Project Manager plugin ready", { namespace: ns });
  },

  async onHealth() {
    return { status: "ok" as const, message: "Project Manager worker running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
