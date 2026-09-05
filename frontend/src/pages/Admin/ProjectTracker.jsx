import { useEffect, useMemo, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(d) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function addDays(date, n) {
  return new Date(date.getTime() + n * DAY_MS);
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function formatShort(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// One row per action, flattened across every Company Profile's Phase III(b)
// project plan — this is the "all projects at once" view.
function flattenActions(profiles) {
  const rows = [];
  for (const p of profiles) {
    for (const a of p.phase3b?.actions || []) {
      rows.push({ ...a, clientName: p.clientName, profileId: p.id });
    }
  }
  return rows;
}

function statusOf(action, today) {
  if (action.completed) return "good";
  const due = parseDate(action.dueDate);
  if (due && due < today) return "critical";
  return "pending";
}

const STATUS_LABEL = { good: "Completed", critical: "Overdue", pending: "On Track" };

export default function ProjectTracker() {
  const [profiles, setProfiles] = useState(null);
  const [error, setError] = useState("");
  const [clientFilter, setClientFilter] = useState("");

  async function load() {
    setError("");
    try {
      const { data } = await client.get("/company-profiles");
      setProfiles(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  const allRows = useMemo(() => (profiles ? flattenActions(profiles) : []), [profiles]);
  const clientNames = useMemo(() => [...new Set(allRows.map((r) => r.clientName))].sort(), [allRows]);
  const rows = clientFilter ? allRows.filter((r) => r.clientName === clientFilter) : allRows;

  const today = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);

  const { rangeStart, rangeEnd, ticks } = useMemo(() => {
    if (rows.length === 0) {
      const start = addDays(today, -3);
      const end = addDays(today, 11);
      return { rangeStart: start, rangeEnd: end, ticks: buildTicks(start, end) };
    }
    let minDate = today;
    let maxDate = today;
    for (const r of rows) {
      const s = parseDate(r.startDate) || parseDate(r.dueDate);
      const d = parseDate(r.dueDate) || s;
      if (s && s < minDate) minDate = s;
      if (d && d > maxDate) maxDate = d;
    }
    const start = addDays(minDate, -2);
    const end = addDays(maxDate, 2);
    return { rangeStart: start, rangeEnd: end, ticks: buildTicks(start, end) };
  }, [rows, today]);

  function buildTicks(start, end) {
    const totalDays = Math.max(1, daysBetween(start, end));
    const out = [];
    for (let d = 0; d <= totalDays; d += 7) out.push({ offsetDays: d, date: addDays(start, d) });
    return out;
  }

  const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd));
  const todayOffsetPct = (daysBetween(rangeStart, today) / totalDays) * 100;

  // Group rows by client for the group-header bands.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.clientName)) map.set(r.clientName, []);
      map.get(r.clientName).push(r);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div>
      <div className="page-header">
        <h2>Project Tracker</h2>
      </div>
      <p className="hint-text">
        Every action from every Company Profile's Project Plan, on one shared timeline — bar spans Start Date to Due Date.
      </p>

      <div className="toolbar">
        <select style={{ width: 240 }} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="">All companies</option>
          {clientNames.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="gantt-legend">
        <span><span className="swatch" style={{ background: "var(--gantt-pending)" }} />On Track</span>
        <span><span className="swatch" style={{ background: "var(--gantt-good)" }} />Completed</span>
        <span><span className="swatch" style={{ background: "var(--gantt-critical)" }} />Overdue</span>
        <span>┊ Today</span>
      </div>

      <ErrorText>{error}</ErrorText>
      {!profiles ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="card empty-state">No project plan actions yet. Add some from a Company Profile's Project Plan tab.</div>
      ) : (
        <div className="gantt-scroll">
          <div className="gantt-chart">
            <div className="gantt-header-row">
              <div className="gantt-label-col">Action</div>
              <div className="gantt-ticks">
                {ticks.map((t) => (
                  <div key={t.offsetDays} className="gantt-tick" style={{ left: `${(t.offsetDays / totalDays) * 100}%` }}>
                    {formatShort(t.date)}
                  </div>
                ))}
              </div>
            </div>

            {grouped.map(([clientName, actions]) => (
              <div key={clientName}>
                <div className="gantt-group-header">{clientName}</div>
                {actions.map((a) => {
                  const start = parseDate(a.startDate) || parseDate(a.dueDate) || today;
                  const due = parseDate(a.dueDate) || start;
                  const left = Math.max(0, (daysBetween(rangeStart, start) / totalDays) * 100);
                  const width = Math.max(1, (daysBetween(start, due) / totalDays) * 100);
                  const status = statusOf(a, today);
                  const title = `${a.description}\n${a.assignedToName || a.assignedTo || ""}\nStart: ${a.startDate || "-"}  Due: ${a.dueDate}\n${STATUS_LABEL[status]}`;
                  return (
                    <div key={a.id} className="gantt-row">
                      <div className="gantt-row-label">
                        <span className="desc">{a.description}</span>
                        <span className="meta">{a.assignedToName || a.assignedTo}</span>
                      </div>
                      <div className="gantt-track">
                        <div className="gantt-today-line" style={{ left: `${todayOffsetPct}%` }} />
                        <div
                          className={`gantt-bar gantt-bar-${status}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={title}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
