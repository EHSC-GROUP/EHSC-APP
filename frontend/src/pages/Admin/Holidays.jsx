import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NTH_WORDS = ["1st", "2nd", "3rd", "4th", "5th"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function Holidays() {
  const [holidays, setHolidays] = useState(null);
  const [weeklyOff, setWeeklyOff] = useState(null);
  const [weekdayRules, setWeekdayRules] = useState(null);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setError("");
    try {
      const [h, w, r] = await Promise.all([
        client.get("/holidays"),
        client.get("/settings/weekly-off"),
        client.get("/settings/weekday-rules"),
      ]);
      setHolidays(h.data.holidays);
      setWeeklyOff(w.data.days);
      setWeekdayRules(r.data.rules);
      setDirty(false);
      setRulesDirty(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  function updateRule(i, field, value) {
    setWeekdayRules((list) => list.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
    setRulesDirty(true);
  }
  function addRule(preset) {
    setWeekdayRules((list) => [...list, preset || { weekday: 6, nth: 1, type: "WFH", name: "" }]);
    setRulesDirty(true);
  }
  function removeRule(i) {
    setWeekdayRules((list) => list.filter((_, idx) => idx !== i));
    setRulesDirty(true);
  }
  function addQuickSetup() {
    setWeekdayRules((list) => [
      ...list,
      { weekday: 6, nth: 3, type: "HOLIDAY", name: "3rd Saturday" },
      { weekday: 6, nth: 1, type: "WFH", name: "1st Saturday (WFH)" },
    ]);
    setRulesDirty(true);
  }
  async function saveRules() {
    setRulesBusy(true);
    setError("");
    try {
      const { data } = await client.put("/settings/weekday-rules", { rules: weekdayRules });
      setWeekdayRules(data.rules);
      setRulesDirty(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRulesBusy(false);
    }
  }

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

      <div className="card">
        <h3 className="mt-0">Recurring Weekday Rules</h3>
        <p className="hint-text mt-0">
          Predefine patterns like "every 3rd Saturday is a holiday" or "every 1st Saturday is Work From Home" —
          resolved automatically every month, no need to mark it by hand each time. Holiday rules count like any
          other holiday; WFH rules count as present in payslip generation (unless that employee already has an
          explicit attendance record for that exact date).
        </p>
        {!weekdayRules ? <Loading /> : (
          <>
            {weekdayRules.length === 0 && (
              <button className="btn-sm" onClick={addQuickSetup}>+ Quick setup: 3rd Saturday holiday, 1st Saturday WFH</button>
            )}
            <table>
              <thead><tr><th>Occurrence</th><th>Weekday</th><th>Type</th><th>Name</th><th></th></tr></thead>
              <tbody>
                {weekdayRules.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <select value={r.nth} onChange={(e) => updateRule(i, "nth", Number(e.target.value))}>
                        {NTH_WORDS.map((w, idx) => <option key={w} value={idx + 1}>{w}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={r.weekday} onChange={(e) => updateRule(i, "weekday", Number(e.target.value))}>
                        {WEEKDAY_NAMES.map((w, idx) => <option key={w} value={idx}>{w}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={r.type} onChange={(e) => updateRule(i, "type", e.target.value)}>
                        <option value="HOLIDAY">Holiday</option>
                        <option value="WFH">WFH (Out of Office)</option>
                      </select>
                    </td>
                    <td><input value={r.name} onChange={(e) => updateRule(i, "name", e.target.value)} placeholder={`${NTH_WORDS[r.nth - 1]} ${WEEKDAY_NAMES[r.weekday]}`} /></td>
                    <td><button className="btn-sm btn-danger" onClick={() => removeRule(i)}>Delete</button></td>
                  </tr>
                ))}
                {weekdayRules.length === 0 && <tr><td colSpan={5} className="empty-state">No recurring weekday rules yet.</td></tr>}
              </tbody>
            </table>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button onClick={() => addRule()}>+ Add Rule</button>
              <button className="btn-primary" onClick={saveRules} disabled={rulesBusy || !rulesDirty}>{rulesBusy ? "Saving…" : "Save"}</button>
              {rulesDirty && <span className="hint-text">Unsaved changes</span>}
            </div>
          </>
        )}
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
