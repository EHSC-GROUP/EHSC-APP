import { useState } from "react";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

// A month-grid calendar for picking one date. Dates before `minDate` can't be
// chosen; `markers` maps an ISO date to a CSS modifier (e.g. "pending",
// "approved") shown as a coloured dot.
export default function CalendarPicker({ value, onChange, minDate, markers = {} }) {
  const seed = value ? new Date(`${value}T00:00:00`) : new Date();
  const [view, setView] = useState({ year: seed.getFullYear(), month: seed.getMonth() });

  const first = new Date(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // Monday-first grid
  const cells = [...Array(leading).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  function shift(delta) {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const title = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="btn-sm" onClick={() => shift(-1)} aria-label="Previous month">&lsaquo;</button>
        <strong>{title}</strong>
        <button type="button" className="btn-sm" onClick={() => shift(1)} aria-label="Next month">&rsaquo;</button>
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const date = iso(view.year, view.month, day);
          const disabled = !!minDate && date < minDate;
          const cls = ["cal-day", date === value ? "selected" : "", date === todayIso ? "today" : "", markers[date] ? `mark-${markers[date]}` : ""].join(" ");
          return (
            <button key={date} type="button" className={cls} disabled={disabled} onClick={() => onChange(date)}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
