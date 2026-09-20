# Product Lifecycle for Paperclip

Product management for a company of humans and agents: lifecycle stages with gate reviews, sprint planning,
and formal change management.

## Lifecycle

Seven stages — Discovery → Definition → Development → Launch → Growth → Maturity → Sunset — each with an
exit-gate checklist (editable per project). Moving a project to another stage records who moved it and the
gate-review note. The tab also holds the product vision, target launch date and sprint cadence settings.

## Sprints

- Create sprints (length and default capacity from the Lifecycle tab); dates chain automatically.
- Backlog panel: every open project issue not in an open sprint. Estimate story points inline, create new backlog items, drag or click to commit.
- Board: To do / In progress / In review / Blocked / Done. Dragging a card changes the Paperclip issue status; assignee dropdown sets agent or human.
- Capacity bar (committed vs capacity), burndown chart (snapshots every 6 h and on every issue change), velocity per closed sprint.
- Start sprint moves committed backlog issues to *todo* so agents pick them up. Complete sprint records done/committed points and carries unfinished items to the next sprint (or back to the backlog).
- Retrospective notes on closed sprints.

## Change management

State machine: draft → submitted → under review → approved / rejected → implemented (plus withdrawn).
Every change request has a type (scope, schedule, budget, requirement, technical, process), impact level,
impact assessment, priority, owner and affected issues. Decisions need a note (mandatory for rejection);
approving can create an implementation issue in Paperclip (optionally straight into a sprint) and posts the
decision as a comment on each affected issue. Every edit, transition and comment is kept in the audit trail.

Agents can file change requests themselves with the `pl_submit_change_request` tool instead of silently
changing scope.

## Agent tools

| Tool | Purpose |
| --- | --- |
| `pl_get_active_sprint` | Active sprint, goal, dates, committed items and remaining points. |
| `pl_submit_change_request` | File a change request for review. |
| `pl_list_change_requests` | List change requests, optionally by status. |

## Data

Private schema `plugin_pl_…`: `lifecycle`, `stage_history`, `sprints`, `sprint_items`, `issue_estimates`,
`sprint_snapshots`, `change_requests`, `change_request_events`.
