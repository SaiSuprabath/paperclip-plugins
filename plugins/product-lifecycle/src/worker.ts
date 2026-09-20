import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, Issue, Agent, ToolResult } from "@paperclipai/plugin-sdk";
import { randomUUID } from "node:crypto";
import {
  CR_IMPACTS,
  CR_STATUSES,
  CR_TRANSITIONS,
  CR_TYPES,
  STAGES,
  STAGE_GATES,
  type ChangeRequest,
  type CrEvent,
  type CrImpact,
  type CrStatus,
  type CrType,
  type IssueLite,
  type Lifecycle,
  type ProjectOverview,
  type Snapshot,
  type Sprint,
  type SprintItem,
  type Stage,
} from "./shared/types.js";

const EXPECTED_NS = process.env.PL_DB_NAMESPACE ?? "";
type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown, d = 0): number => (v === null || v === undefined || v === "" ? d : Number(v));
const bool = (v: unknown): boolean => v === true || v === "t" || v === "true";
const dateStr = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
};
const tsStr = (v: unknown): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const json = (v: unknown, fallback: unknown) => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return fallback; }
  }
  return v;
};
function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || v.length === 0) throw new Error(`Missing required parameter "${key}"`);
  return v;
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const ns = ctx.db.namespace;
    if (EXPECTED_NS && ns !== EXPECTED_NS) ctx.logger.warn("Namespace differs from build-time expectation", { runtime: ns, expected: EXPECTED_NS });
    const T = {
      lifecycle: `${ns}.lifecycle`,
      history: `${ns}.stage_history`,
      sprints: `${ns}.sprints`,
      items: `${ns}.sprint_items`,
      estimates: `${ns}.issue_estimates`,
      snapshots: `${ns}.sprint_snapshots`,
      crs: `${ns}.change_requests`,
      crEvents: `${ns}.change_request_events`,
    };
    const q = <R = Row>(sql: string, params: unknown[] = []) => ctx.db.query<R>(sql, params);
    const x = (sql: string, params: unknown[] = []) => ctx.db.execute(sql, params);

    // ------------------------------------------------------------------ loaders
    const mapSprint = (r: Row): Sprint => ({
      id: String(r.id),
      projectId: String(r.project_id),
      name: String(r.name),
      goal: str(r.goal),
      startDate: dateStr(r.start_date)!,
      endDate: dateStr(r.end_date)!,
      status: (str(r.status) as Sprint["status"]) ?? "planning",
      capacityPoints: num(r.capacity_points, 30),
      sequence: num(r.sequence, 1),
      retro: json(r.retro, {}) as Sprint["retro"],
      startedAt: tsStr(r.started_at),
      closedAt: tsStr(r.closed_at),
    });
    const mapItem = (r: Row): SprintItem => ({
      id: String(r.id),
      sprintId: String(r.sprint_id),
      issueId: String(r.issue_id),
      storyPoints: r.story_points == null ? null : num(r.story_points),
      committed: r.committed === undefined ? true : bool(r.committed),
      carriedFromSprintId: str(r.carried_from_sprint_id),
    });
    const mapCr = (r: Row): ChangeRequest => ({
      id: String(r.id),
      projectId: String(r.project_id),
      number: num(r.number),
      title: String(r.title),
      description: str(r.description),
      type: (str(r.type) as CrType) ?? "scope",
      impact: (str(r.impact) as CrImpact) ?? "medium",
      impactAssessment: str(r.impact_assessment),
      status: (str(r.status) as CrStatus) ?? "draft",
      priority: str(r.priority) ?? "medium",
      requestedByType: str(r.requested_by_type),
      requestedById: str(r.requested_by_id),
      requestedByName: str(r.requested_by_name),
      ownerAgentId: str(r.owner_agent_id),
      ownerUserId: str(r.owner_user_id),
      decisionNote: str(r.decision_note),
      decidedBy: str(r.decided_by),
      decidedAt: tsStr(r.decided_at),
      relatedIssueIds: (json(r.related_issue_ids, []) as string[]) ?? [],
      implementationIssueId: str(r.implementation_issue_id),
      targetSprintId: str(r.target_sprint_id),
      createdAt: tsStr(r.created_at) ?? new Date().toISOString(),
      updatedAt: tsStr(r.updated_at) ?? new Date().toISOString(),
    });
    const mapEvent = (r: Row): CrEvent => ({
      id: String(r.id),
      kind: String(r.kind),
      fromStatus: str(r.from_status),
      toStatus: str(r.to_status),
      note: str(r.note),
      actorType: str(r.actor_type),
      actorId: str(r.actor_id),
      actorName: str(r.actor_name),
      createdAt: tsStr(r.created_at) ?? new Date().toISOString(),
    });

    async function listAllIssues(companyId: string, projectId: string): Promise<Issue[]> {
      const out: Issue[] = [];
      let offset = 0;
      for (;;) {
        const page = await ctx.issues.list({ companyId, projectId, limit: 200, offset });
        out.push(...page);
        if (page.length < 200) break;
        offset += 200;
      }
      return out.filter((i) => !i.archivedAt);
    }

    async function ensureLifecycle(companyId: string, projectId: string): Promise<Lifecycle> {
      let rows = await q(`SELECT * FROM ${T.lifecycle} WHERE project_id = $1`, [projectId]);
      if (!rows[0]) {
        await x(`INSERT INTO ${T.lifecycle} (project_id, company_id) VALUES ($1, $2) ON CONFLICT (project_id) DO NOTHING`, [projectId, companyId]);
        rows = await q(`SELECT * FROM ${T.lifecycle} WHERE project_id = $1`, [projectId]);
      }
      const r = rows[0]!;
      const history = await q(`SELECT from_stage, to_stage, note, actor, created_at FROM ${T.history} WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
      return {
        stage: (STAGES.includes(str(r.stage) as Stage) ? (str(r.stage) as Stage) : "discovery"),
        gates: json(r.gates, {}) as Record<string, string[]>,
        vision: str(r.vision),
        targetLaunch: dateStr(r.target_launch),
        sprintLengthDays: num(r.sprint_length_days, 14),
        defaultCapacityPoints: num(r.default_capacity_points, 30),
        history: history.map((h) => ({ fromStage: str(h.from_stage), toStage: String(h.to_stage), note: str(h.note), actor: str(h.actor), createdAt: tsStr(h.created_at)! })),
      };
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
      } catch {
        return [];
      }
    }

    async function sprintPoints(sprintId: string, companyId: string, issueById?: Map<string, Issue>) {
      const items = (await q(`SELECT * FROM ${T.items} WHERE sprint_id = $1`, [sprintId])).map(mapItem);
      let byId = issueById;
      if (!byId) {
        const sp = (await q(`SELECT project_id FROM ${T.sprints} WHERE id = $1`, [sprintId]))[0];
        const issues = sp ? await listAllIssues(companyId, String(sp.project_id)) : [];
        byId = new Map(issues.map((i) => [i.id, i]));
      }
      let committed = 0;
      let done = 0;
      for (const it of items) {
        const pts = it.storyPoints ?? 0;
        committed += pts;
        const issue = byId.get(it.issueId);
        if (issue?.status === "done") done += pts;
      }
      return { items, committed, done, remaining: Math.max(0, committed - done) };
    }

    async function snapshotSprint(sprintId: string, companyId: string, issueById?: Map<string, Issue>) {
      const { committed, done, remaining } = await sprintPoints(sprintId, companyId, issueById);
      await x(
        `INSERT INTO ${T.snapshots} (id, company_id, sprint_id, snapshot_date, remaining_points, committed_points, done_points) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (sprint_id, snapshot_date) DO UPDATE SET remaining_points = $5, committed_points = $6, done_points = $7`,
        [randomUUID(), companyId, sprintId, todayIso(), remaining, committed, done],
      );
    }

    async function buildOverview(companyId: string, projectId: string): Promise<ProjectOverview> {
      const project = await ctx.projects.get(projectId, companyId);
      if (!project) throw new Error("Project not found");
      const [lifecycle, issues, sprintRows, crRows, agents, humans] = await Promise.all([
        ensureLifecycle(companyId, projectId),
        listAllIssues(companyId, projectId),
        q(`SELECT * FROM ${T.sprints} WHERE project_id = $1 ORDER BY sequence`, [projectId]),
        q(`SELECT * FROM ${T.crs} WHERE project_id = $1 ORDER BY number DESC`, [projectId]),
        ctx.agents.list({ companyId, limit: 200 }),
        listHumans(companyId),
      ]);
      const sprints = sprintRows.map(mapSprint);
      const sprintIds = sprints.map((s) => s.id);
      const [itemRows, estRows, snapRows] = await Promise.all([
        sprintIds.length ? q(`SELECT * FROM ${T.items} WHERE company_id = $1 AND sprint_id = ANY($2::text[])`, [companyId, sprintIds]) : Promise.resolve([] as Row[]),
        q(`SELECT issue_id, story_points FROM ${T.estimates} WHERE company_id = $1`, [companyId]),
        sprintIds.length ? q(`SELECT sprint_id, snapshot_date, remaining_points, committed_points, done_points FROM ${T.snapshots} WHERE company_id = $1 AND sprint_id = ANY($2::text[]) ORDER BY snapshot_date`, [companyId, sprintIds]) : Promise.resolve([] as Row[]),
      ]);
      const estimates = new Map(estRows.map((r) => [String(r.issue_id), r.story_points == null ? null : num(r.story_points)]));
      const items = itemRows.map(mapItem);
      const issueLite: IssueLite[] = issues.map((i) => ({
        id: i.id,
        identifier: i.identifier ?? null,
        title: i.title,
        status: i.status,
        priority: i.priority,
        assigneeAgentId: i.assigneeAgentId ?? null,
        assigneeUserId: i.assigneeUserId ?? null,
        storyPoints: estimates.get(i.id) ?? items.find((it) => it.issueId === i.id)?.storyPoints ?? null,
        labels: (i.labels ?? []).map((l) => l.name),
      }));
      const snapshots: Record<string, Snapshot[]> = {};
      for (const r of snapRows) {
        const sid = String(r.sprint_id);
        (snapshots[sid] ??= []).push({ date: dateStr(r.snapshot_date)!, remaining: num(r.remaining_points), committed: num(r.committed_points), done: num(r.done_points) });
      }
      const issueById = new Map(issues.map((i) => [i.id, i]));
      const velocity = sprints
        .filter((s) => s.status === "closed")
        .map((s) => {
          const retro = s.retro as { committedPoints?: number; donePoints?: number };
          if (retro.committedPoints != null) return { sprintId: s.id, name: s.name, committed: retro.committedPoints, done: retro.donePoints ?? 0 };
          const its = items.filter((it) => it.sprintId === s.id);
          const committed = its.reduce((a, it) => a + (it.storyPoints ?? 0), 0);
          const done = its.filter((it) => issueById.get(it.issueId)?.status === "done").reduce((a, it) => a + (it.storyPoints ?? 0), 0);
          return { sprintId: s.id, name: s.name, committed, done };
        });
      return {
        project: { id: project.id, name: project.name, status: project.status, color: project.color, targetDate: project.targetDate },
        lifecycle,
        sprints,
        activeSprint: sprints.find((s) => s.status === "active") ?? null,
        items,
        issues: issueLite,
        snapshots,
        changeRequests: crRows.map(mapCr),
        agents: (agents as Agent[]).filter((a) => a.status !== "terminated").map((a) => ({ id: a.id, name: a.name, role: a.role, status: a.status })),
        humans,
        velocity,
        today: todayIso(),
      };
    }

    async function actorName(actor: { userId: string | null; agentId: string | null }, companyId: string): Promise<{ type: string | null; id: string | null; name: string | null }> {
      if (actor.agentId) {
        const a = await ctx.agents.get(actor.agentId, companyId).catch(() => null);
        return { type: "agent", id: actor.agentId, name: a?.name ?? "agent" };
      }
      if (actor.userId) {
        const humans = await listHumans(companyId);
        return { type: "user", id: actor.userId, name: humans.find((h) => h.id === actor.userId)?.name ?? "board" };
      }
      return { type: null, id: null, name: null };
    }

    async function addCrEvent(companyId: string, crId: string, kind: string, from: string | null, to: string | null, note: string | null, actor: { type: string | null; id: string | null; name: string | null }) {
      await x(`INSERT INTO ${T.crEvents} (id, company_id, change_request_id, kind, from_status, to_status, note, actor_type, actor_id, actor_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [randomUUID(), companyId, crId, kind, from, to, note, actor.type, actor.id, actor.name]);
    }

    async function createChangeRequest(
      companyId: string,
      input: { projectId: string; title: string; description?: string | null; type?: string; impact?: string; impactAssessment?: string | null; priority?: string; relatedIssueIds?: string[]; submit?: boolean },
      actor: { type: string | null; id: string | null; name: string | null },
    ): Promise<ChangeRequest> {
      const type = (CR_TYPES.includes(input.type as CrType) ? input.type : "scope") as CrType;
      const impact = (CR_IMPACTS.includes(input.impact as CrImpact) ? input.impact : "medium") as CrImpact;
      const next = await q<{ n: number }>(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM ${T.crs} WHERE project_id = $1`, [input.projectId]);
      const id = randomUUID();
      const status: CrStatus = input.submit ? "submitted" : "draft";
      await x(
        `INSERT INTO ${T.crs} (id, company_id, project_id, number, title, description, type, impact, impact_assessment, status, priority, requested_by_type, requested_by_id, requested_by_name, related_issue_ids) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)`,
        [id, companyId, input.projectId, num(next[0]?.n, 1), input.title.trim(), input.description ?? null, type, impact, input.impactAssessment ?? null, status, input.priority ?? "medium", actor.type, actor.id, actor.name, JSON.stringify(input.relatedIssueIds ?? [])],
      );
      await addCrEvent(companyId, id, "created", null, status, null, actor);
      if (input.submit) await addCrEvent(companyId, id, "transition", "draft", "submitted", null, actor);
      const rows = await q(`SELECT * FROM ${T.crs} WHERE id = $1`, [id]);
      return mapCr(rows[0]!);
    }

    // ------------------------------------------------------------------ data
    ctx.data.register("projects", async (params) => {
      const companyId = requireString(params, "companyId");
      const projects = await ctx.projects.list({ companyId, limit: 200 });
      return projects.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, name: p.name, status: p.status, color: p.color, targetDate: p.targetDate }));
    });

    ctx.data.register("overview", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      if (!projectId) return null;
      return buildOverview(companyId, projectId);
    });

    ctx.data.register("change-request", async (params) => {
      const companyId = requireString(params, "companyId");
      const id = requireString(params, "id");
      const rows = await q(`SELECT * FROM ${T.crs} WHERE id = $1 AND company_id = $2`, [id, companyId]);
      if (!rows[0]) return null;
      const events = await q(`SELECT * FROM ${T.crEvents} WHERE change_request_id = $1 ORDER BY created_at`, [id]);
      return { changeRequest: mapCr(rows[0]), events: events.map(mapEvent) };
    });

    ctx.data.register("portfolio", async (params) => {
      const companyId = requireString(params, "companyId");
      const projects = (await ctx.projects.list({ companyId, limit: 100 })).filter((p) => !p.archivedAt);
      const out = [];
      for (const p of projects) {
        try {
          const o = await buildOverview(companyId, p.id);
          const active = o.activeSprint;
          const pts = active ? await sprintPoints(active.id, companyId, new Map()) : null;
          const activeItems = active ? o.items.filter((i) => i.sprintId === active.id) : [];
          const committed = activeItems.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
          const done = activeItems.filter((i) => o.issues.find((x) => x.id === i.issueId)?.status === "done").reduce((a, i) => a + (i.storyPoints ?? 0), 0);
          void pts;
          out.push({
            projectId: p.id,
            name: p.name,
            color: p.color,
            stage: o.lifecycle.stage,
            activeSprint: active ? { id: active.id, name: active.name, endDate: active.endDate, committed, done, items: activeItems.length } : null,
            openChanges: o.changeRequests.filter((c) => ["submitted", "under_review"].includes(c.status)).length,
            approvedChanges: o.changeRequests.filter((c) => c.status === "approved").length,
          });
        } catch (err) {
          ctx.logger.warn("portfolio failed", { projectId: p.id, error: String(err) });
        }
      }
      return out;
    });

    // ------------------------------------------------------------------ lifecycle actions
    ctx.actions.register("set-stage", async (params, actionCtx) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const stage = requireString(params, "stage") as Stage;
      if (!STAGES.includes(stage)) throw new Error("Unknown stage");
      const cur = await ensureLifecycle(companyId, projectId);
      await x(`UPDATE ${T.lifecycle} SET stage = $1, updated_at = now() WHERE project_id = $2 AND company_id = $3`, [stage, projectId, companyId]);
      const who = await actorName(actionCtx.actor, companyId);
      await x(`INSERT INTO ${T.history} (id, company_id, project_id, from_stage, to_stage, note, actor) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [randomUUID(), companyId, projectId, cur.stage, stage, typeof params.note === "string" ? params.note : null, who.name]);
      await ctx.activity.log({ companyId, message: `Product Lifecycle: project moved from ${cur.stage} to ${stage}`, entityType: "project", entityId: projectId }).catch(() => undefined);
      return { ok: true };
    });

    ctx.actions.register("toggle-gate", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const stage = requireString(params, "stage");
      const gate = requireString(params, "gate");
      const lc = await ensureLifecycle(companyId, projectId);
      const gates = { ...lc.gates };
      const set = new Set(gates[stage] ?? []);
      if (params.done === false) set.delete(gate); else set.add(gate);
      gates[stage] = [...set];
      await x(`UPDATE ${T.lifecycle} SET gates = $1::jsonb, updated_at = now() WHERE project_id = $2 AND company_id = $3`, [JSON.stringify(gates), projectId, companyId]);
      return { ok: true };
    });

    ctx.actions.register("update-lifecycle", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      await ensureLifecycle(companyId, projectId);
      const patch = (params.patch ?? {}) as Record<string, unknown>;
      if ("vision" in patch) await x(`UPDATE ${T.lifecycle} SET vision = $1, updated_at = now() WHERE project_id = $2 AND company_id = $3`, [patch.vision == null ? null : String(patch.vision), projectId, companyId]);
      if ("targetLaunch" in patch) await x(`UPDATE ${T.lifecycle} SET target_launch = $1, updated_at = now() WHERE project_id = $2 AND company_id = $3`, [patch.targetLaunch ? String(patch.targetLaunch).slice(0, 10) : null, projectId, companyId]);
      if ("sprintLengthDays" in patch) await x(`UPDATE ${T.lifecycle} SET sprint_length_days = $1, updated_at = now() WHERE project_id = $2 AND company_id = $3`, [Math.max(1, Math.round(num(patch.sprintLengthDays, 14))), projectId, companyId]);
      if ("defaultCapacityPoints" in patch) await x(`UPDATE ${T.lifecycle} SET default_capacity_points = $1, updated_at = now() WHERE project_id = $2 AND company_id = $3`, [Math.max(1, Math.round(num(patch.defaultCapacityPoints, 30))), projectId, companyId]);
      return { ok: true };
    });

    // ------------------------------------------------------------------ sprint actions
    ctx.actions.register("create-sprint", async (params) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const lc = await ensureLifecycle(companyId, projectId);
      const existing = (await q(`SELECT * FROM ${T.sprints} WHERE project_id = $1 ORDER BY sequence`, [projectId])).map(mapSprint);
      const seq = (existing.at(-1)?.sequence ?? 0) + 1;
      const last = existing.at(-1);
      const start = typeof params.startDate === "string" && params.startDate ? params.startDate.slice(0, 10) : last ? addDays(last.endDate, 1) : todayIso();
      const end = typeof params.endDate === "string" && params.endDate ? params.endDate.slice(0, 10) : addDays(start, lc.sprintLengthDays - 1);
      const id = randomUUID();
      await x(
        `INSERT INTO ${T.sprints} (id, company_id, project_id, name, goal, start_date, end_date, status, capacity_points, sequence) VALUES ($1, $2, $3, $4, $5, $6, $7, 'planning', $8, $9)`,
        [id, companyId, projectId, typeof params.name === "string" && params.name.trim() ? params.name.trim() : `Sprint ${seq}`, typeof params.goal === "string" ? params.goal : null, start, end, Math.round(num(params.capacityPoints, lc.defaultCapacityPoints)), seq],
      );
      return { ok: true, id };
    });

    ctx.actions.register("update-sprint", async (params) => {
      const companyId = requireString(params, "companyId");
      const sprintId = requireString(params, "sprintId");
      const patch = (params.patch ?? {}) as Record<string, unknown>;
      if (typeof patch.name === "string" && patch.name.trim()) await x(`UPDATE ${T.sprints} SET name = $1, updated_at = now() WHERE id = $2 AND company_id = $3`, [patch.name.trim(), sprintId, companyId]);
      if ("goal" in patch) await x(`UPDATE ${T.sprints} SET goal = $1, updated_at = now() WHERE id = $2 AND company_id = $3`, [patch.goal == null ? null : String(patch.goal), sprintId, companyId]);
      if (patch.startDate) await x(`UPDATE ${T.sprints} SET start_date = $1, updated_at = now() WHERE id = $2 AND company_id = $3`, [String(patch.startDate).slice(0, 10), sprintId, companyId]);
      if (patch.endDate) await x(`UPDATE ${T.sprints} SET end_date = $1, updated_at = now() WHERE id = $2 AND company_id = $3`, [String(patch.endDate).slice(0, 10), sprintId, companyId]);
      if ("capacityPoints" in patch) await x(`UPDATE ${T.sprints} SET capacity_points = $1, updated_at = now() WHERE id = $2 AND company_id = $3`, [Math.max(0, Math.round(num(patch.capacityPoints, 30))), sprintId, companyId]);
      if ("retro" in patch) {
        const cur = (await q(`SELECT retro FROM ${T.sprints} WHERE id = $1`, [sprintId]))[0];
        const merged = { ...(json(cur?.retro, {}) as Record<string, unknown>), ...(patch.retro as Record<string, unknown>) };
        await x(`UPDATE ${T.sprints} SET retro = $1::jsonb, updated_at = now() WHERE id = $2 AND company_id = $3`, [JSON.stringify(merged), sprintId, companyId]);
      }
      return { ok: true };
    });

    ctx.actions.register("delete-sprint", async (params) => {
      const companyId = requireString(params, "companyId");
      const sprintId = requireString(params, "sprintId");
      const s = (await q(`SELECT status FROM ${T.sprints} WHERE id = $1 AND company_id = $2`, [sprintId, companyId]))[0];
      if (!s) throw new Error("Sprint not found");
      if (String(s.status) !== "planning") throw new Error("Only sprints still in planning can be deleted");
      await x(`DELETE FROM ${T.items} WHERE sprint_id = $1 AND company_id = $2`, [sprintId, companyId]);
      await x(`DELETE FROM ${T.snapshots} WHERE sprint_id = $1 AND company_id = $2`, [sprintId, companyId]);
      await x(`DELETE FROM ${T.sprints} WHERE id = $1 AND company_id = $2`, [sprintId, companyId]);
      return { ok: true };
    });

    ctx.actions.register("start-sprint", async (params) => {
      const companyId = requireString(params, "companyId");
      const sprintId = requireString(params, "sprintId");
      const s = (await q(`SELECT * FROM ${T.sprints} WHERE id = $1 AND company_id = $2`, [sprintId, companyId]))[0];
      if (!s) throw new Error("Sprint not found");
      const active = await q(`SELECT id, name FROM ${T.sprints} WHERE project_id = $1 AND status = 'active'`, [String(s.project_id)]);
      if (active.length) throw new Error(`"${active[0]!.name}" is already active. Complete it first.`);
      await x(`UPDATE ${T.sprints} SET status = 'active', started_at = now(), updated_at = now() WHERE id = $1 AND company_id = $2`, [sprintId, companyId]);
      // Move committed issues that are still in backlog to todo so agents pick them up.
      const items = (await q(`SELECT issue_id FROM ${T.items} WHERE sprint_id = $1`, [sprintId])).map((r) => String(r.issue_id));
      for (const issueId of items) {
        const issue = await ctx.issues.get(issueId, companyId).catch(() => null);
        if (issue && issue.status === "backlog") await ctx.issues.update(issueId, { status: "todo" }, companyId).catch(() => undefined);
      }
      await snapshotSprint(sprintId, companyId);
      await ctx.activity.log({ companyId, message: `Product Lifecycle: sprint "${s.name}" started (${items.length} items)`, entityType: "project", entityId: String(s.project_id) }).catch(() => undefined);
      return { ok: true };
    });

    ctx.actions.register("complete-sprint", async (params) => {
      const companyId = requireString(params, "companyId");
      const sprintId = requireString(params, "sprintId");
      const carryOver = params.carryOver === "backlog" ? "backlog" : "next";
      const sRow = (await q(`SELECT * FROM ${T.sprints} WHERE id = $1 AND company_id = $2`, [sprintId, companyId]))[0];
      if (!sRow) throw new Error("Sprint not found");
      const sprint = mapSprint(sRow);
      const { items, committed, done } = await sprintPoints(sprintId, companyId);
      const issues = await listAllIssues(companyId, sprint.projectId);
      const byId = new Map(issues.map((i) => [i.id, i]));
      const incomplete = items.filter((it) => byId.get(it.issueId)?.status !== "done");
      await snapshotSprint(sprintId, companyId, byId);
      await x(`UPDATE ${T.sprints} SET status = 'closed', closed_at = now(), retro = retro || $1::jsonb, updated_at = now() WHERE id = $2 AND company_id = $3`, [JSON.stringify({ committedPoints: committed, donePoints: done, carriedOver: incomplete.length }), sprintId, companyId]);
      let nextId: string | null = null;
      if (carryOver === "next" && incomplete.length) {
        const next = (await q(`SELECT * FROM ${T.sprints} WHERE project_id = $1 AND status = 'planning' ORDER BY sequence LIMIT 1`, [sprint.projectId]))[0];
        if (next) nextId = String(next.id);
        else {
          const lc = await ensureLifecycle(companyId, sprint.projectId);
          nextId = randomUUID();
          const start = addDays(sprint.endDate, 1);
          await x(`INSERT INTO ${T.sprints} (id, company_id, project_id, name, start_date, end_date, status, capacity_points, sequence) VALUES ($1, $2, $3, $4, $5, $6, 'planning', $7, $8)`, [nextId, companyId, sprint.projectId, `Sprint ${sprint.sequence + 1}`, start, addDays(start, lc.sprintLengthDays - 1), lc.defaultCapacityPoints, sprint.sequence + 1]);
        }
        for (const it of incomplete) {
          await x(`INSERT INTO ${T.items} (id, company_id, sprint_id, issue_id, story_points, committed, carried_from_sprint_id) VALUES ($1, $2, $3, $4, $5, true, $6) ON CONFLICT (sprint_id, issue_id) DO NOTHING`, [randomUUID(), companyId, nextId, it.issueId, it.storyPoints, sprintId]);
        }
      }
      await ctx.activity.log({ companyId, message: `Product Lifecycle: sprint "${sprint.name}" completed — ${done}/${committed} points done, ${incomplete.length} item(s) carried over`, entityType: "project", entityId: sprint.projectId }).catch(() => undefined);
      return { ok: true, done, committed, carried: incomplete.length, nextSprintId: nextId };
    });

    ctx.actions.register("add-to-sprint", async (params) => {
      const companyId = requireString(params, "companyId");
      const sprintId = requireString(params, "sprintId");
      const issueId = requireString(params, "issueId");
      const s = (await q(`SELECT project_id, status FROM ${T.sprints} WHERE id = $1 AND company_id = $2`, [sprintId, companyId]))[0];
      if (!s) throw new Error("Sprint not found");
      if (String(s.status) === "closed") throw new Error("Cannot add items to a closed sprint");
      // one open sprint per issue
      const open = await q(`SELECT id FROM ${T.sprints} WHERE project_id = $1 AND status <> 'closed'`, [String(s.project_id)]);
      for (const o of open) await x(`DELETE FROM ${T.items} WHERE sprint_id = $1 AND issue_id = $2 AND company_id = $3`, [String(o.id), issueId, companyId]);
      const est = (await q(`SELECT story_points FROM ${T.estimates} WHERE issue_id = $1`, [issueId]))[0];
      const pts = params.storyPoints != null && params.storyPoints !== "" ? Math.round(num(params.storyPoints)) : est?.story_points == null ? null : num(est.story_points);
      await x(`INSERT INTO ${T.items} (id, company_id, sprint_id, issue_id, story_points, committed) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (sprint_id, issue_id) DO UPDATE SET story_points = $5`, [randomUUID(), companyId, sprintId, issueId, pts]);
      if (pts != null) await x(`INSERT INTO ${T.estimates} (issue_id, company_id, story_points, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (issue_id) DO UPDATE SET story_points = $3, updated_at = now()`, [issueId, companyId, pts]);
      if (String(s.status) === "active") await snapshotSprint(sprintId, companyId);
      return { ok: true };
    });

    ctx.actions.register("remove-from-sprint", async (params) => {
      const companyId = requireString(params, "companyId");
      const sprintId = requireString(params, "sprintId");
      const issueId = requireString(params, "issueId");
      await x(`DELETE FROM ${T.items} WHERE sprint_id = $1 AND issue_id = $2 AND company_id = $3`, [sprintId, issueId, companyId]);
      return { ok: true };
    });

    ctx.actions.register("set-points", async (params) => {
      const companyId = requireString(params, "companyId");
      const issueId = requireString(params, "issueId");
      const pts = params.storyPoints == null || params.storyPoints === "" ? null : Math.max(0, Math.round(num(params.storyPoints)));
      await x(`INSERT INTO ${T.estimates} (issue_id, company_id, story_points, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (issue_id) DO UPDATE SET story_points = $3, updated_at = now()`, [issueId, companyId, pts]);
      await x(`UPDATE ${T.items} SET story_points = $1 WHERE issue_id = $2 AND company_id = $3`, [pts, issueId, companyId]);
      return { ok: true };
    });

    ctx.actions.register("set-issue-status", async (params) => {
      const companyId = requireString(params, "companyId");
      const issueId = requireString(params, "issueId");
      const status = requireString(params, "status") as Issue["status"];
      await ctx.issues.update(issueId, { status }, companyId);
      return { ok: true };
    });

    ctx.actions.register("assign-issue", async (params) => {
      const companyId = requireString(params, "companyId");
      const issueId = requireString(params, "issueId");
      await ctx.issues.update(issueId, { assigneeAgentId: typeof params.assigneeAgentId === "string" && params.assigneeAgentId ? params.assigneeAgentId : null, assigneeUserId: typeof params.assigneeUserId === "string" && params.assigneeUserId ? params.assigneeUserId : null }, companyId);
      return { ok: true };
    });

    ctx.actions.register("create-issue", async (params, actionCtx) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const title = requireString(params, "title").trim();
      const issue = await ctx.issues.create({
        companyId,
        projectId,
        title,
        description: typeof params.description === "string" ? params.description : undefined,
        priority: (["critical", "high", "medium", "low"].includes(String(params.priority)) ? String(params.priority) : "medium") as Issue["priority"],
        status: "backlog",
        assigneeAgentId: typeof params.assigneeAgentId === "string" && params.assigneeAgentId ? params.assigneeAgentId : undefined,
        assigneeUserId: typeof params.assigneeUserId === "string" && params.assigneeUserId ? params.assigneeUserId : undefined,
        originKind: "plugin",
        originId: "suprabath.product-lifecycle",
        actor: actionCtx.actor.userId ? ({ actorType: "user", actorId: actionCtx.actor.userId } as never) : undefined,
      } as never);
      if (params.storyPoints != null && params.storyPoints !== "") {
        await x(`INSERT INTO ${T.estimates} (issue_id, company_id, story_points, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (issue_id) DO UPDATE SET story_points = $3, updated_at = now()`, [issue.id, companyId, Math.round(num(params.storyPoints))]);
      }
      if (typeof params.sprintId === "string" && params.sprintId) {
        await x(`INSERT INTO ${T.items} (id, company_id, sprint_id, issue_id, story_points, committed) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (sprint_id, issue_id) DO NOTHING`, [randomUUID(), companyId, params.sprintId, issue.id, params.storyPoints == null || params.storyPoints === "" ? null : Math.round(num(params.storyPoints))]);
      }
      return { ok: true, issueId: issue.id, identifier: issue.identifier };
    });

    // ------------------------------------------------------------------ change management
    ctx.actions.register("create-change-request", async (params, actionCtx) => {
      const companyId = requireString(params, "companyId");
      const projectId = requireString(params, "projectId");
      const title = requireString(params, "title");
      const who = await actorName(actionCtx.actor, companyId);
      const cr = await createChangeRequest(companyId, {
        projectId,
        title,
        description: typeof params.description === "string" ? params.description : null,
        type: typeof params.type === "string" ? params.type : undefined,
        impact: typeof params.impact === "string" ? params.impact : undefined,
        impactAssessment: typeof params.impactAssessment === "string" ? params.impactAssessment : null,
        priority: typeof params.priority === "string" ? params.priority : undefined,
        relatedIssueIds: Array.isArray(params.relatedIssueIds) ? (params.relatedIssueIds as string[]) : [],
        submit: params.submit === true,
      }, who);
      return { ok: true, id: cr.id, number: cr.number };
    });

    ctx.actions.register("update-change-request", async (params, actionCtx) => {
      const companyId = requireString(params, "companyId");
      const id = requireString(params, "id");
      const patch = (params.patch ?? {}) as Record<string, unknown>;
      const sets: string[] = [];
      const vals: unknown[] = [];
      const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (typeof patch.title === "string" && patch.title.trim()) set("title", patch.title.trim());
      if ("description" in patch) set("description", patch.description == null ? null : String(patch.description));
      if (typeof patch.type === "string" && CR_TYPES.includes(patch.type as CrType)) set("type", patch.type);
      if (typeof patch.impact === "string" && CR_IMPACTS.includes(patch.impact as CrImpact)) set("impact", patch.impact);
      if ("impactAssessment" in patch) set("impact_assessment", patch.impactAssessment == null ? null : String(patch.impactAssessment));
      if (typeof patch.priority === "string") set("priority", patch.priority);
      if ("ownerAgentId" in patch) set("owner_agent_id", patch.ownerAgentId ? String(patch.ownerAgentId) : null);
      if ("ownerUserId" in patch) set("owner_user_id", patch.ownerUserId ? String(patch.ownerUserId) : null);
      if ("targetSprintId" in patch) set("target_sprint_id", patch.targetSprintId ? String(patch.targetSprintId) : null);
      if (Array.isArray(patch.relatedIssueIds)) { vals.push(JSON.stringify(patch.relatedIssueIds)); sets.push(`related_issue_ids = $${vals.length}::jsonb`); }
      if (sets.length === 0) return { ok: true, unchanged: true };
      sets.push("updated_at = now()");
      vals.push(id, companyId);
      await x(`UPDATE ${T.crs} SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND company_id = $${vals.length}`, vals);
      const who = await actorName(actionCtx.actor, companyId);
      await addCrEvent(companyId, id, "edited", null, null, Object.keys(patch).join(", "), who);
      return { ok: true };
    });

    ctx.actions.register("comment-change-request", async (params, actionCtx) => {
      const companyId = requireString(params, "companyId");
      const id = requireString(params, "id");
      const note = requireString(params, "note");
      const who = await actorName(actionCtx.actor, companyId);
      await addCrEvent(companyId, id, "comment", null, null, note, who);
      return { ok: true };
    });

    ctx.actions.register("transition-change-request", async (params, actionCtx) => {
      const companyId = requireString(params, "companyId");
      const id = requireString(params, "id");
      const to = requireString(params, "to") as CrStatus;
      if (!CR_STATUSES.includes(to)) throw new Error("Unknown status");
      const row = (await q(`SELECT * FROM ${T.crs} WHERE id = $1 AND company_id = $2`, [id, companyId]))[0];
      if (!row) throw new Error("Change request not found");
      const cr = mapCr(row);
      if (!CR_TRANSITIONS[cr.status].includes(to)) throw new Error(`Cannot move a ${cr.status.replace("_", " ")} change request to ${to.replace("_", " ")}`);
      const who = await actorName(actionCtx.actor, companyId);
      const note = typeof params.note === "string" && params.note.trim() ? params.note.trim() : null;
      if (to === "approved" || to === "rejected") {
        await x(`UPDATE ${T.crs} SET status = $1, decision_note = $2, decided_by = $3, decided_at = now(), updated_at = now() WHERE id = $4 AND company_id = $5`, [to, note, who.name, id, companyId]);
      } else {
        await x(`UPDATE ${T.crs} SET status = $1, updated_at = now() WHERE id = $2 AND company_id = $3`, [to, id, companyId]);
      }
      await addCrEvent(companyId, id, "transition", cr.status, to, note, who);

      let implementationIssueId: string | null = cr.implementationIssueId;
      if (to === "approved" && params.createImplementationIssue === true && !implementationIssueId) {
        const priority = cr.impact === "critical" ? "critical" : cr.impact === "high" ? "high" : cr.impact === "medium" ? "medium" : "low";
        const issue = await ctx.issues.create({
          companyId,
          projectId: cr.projectId,
          title: `CR-${cr.number}: ${cr.title}`,
          description: `Approved change request CR-${cr.number} (${cr.type}, impact ${cr.impact}).\n\n${cr.description ?? ""}\n\n**Impact assessment**\n${cr.impactAssessment ?? "n/a"}\n\n**Decision note**\n${note ?? "n/a"}`,
          priority: priority as Issue["priority"],
          status: "todo",
          assigneeAgentId: cr.ownerAgentId ?? undefined,
          assigneeUserId: cr.ownerUserId ?? undefined,
          originKind: "plugin",
          originId: "suprabath.product-lifecycle",
        } as never);
        implementationIssueId = issue.id;
        await x(`UPDATE ${T.crs} SET implementation_issue_id = $1, updated_at = now() WHERE id = $2 AND company_id = $3`, [issue.id, id, companyId]);
        const sprintId = typeof params.targetSprintId === "string" && params.targetSprintId ? params.targetSprintId : cr.targetSprintId;
        if (sprintId) await x(`INSERT INTO ${T.items} (id, company_id, sprint_id, issue_id, story_points, committed) VALUES ($1, $2, $3, $4, NULL, true) ON CONFLICT (sprint_id, issue_id) DO NOTHING`, [randomUUID(), companyId, sprintId, issue.id]);
        await addCrEvent(companyId, id, "implementation_issue", null, null, issue.identifier ?? issue.id, who);
      }
      // Tell the affected issues' assignees what was decided.
      if ((to === "approved" || to === "rejected") && cr.relatedIssueIds.length) {
        for (const issueId of cr.relatedIssueIds.slice(0, 10)) {
          await ctx.issues.createComment(issueId, `Change request **CR-${cr.number} "${cr.title}"** was **${to}**${who.name ? ` by ${who.name}` : ""}.${note ? `\n\n> ${note}` : ""}${implementationIssueId ? `\n\nImplementation tracked in a new issue.` : ""}`, companyId).catch((err) => ctx.logger.warn("comment failed", { issueId, error: String(err) }));
        }
      }
      await ctx.activity.log({ companyId, message: `Product Lifecycle: CR-${cr.number} "${cr.title}" → ${to}`, entityType: "project", entityId: cr.projectId }).catch(() => undefined);
      return { ok: true, implementationIssueId };
    });

    // ------------------------------------------------------------------ tools
    const toolDecl = (name: string) => ctx.manifest.tools!.find((t) => t.name === name)!;

    ctx.tools.register("pl_get_active_sprint", toolDecl("pl_get_active_sprint"), async (raw, run): Promise<ToolResult> => {
      const p = (raw ?? {}) as { projectId?: string };
      const projectId = p.projectId || run.projectId;
      if (!projectId) return { error: "No project in context. Pass projectId." };
      const o = await buildOverview(run.companyId, projectId);
      const s = o.activeSprint;
      if (!s) return { content: `No active sprint for "${o.project.name}". Stage: ${o.lifecycle.stage}. Planned sprints: ${o.sprints.filter((k) => k.status === "planning").map((k) => k.name).join(", ") || "none"}.`, data: { activeSprint: null, stage: o.lifecycle.stage } };
      const items = o.items.filter((i) => i.sprintId === s.id).map((i) => ({ ...i, issue: o.issues.find((x) => x.id === i.issueId) }));
      const committed = items.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
      const done = items.filter((i) => i.issue?.status === "done").reduce((a, i) => a + (i.storyPoints ?? 0), 0);
      const lines = items.map((i) => `- ${i.issue?.identifier ?? i.issueId} ${i.issue?.title ?? ""} [${i.issue?.status ?? "?"}] ${i.storyPoints ?? "?"}pt`);
      return {
        content: `Active sprint "${s.name}" (${s.startDate} → ${s.endDate}). Goal: ${s.goal ?? "n/a"}. ${done}/${committed} points done, ${Math.max(0, committed - done)} remaining.\n${lines.join("\n")}`,
        data: { sprint: s, items, committed, done },
      };
    });

    ctx.tools.register("pl_submit_change_request", toolDecl("pl_submit_change_request"), async (raw, run): Promise<ToolResult> => {
      const p = (raw ?? {}) as { projectId?: string; title?: string; description?: string; type?: string; impact?: string; impactAssessment?: string; relatedIssueIds?: string[] };
      const projectId = p.projectId || run.projectId;
      if (!projectId) return { error: "No project in context. Pass projectId." };
      if (!p.title || !p.description) return { error: "title and description are required" };
      const agent = await ctx.agents.get(run.agentId, run.companyId).catch(() => null);
      const cr = await createChangeRequest(run.companyId, { projectId, title: p.title, description: p.description, type: p.type, impact: p.impact, impactAssessment: p.impactAssessment ?? null, relatedIssueIds: p.relatedIssueIds ?? [], submit: true }, { type: "agent", id: run.agentId, name: agent?.name ?? "agent" });
      return { content: `Change request CR-${cr.number} submitted for review (status: ${cr.status}). Do not implement the change until it is approved.`, data: cr };
    });

    ctx.tools.register("pl_list_change_requests", toolDecl("pl_list_change_requests"), async (raw, run): Promise<ToolResult> => {
      const p = (raw ?? {}) as { projectId?: string; status?: string };
      const projectId = p.projectId || run.projectId;
      if (!projectId) return { error: "No project in context. Pass projectId." };
      const rows = (await q(`SELECT * FROM ${T.crs} WHERE project_id = $1 ORDER BY number DESC`, [projectId])).map(mapCr).filter((c) => !p.status || c.status === p.status);
      return { content: rows.length ? rows.map((c) => `CR-${c.number} [${c.status}] ${c.title} (${c.type}, impact ${c.impact})`).join("\n") : "No change requests.", data: rows };
    });

    // ------------------------------------------------------------------ events & jobs
    ctx.events.on("issue.updated", async (event) => {
      try {
        const issueId = event.entityId;
        if (!issueId) return;
        const rows = await q(`SELECT s.id FROM ${T.items} i JOIN ${T.sprints} s ON s.id = i.sprint_id WHERE i.issue_id = $1 AND s.status = 'active'`, [issueId]);
        for (const r of rows) await snapshotSprint(String(r.id), event.companyId);
      } catch (err) {
        ctx.logger.warn("issue.updated handler failed", { error: String(err) });
      }
    });

    ctx.jobs.register("burndown-snapshot", async () => {
      const rows = await q(`SELECT id, company_id FROM ${T.sprints} WHERE status = 'active'`);
      for (const r of rows) await snapshotSprint(String(r.id), String(r.company_id)).catch((err) => ctx.logger.warn("snapshot failed", { sprintId: r.id, error: String(err) }));
    });

    ctx.logger.info("Product Lifecycle plugin ready", { namespace: ns, gates: Object.keys(STAGE_GATES).length });
  },
  async onHealth() {
    return { status: "ok" as const, message: "Product Lifecycle worker running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
