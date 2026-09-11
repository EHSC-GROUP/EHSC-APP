import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";
import StatusBadge from "../../components/StatusBadge";
import { getCurrentPosition } from "../../lib/geolocation";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const STATUSES = ["PRESENT", "ABSENT", "LEAVE", "HALF_DAY"];
const STATUS_LABEL = { PRESENT: "Present", ABSENT: "Absent", LEAVE: "Leave", HALF_DAY: "Half Day" };
const SOURCE_LABEL = { ADMIN: "admin-marked", SELF_GEOFENCE: "self check-in", BULK: "bulk" };

export default function Attendance() {
  const [tab, setTab] = useState("Daily Status");

  return (
    <div>
      <div className="page-header"><h2>Attendance</h2></div>
      <div className="drawer-tabs">
        {["Daily Status", "Time Clock (Reference)"].map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "Daily Status" ? <DailyStatusTab /> : <TimeClockTab />}
    </div>
  );
}

function DailyStatusTab() {
  const [date, setDate] = useState(todayISO());
  const [roster, setRoster] = useState(null);
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadRoster() {
    setError("");
    try {
      const { data } = await client.get("/attendance/roster", { params: { date } });
      setRoster(data.roster);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { loadRoster(); }, [date]);

  async function loadSummary() {
    try {
      const { data } = await client.get("/attendance/status-summary", { params: { month } });
      setSummary(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { loadSummary(); }, [month]);

  async function mark(userId, status) {
    setError("");
    try {
      await client.post("/attendance/mark-status", { userId, date, status });
      loadRoster();
      if (month === date.slice(0, 7)) loadSummary();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function markAllPresent() {
    setBusy(true);
    setError("");
    try {
      const { data } = await client.post("/attendance/mark-all-present", { date });
      await loadRoster();
      if (month === date.slice(0, 7)) loadSummary();
      alert(`Marked ${data.count} employee(s) present.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const unmarkedCount = (roster || []).filter((r) => !r.status).length;

  return (
    <div>
      <p className="hint-text mt-0">
        Employees can never pick their own status from a dropdown — only an admin marking it, or a
        geofenced self check-in, ever creates a record.
      </p>

      <GeofenceSettings />

      <div className="card">
        <div className="toolbar">
          <h3 className="mt-0" style={{ marginRight: 8 }}>Today's Roster</h3>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="spacer" />
          {unmarkedCount > 0 && (
            <button className="btn-primary" onClick={markAllPresent} disabled={busy}>
              {busy ? "Marking…" : `Mark all present (${unmarkedCount})`}
            </button>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
        {!roster ? <Loading /> : (
          <table>
            <thead><tr><th>Employee</th><th>Status</th><th>Source</th><th></th></tr></thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.userId}>
                  <td>{r.name} <span className="text-muted">({r.userId})</span></td>
                  <td>{r.status ? <StatusBadge status={r.status} /> : <span className="text-muted">Not marked</span>}</td>
                  <td className="text-muted">{r.source ? SOURCE_LABEL[r.source] : "-"}</td>
                  <td>
                    <div className="toolbar" style={{ margin: 0 }}>
                      {STATUSES.map((s) => (
                        <button key={s} className="btn-sm" disabled={r.status === s} onClick={() => mark(r.userId, s)}>
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {roster.length === 0 && <tr><td colSpan={4} className="empty-state">No active employees.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <h3 className="mt-0" style={{ marginRight: 8 }}>Monthly Summary</h3>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        {!summary ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Present</th><th>Absent</th><th>Leave</th><th>Half Day</th></tr></thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.userId}>
                    <td>{s.name}</td>
                    <td>{s.PRESENT}</td>
                    <td>{s.ABSENT}</td>
                    <td>{s.LEAVE}</td>
                    <td>{s.HALF_DAY}</td>
                  </tr>
                ))}
                {summary.length === 0 && <tr><td colSpan={5} className="empty-state">No active employees.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function GeofenceSettings() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ lat: "", lng: "", radiusMeters: 200, enabled: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  async function load() {
    try {
      const { data } = await client.get("/attendance/geofence");
      setConfig(data);
      if (data) setForm({ lat: data.lat, lng: data.lng, radiusMeters: data.radiusMeters, enabled: data.enabled });
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function useMyLocation() {
    setError("");
    setLocating(true);
    try {
      const { lat, lng } = await getCurrentPosition();
      setForm((f) => ({ ...f, lat, lng }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLocating(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    if (form.lat === "" || form.lng === "") return setError("Set the office location first (use the button below, or it won't be accurate).");
    setBusy(true);
    try {
      await client.put("/attendance/geofence", form);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="toolbar" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer", marginBottom: open ? 12 : 0 }}>
        <h3 className="mt-0" style={{ margin: 0 }}>Self Check-in (Geofence) Settings</h3>
        <div className="spacer" />
        {config?.enabled && <span className="badge-pill badge-APPROVED">Enabled — {config.radiusMeters}m radius</span>}
        {config && !config.enabled && <span className="badge-pill badge-CANCELLED">Disabled</span>}
        <button type="button" className="btn-sm">{open ? "Hide" : "Configure"}</button>
      </div>

      {open && (
        <form onSubmit={save}>
          <p className="hint-text mt-0">
            Employees never see these coordinates — only whether check-in is available and the required radius.
          </p>
          <div className="toolbar">
            <button type="button" onClick={useMyLocation} disabled={locating}>
              {locating ? "Getting location…" : "Use my current location as the office"}
            </button>
            {form.lat !== "" && form.lng !== "" && (
              <span className="hint-text">Office set to {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}</span>
            )}
          </div>
          <div className="form-row">
            <div>
              <label>Radius (meters)</label>
              <input type="number" min="10" max="5000" value={form.radiusMeters} onChange={(e) => set("radiusMeters", e.target.value)} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
                Enable self check-in
              </label>
            </div>
          </div>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </form>
      )}
    </div>
  );
}

function TimeClockTab() {
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

  async function load() {
    setError("");
    try {
      const { data } = await client.get("/attendance/summary", { params: { month } });
      setSummary(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [month]);

  async function viewDetail(userId) {
    setSelected(userId);
    try {
      const { data } = await client.get(`/attendance/${userId}`, { params: { month } });
      setDetail(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <p className="hint-text">Login/logout session hours — reference only, never used to set payslip Present Days.</p>
      <ErrorText>{error}</ErrorText>
      {!summary ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Days Present</th><th>Total Hours</th><th></th></tr></thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.userId}>
                  <td>{s.name || s.userId}</td>
                  <td>{s.daysPresent}</td>
                  <td>{(s.totalMinutes / 60).toFixed(1)}</td>
                  <td><button className="btn-sm" onClick={() => viewDetail(s.userId)}>View</button></td>
                </tr>
              ))}
              {summary.length === 0 && <tr><td colSpan={4} className="empty-state">No attendance data.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="card">
          <h3>{selected} — daily log</h3>
          {!detail ? <Loading /> : (
            <table>
              <thead><tr><th>Date</th><th>Status</th><th>Total Minutes</th><th>Sessions</th></tr></thead>
              <tbody>
                {detail.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td><td>{d.status}</td><td>{d.totalMinutes}</td>
                    <td>{(d.sessions || []).map((s, i) => <div key={i}>{s.loginTime?.slice(11, 16)} - {s.logoutTime?.slice(11, 16) || "open"}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
