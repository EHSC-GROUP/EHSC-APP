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

const DAY_COL_WIDTH = 34; // px per day column in the Gantt header/timeline

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
  // Hover shows the tooltip; click pins it open (stays until that bar is
  // clicked again, or the page is clicked elsewhere) — useful for touch, or
  // to read it without holding the cursor still. Position is captured in
  // viewport pixels at hover/click time and rendered as position:fixed
  // *outside* the horizontally-scrolling chart, so it's never clipped by
  // the chart's own overflow — a plain CSS-relative tooltip nested inside
  // the scroll container gets cut off by that container's implied
  // overflow-y once its content taller than the container.
  const [activeTooltip, setActiveTooltip] = useState(null); // { id, x, y, pinned }

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

  // Clicking anywhere outside a pinned tooltip closes it.
  useEffect(() => {
    if (!activeTooltip?.pinned) return;
    function onDocClick(e) {
      if (e.target.closest(".gantt-bar") || e.target.closest(".gantt-tooltip")) return;
      setActiveTooltip(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [activeTooltip?.pinned]);

  const allRows = useMemo(() => (profiles ? flattenActions(profiles) : []), [profiles]);
  const clientNames = useMemo(() => [...new Set(allRows.map((r) => r.clientName))].sort(), [allRows]);
  const rows = clientFilter ? allRows.filter((r) => r.clientName === clientFilter) : allRows;
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

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
    for (let d = 0; d <= totalDays; d++) {
      out.push({ offsetDays: d, date: addDays(start, d) });
    }
    return out;
  }

  // Month band row above the day numbers — showing "Aug" once for the
  // whole span of August days, rather than repeating it on every tick
  // (which was overlapping/garbling the day-23 label it was prefixed to).
  const monthBands = useMemo(() => {
    const bands = [];
    for (const t of ticks) {
      const key = `${t.date.getFullYear()}-${t.date.getMonth()}`;
      const last = bands[bands.length - 1];
      if (last && last.key === key) {
        last.days += 1;
      } else {
        bands.push({ key, label: t.date.toLocaleDateString(undefined, { month: "long", year: "numeric" }), startOffset: t.offsetDays, days: 1 });
      }
    }
    return bands;
  }, [ticks]);

  const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd));
  const chartWidthPx = Math.max(900, (totalDays + 1) * DAY_COL_WIDTH);
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

  function showHoverTooltip(e, actionId) {
    if (activeTooltip?.pinned) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveTooltip({ id: actionId, x: rect.left, y: rect.bottom + 6, pinned: false });
  }
  function hideHoverTooltip(actionId) {
    setActiveTooltip((cur) => (cur && cur.id === actionId && !cur.pinned ? null : cur));
  }
  function toggleClickPin(e, actionId) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveTooltip((cur) => (cur?.id === actionId && cur.pinned ? null : { id: actionId, x: rect.left, y: rect.bottom + 6, pinned: true }));
  }

  const activeAction = activeTooltip ? rowById.get(activeTooltip.id) : null;
  const activeStatus = activeAction ? statusOf(activeAction, today) : null;
  const tooltipLeft = activeTooltip ? Math.min(activeTooltip.x, window.innerWidth - 300) : 0;

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
          <div className="gantt-chart" style={{ minWidth: chartWidthPx + 300 }}>
            <div className="gantt-header-row gantt-month-row">
              <div className="gantt-label-col" />
              <div className="gantt-ticks" style={{ minWidth: chartWidthPx }}>
                {monthBands.map((b) => (
                  <div
                    key={b.key}
                    className="gantt-tick-month-band"
                    style={{ left: `${(b.startOffset / totalDays) * 100}%`, width: `${(b.days / totalDays) * 100}%` }}
                  >
                    {b.label}
                  </div>
                ))}
              </div>
            </div>
            <div className="gantt-header-row">
              <div className="gantt-label-col">
                <span className="gantt-col-task">Action</span>
                <span className="gantt-col-start">Start</span>
                <span className="gantt-col-end">End</span>
              </div>
              <div className="gantt-ticks" style={{ minWidth: chartWidthPx }}>
                {ticks.map((t) => (
                  <div key={t.offsetDays} className="gantt-tick" style={{ left: `${(t.offsetDays / totalDays) * 100}%`, width: DAY_COL_WIDTH }}>
                    {t.date.getDate()}
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
                  const isPinned = activeTooltip?.pinned && activeTooltip.id === a.id;
                  return (
                    <div key={a.id} className="gantt-row">
                      <div className="gantt-row-label">
                        <span className="gantt-col-task">
                          <span className="desc">{a.description}</span>
                          <span className="meta">{a.assignedToName || a.assignedTo}</span>
                        </span>
                        <span className="gantt-col-start">{a.startDate || "-"}</span>
                        <span className="gantt-col-end">{a.dueDate || "-"}</span>
                      </div>
                      <div className="gantt-track">
                        <div className="gantt-today-line" style={{ left: `${todayOffsetPct}%` }} />
                        <div
                          className={`gantt-bar gantt-bar-${status}${isPinned ? " gantt-bar-pinned" : ""}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          onMouseEnter={(e) => showHoverTooltip(e, a.id)}
                          onMouseLeave={() => hideHoverTooltip(a.id)}
                          onClick={(e) => toggleClickPin(e, a.id)}
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

      {activeAction && (
        <div className="gantt-tooltip" style={{ left: tooltipLeft, top: activeTooltip.y }}>
          <div className="gantt-tooltip-title">{activeAction.description}</div>
          <div className="gantt-tooltip-row"><span>Client</span><span>{activeAction.clientName}</span></div>
          <div className="gantt-tooltip-row"><span>Assigned to</span><span>{activeAction.assignedToName || activeAction.assignedTo}</span></div>
          <div className="gantt-tooltip-row"><span>Start</span><span>{activeAction.startDate || "-"}</span></div>
          <div className="gantt-tooltip-row"><span>Due</span><span>{activeAction.dueDate}</span></div>
          <div className="gantt-tooltip-row"><span>Status</span><span className={`gantt-tooltip-status gantt-tooltip-status-${activeStatus}`}>{STATUS_LABEL[activeStatus]}</span></div>
          {activeTooltip.pinned && <div className="gantt-tooltip-hint">Click the bar again (or elsewhere) to close</div>}
        </div>
      )}
    </div>
  );
}
