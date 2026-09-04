import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Holidays() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState(null);
  const [weeklyOff, setWeeklyOff] = useState(null);
  const [error, setError] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      const [h, w] = await Promise.all([
        client.get(`/holidays/${year}`),
        client.get("/settings/weekly-off"),
      ]);
      setHolidays(h.data.holidays);
      setWeeklyOff(w.data.days);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [year]);

  function updateRow(i, field, value) {
    setHolidays((list) => list.map((h, idx) => (idx === i ? { ...h, [field]: value } : h)));
  }
  function addRow() { setHolidays((list) => [...list, { date: "", name: "" }]); }
  function removeRow(i) { setHolidays((list) => list.filter((_, idx) => idx !== i)); }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await client.put(`/holidays/${year}`, { holidays });
      alert("Saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function doCopy() {
    if (!copyFrom) return;
    try {
      const { data } = await client.get(`/holidays/${year}/copy-from/${copyFrom}`);
      setHolidays(data.holidays);
    } catch (err) {
      setError(errorMessage(err));
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

      <div className="toolbar">
        <label style={{ margin: 0 }}>Year</label>
        <input type="number" style={{ width: 100 }} value={year} onChange={(e) => setYear(Number(e.target.value))} />
        <div className="spacer" />
        <input type="number" style={{ width: 100 }} placeholder="Copy from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} />
        <button onClick={doCopy}>Copy holidays</button>
      </div>

      <ErrorText>{error}</ErrorText>
      {!holidays ? <Loading /> : (
        <div className="card">
          <table>
            <thead><tr><th>Date</th><th>Name</th><th></th></tr></thead>
            <tbody>
              {holidays.map((h, i) => (
                <tr key={i}>
                  <td><input type="date" value={h.date} onChange={(e) => updateRow(i, "date", e.target.value)} /></td>
                  <td><input value={h.name} onChange={(e) => updateRow(i, "name", e.target.value)} /></td>
                  <td><button className="btn-sm btn-danger" onClick={() => removeRow(i)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button onClick={addRow}>+ Add Holiday</button>
            <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
