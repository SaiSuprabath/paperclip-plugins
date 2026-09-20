import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest = {
  id: "suprabath.product-lifecycle",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Product Lifecycle",
  description:
    "Product management for Paperclip: lifecycle stages with gate reviews, sprint planning with capacity and burndown, and a change-management workflow (request → impact → approval → implementation) for humans and agents.",
  author: "Sai Suprabath Chadalavada <suprabath014@gmail.com>",
  categories: ["ui", "workspace"],
  capabilities: [
    "companies.read",
    "projects.read",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.create",
    "agents.read",
    "access.members.read",
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
  database: {
    namespaceSlug: "pl",
    migrationsDir: "migrations",
    coreReadTables: ["issues", "projects", "agents"],
  },
  jobs: [
    {
      jobKey: "burndown-snapshot",
      displayName: "Daily burndown snapshot",
      description: "Records remaining story points for every active sprint so burndown charts have a daily history.",
      schedule: "0 */6 * * *",
    },
  ],
  tools: [
    {
      name: "pl_get_active_sprint",
      displayName: "Get active sprint",
      description: "Returns the active sprint for a project: goal, dates, committed items with story points and status, and remaining points. Use it to know what is in scope right now.",
      parametersSchema: {
        type: "object",
        properties: { projectId: { type: "string", description: "Project UUID. Defaults to the project of the current issue." } },
      },
    },
    {
      name: "pl_submit_change_request",
      displayName: "Submit change request",
      description:
        "Files a formal change request (scope, schedule, budget, requirement or technical change) for review by the product owner. Use this instead of silently changing scope. Returns the change request id and status.",
      parametersSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project UUID. Defaults to the project of the current issue." },
          title: { type: "string" },
          description: { type: "string", description: "What should change and why." },
          type: { type: "string", enum: ["scope", "schedule", "budget", "requirement", "technical", "process"] },
          impact: { type: "string", enum: ["low", "medium", "high", "critical"] },
          impactAssessment: { type: "string", description: "Effect on scope, schedule, cost, quality, risk." },
          relatedIssueIds: { type: "array", items: { type: "string" } },
        },
        required: ["title", "description", "type", "impact"],
      },
    },
    {
      name: "pl_list_change_requests",
      displayName: "List change requests",
      description: "Lists change requests for a project, optionally filtered by status (draft, submitted, under_review, approved, rejected, implemented, withdrawn).",
      parametersSchema: {
        type: "object",
        properties: { projectId: { type: "string" }, status: { type: "string" } },
      },
    },
  ],
  ui: {
    slots: [
      { type: "sidebar", id: "pl-sidebar", displayName: "Product Lifecycle", exportName: "PlSidebarLink", order: 41 },
      { type: "page", id: "product-lifecycle", displayName: "Product Lifecycle", exportName: "ProductLifecyclePage", routePath: "product-lifecycle" },
      { type: "detailTab", id: "sprints", displayName: "Sprints & Changes", exportName: "ProjectSprintsTab", entityTypes: ["project"] },
      { type: "dashboardWidget", id: "pl-widget", displayName: "Sprint & change status", exportName: "PlDashboardWidget" },
    ],
  },
} satisfies PaperclipPluginManifestV1;

export default manifest;
