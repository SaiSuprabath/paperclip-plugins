# Paperclip plugins: Project Manager & Product Lifecycle

Two plugins for [Paperclip](https://github.com/paperclipai/paperclip) that bring traditional
project-management and product-management practice to a company run by humans **and** AI agents.

| Plugin | Package | What it adds |
| --- | --- | --- |
| **Project Manager** | `plugins/project-manager` | Gantt chart, task dependencies (FS/SS/FF/SF with lag), critical-path method (early/late dates, total & free float), baselines and slippage, working calendar, resource pool of humans and agents, weekly allocation heatmap, resource leveling, agent tools. |
| **Product Lifecycle** | `plugins/product-lifecycle` | Product lifecycle stages with exit-gate checklists, sprint planning (backlog → sprint, capacity, story points, drag-and-drop board, burndown, velocity, retrospectives) and a change-management workflow (request → impact assessment → review → approve/reject → implementation issue) with a full audit trail. |

Both plugins work on top of Paperclip's own issues, projects, agents and members: tasks and backlog
items **are** Paperclip issues, so assigning a task to an agent wakes that agent through the normal
Paperclip heartbeat, and status changes made by agents flow back into the Gantt chart and sprint board.

## Requirements

- Node.js 20+ and [pnpm](https://pnpm.io)
- A running Paperclip instance (`npx paperclipai run`) — tested against Paperclip `2026.722.0`

## Install into any Paperclip company

```bash
git clone https://github.com/<you>/paperclip-plugins.git
cd paperclip-plugins
pnpm install
pnpm build

# with Paperclip running locally (default http://localhost:3100)
npx paperclipai plugin install "$PWD/plugins/project-manager" --local
npx paperclipai plugin install "$PWD/plugins/product-lifecycle" --local
```

Plugins are installed per Paperclip *instance* and are visible in every company on that instance.
If Paperclip runs elsewhere, add `--api-base https://your-paperclip.example` to the install commands.

After installing you get:

- Sidebar entries **Project Manager** and **Product Lifecycle**
- A **Schedule** tab and a **Sprints & Changes** tab on every project page
- Two dashboard widgets (portfolio schedule health; sprint & change status)
- Agent tools that agents can call from their runs:
  - `pm_get_schedule`, `pm_my_assignments`, `pm_report_progress`
  - `pl_get_active_sprint`, `pl_submit_change_request`, `pl_list_change_requests`

Upgrade later with `git pull && pnpm build && npx paperclipai plugin upgrade <pluginId>` (find the id with
`npx paperclipai plugin list`). Uninstall with `npx paperclipai plugin uninstall suprabath.project-manager`.

## Development

```bash
pnpm install
pnpm --filter paperclip-plugin-project-manager dev     # rebuilds dist/ on change; Paperclip reloads the worker
pnpm --filter paperclip-plugin-product-lifecycle dev
pnpm test        # unit tests (CPM engine, change-request state machine)
pnpm typecheck
```

Each plugin has the same layout:

```
plugins/<name>/
  package.json        paperclipPlugin.manifest/worker/ui entrypoints
  build.mjs           esbuild: dist/worker.js (node), dist/manifest.js, dist/ui/index.js (browser)
  migrations/*.sql    plugin-private PostgreSQL schema (host-managed, fully qualified names)
  src/manifest.ts     capabilities, jobs, tools, UI slots
  src/worker.ts       data providers, actions, agent tools, events, jobs
  src/shared/         pure logic shared by worker and UI (e.g. the CPM engine)
  src/ui/             React components mounted into Paperclip UI slots
```

See each plugin's README for a feature walkthrough.

## Publishing to npm (optional)

Local-path installs are the development workflow. For deployed Paperclip instances, publish each plugin
as an npm package (`npm publish` inside `plugins/<name>`) and install with
`npx paperclipai plugin install paperclip-plugin-project-manager`.

## License

MIT
