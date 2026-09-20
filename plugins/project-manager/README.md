# Project Manager for Paperclip

Traditional project management on top of Paperclip issues: plan, schedule, assign work to humans and agents,
and see the critical path the way you would in MS Project.

## Concepts

- **Task** = a Paperclip issue in the project. Opening a project in the planner creates a schedule row for each
  issue (default 3 working days). New issues created by agents are added automatically.
- **Dependencies** — Finish-to-Start, Start-to-Start, Finish-to-Finish, Start-to-Finish with lag (working days).
  FS dependencies are mirrored to Paperclip's *blocked by* relations so agents see blockers natively.
- **Constraints** — As soon as possible, Start no earlier than, Must start on. Dragging a bar sets *Start no earlier than*.
- **Critical path** — computed with forward/backward passes on a working-day calendar; tasks with zero total float are red.
- **Baseline** — snapshot planned dates; the chart shows baseline bars and the KPI strip reports slippage.
- **Resources** — a pool of humans (optionally linked to Paperclip users) and agents (linked to Paperclip agents) with
  hours/day capacity and cost rate. Assigning the first resource to a task also sets the Paperclip assignee, which
  is what makes an agent actually pick the work up.
- **Allocation heatmap** — hours scheduled per resource per week vs capacity; over-allocation is red.
- **Resource leveling** — delays tasks (critical-first, serial method) so no resource exceeds capacity. Undo any time.
- **Calendar** — working days, hours per day and holidays per company.

## Views

| View | Contents |
| --- | --- |
| Gantt | Task table + timeline (day / week / month zoom), today line, weekend shading, dependency arrows, milestones, baseline bars. Drag to move, drag the right edge to resize, drag the ○ handle onto another task to link. |
| Critical path | The chain of critical tasks, and a table of early/late start/finish, total and free float. |
| Resources | Resource pool, weekly allocation heatmap, working calendar. |

Clicking a task opens the editor: dates, duration, effort, constraint, milestone, % complete, predecessors,
resource assignment, baseline variance, notes.

## Agent tools

| Tool | Purpose |
| --- | --- |
| `pm_get_schedule` | Full schedule for the current project with critical-path flags and float. |
| `pm_my_assignments` | Tasks scheduled for the calling agent, ordered by start date. |
| `pm_report_progress` | Record % complete on a task. |

## Automation

- `issue.updated` — issue marked *done* → 100 %; *in progress* → at least 10 %.
- `issue.created` — new issues in planned projects get a schedule row.
- Job `daily-health` (06:00) — recomputes every plan, logs projects that are behind baseline, stores a portfolio snapshot.

## Data

All plugin data lives in the plugin's private PostgreSQL schema (`plugin_pm_…`): `project_plans`, `task_schedule`,
`task_links`, `resources`, `assignments`, `calendars`. Paperclip issues are only updated for assignee, status/priority
edits you make explicitly, and mirrored blockers.
