import { useMemo, useState, type DragEvent } from "react";
import type { IssueLite, ProjectOverview, Sprint } from "../shared/types.js";
import { fmtDate } from "./util.js";

const COLUMNS: { key: string; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "in_review", label: "In review" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

export interface SprintsProps {
  o: ProjectOverview;
  busy: boolean;
  issueHref(identifier: string | null): string | null;
  onCreateSprint(input: { name?: string; goal?: string; startDate?: string; endDate?: string; capacityPoints?: number }): Promise<unknown>;
  onUpdateSprint(sprintId: string, patch: Record<string, unknown>): Promise<unknown>;
  onDeleteSprint(sprintId: string): Promise<unknown>;
  onStart(sprintId: string): Promise<unknown>;
  onComplete(sprintId: string, carryOver: "next" | "backlog"): Promise<unknown>;
  onAdd(sprintId: string, issueId: string, storyPoints?: number | null): Promise<unknown>;
  onRemove(sprintId: string, issueId: string): Promise<unknown>;
  onSetPoints(issueId: string, pts: number | null): Promise<unknown>;
  onSetStatus(issueId: string, status: string): Promise<unknown>;
  onAssign(issueId: string, assigneeAgentId: string | null, assigneeUserId: string | null): Promise<unknown>;
  onCreateIssue(input: { title: string; storyPoints?: number | null; sprintId?: string | null; priority?: string }): Promise<unknown>;
}

export function SprintsView(p: SprintsProps) {
  const { o } = p;
  const [selectedId, setSelectedId] = useState<string | null>(o.activeSprint?.id ?? o.sprints.find((s) => s.status === "planning")?.id ?? o.sprints.at(-1)?.id ?? null);
  const sprint = o.sprints.find((s) => s.id === selectedId) ?? o.activeSprint ?? o.sprints[0] ?? null;
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newPts, setNewPts] = useState("");
  const [search, setSearch] = useState("");

  const issueById = useMemo(() => new Map(o.issues.map((i) => [i.id, i])), [o.issues]);
  const openSprintIssueIds = useMemo(() => new Set(o.items.filter((it) => o.sprints.find((s) => s.id === it.sprintId)?.status !== "closed").map((it) => it.issueId)), [o.items, o.sprints]);
  const items = sprint ? o.items.filter((it) => it.sprintId === sprint.id) : [];
  const committed = items.reduce((a, it) => a + (it.storyPoints ?? 0), 0);
  const donePts = items.filter((it) => issueById.get(it.issueId)?.status === "done").reduce((a, it) => a + (it.storyPoints ?? 0), 0);
  const backlog = o.issues.filter((i) => !openSprintIssueIds.has(i.id) && !["done", "cancelled"].includes(i.status) && (!search || i.title.toLowerCase().includes(search.toLowerCase()) || (i.identifier ?? "").toLowerCase().includes(search.toLowerCase())));
  const whoName = (i: IssueLite) => (i.assigneeAgentId ? `🤖 ${o.agents.find((a) => a.id === i.assigneeAgentId)?.name ?? "agent"}` : i.assigneeUserId ? `👤 ${o.humans.find((h) => h.id === i.assigneeUserId)?.name ?? "user"}` : "");

  const onDrop = async (e: DragEvent, status: string) => {
    e.preventDefault();
    setDropCol(null);
    const issueId = e.dataTransfer.getData("text/issue-id");
    const from = e.dataTransfer.getData("text/from");
    if (!issueId || !sprint) return;
    if (from === "backlog") await p.onAdd(sprint.id, issueId);
    const cur = issueById.get(issueId);
    if (cur && cur.status !== status) await p.onSetStatus(issueId, status);
  };

  return (
    <div className="pl-split">
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, overflow: "auto" }}>
        <button className="pl-btn pl-primary" disabled={p.busy} onClick={() => p.onCreateSprint({})}>+ New sprint</button>
        {o.sprints.length === 0 && <div className="pl-empty">No sprints yet.</div>}
        {[...o.sprints].reverse().map((s) => {
          const its = o.items.filter((it) => it.sprintId === s.id);
          const pts = its.reduce((a, it) => a + (it.storyPoints ?? 0), 0);
          return (
            <div key={s.id} className={`pl-sprint-item ${sprint?.id === s.id ? "pl-selected" : ""}`} onClick={() => setSelectedId(s.id)}>
              <div className="pl-sprint-name"><span>{s.name}</span><span className={`pl-chip ${s.status === "active" ? "pl-ok" : s.status === "closed" ? "" : "pl-warn"}`}>{s.status}</span></div>
              <div className="pl-sub pl-mono">{fmtDate(s.startDate)} → {fmtDate(s.endDate)} · {its.length} items · {pts}/{s.capacityPoints}pt</div>
              {s.goal && <div className="pl-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.goal}</div>}
            </div>
          );
        })}
        {o.velocity.length > 0 && (
          <div className="pl-card">
            <div className="pl-card-head">Velocity <span className="pl-sub">done / committed</span></div>
            <Velocity data={o.velocity} />
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}>
        {!sprint && <div className="pl-empty">Create a sprint to start planning. Sprint length and default capacity come from the Lifecycle tab.</div>}
        {sprint && (
          <>
            <div className="pl-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="pl-row" style={{ flexWrap: "wrap" }}>
                <input className="pl-input" style={{ fontWeight: 600, fontSize: 15, width: 200 }} key={sprint.id + sprint.name} defaultValue={sprint.name} disabled={sprint.status === "closed"} onBlur={(e) => e.target.value.trim() && e.target.value !== sprint.name && p.onUpdateSprint(sprint.id, { name: e.target.value })} />
                <span className={`pl-chip ${sprint.status === "active" ? "pl-ok" : sprint.status === "closed" ? "" : "pl-warn"}`}>{sprint.status}</span>
                <input className="pl-input" type="date" key={`s${sprint.id}${sprint.startDate}`} defaultValue={sprint.startDate} disabled={sprint.status === "closed"} onBlur={(e) => e.target.value && e.target.value !== sprint.startDate && p.onUpdateSprint(sprint.id, { startDate: e.target.value })} />
                <span className="pl-sub">→</span>
                <input className="pl-input" type="date" key={`e${sprint.id}${sprint.endDate}`} defaultValue={sprint.endDate} disabled={sprint.status === "closed"} onBlur={(e) => e.target.value && e.target.value !== sprint.endDate && p.onUpdateSprint(sprint.id, { endDate: e.target.value })} />
                <label className="pl-row pl-sub">Capacity <input className="pl-input" type="number" min={0} key={`c${sprint.id}${sprint.capacityPoints}`} defaultValue={sprint.capacityPoints} disabled={sprint.status === "closed"} onBlur={(e) => Number(e.target.value) !== sprint.capacityPoints && p.onUpdateSprint(sprint.id, { capacityPoints: Number(e.target.value) })} /> pt</label>
                <span className="pl-spacer" style={{ flex: 1 }} />
                {sprint.status === "planning" && <button className="pl-btn pl-primary" disabled={p.busy || items.length === 0} onClick={() => p.onStart(sprint.id)} title={items.length === 0 ? "Add items first" : "Start this sprint"}>Start sprint</button>}
                {sprint.status === "planning" && <button className="pl-btn pl-danger" disabled={p.busy} onClick={() => confirm("Delete this sprint? Items return to the backlog.") && p.onDeleteSprint(sprint.id)}>Delete</button>}
                {sprint.status === "active" && <button className="pl-btn pl-primary" disabled={p.busy} onClick={() => { const carry = confirm("Complete sprint. OK = carry unfinished items to the next sprint, Cancel = return them to the backlog."); void p.onComplete(sprint.id, carry ? "next" : "backlog"); }}>Complete sprint</button>}
              </div>
              <input className="pl-input" style={{ width: "100%" }} placeholder="Sprint goal — the one outcome this sprint must deliver" key={`g${sprint.id}${sprint.goal ?? ""}`} defaultValue={sprint.goal ?? ""} disabled={sprint.status === "closed"} onBlur={(e) => e.target.value !== (sprint.goal ?? "") && p.onUpdateSprint(sprint.id, { goal: e.target.value })} />
              <div className="pl-row">
                <div className="pl-capbar" style={{ flex: 1 }}><i className={committed > sprint.capacityPoints ? "pl-over" : ""} style={{ width: `${Math.min(100, sprint.capacityPoints ? (committed / sprint.capacityPoints) * 100 : 0)}%` }} /></div>
                <span className="pl-sub pl-mono">{committed}/{sprint.capacityPoints} pt committed · {donePts} done · {items.filter((it) => it.storyPoints == null).length} unestimated{committed > sprint.capacityPoints ? " · over capacity" : ""}</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 10, minHeight: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div className="pl-board">
                  {COLUMNS.map((c) => {
                    const cards = items.map((it) => ({ it, issue: issueById.get(it.issueId) })).filter((k) => k.issue && (k.issue.status === c.key || (c.key === "todo" && k.issue.status === "backlog")));
                    return (
                      <div key={c.key} className={`pl-col ${dropCol === c.key ? "pl-drop" : ""}`} onDragOver={(e) => { e.preventDefault(); setDropCol(c.key); }} onDragLeave={() => setDropCol(null)} onDrop={(e) => onDrop(e, c.key)}>
                        <div className="pl-col-head"><span>{c.label}</span><span>{cards.reduce((a, k) => a + (k.it.storyPoints ?? 0), 0)}pt · {cards.length}</span></div>
                        <div className="pl-col-body">
                          {cards.map(({ it, issue }) => (
                            <div key={it.id} className="pl-cardx" draggable={sprint.status !== "closed"} onDragStart={(e) => { e.dataTransfer.setData("text/issue-id", it.issueId); e.dataTransfer.setData("text/from", "sprint"); }}>
                              <div className="pl-cardx-title"><span className="pl-task-id">{issue!.identifier}</span>{issue!.title}</div>
                              <div className="pl-cardx-meta">
                                <span className="pl-pts" title="Story points"><input type="number" min={0} key={`${it.id}${it.storyPoints ?? ""}`} defaultValue={it.storyPoints ?? ""} placeholder="?" onBlur={(e) => (e.target.value === "" ? null : Number(e.target.value)) !== it.storyPoints && p.onSetPoints(it.issueId, e.target.value === "" ? null : Number(e.target.value))} /></span>
                                <span className={`pl-chip ${issue!.priority === "critical" || issue!.priority === "high" ? "pl-crit" : ""}`}>{issue!.priority}</span>
                                {it.carriedFromSprintId && <span className="pl-chip pl-warn" title="Carried over from a previous sprint">↻</span>}
                                <select className="pl-select" style={{ height: 22, fontSize: 11, maxWidth: 130 }} value={issue!.assigneeAgentId ?? (issue!.assigneeUserId ? `u:${issue!.assigneeUserId}` : "")} onChange={(e) => { const v = e.target.value; void p.onAssign(it.issueId, v && !v.startsWith("u:") ? v : null, v.startsWith("u:") ? v.slice(2) : null); }}>
                                  <option value="">unassigned</option>
                                  <optgroup label="Agents">{o.agents.map((a) => <option key={a.id} value={a.id}>🤖 {a.name}</option>)}</optgroup>
                                  <optgroup label="People">{o.humans.map((h) => <option key={h.id} value={`u:${h.id}`}>👤 {h.name}</option>)}</optgroup>
                                </select>
                                <span style={{ flex: 1 }} />
                                {p.issueHref(issue!.identifier) && <a href={p.issueHref(issue!.identifier)!} target="_blank" rel="noreferrer" className="pl-sub">↗</a>}
                                {sprint.status !== "closed" && <button className="pl-chip" style={{ cursor: "pointer" }} title="Remove from sprint" onClick={() => p.onRemove(sprint.id, it.issueId)}>✕</button>}
                              </div>
                            </div>
                          ))}
                          {cards.length === 0 && <div className="pl-sub" style={{ textAlign: "center", padding: 12 }}>drop here</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="pl-card">
                  <div className="pl-card-head">Burndown <span className="pl-sub">remaining story points vs ideal</span></div>
                  <Burndown sprint={sprint} snapshots={o.snapshots[sprint.id] ?? []} committed={committed} remaining={Math.max(0, committed - donePts)} today={o.today} />
                </div>
                {(sprint.status === "closed" || sprint.status === "review") && (
                  <div className="pl-card">
                    <div className="pl-card-head">Retrospective</div>
                    <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      {(["wentWell", "improve", "actions"] as const).map((k) => (
                        <label key={k} className="pl-field"><span className="pl-sub">{k === "wentWell" ? "What went well" : k === "improve" ? "What to improve" : "Action items"}</span>
                          <textarea className="pl-textarea" key={`${sprint.id}${k}${sprint.retro[k] ?? ""}`} defaultValue={sprint.retro[k] ?? ""} onBlur={(e) => e.target.value !== (sprint.retro[k] ?? "") && p.onUpdateSprint(sprint.id, { retro: { [k]: e.target.value } })} />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="pl-backlog">
                <div className="pl-card-head">Backlog <span className="pl-sub">{backlog.length}</span></div>
                <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px solid var(--border)" }}>
                  <input className="pl-input" placeholder="Filter backlog…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <div className="pl-row">
                    <input className="pl-input" style={{ flex: 1 }} placeholder="New backlog item" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && newTitle.trim()) { await p.onCreateIssue({ title: newTitle.trim(), storyPoints: newPts === "" ? null : Number(newPts) }); setNewTitle(""); setNewPts(""); } }} />
                    <input className="pl-input" type="number" style={{ width: 60 }} placeholder="pt" value={newPts} onChange={(e) => setNewPts(e.target.value)} />
                    <button className="pl-btn" disabled={!newTitle.trim() || p.busy} onClick={async () => { await p.onCreateIssue({ title: newTitle.trim(), storyPoints: newPts === "" ? null : Number(newPts) }); setNewTitle(""); setNewPts(""); }}>Add</button>
                  </div>
                </div>
                <div className="pl-backlog-list">
                  {backlog.map((i) => (
                    <div key={i.id} className="pl-backlog-row" draggable={sprint.status !== "closed"} onDragStart={(e) => { e.dataTransfer.setData("text/issue-id", i.id); e.dataTransfer.setData("text/from", "backlog"); }} title={whoName(i)}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span className="pl-task-id">{i.identifier}</span>{i.title}</span>
                      <span className="pl-pts"><input type="number" min={0} key={`${i.id}${i.storyPoints ?? ""}`} defaultValue={i.storyPoints ?? ""} placeholder="?" onBlur={(e) => (e.target.value === "" ? null : Number(e.target.value)) !== i.storyPoints && p.onSetPoints(i.id, e.target.value === "" ? null : Number(e.target.value))} /></span>
                      <span className={`pl-chip ${i.priority === "critical" || i.priority === "high" ? "pl-crit" : ""}`}>{i.priority}</span>
                      <button className="pl-btn" style={{ height: 24 }} disabled={p.busy || sprint.status === "closed"} onClick={() => p.onAdd(sprint.id, i.id)} title="Add to sprint">←</button>
                    </div>
                  ))}
                  {backlog.length === 0 && <div className="pl-sub" style={{ padding: 16, textAlign: "center" }}>Backlog is empty.</div>}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Burndown({ sprint, snapshots, committed, remaining, today }: { sprint: Sprint; snapshots: { date: string; remaining: number }[]; committed: number; remaining: number; today: string }) {
  const W = 640, H = 200, PAD = 32;
  const days = Math.max(1, Math.round((Date.parse(sprint.endDate) - Date.parse(sprint.startDate)) / 86_400_000));
  const maxY = Math.max(committed, ...snapshots.map((s) => s.remaining), 1);
  const xFor = (iso: string) => PAD + Math.min(days, Math.max(0, (Date.parse(iso) - Date.parse(sprint.startDate)) / 86_400_000)) * ((W - PAD * 2) / days);
  const yFor = (v: number) => H - PAD + 8 - (v / maxY) * (H - PAD * 2);
  const pts = [...snapshots.map((s) => ({ x: xFor(s.date), y: yFor(s.remaining) }))];
  if (sprint.status === "active" && (snapshots.length === 0 || snapshots.at(-1)!.date !== today)) pts.push({ x: xFor(today), y: yFor(remaining) });
  const actual = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg className="pl-burndown" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={PAD} x2={W - PAD} y1={yFor(maxY * f)} y2={yFor(maxY * f)} stroke="var(--border)" />
          <text x={PAD - 6} y={yFor(maxY * f) + 3} fontSize={10} textAnchor="end" fill="var(--muted-foreground)">{Math.round(maxY * f)}</text>
        </g>
      ))}
      <line x1={xFor(sprint.startDate)} y1={yFor(committed)} x2={xFor(sprint.endDate)} y2={yFor(0)} stroke="var(--muted-foreground)" strokeDasharray="5 4" />
      {actual && <path d={actual} fill="none" stroke="var(--pl-bar)" strokeWidth={2.2} />}
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill="var(--pl-bar)" />)}
      {today >= sprint.startDate && today <= sprint.endDate && <line x1={xFor(today)} x2={xFor(today)} y1={PAD - 10} y2={H - PAD + 8} stroke="var(--pl-today)" strokeDasharray="3 3" />}
      <text x={PAD} y={H - 6} fontSize={10} fill="var(--muted-foreground)">{fmtDate(sprint.startDate)}</text>
      <text x={W - PAD} y={H - 6} fontSize={10} textAnchor="end" fill="var(--muted-foreground)">{fmtDate(sprint.endDate)}</text>
      {snapshots.length === 0 && sprint.status !== "active" && <text x={W / 2} y={H / 2} fontSize={11} textAnchor="middle" fill="var(--muted-foreground)">Burndown starts when the sprint is active</text>}
    </svg>
  );
}

function Velocity({ data }: { data: { name: string; committed: number; done: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.committed));
  const avg = data.length ? Math.round(data.reduce((a, d) => a + d.done, 0) / data.length) : 0;
  return (
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      {data.slice(-6).map((d) => (
        <div key={d.name} className="pl-row" title={`${d.done} of ${d.committed} points`}>
          <span className="pl-sub" style={{ width: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
          <div className="pl-capbar" style={{ flex: 1, height: 10 }}><i style={{ width: `${(d.committed / max) * 100}%`, background: "var(--muted-foreground)", opacity: 0.35 }} /><i style={{ width: `${(d.done / max) * 100}%`, marginTop: -10 }} /></div>
          <span className="pl-sub pl-mono" style={{ width: 52, textAlign: "right" }}>{d.done}/{d.committed}</span>
        </div>
      ))}
      <div className="pl-sub">Average velocity: <strong>{avg} pt</strong> / sprint</div>
    </div>
  );
}
