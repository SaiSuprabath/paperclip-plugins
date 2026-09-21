import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest = {
  id: "suprabath.project-manager",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Project Manager",
  description:
    "Traditional project management for Paperclip: Gantt charts, task dependencies, critical path (CPM), baselines and resource planning across humans and AI agents.",
  author: "Sai Suprabath Chadalavada <suprabath014@gmail.com>",
  categories: ["ui", "workspace"],
  capabilities: [
    "companies.read",
    "projects.read",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.relations.read",
    "issue.relations.write",
    "agents.read",
    "access.members.read",
    "costs.read",
    "issues.orchestration.read",
    "issues.wakeup",
    "issue.comments.create",
    "http.outbound",
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "plugin.state.read",
    "plugin.state.write",
    "events.subscribe",
    "jobs.schedule",
    "agent.tools.register",
    "activity.log.write",
    "ui.sidebar.register",
    "ui.page.register",
    "ui.detailTab.register",
    "ui.dashboardWidget.register",
  ],
  entrypoints: {
    worker: "dist/worker.js",
    ui: "dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    title: "Project Manager settings",
    properties: {
      emailProvider: { type: "string", title: "Email provider", description: "How status reports and nudges are emailed. 'mailto' opens your mail client with a pre-filled draft; 'resend' sends through the Resend HTTP API.", enum: ["mailto", "resend"], default: "mailto" },
      resendApiKey: { type: "string", title: "Resend API key", description: "Required when emailProvider is 'resend'." },
      fromAddress: { type: "string", title: "From address", description: "Sender for outgoing email, e.g. pmo@example.com (must be a verified Resend domain)." },
    },
  },
  database: {
    namespaceSlug: "pm",
    migrationsDir: "migrations",
    coreReadTables: ["issues", "projects", "agents"],
  },
  jobs: [
    {
      jobKey: "weekly-status",
      displayName: "Weekly status report",
      description: "Every Monday 08:00: records the earned-value snapshot, generates the weekly status report for each planned project, emails it to the configured recipients and nudges owners of overdue tasks when auto-nudge is on.",
      schedule: "0 8 * * 1",
    },
    {
      jobKey: "daily-health",
      displayName: "Daily schedule health",
      description: "Recomputes every project plan, records slippage against baseline and stores a portfolio summary.",
      schedule: "0 6 * * *",
    },
  ],
  tools: [
    {
      name: "pm_get_status",
      displayName: "Get project status (EVM)",
      description: "Returns the project's RAG status, schedule and cost performance (SPI, CPI, EAC, forecast finish), open risks/issues and overdue tasks. Use it before reporting progress or when asked how the project is doing.",
      parametersSchema: { type: "object", properties: { projectId: { type: "string", description: "Project UUID. Defaults to the current issue's project." } } },
    },
    {
      name: "pm_log_raid_item",
      displayName: "Log a risk / issue / assumption / decision",
      description: "Adds an entry to the project RAID log so the project manager sees it in the communications dashboard and status report. Use it whenever you discover a risk, hit a blocker, rely on an assumption or make a notable decision.",
      parametersSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          kind: { type: "string", enum: ["risk", "assumption", "issue", "decision", "dependency"] },
          title: { type: "string" },
          description: { type: "string" },
          probability: { type: "integer", minimum: 1, maximum: 5, description: "Risks only: 1 (rare) to 5 (almost certain)." },
          impact: { type: "integer", minimum: 1, maximum: 5, description: "1 (negligible) to 5 (severe)." },
          response: { type: "string", description: "Mitigation / response plan." },
        },
        required: ["kind", "title"],
      },
    },
    {
      name: "pm_log_hours",
      displayName: "Log actual hours on a task",
      description: "Records actual hours worked on a scheduled task (adds to the running total) so actual cost and earned value stay accurate.",
      parametersSchema: { type: "object", properties: { issueId: { type: "string" }, hours: { type: "number", minimum: 0 }, note: { type: "string" } }, required: ["issueId", "hours"] },
    },
    {
      name: "pm_get_schedule",
      displayName: "Get project schedule",
      description:
        "Returns the current project schedule (tasks with planned start/finish dates, duration, % complete, predecessors, assigned resource and whether the task is on the critical path). Use it to understand deadlines and sequencing before starting work.",
      parametersSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project UUID. Defaults to the project of the current issue." },
          onlyCritical: { type: "boolean", description: "Return only critical-path tasks." },
        },
      },
    },
    {
      name: "pm_my_assignments",
      displayName: "My scheduled assignments",
      description: "Lists the tasks scheduled for the calling agent, ordered by planned start date, with float and critical-path flags.",
      parametersSchema: { type: "object", properties: {} },
    },
    {
      name: "pm_report_progress",
      displayName: "Report task progress",
      description: "Records percent complete (0-100) on a scheduled task and an optional note. Use when you finish part of a task so the Gantt chart and critical path stay accurate.",
      parametersSchema: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "Issue UUID of the task." },
          percentComplete: { type: "integer", minimum: 0, maximum: 100 },
          note: { type: "string" },
        },
        required: ["issueId", "percentComplete"],
      },
    },
  ],
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "pm-sidebar",
        displayName: "Project Manager",
        exportName: "PmSidebarLink",
        order: 40,
      },
      {
        type: "page",
        id: "project-manager",
        displayName: "Project Manager",
        exportName: "ProjectManagerPage",
        routePath: "project-manager",
      },
      {
        type: "detailTab",
        id: "schedule",
        displayName: "Schedule",
        exportName: "ProjectScheduleTab",
        entityTypes: ["project"],
      },
      {
        type: "dashboardWidget",
        id: "pm-portfolio",
        displayName: "Portfolio health",
        exportName: "PmDashboardWidget",
      },
    ],
  },
} satisfies PaperclipPluginManifestV1;

export default manifest;
