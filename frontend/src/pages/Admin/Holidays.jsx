import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function Holidays() {
  const [holidays, setHolidays] = useState(null);
  const [weeklyOff, setWeeklyOff] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setError("");
    try {
      const [h, w] = await Promise.all([
        client.get("/holidays"),
        client.get("/settings/weekly-off"),
      ]);
      setHolidays(h.data.holidays);
      setWeeklyOff(w.data.days);
      setDirty(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  function updateRow(i, field, value) {
    setHolidays((list) => list.map((h, idx) => (idx === i ? { ...h, [field]: value } : h)));
    setDirty(true);
  }
  function addRow() {
    setHolidays((list) => [...list, { month: 1, day: 1, name: "" }]);
    setDirty(true);
  }
  function removeRow(i) {
    setHolidays((list) => list.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const { data } = await client.put("/holidays", { holidays });
      setHolidays(data.holidays);
      setDirty(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleWeeklyOff(day) {
    const next = weeklyOff.includes(day) ? weeklyOff.filter((d) => d !== day) : [...weeklyOff, day].sort();
    setWeeklyOff(next);
    try {
      await client.put("/settings/weekly-off", { days: next });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="page-header"><h2>Holidays &amp; Weekly Off</h2></div>

      <div className="card">
        <h3 className="mt-0">Weekly Off Days</h3>
        <div className="toolbar">
          {WEEKDAYS.map((label, day) => (
            <button
              key={day}
              className={weeklyOff?.includes(day) ? "btn-primary" : ""}
              onClick={() => toggleWeeklyOff(day)}
              disabled={!weeklyOff}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ErrorText>{error}</ErrorText>
      {!holidays ? <Loading /> : (
        <div className="card">
          <h3 className="mt-0">Holidays</h3>
          <p className="hint-text mt-0">
            Enter each holiday once — it repeats on the same date every year. Change a date or remove a holiday
            here and it changes for all years.
          </p>
          <table>
            <thead><tr><th>Month</th><th>Date</th><th>Name</th><th></th></tr></thead>
            <tbody>
              {holidays.map((h, i) => (
                <tr key={i}>
                  <td>
                    <select value={h.month} onChange={(e) => updateRow(i, "month", Number(e.target.value))}>
                      {MONTHS.map((m, idx) => <option key={m} value={idx + 1}>{m}</option>)}
                    </select>
                  </td>
                  <td><input type="number" min="1" max="31" style={{ width: 80 }} value={h.day} onChange={(e) => updateRow(i, "day", Number(e.target.value))} /></td>
                  <td><input value={h.name} onChange={(e) => updateRow(i, "name", e.target.value)} placeholder="Holiday name" /></td>
                  <td><button className="btn-sm btn-danger" onClick={() => removeRow(i)}>Delete</button></td>
                </tr>
              ))}
              {holidays.length === 0 && <tr><td colSpan={4} className="empty-state">No holidays yet.</td></tr>}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button onClick={addRow}>+ Add Holiday</button>
            <button className="btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</button>
            {dirty && <span className="hint-text">Unsaved changes</span>}
          </div>
        </div>
      )}
    </div>
  );
}
