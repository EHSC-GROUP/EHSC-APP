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

// Monday–Sunday week containing dateStr.
function weekBoundsOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const monday = new Date(d);
  monday.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { from: iso(monday), to: iso(sunday) };
}

// Calendar month containing dateStr.
function monthBoundsOf(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${dateStr.slice(0, 7)}-01`, to: `${dateStr.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

const STATUSES = ["PRESENT", "ABSENT", "LEAVE", "HALF_DAY", "OUT_OF_OFFICE", "TRAVEL"];
const STATUS_LABEL = { PRESENT: "Present", ABSENT: "Absent", LEAVE: "Leave", HALF_DAY: "Half Day", OUT_OF_OFFICE: "Out of Office", TRAVEL: "Travel" };
const SOURCE_LABEL = { ADMIN: "admin-marked", SELF_GEOFENCE: "self check-in", BULK: "bulk", SELF_OOO_REQUEST: "OOO request approved", SELF_TRAVEL_REQUEST: "Travel request approved" };

export default function Attendance() {
  return (
    <div>
      <div className="page-header"><h2>Attendance</h2></div>
      <DailyStatusTab />
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
  const [leaveTypes, setLeaveTypes] = useState([]);

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
  useEffect(() => { client.get("/leave-types").then(({ data }) => setLeaveTypes(data)).catch(() => {}); }, []);
  const leaveTypeName = (id) => leaveTypes.find((lt) => lt.id === id)?.name || id;

  async function loadSummary() {
    try {
      const { data } = await client.get("/attendance/status-summary", { params: { month } });
      setSummary(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { loadSummary(); }, [month]);

  async function mark(userId, status, leaveTypeId) {
    setError("");
    try {
      await client.post("/attendance/mark-status", { userId, date, status, leaveTypeId });
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

  async function markPresentRange(fromDate, toDate, label) {
    setBusy(true);
    setError("");
    try {
      const { data } = await client.post("/attendance/mark-all-present-range", { fromDate, toDate });
      await loadRoster();
      await loadSummary();
      alert(`Marked ${data.count} record(s) present across ${data.days} day(s) (${label}, ${fromDate} to ${toDate}). Days that already had a status were left untouched.`);
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

      <OooRequestsQueue onDecided={() => { loadRoster(); loadSummary(); }} />

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
        <div className="toolbar" style={{ marginTop: 0 }}>
          <span className="hint-text" style={{ marginRight: 4 }}>Bulk-mark present (gap-fill only, based on {date}):</span>
          <button
            className="btn-sm"
            disabled={busy}
            onClick={() => { const { from, to } = weekBoundsOf(date); markPresentRange(from, to, "this week"); }}
          >
            This Week
          </button>
          <button
            className="btn-sm"
            disabled={busy}
            onClick={() => { const { from, to } = monthBoundsOf(date); markPresentRange(from, to, "this month"); }}
          >
            This Month
          </button>
        </div>
        <ErrorText>{error}</ErrorText>
        {!roster ? <Loading /> : (
          <table>
            <thead><tr><th>Employee</th><th>Status</th><th>Source</th><th></th></tr></thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.userId}>
                  <td>{r.name} <span className="text-muted">({r.userId})</span></td>
                  <td>
                    {r.status ? <StatusBadge status={r.status} /> : <span className="text-muted">Not marked</span>}
                    {r.status === "LEAVE" && r.leaveTypeId && <div className="hint-text mt-0">{leaveTypeName(r.leaveTypeId)}</div>}
                  </td>
                  <td className="text-muted">{r.source ? SOURCE_LABEL[r.source] : "-"}</td>
                  <td>
                    <div className="toolbar" style={{ margin: 0 }}>
                      {STATUSES.map((s) =>
                        s === "LEAVE" ? (
                          <select
                            key={s}
                            className="btn-sm"
                            value={r.status === "LEAVE" ? r.leaveTypeId || "" : ""}
                            onChange={(e) => e.target.value && mark(r.userId, "LEAVE", e.target.value)}
                          >
                            <option value="">Leave…</option>
                            {leaveTypes.map((lt) => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
                          </select>
                        ) : (
                          <button key={s} className="btn-sm" disabled={r.status === s} onClick={() => mark(r.userId, s)}>
                            {STATUS_LABEL[s]}
                          </button>
                        )
                      )}
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
              <thead><tr><th>Employee</th><th>Present</th><th>Absent</th><th>Leave</th><th>Half Day</th><th>Out of Office</th><th>Travel</th><th>Present (incl. OOO/Travel)</th></tr></thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.userId}>
                    <td>{s.name}</td>
                    <td>{s.PRESENT}</td>
                    <td>{s.ABSENT}</td>
                    <td>{s.LEAVE}</td>
                    <td>{s.HALF_DAY}</td>
                    <td>{s.OUT_OF_OFFICE}</td>
                    <td>{s.TRAVEL}</td>
                    <td><strong>{s.PRESENT_EQUIVALENT}</strong></td>
                  </tr>
                ))}
                {summary.length === 0 && <tr><td colSpan={8} className="empty-state">No active employees.</td></tr>}
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

// A short approval queue for Out of Office requests — only PENDING ones,
// since approving/rejecting are the only actions that ever fire from here.
function OooRequestsQueue({ onDecided }) {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      const { data } = await client.get("/attendance/ooo-requests", { params: { status: "PENDING" } });
      setRequests(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  async function decide(id, action) {
    setBusyId(id);
    setError("");
    try {
      await client.put(`/attendance/ooo-requests/${id}/${action}`);
      await load();
      onDecided();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (requests && requests.length === 0) return null;

  return (
    <div className="card">
      <div className="toolbar">
        <h3 className="mt-0" style={{ marginRight: 8 }}>Out of Office Requests</h3>
        {requests && requests.length > 0 && <span className="badge-pill badge-PENDING_OOO">{requests.length} pending</span>}
      </div>
      <ErrorText>{error}</ErrorText>
      {!requests ? <Loading /> : (
        <table>
          <thead><tr><th>Employee</th><th>Date</th><th>Reason</th><th>Distance from office</th><th></th></tr></thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>{r.name} <span className="text-muted">({r.userId})</span></td>
                <td>{r.date}</td>
                <td>{r.reason}</td>
                <td className="text-muted">{r.distanceMeters != null ? `${r.distanceMeters}m` : "-"}</td>
                <td>
                  <div className="toolbar" style={{ margin: 0 }}>
                    <button className="btn-sm btn-primary" disabled={busyId === r.id} onClick={() => decide(r.id, "approve")}>Approve</button>
                    <button className="btn-sm btn-danger" disabled={busyId === r.id} onClick={() => decide(r.id, "reject")}>Reject</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
