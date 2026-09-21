// Iteration 2: earned value management (S-curve, budget), communications dashboard,
// status reports, RAID log, stakeholder register, nudges and email.
import { randomUUID } from "node:crypto";
import type { PluginContext, Issue } from "@paperclipai/plugin-sdk";
import { WorkCalendar, addCalendarDays } from "./shared/cpm.js";
import type { AttentionItem, CommItem, CommsPayload, CurvePoint, EvmMetrics, EvmPayload, NudgeLog, PlanPayload, PlanSettings, PlanTask, Rag, RaidItem, ResourceCostRow, Stakeholder, StatusReport, TaskCostRow } from "./shared/types.js";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown, d = 0): number => (v === null || v === undefined || v === "" ? d : Number(v));
const dateStr = (v: unknown): string | null => (!v ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const tsStr = (v: unknown): string => (v instanceof Date ? v.toISOString() : v ? String(v) : new Date().toISOString());
const todayIso = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const json = (v: unknown, fb: unknown) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return fb; } })() : v ?? fb);

export interface PmOfficeDeps {
  ctx: PluginContext;
  T: Record<string, string>;
  q: <R = Row>(sql: string, params?: unknown[]) => Promise<R[]>;
  x: (sql: string, params?: unknown[]) => Promise<{ rowCount: number }>;
  buildPlan(companyId: string, projectId: string): Promise<PlanPayload>;
  requireString(params: Record<string, unknown>, key: string): string;
}

export function registerPmOffice({ ctx, T, q, x, buildPlan, requireString }: PmOfficeDeps) {
  const tables = {
    ev: `${ctx.db.namespace}.ev_snapshots`,
    stakeholders: `${ctx.db.namespace}.stakeholders`,
    comm: `${ctx.db.namespace}.comm_plan`,
    raid: `${ctx.db.namespace}.raid_items`,
    reports: `${ctx.db.namespace}.status_reports`,
    nudges: `${ctx.db.namespace}.nudges`,
  };

  // ------------------------------------------------------------------ costs
  async function agentSpend(companyId: string, issueIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    await Promise.all(issueIds.slice(0, 300).map(async (issueId) => {
      try {
        const s = await ctx.issues.summaries.getOrchestration({ issueId, companyId, includeSubtree: false });
        out.set(issueId, (s.costs?.costCents ?? 0) / 100);
      } catch { out.set(issueId, 0); }
    }));
    return out;
  }

  function taskCosts(plan: PlanPayload, spend: Map<string, number>): { rows: TaskCostRow[]; byId: Map<string, TaskCostRow>; resources: ResourceCostRow[] } {
    const resById = new Map(plan.resources.map((r) => [r.id, r]));
    const hoursPerDay = plan.calendar.hoursPerDay || 8;
    const byId = new Map<string, TaskCostRow>();
    const resAgg = new Map<string, ResourceCostRow>();
    for (const t of plan.tasks) {
      if (t.isSummary) continue;
      const asg = plan.assignments.filter((a) => a.issueId === t.issueId);
      const baseHours = t.effortHours ?? (t.isMilestone ? 0 : t.durationDays * hoursPerDay);
      let plannedHours = 0;
      let plannedCost = 0;
      let rateSum = 0;
      for (const a of asg) {
        const r = resById.get(a.resourceId);
        const h = t.effortHours != null ? baseHours / Math.max(1, asg.length) : baseHours * (a.unitsPct / 100);
        plannedHours += h;
        plannedCost += h * (r?.costPerHour ?? 0);
        rateSum += r?.costPerHour ?? 0;
        if (r) {
          const agg = resAgg.get(r.id) ?? { resourceId: r.id, name: r.name, kind: r.kind, plannedHours: 0, plannedCost: 0, taskCount: 0 };
          agg.plannedHours += h; agg.plannedCost += h * (r.costPerHour ?? 0); agg.taskCount++;
          resAgg.set(r.id, agg);
        }
      }
      if (asg.length === 0) plannedHours = baseHours;
      const overridden = t.plannedCostOverride != null;
      if (overridden) plannedCost = t.plannedCostOverride!;
      const avgRate = asg.length ? rateSum / asg.length : 0;
      const agentCost = spend.get(t.issueId) ?? 0;
      const actualHours = t.actualHours ?? 0;
      const actualCost = t.actualCostManual != null ? t.actualCostManual + agentCost : actualHours * avgRate + agentCost;
      const row: TaskCostRow = {
        issueId: t.issueId, identifier: t.identifier, title: t.title, outlineLevel: t.outlineLevel, isSummary: false,
        plannedCost: round2(plannedCost), plannedHours: round2(plannedHours), actualCost: round2(actualCost), agentCost: round2(agentCost), actualHours: round2(actualHours),
        earnedValue: round2(plannedCost * (t.percentComplete / 100)), percentComplete: t.percentComplete,
        resources: asg.map((a) => resById.get(a.resourceId)?.name).filter(Boolean).join(", "), overridden,
      };
      byId.set(t.issueId, row);
    }
    // summaries roll up
    const rows: TaskCostRow[] = plan.tasks.map((t) => {
      if (!t.isSummary) return byId.get(t.issueId)!;
      const leaves = plan.tasks.filter((k) => !k.isSummary && isUnder(plan, k.issueId, t.issueId)).map((k) => byId.get(k.issueId)!).filter(Boolean);
      const sum = (f: (r: TaskCostRow) => number) => round2(leaves.reduce((a, r) => a + f(r), 0));
      const plannedCost = sum((r) => r.plannedCost);
      return { issueId: t.issueId, identifier: t.identifier, title: t.title, outlineLevel: t.outlineLevel, isSummary: true, plannedCost, plannedHours: sum((r) => r.plannedHours), actualCost: sum((r) => r.actualCost), agentCost: sum((r) => r.agentCost), actualHours: sum((r) => r.actualHours), earnedValue: sum((r) => r.earnedValue), percentComplete: plannedCost ? Math.round((sum((r) => r.earnedValue) / plannedCost) * 100) : t.percentComplete, resources: "", overridden: false };
    });
    return { rows, byId, resources: [...resAgg.values()].map((r) => ({ ...r, plannedHours: round2(r.plannedHours), plannedCost: round2(r.plannedCost) })) };
  }

  function isUnder(plan: PlanPayload, id: string, ancestor: string): boolean {
    let cur: string | null = id;
    let g = 0;
    while (cur && g++ < 100) { const t = plan.tasks.find((k) => k.issueId === cur); if (!t) return false; if (t.parentIssueId === ancestor) return true; cur = t.parentIssueId; }
    return false;
  }

  // ------------------------------------------------------------------ EVM
  /** Planned value earned by a task up to and including `date` (linear over its baseline working days). */
  function pvAt(t: PlanTask, plannedCost: number, date: string, cal: WorkCalendar): number {
    const start = t.baselineStart ?? t.start;
    const finish = t.baselineFinish ?? t.finish;
    if (plannedCost <= 0) return 0;
    if (date < start) return 0;
    if (date >= finish) return plannedCost;
    const total = Math.max(1, cal.workingDaysBetween(start, finish) + 1);
    const done = Math.max(0, cal.workingDaysBetween(start, date) + (cal.isWorkingDay(date) ? 1 : 0));
    return plannedCost * Math.min(1, done / total);
  }

  async function computeEvm(companyId: string, projectId: string, plan?: PlanPayload): Promise<EvmPayload> {
    const p = plan ?? (await buildPlan(companyId, projectId));
    const leaves = p.tasks.filter((t) => !t.isSummary);
    const spend = await agentSpend(companyId, leaves.map((t) => t.issueId));
    const costs = taskCosts(p, spend);
    const cal = new WorkCalendar(p.plan.startDate, p.calendar);
    const statusDate = p.plan.statusDate ?? p.today;
    const plannedTotal = round2(leaves.reduce((a, t) => a + (costs.byId.get(t.issueId)?.plannedCost ?? 0), 0));
    const bac = p.plan.budgetAmount != null && p.plan.budgetAmount > 0 ? p.plan.budgetAmount : plannedTotal;
    // Scale factor so PV/EV are expressed against the budget when planned costs don't cover it.
    const scale = plannedTotal > 0 ? bac / plannedTotal : 0;
    const pvOf = (date: string) => round2(leaves.reduce((a, t) => a + pvAt(t, (costs.byId.get(t.issueId)?.plannedCost ?? 0) * scale, date, cal), 0));
    const ev = round2(leaves.reduce((a, t) => a + (costs.byId.get(t.issueId)?.earnedValue ?? 0) * scale, 0));
    const ac = round2(leaves.reduce((a, t) => a + (costs.byId.get(t.issueId)?.actualCost ?? 0), 0));
    const pv = pvOf(statusDate);
    const spi = pv > 0 ? round2(ev / pv) : null;
    const cpi = ac > 0 ? round2(ev / ac) : null;
    const eac = cpi && cpi > 0 ? round2(bac / cpi) : bac;
    const etc = round2(Math.max(0, eac - ac));
    const vac = round2(bac - eac);
    const tcpi = bac - ac > 0 ? round2((bac - ev) / (bac - ac)) : null;
    const plannedFinish = leaves.map((t) => t.baselineFinish ?? t.finish).sort().at(-1) ?? p.summary.projectFinish;
    const plannedDuration = Math.max(1, cal.workingDaysBetween(p.plan.startDate, plannedFinish) + 1);
    const forecastFinish = spi && spi > 0 ? cal.toDate(Math.round(plannedDuration / spi) - 1) : p.summary.projectFinish;
    const ragReasons: string[] = [];
    let rag: Rag = "green";
    if ((spi ?? 1) < 0.9 || (p.summary.slippageDays ?? 0) > 5) { rag = "red"; ragReasons.push(spi !== null && spi < 0.9 ? `SPI ${spi}` : `${p.summary.slippageDays} days behind baseline`); }
    else if ((spi ?? 1) < 0.97 || (p.summary.slippageDays ?? 0) > 0 || p.summary.overdueCount > 0) { rag = "amber"; ragReasons.push(p.summary.overdueCount > 0 ? `${p.summary.overdueCount} overdue task(s)` : "slightly behind schedule"); }
    if ((cpi ?? 1) < 0.9) { rag = "red"; ragReasons.push(`CPI ${cpi}`); }
    else if ((cpi ?? 1) < 0.97 && rag === "green") { rag = "amber"; ragReasons.push(`CPI ${cpi}`); }
    if (p.plan.ragOverride === "green" || p.plan.ragOverride === "amber" || p.plan.ragOverride === "red") { rag = p.plan.ragOverride; ragReasons.unshift("set manually by the PM"); }
    const metrics: EvmMetrics = {
      statusDate, bac: round2(bac), pv, ev, ac, sv: round2(ev - pv), cv: round2(ev - ac), spi, cpi, eac, etc, vac, tcpi,
      pctComplete: bac > 0 ? Math.round((ev / bac) * 100) : p.summary.percentComplete,
      pctPlanned: bac > 0 ? Math.round((pv / bac) * 100) : 0,
      pctSpent: bac > 0 ? Math.round((ac / bac) * 100) : 0,
      forecastFinish, plannedFinish, rag, ragReasons,
    };
    // Curve: weekly points from project start to the later of planned finish / forecast / status date.
    const snapRows = await q(`SELECT snapshot_date, pv, ev, ac, bac FROM ${tables.ev} WHERE project_id = $1 ORDER BY snapshot_date`, [projectId]);
    const snapshots = snapRows.map((r) => ({ date: dateStr(r.snapshot_date)!, pv: num(r.pv), ev: num(r.ev), ac: num(r.ac), bac: num(r.bac) }));
    const end = [plannedFinish, forecastFinish, statusDate, p.summary.projectFinish].sort().at(-1)!;
    const curve: CurvePoint[] = [];
    let cur = p.plan.startDate;
    const snapByDate = new Map(snapshots.map((s) => [s.date, s]));
    let guard = 0;
    while (cur <= end && guard++ < 260) {
      const s = snapByDate.get(cur) ?? snapshots.filter((k) => k.date <= cur && k.date > addCalendarDays(cur, -7)).at(-1);
      const actual = cur <= statusDate ? s ?? null : null;
      curve.push({ date: cur, pv: pvOf(cur), ev: actual ? actual.ev : null, ac: actual ? actual.ac : null });
      cur = addCalendarDays(cur, 7);
    }
    // ensure today's point and the final planned point
    if (!curve.some((c) => c.date === statusDate)) curve.push({ date: statusDate, pv, ev, ac });
    else { const c = curve.find((k) => k.date === statusDate)!; c.ev = ev; c.ac = ac; }
    if (!curve.some((c) => c.date === plannedFinish)) curve.push({ date: plannedFinish, pv: round2(bac), ev: null, ac: null });
    curve.sort((a, b) => a.date.localeCompare(b.date));
    return { metrics, curve, snapshots, tasks: costs.rows, resources: costs.resources, settings: p.plan, currency: p.plan.currency };
  }

  async function recordSnapshot(companyId: string, projectId: string, evm?: EvmPayload) {
    const e = evm ?? (await computeEvm(companyId, projectId));
    const m = e.metrics;
    await x(
      `INSERT INTO ${tables.ev} (id, company_id, project_id, snapshot_date, pv, ev, ac, bac, pct_complete, spi, cpi) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (project_id, snapshot_date) DO UPDATE SET pv = $5, ev = $6, ac = $7, bac = $8, pct_complete = $9, spi = $10, cpi = $11`,
      [randomUUID(), companyId, projectId, m.statusDate, m.pv, m.ev, m.ac, m.bac, m.pctComplete, m.spi, m.cpi],
    );
    return e;
  }

  // ------------------------------------------------------------------ comms loaders
  const mapStakeholder = (r: Row): Stakeholder => ({ id: String(r.id), name: String(r.name), role: str(r.role), organization: str(r.organization), email: str(r.email), userId: str(r.user_id), agentId: str(r.agent_id), power: str(r.power) ?? "medium", interest: str(r.interest) ?? "medium", channel: str(r.channel), frequency: str(r.frequency), notes: str(r.notes) });
  const mapComm = (r: Row): CommItem => ({ id: String(r.id), item: String(r.item), audience: str(r.audience), channel: str(r.channel), frequency: str(r.frequency), owner: str(r.owner), nextDue: dateStr(r.next_due), notes: str(r.notes) });
  const mapRaid = (r: Row): RaidItem => { const pr = r.probability == null ? null : num(r.probability); const im = r.impact == null ? null : num(r.impact); return { id: String(r.id), kind: String(r.kind), title: String(r.title), description: str(r.description), probability: pr, impact: im, score: pr != null && im != null ? pr * im : im, response: str(r.response), owner: str(r.owner), status: str(r.status) ?? "open", dueDate: dateStr(r.due_date), issueId: str(r.issue_id), createdBy: str(r.created_by), createdAt: tsStr(r.created_at), closedAt: r.closed_at ? tsStr(r.closed_at) : null }; };
  const mapReport = (r: Row): StatusReport => ({ id: String(r.id), periodStart: dateStr(r.period_start)!, periodEnd: dateStr(r.period_end)!, rag: (str(r.rag) as Rag) ?? "green", contentMd: String(r.content_md), metrics: json(r.metrics, {}) as Partial<EvmMetrics>, sentTo: (json(r.sent_to, []) as string[]) ?? [], createdBy: str(r.created_by), createdAt: tsStr(r.created_at) });
  const mapNudge = (r: Row): NudgeLog => ({ id: String(r.id), issueId: str(r.issue_id), targetKind: String(r.target_kind), targetName: str(r.target_name), channel: String(r.channel), message: str(r.message), actor: str(r.actor), createdAt: tsStr(r.created_at) });

  async function emailConfig(companyId: string) {
    let cfg: Record<string, unknown> = {};
    try { cfg = await ctx.config.get(companyId); } catch { /* not configured */ }
    const provider = cfg.emailProvider === "resend" && typeof cfg.resendApiKey === "string" && cfg.resendApiKey ? "resend" : "mailto";
    return { provider: provider as "mailto" | "resend", apiKey: typeof cfg.resendApiKey === "string" ? cfg.resendApiKey : null, from: typeof cfg.fromAddress === "string" && cfg.fromAddress ? cfg.fromAddress : null };
  }

  const mailto = (to: string[], subject: string, body: string) => `mailto:${encodeURIComponent(to.join(","))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  async function sendEmail(companyId: string, to: string[], subject: string, text: string): Promise<{ sent: boolean; mailto: string; error?: string }> {
    const cfg = await emailConfig(companyId);
    const link = mailto(to, subject, text);
    if (cfg.provider !== "resend" || !cfg.apiKey || !cfg.from || to.length === 0) return { sent: false, mailto: link };
    try {
      const res = await ctx.http.fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: cfg.from, to, subject, text }) });
      if (!res.ok) return { sent: false, mailto: link, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
      return { sent: true, mailto: link };
    } catch (err) {
      return { sent: false, mailto: link, error: String(err) };
    }
  }

  function attentionList(plan: PlanPayload, stakeholders: Stakeholder[]): AttentionItem[] {
    const soon = addCalendarDays(plan.today, 3);
    const resById = new Map(plan.resources.map((r) => [r.id, r]));
    const out: AttentionItem[] = [];
    for (const t of plan.tasks) {
      if (t.isSummary || t.percentComplete >= 100 || t.status === "done") continue;
      let kind: AttentionItem["kind"] | null = null;
      if (t.finish < plan.today) kind = "overdue";
      else if (t.status === "blocked") kind = "blocked";
      else if (t.finish <= soon) kind = "due_soon";
      else if (t.start < plan.today && t.percentComplete === 0 && t.status !== "in_progress") kind = "stalled";
      if (!t.assigneeAgentId && !t.assigneeUserId && plan.assignments.every((a) => a.issueId !== t.issueId)) kind = kind ?? "unassigned";
      if (!kind) continue;
      let ownerKind: AttentionItem["ownerKind"] = "none"; let ownerId: string | null = null; let ownerName: string | null = null; let ownerEmail: string | null = null;
      if (t.assigneeAgentId) { ownerKind = "agent"; ownerId = t.assigneeAgentId; ownerName = plan.agents.find((a) => a.id === t.assigneeAgentId)?.name ?? "agent"; }
      else if (t.assigneeUserId) { ownerKind = "human"; ownerId = t.assigneeUserId; ownerName = plan.humans.find((h) => h.id === t.assigneeUserId)?.name ?? "user"; ownerEmail = plan.humans.find((h) => h.id === t.assigneeUserId)?.email ?? null; }
      else { const a = plan.assignments.find((k) => k.issueId === t.issueId); const r = a ? resById.get(a.resourceId) : null; if (r) { ownerKind = r.kind; ownerId = r.agentId ?? r.userId ?? r.id; ownerName = r.name; ownerEmail = r.email; } }
      if (!ownerEmail && ownerName) ownerEmail = stakeholders.find((s) => s.name.toLowerCase() === ownerName!.toLowerCase())?.email ?? null;
      const daysLate = Math.max(0, Math.round((Date.parse(plan.today) - Date.parse(t.finish)) / 86_400_000));
      out.push({ issueId: t.issueId, identifier: t.identifier, title: t.title, kind, finish: t.finish, daysLate, ownerKind, ownerId, ownerName, ownerEmail, critical: t.critical, percentComplete: t.percentComplete, status: t.status });
    }
    const order = { overdue: 0, blocked: 1, due_soon: 2, stalled: 3, unassigned: 4 };
    return out.sort((a, b) => order[a.kind] - order[b.kind] || b.daysLate - a.daysLate);
  }

  async function loadComms(companyId: string, projectId: string, plan: PlanPayload, evm: EvmPayload): Promise<CommsPayload> {
    const [st, cp, raid, reports, nudges] = await Promise.all([
      q(`SELECT * FROM ${tables.stakeholders} WHERE project_id = $1 ORDER BY created_at`, [projectId]),
      q(`SELECT * FROM ${tables.comm} WHERE project_id = $1 ORDER BY next_due NULLS LAST, created_at`, [projectId]),
      q(`SELECT * FROM ${tables.raid} WHERE project_id = $1 ORDER BY status, created_at DESC`, [projectId]),
      q(`SELECT * FROM ${tables.reports} WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]),
      q(`SELECT * FROM ${tables.nudges} WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]),
    ]);
    const stakeholders = st.map(mapStakeholder);
    const cfg = await emailConfig(companyId);
    return {
      stakeholders, commPlan: cp.map(mapComm), raid: raid.map(mapRaid), reports: reports.slice(0, 26).map(mapReport), nudges: nudges.slice(0, 100).map(mapNudge),
      attention: attentionList(plan, stakeholders),
      email: { provider: cfg.provider, configured: cfg.provider === "resend" && !!cfg.from, from: cfg.from },
      settings: plan.plan, metrics: evm.metrics,
      milestones: plan.tasks.filter((t) => t.isMilestone).map((t) => ({ issueId: t.issueId, identifier: t.identifier, title: t.title, date: t.start, done: t.percentComplete >= 100 })),
    };
  }

  // ------------------------------------------------------------------ status report
  function money(n: number, currency: string) { try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); } catch { return `${currency} ${Math.round(n)}`; } }

  async function composeReport(companyId: string, projectId: string, actor: string | null): Promise<StatusReport> {
    const plan = await buildPlan(companyId, projectId);
    const evm = await recordSnapshot(companyId, projectId, await computeEvm(companyId, projectId, plan));
    const m = evm.metrics;
    const comms = await loadComms(companyId, projectId, plan, evm);
    const periodEnd = plan.today;
    const periodStart = addCalendarDays(periodEnd, -6);
    const cur = plan.plan.currency;
    const leaves = plan.tasks.filter((t) => !t.isSummary);
    const doneThisWeek = leaves.filter((t) => t.percentComplete >= 100 && t.finish >= periodStart && t.finish <= periodEnd);
    const doneAll = leaves.filter((t) => t.percentComplete >= 100);
    const nextWeekEnd = addCalendarDays(periodEnd, 7);
    const upcoming = leaves.filter((t) => t.percentComplete < 100 && ((t.start >= periodEnd && t.start <= nextWeekEnd) || (t.finish >= periodEnd && t.finish <= nextWeekEnd)));
    const overdue = comms.attention.filter((a) => a.kind === "overdue");
    const openRaid = comms.raid.filter((r) => r.status !== "closed");
    const risks = openRaid.filter((r) => r.kind === "risk").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const issues = openRaid.filter((r) => r.kind === "issue");
    const decisions = openRaid.filter((r) => r.kind === "decision");
    const ragIcon = { green: "🟢", amber: "🟡", red: "🔴" }[m.rag];
    const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const who = (t: PlanTask) => { const a = plan.assignments.find((k) => k.issueId === t.issueId); const r = a ? plan.resources.find((k) => k.id === a.resourceId) : null; return r?.name ?? plan.agents.find((k) => k.id === t.assigneeAgentId)?.name ?? plan.humans.find((k) => k.id === t.assigneeUserId)?.name ?? "unassigned"; };
    const lines: string[] = [];
    lines.push(`# Weekly Status Report — ${plan.project.name}`);
    lines.push(`**Period:** ${fmt(periodStart)} – ${fmt(periodEnd)}  ·  **Status date:** ${fmt(m.statusDate)}  ·  **Prepared by:** ${plan.plan.pmName ?? actor ?? "Project Manager"}${plan.plan.sponsor ? `  ·  **Sponsor:** ${plan.plan.sponsor}` : ""}`);
    lines.push("");
    lines.push(`## Overall status: ${ragIcon} ${m.rag.toUpperCase()}`);
    if (m.ragReasons.length) lines.push(`_${m.ragReasons.join("; ")}_`);
    lines.push("");
    lines.push("## Schedule");
    lines.push(`| Metric | Value |\n|---|---|`);
    lines.push(`| Planned finish (baseline) | ${fmt(m.plannedFinish)} |`);
    lines.push(`| Current finish | ${fmt(plan.summary.projectFinish)}${plan.summary.slippageDays != null ? ` (${plan.summary.slippageDays > 0 ? "+" : ""}${plan.summary.slippageDays} d vs baseline)` : ""} |`);
    lines.push(`| Forecast finish (SPI-adjusted) | ${fmt(m.forecastFinish)} |`);
    lines.push(`| % complete (earned) / % planned | ${m.pctComplete}% / ${m.pctPlanned}% |`);
    lines.push(`| SPI · SV | ${m.spi ?? "n/a"} · ${money(m.sv, cur)} |`);
    lines.push(`| Tasks done / total · critical · overdue | ${doneAll.length} / ${leaves.length} · ${plan.summary.criticalCount} · ${overdue.length} |`);
    lines.push("");
    lines.push("## Budget");
    lines.push(`| Metric | Value |\n|---|---|`);
    lines.push(`| Budget at completion (BAC) | ${money(m.bac, cur)} |`);
    lines.push(`| Planned value (PV) | ${money(m.pv, cur)} |`);
    lines.push(`| Earned value (EV) | ${money(m.ev, cur)} |`);
    lines.push(`| Actual cost (AC) | ${money(m.ac, cur)} (${m.pctSpent}% of budget) |`);
    lines.push(`| CPI · CV | ${m.cpi ?? "n/a"} · ${money(m.cv, cur)} |`);
    lines.push(`| Estimate at completion (EAC) · VAC | ${money(m.eac, cur)} · ${money(m.vac, cur)} |`);
    lines.push(`| Estimate to complete (ETC) · TCPI | ${money(m.etc, cur)} · ${m.tcpi ?? "n/a"} |`);
    lines.push("");
    lines.push("## Accomplished this week");
    lines.push(doneThisWeek.length ? doneThisWeek.map((t) => `- ✅ ${t.identifier ?? ""} ${t.title} (${who(t)})`).join("\n") : "- No tasks completed this period.");
    lines.push("");
    lines.push("## Planned for next week");
    lines.push(upcoming.length ? upcoming.map((t) => `- ${t.critical ? "★ " : ""}${t.identifier ?? ""} ${t.title} — ${fmt(t.start)} → ${fmt(t.finish)} (${who(t)}, ${t.percentComplete}%)`).join("\n") : "- Nothing scheduled to start or finish next week.");
    lines.push("");
    if (comms.milestones.length) { lines.push("## Milestones"); lines.push(comms.milestones.map((ms) => `- ${ms.done ? "✅" : ms.date < plan.today ? "⚠️" : "◆"} ${ms.title} — ${fmt(ms.date)}`).join("\n")); lines.push(""); }
    lines.push("## Attention needed");
    lines.push(overdue.length ? overdue.map((a) => `- ⚠️ ${a.identifier ?? ""} ${a.title} — ${a.daysLate} day(s) late, owner: ${a.ownerName ?? "unassigned"}`).join("\n") : "- No overdue tasks.");
    lines.push("");
    lines.push("## Risks & issues (RAID)");
    lines.push(risks.length ? risks.slice(0, 8).map((r) => `- 🎲 **${r.title}** (score ${r.score ?? "?"}, owner ${r.owner ?? "—"})${r.response ? ` — ${r.response}` : ""}`).join("\n") : "- No open risks.");
    if (issues.length) lines.push(issues.map((r) => `- 🔥 **${r.title}** (owner ${r.owner ?? "—"})${r.response ? ` — ${r.response}` : ""}`).join("\n"));
    if (decisions.length) { lines.push(""); lines.push("## Decisions needed"); lines.push(decisions.map((r) => `- ❓ **${r.title}**${r.dueDate ? ` (by ${fmt(r.dueDate)})` : ""}${r.description ? ` — ${r.description}` : ""}`).join("\n")); }
    lines.push("");
    lines.push(`_Generated by Paperclip Project Manager on ${fmt(plan.today)}._`);
    const content = lines.join("\n");
    const id = randomUUID();
    await x(`INSERT INTO ${tables.reports} (id, company_id, project_id, period_start, period_end, rag, content_md, metrics, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`, [id, companyId, projectId, periodStart, periodEnd, m.rag, content, JSON.stringify(m), actor]);
    await ctx.activity.log({ companyId, message: `Project Manager: weekly status report generated for "${plan.project.name}" — ${m.rag.toUpperCase()}, SPI ${m.spi ?? "n/a"}, CPI ${m.cpi ?? "n/a"}`, entityType: "project", entityId: projectId }).catch(() => undefined);
    return { id, periodStart, periodEnd, rag: m.rag, contentMd: content, metrics: m, sentTo: [], createdBy: actor, createdAt: new Date().toISOString() };
  }

  // ------------------------------------------------------------------ nudges
  async function nudge(companyId: string, projectId: string, issueId: string, message: string | null, actor: string | null): Promise<{ channel: string; mailto?: string; queued?: boolean; error?: string }> {
    const plan = await buildPlan(companyId, projectId);
    const t = plan.tasks.find((k) => k.issueId === issueId);
    if (!t) throw new Error("Task not in plan");
    const stakeholders = (await q(`SELECT * FROM ${tables.stakeholders} WHERE project_id = $1`, [projectId])).map(mapStakeholder);
    const item = attentionList(plan, stakeholders).find((a) => a.issueId === issueId) ?? { ownerKind: t.assigneeAgentId ? "agent" : t.assigneeUserId ? "human" : "none", ownerId: t.assigneeAgentId ?? t.assigneeUserId, ownerName: plan.agents.find((a) => a.id === t.assigneeAgentId)?.name ?? plan.humans.find((h) => h.id === t.assigneeUserId)?.name ?? null, ownerEmail: plan.humans.find((h) => h.id === t.assigneeUserId)?.email ?? null, daysLate: 0, kind: "due_soon" as const };
    const late = item.daysLate > 0 ? `${item.daysLate} day(s) overdue` : `due ${t.finish}`;
    const body = message?.trim() || `📣 Nudge from the project manager: "${t.title}" is ${late} (planned ${t.start} → ${t.finish}, ${t.percentComplete}% complete${t.critical ? ", on the critical path" : ""}). Please post an update or complete the task.`;
    const comment = `${body}\n\n_Sent via Project Manager${actor ? ` by ${actor}` : ""}._`;
    let channel = "comment";
    let result: { channel: string; mailto?: string; queued?: boolean; error?: string } = { channel };
    await ctx.issues.createComment(issueId, comment, companyId).catch((err) => ctx.logger.warn("nudge comment failed", { issueId, error: String(err) }));
    if (item.ownerKind === "agent" && item.ownerId) {
      try {
        const w = await ctx.issues.requestWakeup(issueId, companyId, { reason: "Project manager nudge: task is behind schedule", contextSource: "plugin:suprabath.project-manager" });
        channel = "agent_wakeup";
        result = { channel, queued: w.queued };
      } catch (err) { result = { channel: "comment", error: `wakeup failed: ${String(err)}` }; }
    } else if (item.ownerEmail) {
      const subject = `[${plan.project.name}] Action needed: ${t.title}`;
      const mail = await sendEmail(companyId, [item.ownerEmail], subject, `${body}\n\nTask: ${t.identifier ?? ""} ${t.title}\nPlanned: ${t.start} → ${t.finish}\nProgress: ${t.percentComplete}%\n`);
      channel = mail.sent ? "email" : "mailto";
      result = { channel, mailto: mail.mailto, error: mail.error };
    }
    await x(`INSERT INTO ${tables.nudges} (id, company_id, project_id, issue_id, target_kind, target_id, target_name, channel, message, actor) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [randomUUID(), companyId, projectId, issueId, item.ownerKind, item.ownerId, item.ownerName, channel, body, actor]);
    return result;
  }

  async function actorLabel(actor: { userId: string | null; agentId: string | null }, companyId: string): Promise<string | null> {
    if (actor.agentId) return (await ctx.agents.get(actor.agentId, companyId).catch(() => null))?.name ?? "agent";
    if (actor.userId) { try { const m = await ctx.access.members.list({ companyId }); const u = (m.find((k) => k.principalId === actor.userId) as unknown as { user?: { name?: string } } | undefined)?.user; return u?.name ?? "board"; } catch { return "board"; } }
    return null;
  }

  // ------------------------------------------------------------------ data providers
  ctx.data.register("evm", async (params) => {
    const companyId = requireString(params, "companyId");
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!projectId) return null;
    return computeEvm(companyId, projectId);
  });

  ctx.data.register("comms", async (params) => {
    const companyId = requireString(params, "companyId");
    const projectId = typeof params.projectId === "string" ? params.projectId : "";
    if (!projectId) return null;
    const plan = await buildPlan(companyId, projectId);
    const evm = await computeEvm(companyId, projectId, plan);
    return loadComms(companyId, projectId, plan, evm);
  });

  // ------------------------------------------------------------------ actions
  ctx.actions.register("update-project-settings", async (params) => {
    const companyId = requireString(params, "companyId");
    const projectId = requireString(params, "projectId");
    const p = (params.patch ?? {}) as Record<string, unknown>;
    const sets: string[] = []; const vals: unknown[] = [];
    const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ("budgetAmount" in p) set("budget_amount", p.budgetAmount == null || p.budgetAmount === "" ? null : Math.max(0, num(p.budgetAmount)));
    if (typeof p.currency === "string" && p.currency.trim()) set("currency", p.currency.trim().toUpperCase().slice(0, 3));
    if ("sponsor" in p) set("sponsor", p.sponsor ? String(p.sponsor) : null);
    if ("pmName" in p) set("pm_name", p.pmName ? String(p.pmName) : null);
    if ("pmEmail" in p) set("pm_email", p.pmEmail ? String(p.pmEmail) : null);
    if ("ragOverride" in p) set("rag_override", ["green", "amber", "red"].includes(String(p.ragOverride)) ? String(p.ragOverride) : null);
    if ("autoNudge" in p) set("auto_nudge", Boolean(p.autoNudge));
    if ("reportRecipients" in p) set("report_recipients", p.reportRecipients ? String(p.reportRecipients) : null);
    if ("statusDate" in p) set("status_date", p.statusDate ? String(p.statusDate).slice(0, 10) : null);
    if (sets.length === 0) return { ok: true };
    sets.push("updated_at = now()");
    vals.push(projectId, companyId);
    await x(`UPDATE ${T.plans} SET ${sets.join(", ")} WHERE project_id = $${vals.length - 1} AND company_id = $${vals.length}`, vals);
    return { ok: true };
  });

  ctx.actions.register("update-task-costs", async (params) => {
    const companyId = requireString(params, "companyId");
    const issueId = requireString(params, "issueId");
    const p = (params.patch ?? {}) as Record<string, unknown>;
    const sets: string[] = []; const vals: unknown[] = [];
    const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ("plannedCost" in p) set("planned_cost", p.plannedCost == null || p.plannedCost === "" ? null : Math.max(0, num(p.plannedCost)));
    if ("actualCost" in p) set("actual_cost_manual", p.actualCost == null || p.actualCost === "" ? null : Math.max(0, num(p.actualCost)));
    if ("actualHours" in p) set("actual_hours", p.actualHours == null || p.actualHours === "" ? null : Math.max(0, num(p.actualHours)));
    if (sets.length === 0) return { ok: true };
    sets.push("updated_at = now()");
    vals.push(issueId, companyId);
    await x(`UPDATE ${T.tasks} SET ${sets.join(", ")} WHERE issue_id = $${vals.length - 1} AND company_id = $${vals.length}`, vals);
    return { ok: true };
  });

  ctx.actions.register("record-status", async (params) => {
    const companyId = requireString(params, "companyId");
    const projectId = requireString(params, "projectId");
    const e = await recordSnapshot(companyId, projectId);
    return { ok: true, metrics: e.metrics };
  });

  ctx.actions.register("generate-status-report", async (params, actionCtx) => {
    const companyId = requireString(params, "companyId");
    const projectId = requireString(params, "projectId");
    const who = await actorLabel(actionCtx.actor, companyId);
    return composeReport(companyId, projectId, who);
  });

  ctx.actions.register("send-status-report", async (params) => {
    const companyId = requireString(params, "companyId");
    const reportId = requireString(params, "reportId");
    const row = (await q(`SELECT * FROM ${tables.reports} WHERE id = $1 AND company_id = $2`, [reportId, companyId]))[0];
    if (!row) throw new Error("Report not found");
    const report = mapReport(row);
    const to = (Array.isArray(params.to) ? params.to : String(params.to ?? "").split(/[,;\s]+/)).map((s) => String(s).trim()).filter((s) => s.includes("@"));
    const project = await ctx.projects.get(String(row.project_id), companyId);
    const subject = `[${project?.name ?? "Project"}] Weekly status ${report.periodEnd} — ${report.rag.toUpperCase()}`;
    const result = await sendEmail(companyId, to, subject, report.contentMd);
    if (result.sent) await x(`UPDATE ${tables.reports} SET sent_to = $1::jsonb WHERE id = $2`, [JSON.stringify([...new Set([...report.sentTo, ...to])]), reportId]);
    return { ok: true, ...result, subject };
  });

  ctx.actions.register("nudge", async (params, actionCtx) => {
    const companyId = requireString(params, "companyId");
    const projectId = requireString(params, "projectId");
    const issueId = requireString(params, "issueId");
    const who = await actorLabel(actionCtx.actor, companyId);
    return nudge(companyId, projectId, issueId, typeof params.message === "string" ? params.message : null, who);
  });

  ctx.actions.register("nudge-all", async (params, actionCtx) => {
    const companyId = requireString(params, "companyId");
    const projectId = requireString(params, "projectId");
    const kinds = new Set((Array.isArray(params.kinds) ? params.kinds : ["overdue"]).map(String));
    const who = await actorLabel(actionCtx.actor, companyId);
    const plan = await buildPlan(companyId, projectId);
    const stakeholders = (await q(`SELECT * FROM ${tables.stakeholders} WHERE project_id = $1`, [projectId])).map(mapStakeholder);
    const targets = attentionList(plan, stakeholders).filter((a) => kinds.has(a.kind) && a.ownerKind !== "none");
    const results = [];
    for (const t of targets) results.push({ issueId: t.issueId, ...(await nudge(companyId, projectId, t.issueId, null, who).catch((err) => ({ channel: "error", error: String(err) }))) });
    return { ok: true, count: results.length, results };
  });

  const upsertSimple = (table: string, cols: string[]) => async (params: Record<string, unknown>) => {
    const companyId = requireString(params, "companyId");
    const projectId = requireString(params, "projectId");
    const item = (params.item ?? {}) as Record<string, unknown>;
    const id = typeof item.id === "string" && item.id ? item.id : randomUUID();
    const values = cols.map((c) => { const v = item[c]; return v === "" || v === undefined ? null : v; });
    const colNames = cols.map((c) => c.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`));
    const placeholders = cols.map((_, i) => `$${i + 4}`);
    const updates = colNames.map((c, i) => `${c} = $${i + 4}`);
    await x(`INSERT INTO ${table} (id, company_id, project_id, ${colNames.join(", ")}) VALUES ($1, $2, $3, ${placeholders.join(", ")}) ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`, [id, companyId, projectId, ...values]);
    return { ok: true, id };
  };
  const deleteSimple = (table: string) => async (params: Record<string, unknown>) => {
    const companyId = requireString(params, "companyId");
    const id = requireString(params, "id");
    await x(`DELETE FROM ${table} WHERE id = $1 AND company_id = $2`, [id, companyId]);
    return { ok: true };
  };
  ctx.actions.register("upsert-stakeholder", upsertSimple(tables.stakeholders, ["name", "role", "organization", "email", "userId", "agentId", "power", "interest", "channel", "frequency", "notes"]));
  ctx.actions.register("delete-stakeholder", deleteSimple(tables.stakeholders));
  ctx.actions.register("upsert-comm-item", upsertSimple(tables.comm, ["item", "audience", "channel", "frequency", "owner", "nextDue", "notes"]));
  ctx.actions.register("delete-comm-item", deleteSimple(tables.comm));
  ctx.actions.register("upsert-raid-item", async (params, actionCtx) => {
    const companyId = requireString(params, "companyId");
    const projectId = requireString(params, "projectId");
    const item = (params.item ?? {}) as Record<string, unknown>;
    const id = typeof item.id === "string" && item.id ? item.id : randomUUID();
    const who = await actorLabel(actionCtx.actor, companyId);
    const status = ["open", "monitoring", "closed"].includes(String(item.status)) ? String(item.status) : "open";
    await x(
      `INSERT INTO ${tables.raid} (id, company_id, project_id, kind, title, description, probability, impact, response, owner, status, due_date, issue_id, created_by, updated_at, closed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), $15) ON CONFLICT (id) DO UPDATE SET kind = $4, title = $5, description = $6, probability = $7, impact = $8, response = $9, owner = $10, status = $11, due_date = $12, issue_id = $13, updated_at = now(), closed_at = $15`,
      [id, companyId, projectId, ["risk", "assumption", "issue", "decision", "dependency"].includes(String(item.kind)) ? String(item.kind) : "risk", String(item.title ?? "Untitled").trim() || "Untitled", item.description ?? null, item.probability == null || item.probability === "" ? null : num(item.probability), item.impact == null || item.impact === "" ? null : num(item.impact), item.response ?? null, item.owner ?? null, status, item.dueDate ? String(item.dueDate).slice(0, 10) : null, item.issueId ?? null, who, status === "closed" ? new Date().toISOString() : null],
    );
    return { ok: true, id };
  });
  ctx.actions.register("delete-raid-item", deleteSimple(tables.raid));

  // ------------------------------------------------------------------ tools
  const toolDecl = (name: string) => ctx.manifest.tools!.find((t) => t.name === name)!;
  ctx.tools.register("pm_get_status", toolDecl("pm_get_status"), async (raw, run) => {
    const p = (raw ?? {}) as { projectId?: string };
    const projectId = p.projectId || run.projectId;
    if (!projectId) return { error: "No project in context. Pass projectId." };
    const plan = await buildPlan(run.companyId, projectId);
    const evm = await computeEvm(run.companyId, projectId, plan);
    const comms = await loadComms(run.companyId, projectId, plan, evm);
    const m = evm.metrics;
    const overdue = comms.attention.filter((a) => a.kind === "overdue");
    const risks = comms.raid.filter((r) => r.status !== "closed");
    return {
      content: `Project "${plan.project.name}": ${m.rag.toUpperCase()}${m.ragReasons.length ? ` (${m.ragReasons.join("; ")})` : ""}. Finish ${plan.summary.projectFinish} (baseline ${m.plannedFinish}, forecast ${m.forecastFinish}). SPI ${m.spi ?? "n/a"}, CPI ${m.cpi ?? "n/a"}, ${m.pctComplete}% earned vs ${m.pctPlanned}% planned, spent ${m.ac} of ${m.bac} ${evm.currency} (EAC ${m.eac}). Overdue: ${overdue.map((a) => `${a.identifier ?? ""} ${a.title} (${a.ownerName ?? "unassigned"}, ${a.daysLate}d)`).join("; ") || "none"}. Open RAID: ${risks.map((r) => `[${r.kind}] ${r.title}`).join("; ") || "none"}.`,
      data: { metrics: m, attention: comms.attention, raid: risks },
    };
  });
  ctx.tools.register("pm_log_raid_item", toolDecl("pm_log_raid_item"), async (raw, run) => {
    const p = (raw ?? {}) as { projectId?: string; kind?: string; title?: string; description?: string; probability?: number; impact?: number; response?: string };
    const projectId = p.projectId || run.projectId;
    if (!projectId) return { error: "No project in context. Pass projectId." };
    if (!p.title) return { error: "title is required" };
    const agent = await ctx.agents.get(run.agentId, run.companyId).catch(() => null);
    const id = randomUUID();
    await x(`INSERT INTO ${tables.raid} (id, company_id, project_id, kind, title, description, probability, impact, response, owner, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11)`, [id, run.companyId, projectId, ["risk", "assumption", "issue", "decision", "dependency"].includes(String(p.kind)) ? p.kind : "risk", p.title, p.description ?? null, p.probability ?? null, p.impact ?? null, p.response ?? null, agent?.name ?? null, agent?.name ?? "agent"]);
    return { content: `Logged ${p.kind ?? "risk"} "${p.title}" in the project RAID log.`, data: { id } };
  });
  ctx.tools.register("pm_log_hours", toolDecl("pm_log_hours"), async (raw, run) => {
    const p = (raw ?? {}) as { issueId?: string; hours?: number; note?: string };
    if (!p.issueId || p.hours == null) return { error: "issueId and hours are required" };
    const res = await x(`UPDATE ${T.tasks} SET actual_hours = COALESCE(actual_hours, 0) + $1, notes = CASE WHEN $2::text IS NULL THEN notes ELSE COALESCE(notes, '') || $2::text END, updated_at = now() WHERE issue_id = $3 AND company_id = $4`, [Math.max(0, Number(p.hours)), p.note ? `\n[hours] ${p.note}` : null, p.issueId, run.companyId]);
    if (res.rowCount === 0) return { error: "Task is not part of a project plan" };
    return { content: `Logged ${p.hours} hour(s).` };
  });

  // ------------------------------------------------------------------ jobs
  ctx.jobs.register("weekly-status", async () => {
    const companies = await ctx.companies.list({ limit: 100 });
    for (const c of companies) {
      const plans = await q(`SELECT project_id, auto_nudge, report_recipients FROM ${T.plans} WHERE company_id = $1`, [c.id]);
      for (const pl of plans) {
        const projectId = String(pl.project_id);
        try {
          const report = await composeReport(c.id, projectId, "weekly job");
          const to = String(pl.report_recipients ?? "").split(/[,;\s]+/).filter((s) => s.includes("@"));
          if (to.length) {
            const project = await ctx.projects.get(projectId, c.id);
            const r = await sendEmail(c.id, to, `[${project?.name ?? "Project"}] Weekly status ${report.periodEnd} — ${report.rag.toUpperCase()}`, report.contentMd);
            if (r.sent) await x(`UPDATE ${tables.reports} SET sent_to = $1::jsonb WHERE id = $2`, [JSON.stringify(to), report.id]);
          }
          if (pl.auto_nudge === true || pl.auto_nudge === "t") {
            const plan = await buildPlan(c.id, projectId);
            const stakeholders = (await q(`SELECT * FROM ${tables.stakeholders} WHERE project_id = $1`, [projectId])).map(mapStakeholder);
            for (const a of attentionList(plan, stakeholders).filter((k) => k.kind === "overdue" && k.ownerKind !== "none")) await nudge(c.id, projectId, a.issueId, null, "weekly job").catch(() => undefined);
          }
        } catch (err) { ctx.logger.warn("weekly-status failed", { projectId, error: String(err) }); }
      }
    }
  });

  return { computeEvm, recordSnapshot };
}

export type { Issue };
