import { useState } from "react";
import type { CommsPayload, PlanPayload, RaidItem, Stakeholder, CommItem } from "../shared/types.js";
import { fmtDate, fmtDateFull } from "./util.js";
import { money } from "./Evm.js";

export interface CommsProps {
  plan: PlanPayload;
  comms: CommsPayload | null;
  loading: boolean;
  busy: boolean;
  onGenerateReport(): Promise<unknown>;
  onSendReport(reportId: string, to: string): Promise<{ sent: boolean; mailto: string; error?: string }>;
  onNudge(issueId: string, message?: string): Promise<{ channel: string; mailto?: string; queued?: boolean; error?: string }>;
  onNudgeAll(kinds: string[]): Promise<{ count: number }>;
  onUpsertStakeholder(item: Partial<Stakeholder>): Promise<unknown>;
  onDeleteStakeholder(id: string): Promise<unknown>;
  onUpsertComm(item: Partial<CommItem>): Promise<unknown>;
  onDeleteComm(id: string): Promise<unknown>;
  onUpsertRaid(item: Partial<RaidItem>): Promise<unknown>;
  onDeleteRaid(id: string): Promise<unknown>;
  onUpdateSettings(patch: Record<string, unknown>): Promise<unknown>;
  toast(msg: string, kind?: "ok" | "err"): void;
}

type Tab = "dashboard" | "report" | "stakeholders" | "plan" | "raid";

/** Minimal markdown → HTML for the status report preview (headings, tables, lists, bold, italics). */
function renderMd(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/_(.+?)_/g, "<i>$1</i>");
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith("# ")) { out.push(`<h2>${inline(l.slice(2))}</h2>`); i++; continue; }
    if (l.startsWith("## ")) { out.push(`<h3>${inline(l.slice(3))}</h3>`); i++; continue; }
    if (l.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) { const cells = lines[i]!.split("|").slice(1, -1).map((c) => c.trim()); if (!cells.every((c) => /^-+$/.test(c))) rows.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`); i++; }
      out.push(`<table class="pm-md-table">${rows.join("")}</table>`); continue;
    }
    if (l.startsWith("- ")) { const items: string[] = []; while (i < lines.length && lines[i]!.startsWith("- ")) { items.push(`<li>${inline(lines[i]!.slice(2))}</li>`); i++; } out.push(`<ul>${items.join("")}</ul>`); continue; }
    if (l.trim() === "") { i++; continue; }
    out.push(`<p>${inline(l)}</p>`); i++;
  }
  return out.join("");
}

const KIND_LABEL: Record<string, string> = { overdue: "Overdue", blocked: "Blocked", due_soon: "Due soon", stalled: "Not started", unassigned: "Unassigned" };

export function CommsView(p: CommsProps) {
  const { plan, comms } = p;
  const [tab, setTab] = useState<Tab>("dashboard");
  const [to, setTo] = useState(plan.plan.reportRecipients ?? "");
  const [reportId, setReportId] = useState<string | null>(null);
  if (!comms) return <div className="pm-empty">{p.loading ? "Loading communications…" : "No data"}</div>;
  const m = comms.metrics;
  const cur = plan.plan.currency;
  const report = comms.reports.find((r) => r.id === reportId) ?? comms.reports[0] ?? null;
  const rag = (r: string) => (r === "red" ? "🔴" : r === "amber" ? "🟡" : "🟢");
  const openRaid = comms.raid.filter((r) => r.status !== "closed");
  const overdueDue = comms.commPlan.filter((c) => c.nextDue && c.nextDue <= plan.today);

  const doNudge = async (issueId: string) => {
    const r = await p.onNudge(issueId);
    if (r.channel === "agent_wakeup") p.toast(r.queued ? "Agent nudged: comment posted and run queued" : "Comment posted; agent already running");
    else if (r.channel === "email") p.toast("Comment posted and email sent");
    else if (r.channel === "mailto" && r.mailto) { p.toast("Comment posted; opening email draft"); window.open(r.mailto, "_blank"); }
    else p.toast(`Comment posted${r.error ? ` (${r.error})` : ""}`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
      <div className="pm-row" style={{ flexWrap: "wrap" }}>
        <div className="pm-seg">
          <button className={tab === "dashboard" ? "pm-active" : ""} onClick={() => setTab("dashboard")}>Dashboard</button>
          <button className={tab === "report" ? "pm-active" : ""} onClick={() => setTab("report")}>Status reports ({comms.reports.length})</button>
          <button className={tab === "stakeholders" ? "pm-active" : ""} onClick={() => setTab("stakeholders")}>Stakeholders ({comms.stakeholders.length})</button>
          <button className={tab === "plan" ? "pm-active" : ""} onClick={() => setTab("plan")}>Comm plan ({comms.commPlan.length})</button>
          <button className={tab === "raid" ? "pm-active" : ""} onClick={() => setTab("raid")}>RAID log ({openRaid.length} open)</button>
        </div>
        <span className="pm-spacer" />
        <span className="pm-sub">Email: {comms.email.configured ? `Resend from ${comms.email.from}` : "mail client drafts (configure Resend in plugin settings to send automatically)"}</span>
      </div>

      {tab === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
          <div className="pm-kpis">
            <div className={`pm-kpi ${m.rag === "red" ? "pm-bad" : m.rag === "amber" ? "pm-warn-kpi" : "pm-good"}`}><div className="pm-kpi-label">Project health</div><div className="pm-kpi-value">{rag(m.rag)} {m.rag}</div><div className="pm-kpi-hint">SPI {m.spi ?? "—"} · CPI {m.cpi ?? "—"} · {m.pctComplete}% earned</div></div>
            <div className={`pm-kpi ${comms.attention.filter((a) => a.kind === "overdue").length ? "pm-bad" : ""}`}><div className="pm-kpi-label">Needs attention</div><div className="pm-kpi-value">{comms.attention.length}</div><div className="pm-kpi-hint">{comms.attention.filter((a) => a.kind === "overdue").length} overdue · {comms.attention.filter((a) => a.kind === "blocked").length} blocked · {comms.attention.filter((a) => a.kind === "unassigned").length} unassigned</div></div>
            <div className={`pm-kpi ${openRaid.some((r) => (r.score ?? 0) >= 15) ? "pm-bad" : ""}`}><div className="pm-kpi-label">Open risks & issues</div><div className="pm-kpi-value">{openRaid.length}</div><div className="pm-kpi-hint">{openRaid.filter((r) => r.kind === "risk").length} risks · {openRaid.filter((r) => r.kind === "issue").length} issues · {openRaid.filter((r) => r.kind === "decision").length} decisions pending</div></div>
            <div className="pm-kpi"><div className="pm-kpi-label">Budget</div><div className="pm-kpi-value">{money(m.ac, cur)}</div><div className="pm-kpi-hint">of {money(m.bac, cur)} · EAC {money(m.eac, cur)}</div></div>
            <div className={`pm-kpi ${overdueDue.length ? "pm-warn-kpi" : ""}`}><div className="pm-kpi-label">Communications due</div><div className="pm-kpi-value">{overdueDue.length}</div><div className="pm-kpi-hint">{comms.reports[0] ? `last report ${fmtDate(comms.reports[0].periodEnd)} ${rag(comms.reports[0].rag)}` : "no report yet"} · {comms.nudges.length} nudges sent</div></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(420px, 1.4fr) minmax(280px, 1fr)", gap: 12 }}>
            <div className="pm-card">
              <div className="pm-card-head" title="Agents get a comment on the issue plus a wake-up run; humans get a comment plus an email">Nudge center<span className="pm-spacer" />
                <button className="pm-btn" disabled={p.busy || !comms.attention.some((a) => a.kind === "overdue" && a.ownerKind !== "none")} onClick={async () => { const r = await p.onNudgeAll(["overdue"]); p.toast(`Nudged ${r.count} owner(s) of overdue tasks`); }}>Nudge all overdue</button>
              </div>
              <table className="pm-table">
                <thead><tr><th>Why</th><th>Task</th><th>Owner</th><th>Finish</th><th className="pm-num">%</th><th></th></tr></thead>
                <tbody>
                  {comms.attention.map((a) => (
                    <tr key={a.issueId}>
                      <td><span className={`pm-chip ${a.kind === "overdue" || a.kind === "blocked" ? "pm-crit" : a.kind === "due_soon" ? "pm-warn" : ""}`}>{KIND_LABEL[a.kind]}{a.daysLate ? ` +${a.daysLate}d` : ""}</span></td>
                      <td>{a.critical && <span className="pm-dot pm-crit" />}<span className="pm-task-id">{a.identifier}</span>{a.title}</td>
                      <td>{a.ownerName ? <span className={`pm-chip ${a.ownerKind === "agent" ? "pm-agent" : "pm-human"}`}>{a.ownerKind === "agent" ? "🤖" : "👤"} {a.ownerName}</span> : <span className="pm-muted">unassigned</span>}</td>
                      <td className="pm-mono">{fmtDate(a.finish)}</td>
                      <td className="pm-num">{a.percentComplete}</td>
                      <td style={{ textAlign: "right" }}>{a.ownerKind !== "none" && <button className="pm-btn" disabled={p.busy} onClick={() => doNudge(a.issueId)} title={a.ownerKind === "agent" ? "Post a comment and wake the agent" : a.ownerEmail ? `Post a comment and email ${a.ownerEmail}` : "Post a comment"}>📣 Nudge</button>}</td>
                    </tr>
                  ))}
                  {comms.attention.length === 0 && <tr><td colSpan={6} className="pm-muted" style={{ textAlign: "center", padding: 18 }}>Nothing needs attention. 🎉</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="pm-card">
                <div className="pm-card-head">Upcoming milestones</div>
                <div className="pm-list" style={{ padding: 10 }}>
                  {comms.milestones.length === 0 && <div className="pm-sub">No milestones. Set a task's duration to 0 to make one.</div>}
                  {comms.milestones.map((ms) => <div key={ms.issueId} className="pm-list-item"><span>{ms.done ? "✅" : ms.date < plan.today ? "⚠️" : "◆"}</span><span className="pm-grow">{ms.title}</span><span className="pm-mono pm-sub">{fmtDate(ms.date)}</span></div>)}
                </div>
              </div>
              <div className="pm-card">
                <div className="pm-card-head">Top risks</div>
                <div className="pm-list" style={{ padding: 10 }}>
                  {openRaid.filter((r) => r.kind === "risk").sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5).map((r) => <div key={r.id} className="pm-list-item"><span className={`pm-chip ${(r.score ?? 0) >= 15 ? "pm-crit" : (r.score ?? 0) >= 8 ? "pm-warn" : ""}`}>{r.score ?? "?"}</span><span className="pm-grow">{r.title}</span><span className="pm-sub">{r.owner ?? ""}</span></div>)}
                  {openRaid.filter((r) => r.kind === "risk").length === 0 && <div className="pm-sub">No open risks logged.</div>}
                </div>
              </div>
              <div className="pm-card">
                <div className="pm-card-head">Recent nudges</div>
                <div className="pm-list" style={{ padding: 10 }}>
                  {comms.nudges.slice(0, 6).map((n) => <div key={n.id} className="pm-list-item"><span className="pm-chip">{n.channel.replace("_", " ")}</span><span className="pm-grow">{n.targetName ?? "—"}: {n.message?.slice(0, 80)}</span><span className="pm-sub">{new Date(n.createdAt).toLocaleDateString()}</span></div>)}
                  {comms.nudges.length === 0 && <div className="pm-sub">No nudges yet.</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "report" && (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12, flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "auto" }}>
            <button className="pm-btn pm-primary" disabled={p.busy} onClick={async () => { const r = (await p.onGenerateReport()) as { id: string }; setReportId(r.id); p.toast("Status report generated and snapshot recorded"); }}>Generate this week's report</button>
            <div className="pm-card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="pm-sub">Automatic every Monday 08:00 → recipients:</span>
              <input className="pm-input" placeholder="sponsor@example.com, team@…" value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => (to || null) !== plan.plan.reportRecipients && p.onUpdateSettings({ reportRecipients: to })} />
              <label className="pm-row pm-sub"><input type="checkbox" checked={plan.plan.autoNudge} onChange={(e) => p.onUpdateSettings({ autoNudge: e.target.checked })} /> Auto-nudge overdue owners weekly</label>
            </div>
            {comms.reports.map((r) => <div key={r.id} className={`pm-list-item ${report?.id === r.id ? "pm-selected" : ""}`} style={{ cursor: "pointer" }} onClick={() => setReportId(r.id)}><span>{rag(r.rag)}</span><span className="pm-grow">Week ending {fmtDate(r.periodEnd)}</span>{r.sentTo.length > 0 && <span className="pm-chip pm-ok" title={r.sentTo.join(", ")}>sent</span>}</div>)}
            {comms.reports.length === 0 && <div className="pm-sub">No reports yet.</div>}
          </div>
          <div className="pm-card" style={{ overflow: "auto", minHeight: 0 }}>
            {report ? (
              <>
                <div className="pm-card-head">{rag(report.rag)} Week ending {fmtDateFull(report.periodEnd)} <span className="pm-sub">generated {new Date(report.createdAt).toLocaleString()}{report.createdBy ? ` by ${report.createdBy}` : ""}</span><span className="pm-spacer" />
                  <button className="pm-btn" onClick={() => { navigator.clipboard?.writeText(report.contentMd); p.toast("Markdown copied"); }}>Copy markdown</button>
                  <button className="pm-btn pm-primary" disabled={p.busy} onClick={async () => { const r = await p.onSendReport(report.id, to); if (r.sent) p.toast("Report emailed"); else { p.toast(r.error ? `Not sent: ${r.error}. Opening mail draft.` : "Opening email draft in your mail client"); window.open(r.mailto, "_blank"); } }}>✉ Email report</button>
                </div>
                <div className="pm-md" dangerouslySetInnerHTML={{ __html: renderMd(report.contentMd) }} />
              </>
            ) : <div className="pm-empty">Generate a report to see the weekly status with schedule, budget (EVM), accomplishments, next week, milestones, attention items and RAID.</div>}
          </div>
        </div>
      )}

      {tab === "stakeholders" && <Stakeholders p={p} comms={comms} />}
      {tab === "plan" && <CommPlan p={p} comms={comms} />}
      {tab === "raid" && <Raid p={p} comms={comms} />}
    </div>
  );
}

function Editable({ value, onCommit, type = "text", options }: { value: string; onCommit(v: string): void; type?: string; options?: string[] }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(value);
  if (options) return <select className="pm-cell-select" value={value} onChange={(e) => onCommit(e.target.value)}>{options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}</select>;
  if (!edit) return <div className="pm-cell" onClick={() => { setDraft(value); setEdit(true); }}>{value || <span className="pm-muted">—</span>}</div>;
  return <input autoFocus className="pm-cell-input" type={type} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { setEdit(false); if (draft !== value) onCommit(draft); }} onKeyDown={(e) => { if (e.key === "Enter") { setEdit(false); if (draft !== value) onCommit(draft); } if (e.key === "Escape") setEdit(false); }} />;
}

function Stakeholders({ p, comms }: { p: CommsProps; comms: CommsPayload }) {
  const [name, setName] = useState("");
  const cols = "minmax(160px,1fr) 130px 130px 180px 170px 90px 90px 110px 110px 40px";
  const lvl = ["low", "medium", "high"];
  const grid = (pw: string, it: string) => comms.stakeholders.filter((s) => s.power === pw && s.interest === it);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
      <div className="pm-card">
        <div className="pm-card-head">Stakeholder register <span className="pm-sub">click a cell to edit</span></div>
        <div className="pm-sheet" style={{ gridTemplateColumns: cols }}>
          {["Name", "Role", "Organization", "Email", "Paperclip identity", "Power", "Interest", "Channel", "Frequency", ""].map((h) => <div key={h} className="pm-sheet-head">{h}</div>)}
          {comms.stakeholders.map((s) => (
            <div key={s.id} style={{ display: "contents" }}>
              <Editable value={s.name} onCommit={(v) => v.trim() && p.onUpsertStakeholder({ ...s, name: v.trim() })} />
              <Editable value={s.role ?? ""} onCommit={(v) => p.onUpsertStakeholder({ ...s, role: v })} />
              <Editable value={s.organization ?? ""} onCommit={(v) => p.onUpsertStakeholder({ ...s, organization: v })} />
              <Editable value={s.email ?? ""} type="email" onCommit={(v) => p.onUpsertStakeholder({ ...s, email: v })} />
              <div className="pm-cell"><select className="pm-cell-select" value={s.agentId ? `a:${s.agentId}` : s.userId ? `u:${s.userId}` : ""} onChange={(e) => { const v = e.target.value; void p.onUpsertStakeholder({ ...s, agentId: v.startsWith("a:") ? v.slice(2) : null, userId: v.startsWith("u:") ? v.slice(2) : null }); }}><option value="">— external —</option><optgroup label="People">{p.plan.humans.map((h) => <option key={h.id} value={`u:${h.id}`}>👤 {h.name}</option>)}</optgroup><optgroup label="Agents">{p.plan.agents.map((a) => <option key={a.id} value={`a:${a.id}`}>🤖 {a.name}</option>)}</optgroup></select></div>
              <div className="pm-cell"><Editable value={s.power} options={lvl} onCommit={(v) => p.onUpsertStakeholder({ ...s, power: v })} /></div>
              <div className="pm-cell"><Editable value={s.interest} options={lvl} onCommit={(v) => p.onUpsertStakeholder({ ...s, interest: v })} /></div>
              <div className="pm-cell"><Editable value={s.channel ?? ""} options={["", "email", "meeting", "Paperclip", "chat", "report"]} onCommit={(v) => p.onUpsertStakeholder({ ...s, channel: v })} /></div>
              <div className="pm-cell"><Editable value={s.frequency ?? ""} options={["", "daily", "weekly", "bi-weekly", "monthly", "milestone", "ad hoc"]} onCommit={(v) => p.onUpsertStakeholder({ ...s, frequency: v })} /></div>
              <div className="pm-cell"><button className="pm-btn pm-danger" style={{ height: 22, padding: "0 6px" }} onClick={() => confirm(`Remove ${s.name}?`) && p.onDeleteStakeholder(s.id)}>✕</button></div>
            </div>
          ))}
          <div className="pm-cell" style={{ gridColumn: "1 / -1" }}><input className="pm-cell-input" placeholder="Type a name and press Enter to add a stakeholder (sponsor, customer, team lead, vendor, an agent…)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && name.trim()) { await p.onUpsertStakeholder({ name: name.trim(), power: "medium", interest: "medium" }); setName(""); } }} /></div>
        </div>
      </div>
      <div className="pm-card">
        <div className="pm-card-head">Power / interest grid <span className="pm-sub">manage closely · keep satisfied · keep informed · monitor</span></div>
        <div style={{ padding: 12, display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr", gap: 6 }}>
          <div /><div className="pm-heat-head">Low interest</div><div className="pm-heat-head">Medium</div><div className="pm-heat-head">High interest</div>
          {["high", "medium", "low"].map((pw) => (<div key={pw} style={{ display: "contents" }}><div className="pm-heat-head" style={{ alignSelf: "center" }}>{pw} power</div>{lvl.map((it) => <div key={it} className="pm-card" style={{ minHeight: 56, padding: 6, background: pw === "high" && it === "high" ? "oklch(62% 0.2 25 / 0.12)" : pw === "high" ? "oklch(78% 0.15 80 / 0.15)" : it === "high" ? "oklch(62% 0.14 250 / 0.12)" : "var(--muted)", display: "flex", flexWrap: "wrap", gap: 4 }}>{grid(pw, it).map((s) => <span key={s.id} className={`pm-chip ${s.agentId ? "pm-agent" : "pm-human"}`}>{s.name}</span>)}</div>)}</div>))}
        </div>
      </div>
    </div>
  );
}

function CommPlan({ p, comms }: { p: CommsProps; comms: CommsPayload }) {
  const [item, setItem] = useState("");
  return (
    <div className="pm-card" style={{ overflow: "auto" }}>
      <div className="pm-card-head">Communication plan <span className="pm-sub">what · to whom · how · how often · who owns it · next due</span></div>
      <div className="pm-sheet" style={{ gridTemplateColumns: "minmax(180px,1fr) 160px 110px 110px 130px 120px minmax(140px,1fr) 40px" }}>
        {["Communication", "Audience", "Channel", "Frequency", "Owner", "Next due", "Notes", ""].map((h) => <div key={h} className="pm-sheet-head">{h}</div>)}
        {comms.commPlan.map((c) => (
          <div key={c.id} style={{ display: "contents", background: c.nextDue && c.nextDue <= p.plan.today ? "oklch(62% 0.2 25 / 0.08)" : undefined }}>
            <Editable value={c.item} onCommit={(v) => v.trim() && p.onUpsertComm({ ...c, item: v })} />
            <Editable value={c.audience ?? ""} onCommit={(v) => p.onUpsertComm({ ...c, audience: v })} />
            <div className="pm-cell"><Editable value={c.channel ?? ""} options={["", "email", "meeting", "Paperclip", "chat", "report", "dashboard"]} onCommit={(v) => p.onUpsertComm({ ...c, channel: v })} /></div>
            <div className="pm-cell"><Editable value={c.frequency ?? ""} options={["", "daily", "weekly", "bi-weekly", "monthly", "milestone", "ad hoc"]} onCommit={(v) => p.onUpsertComm({ ...c, frequency: v })} /></div>
            <Editable value={c.owner ?? ""} onCommit={(v) => p.onUpsertComm({ ...c, owner: v })} />
            <div className="pm-cell" style={c.nextDue && c.nextDue <= p.plan.today ? { color: "var(--destructive)", fontWeight: 600 } : undefined}><Editable value={c.nextDue ?? ""} type="date" onCommit={(v) => p.onUpsertComm({ ...c, nextDue: v || null })} /></div>
            <Editable value={c.notes ?? ""} onCommit={(v) => p.onUpsertComm({ ...c, notes: v })} />
            <div className="pm-cell"><button className="pm-btn pm-danger" style={{ height: 22, padding: "0 6px" }} onClick={() => p.onDeleteComm(c.id)}>✕</button></div>
          </div>
        ))}
        <div className="pm-cell" style={{ gridColumn: "1 / -1" }}><input className="pm-cell-input" placeholder="Add: e.g. Weekly status report · Steering committee · Daily stand-up · Release announcement  (Enter)" value={item} onChange={(e) => setItem(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && item.trim()) { await p.onUpsertComm({ item: item.trim(), frequency: "weekly", channel: "email" }); setItem(""); } }} /></div>
      </div>
      {comms.commPlan.length === 0 && <div style={{ padding: 12 }} className="pm-sub">Suggested starter set: Weekly status report (sponsor, email, weekly) · Steering committee (sponsor + leads, meeting, monthly) · Stand-up (team + agents, Paperclip, daily) · Risk review (PM + leads, meeting, bi-weekly) · Go-live announcement (all, email, milestone).</div>}
    </div>
  );
}

function Raid({ p, comms }: { p: CommsProps; comms: CommsPayload }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("risk");
  const [showClosed, setShowClosed] = useState(false);
  const rows = comms.raid.filter((r) => showClosed || r.status !== "closed").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const scoreClass = (s: number | null) => (s == null ? "" : s >= 15 ? "pm-crit" : s >= 8 ? "pm-warn" : "pm-ok");
  return (
    <div className="pm-card" style={{ overflow: "auto" }}>
      <div className="pm-card-head">RAID log <span className="pm-sub">risks · assumptions · issues · decisions · dependencies — agents can add entries with the pm_log_raid_item tool</span><span className="pm-spacer" /><label className="pm-sub pm-row"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> show closed</label></div>
      <div className="pm-sheet" style={{ gridTemplateColumns: "100px minmax(200px,1fr) 60px 60px 60px minmax(160px,1fr) 120px 100px 110px 40px" }}>
        {["Type", "Title / description", "Prob", "Impact", "Score", "Response / mitigation", "Owner", "Status", "Due", ""].map((h) => <div key={h} className="pm-sheet-head">{h}</div>)}
        {rows.map((r) => (
          <div key={r.id} style={{ display: "contents" }}>
            <div className="pm-cell"><Editable value={r.kind} options={["risk", "assumption", "issue", "decision", "dependency"]} onCommit={(v) => p.onUpsertRaid({ ...r, kind: v })} /></div>
            <div className="pm-cell" style={{ flexDirection: "column", alignItems: "stretch", height: "auto", padding: 4 }}><Editable value={r.title} onCommit={(v) => v.trim() && p.onUpsertRaid({ ...r, title: v })} /><Editable value={r.description ?? ""} onCommit={(v) => p.onUpsertRaid({ ...r, description: v })} /></div>
            <div className="pm-cell"><Editable value={r.probability == null ? "" : String(r.probability)} options={["", "1", "2", "3", "4", "5"]} onCommit={(v) => p.onUpsertRaid({ ...r, probability: v === "" ? null : Number(v) })} /></div>
            <div className="pm-cell"><Editable value={r.impact == null ? "" : String(r.impact)} options={["", "1", "2", "3", "4", "5"]} onCommit={(v) => p.onUpsertRaid({ ...r, impact: v === "" ? null : Number(v) })} /></div>
            <div className="pm-cell"><span className={`pm-chip ${scoreClass(r.score)}`}>{r.score ?? "—"}</span></div>
            <Editable value={r.response ?? ""} onCommit={(v) => p.onUpsertRaid({ ...r, response: v })} />
            <Editable value={r.owner ?? ""} onCommit={(v) => p.onUpsertRaid({ ...r, owner: v })} />
            <div className="pm-cell"><Editable value={r.status} options={["open", "monitoring", "closed"]} onCommit={(v) => p.onUpsertRaid({ ...r, status: v })} /></div>
            <div className="pm-cell"><Editable value={r.dueDate ?? ""} type="date" onCommit={(v) => p.onUpsertRaid({ ...r, dueDate: v || null })} /></div>
            <div className="pm-cell"><button className="pm-btn pm-danger" style={{ height: 22, padding: "0 6px" }} onClick={() => confirm("Delete this entry?") && p.onDeleteRaid(r.id)}>✕</button></div>
          </div>
        ))}
        <div className="pm-cell"><select className="pm-cell-select" value={kind} onChange={(e) => setKind(e.target.value)}>{["risk", "assumption", "issue", "decision", "dependency"].map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="pm-cell" style={{ gridColumn: "2 / -1" }}><input className="pm-cell-input" placeholder="Describe the risk / issue / assumption / decision and press Enter" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && title.trim()) { await p.onUpsertRaid({ kind, title: title.trim(), status: "open", probability: kind === "risk" ? 3 : null, impact: 3 }); setTitle(""); } }} /></div>
      </div>
    </div>
  );
}
