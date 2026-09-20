import type { PlanPayload } from "../shared/types.js";
import { fmtDate } from "./util.js";

export function CriticalPathView({ plan, selectedId, onSelect }: { plan: PlanPayload; selectedId: string | null; onSelect(id: string): void }) {
  const live = plan.tasks.filter((t) => t.status !== "cancelled");
  const critical = live.filter((t) => t.critical).sort((a, b) => a.start.localeCompare(b.start));
  const sorted = [...live].sort((a, b) => a.totalFloat - b.totalFloat || a.start.localeCompare(b.start));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
      <div className="pm-card">
        <div className="pm-card-head">Critical path <span className="pm-sub">({critical.length} tasks, zero total float)</span></div>
        {critical.length === 0 ? (
          <div className="pm-empty">No tasks yet.</div>
        ) : (
          <div className="pm-chain">
            {critical.map((t, i) => (
              <span key={t.issueId} style={{ display: "contents" }}>
                {i > 0 && <span className="pm-chain-arrow">→</span>}
                <span className="pm-chain-node" onClick={() => onSelect(t.issueId)} title={`${fmtDate(t.start)} → ${fmtDate(t.finish)}`}>
                  <span className="pm-task-id">{t.identifier}</span>{t.title}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
      {plan.cycles.length > 0 && (
        <div className="pm-error">Dependency cycle detected between {plan.cycles[0]!.length} tasks; one or more links were ignored in the calculation.</div>
      )}
      <div className="pm-card" style={{ flex: 1, minHeight: 0 }}>
        <table className="pm-table">
          <thead>
            <tr>
              <th>Task</th><th>Early start</th><th>Early finish</th><th>Late start</th><th>Late finish</th>
              <th className="pm-num">Total float</th><th className="pm-num">Free float</th><th className="pm-num">Dur</th><th className="pm-num">%</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.issueId} className={selectedId === t.issueId ? "pm-selected" : ""} onClick={() => onSelect(t.issueId)} style={{ cursor: "pointer" }}>
                <td><span className={`pm-dot ${t.critical ? "pm-crit" : ""}`} /><span className="pm-task-id">{t.identifier}</span>{t.title}</td>
                <td className="pm-mono">{fmtDate(t.start)}</td>
                <td className="pm-mono">{fmtDate(t.finish)}</td>
                <td className="pm-mono">{fmtDate(t.lateStart)}</td>
                <td className="pm-mono">{fmtDate(t.lateFinish)}</td>
                <td className="pm-num">{t.critical ? <span className="pm-chip pm-crit">0</span> : `${t.totalFloat}d`}</td>
                <td className="pm-num">{t.freeFloat}d</td>
                <td className="pm-num">{t.isMilestone ? "◆" : `${t.durationDays}d`}</td>
                <td className="pm-num">{t.percentComplete}</td>
                <td><span className="pm-chip">{t.status.replace(/_/g, " ")}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
