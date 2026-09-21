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

## Views (MS Project layout)

| View | Contents |
| --- | --- |
| Gantt Chart | Left: editable task grid with ID, Task Name, Duration, Start, Finish, Predecessors, Resource Names, % Complete and an indicator column. Right: timescale (day / week / month), blue task bars with progress line, red critical bars, black summary bars, milestone diamonds, baseline bars, dependency arrows, today line. |
| Critical Path | The chain of critical tasks, and a table of early/late start/finish, total and free float. |
| Resource Sheet | Editable sheet: Resource Name, Type (Human / AI agent), Paperclip identity, Initials, Group, Max Units, Hours/Day, Std Rate, Ovt Rate, Role, Active. Type a name in the last row to add. |
| Resource Usage | Weekly hours per resource vs capacity, working calendar. |

Editing works the way it does in MS Project:

- **Click a cell** to edit in place (Enter commits, Esc cancels). Task Name renames the Paperclip issue.
- **Duration** accepts `3`, `3d`, `3 days`; `0` turns the task into a milestone. Editing **Finish** recalculates duration.
- **Predecessors** use ID notation: `2`, `2FS+1d`, `3SS`, `5FF-2d`, comma separated.
- **Resource Names** accepts `Name, Name[50%]`; unknown names create a new human resource, agent names link to the Paperclip agent.
- **Outline**: right-click → Indent / Outdent (or Alt+Tab / Alt+Shift+Tab). A task with subtasks becomes a summary task with rolled-up dates, duration and % complete; links on a summary apply to all of its subtasks.
- **Right-click** a row for Insert task above/below, Insert milestone, Mark as milestone, Task information, Delete task. `Insert` and `Delete` keys work too. The last row ("Click to add a new task…") appends.
- **Click a dependency arrow** to change its type (FS/SS/FF/SF) and lag, or delete it. Drag the ○ handle under a bar onto another task to create an FS link.
- **Enter** or double-click opens Task Information (constraint type, effort, notes, baseline variance, full predecessor and resource lists).

Deleting a task removes it from the plan and cancels the Paperclip issue (the plugin SDK cannot hard-delete issues).

## Iteration 2: the PM office

| View | What a project manager gets |
| --- | --- |
| S-Curve & Budget | Earned value management: BAC, PV, EV, AC, SV, CV, SPI, CPI, EAC, ETC, VAC, TCPI, forecast finish and an automatic RAG status. The S-curve plots cumulative planned value against earned value and actual cost with weekly snapshots (recorded daily by the health job, every Monday by the status job, or on demand). Planned cost comes from resource rates × hours (override per task); actual cost = logged hours × rate + the AI agent spend Paperclip already tracks per issue. Budget, currency, status date, sponsor, PM and RAG override are editable. |
| Communications › Dashboard | Health tiles, the **nudge center** (overdue / blocked / due soon / not started / unassigned tasks with their owner), upcoming milestones, top risks, recent nudges. **Nudge** posts a comment on the issue and wakes the agent (or emails the human); **Nudge all overdue** does it in bulk. |
| Communications › Status reports | One click (or every Monday 08:00) generates the weekly status report: RAG, schedule and budget tables (EVM), accomplished this week, planned next week, milestones, attention items, RAID summary and decisions needed. Copy as Markdown or **Email report** to the recipients list. |
| Communications › Stakeholders | Stakeholder register (role, organisation, email, Paperclip identity, power, interest, channel, frequency) and the power/interest grid. |
| Communications › Comm plan | Communication plan matrix: what, audience, channel, frequency, owner, next due (overdue rows highlighted). |
| Communications › RAID log | Risks, assumptions, issues, decisions, dependencies with probability × impact scoring, response, owner, status and due date. Agents can add entries with `pm_log_raid_item`. |

Email: by default the plugin opens a pre-filled draft in your mail client (`mailto:`). To send automatically, open the plugin settings in Paperclip and set `emailProvider` to `resend`, add a Resend API key and a verified from-address; the weekly job then emails reports to the recipients list and nudges human owners directly.

## Agent tools

| Tool | Purpose |
| --- | --- |
| `pm_get_schedule` | Full schedule for the current project with critical-path flags and float. |
| `pm_my_assignments` | Tasks scheduled for the calling agent, ordered by start date. |
| `pm_report_progress` | Record % complete on a task. |
| `pm_get_status` | RAG, SPI/CPI, forecast, overdue tasks and open RAID items for the project. |
| `pm_log_raid_item` | Add a risk, assumption, issue, decision or dependency to the RAID log. |
| `pm_log_hours` | Log actual hours on a task (feeds actual cost). |

## Automation

- `issue.updated` — issue marked *done* → 100 %; *in progress* → at least 10 %.
- `issue.created` — new issues in planned projects get a schedule row.
- Job `daily-health` (06:00) — recomputes every plan, records the earned-value snapshot, logs projects that are behind baseline, stores a portfolio snapshot.
- Job `weekly-status` (Monday 08:00) — generates the weekly status report per project, emails it to the recipients list when email is configured, and nudges owners of overdue tasks when auto-nudge is on.

## Data

All plugin data lives in the plugin's private PostgreSQL schema (`plugin_pm_…`): `project_plans`, `task_schedule`,
`task_links`, `resources`, `assignments`, `calendars`. Paperclip issues are only updated for assignee, status/priority
edits you make explicitly, and mirrored blockers.
