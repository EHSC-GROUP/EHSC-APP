import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";
import StatusBadge from "../../components/StatusBadge";
import { getCurrentPosition } from "../../lib/geolocation";
import { useAuth } from "../../context/AuthContext";
import { fmtDate } from "../../lib/dates";
import DateInput from "../../components/DateInput";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const SOURCE_LABEL = { SELF_GEOFENCE: "Self check-in", BULK: "Bulk", SELF_OOO_REQUEST: "Self check-in", SELF_TRAVEL_REQUEST: "Travel request", SELF_WFH_REQUEST: "WFH request" };

export default function MyAttendance() {
  const { user } = useAuth();
  return (
    <div>
      <div className="toolbar" style={{ alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>🕐 My Attendance</h2>
          <p className="hint-text mt-0">Your daily attendance status and check-in history.</p>
        </div>
        <div className="spacer" />
        <div className="card" style={{ padding: "10px 16px", margin: 0, textAlign: "right" }}>
          <strong>{user?.name}</strong>
          <div className="hint-text">ID: {user?.userId}</div>
        </div>
      </div>
      <DailyStatusSection />
    </div>
  );
}

function DailyStatusSection() {
  const [month, setMonth] = useState(currentMonth());
  const [history, setHistory] = useState(null);
  const [geofence, setGeofence] = useState(null);
  const [oooRequests, setOooRequests] = useState(null);
  const [wfhRequests, setWfhRequests] = useState(null);
  const [submittingWfh, setSubmittingWfh] = useState(false);
  const [error, setError] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkInResult, setCheckInResult] = useState(null);
  const [checkOutResult, setCheckOutResult] = useState(null);
  const [lastCoords, setLastCoords] = useState(null);
  const [showOooForm, setShowOooForm] = useState(false);
  const [oooReason, setOooReason] = useState("");
  const [oooDate, setOooDate] = useState(todayISO());
  const [oooStartTime, setOooStartTime] = useState("09:00");
  const [oooEndTime, setOooEndTime] = useState("17:00");
  const [submittingOoo, setSubmittingOoo] = useState(false);

  async function loadHistory() {
    setError("");
    try {
      const { data } = await client.get("/attendance/my-status", { params: { month } });
      setHistory(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { loadHistory(); }, [month]);

  async function loadGeofenceStatus() {
    try {
      const { data } = await client.get("/attendance/geofence-status");
      setGeofence(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { loadGeofenceStatus(); }, []);

  async function loadOooRequests() {
    try {
      const { data } = await client.get("/attendance/ooo-requests/mine");
      setOooRequests(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { loadOooRequests(); }, []);

  async function loadWfhRequests() {
    try {
      const { data } = await client.get("/attendance/wfh-requests/mine");
      setWfhRequests(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { loadWfhRequests(); }, []);

  const today = todayISO();
  const todayRecord = (history || []).find((h) => h.date === today);
  const pendingOooToday = (oooRequests || []).find((r) => r.date === today && r.status === "PENDING");
  const pendingWfhToday = (wfhRequests || []).find((r) => r.date === today && r.status === "PENDING");

  // One tap, no description — goes to an admin for approval.
  async function requestWfh() {
    setSubmittingWfh(true);
    setError("");
    try {
      await client.post("/attendance/wfh-requests", { date: today });
      loadWfhRequests();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmittingWfh(false);
    }
  }

  async function checkIn() {
    setCheckingIn(true);
    setCheckInResult(null);
    setShowOooForm(false);
    setError("");
    try {
      const { lat, lng } = await getCurrentPosition();
      setLastCoords({ lat, lng });
      const { data } = await client.post("/attendance/check-in", { date: today, lat, lng });
      setCheckInResult({ ok: true, distanceMeters: data.distanceMeters });
      loadHistory();
    } catch (err) {
      if (err?.response?.data?.error) {
        setCheckInResult({ ok: false, message: err.response.data.error });
      } else {
        setError(err.message || errorMessage(err));
      }
    } finally {
      setCheckingIn(false);
    }
  }

  async function checkOut() {
    setCheckingOut(true);
    setCheckOutResult(null);
    setError("");
    try {
      const { lat, lng } = await getCurrentPosition();
      const { data } = await client.post("/attendance/check-out", { date: today, lat, lng });
      setCheckOutResult({ ok: true, distanceMeters: data.distanceMeters });
      loadHistory();
    } catch (err) {
      if (err?.response?.data?.error) {
        setCheckOutResult({ ok: false, message: err.response.data.error });
      } else {
        setError(err.message || errorMessage(err));
      }
    } finally {
      setCheckingOut(false);
    }
  }

  async function submitOoo() {
    if (!oooReason.trim()) return setError("Please give a reason for the On Duty request.");
    if (!oooDate || !oooStartTime || !oooEndTime || oooEndTime <= oooStartTime) {
      return setError("Choose a date and valid hours. End time must be later than start time.");
    }
    setSubmittingOoo(true);
    setError("");
    try {
      await client.post("/attendance/ooo-requests", {
        date: oooDate,
        startTime: oooStartTime,
        endTime: oooEndTime,
        reason: oooReason,
        lat: lastCoords?.lat,
        lng: lastCoords?.lng,
      });
      setShowOooForm(false);
      setOooReason("");
      setOooDate(today);
      setOooStartTime("09:00");
      setOooEndTime("17:00");
      setCheckInResult(null);
      loadOooRequests();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmittingOoo(false);
    }
  }

  const canCheckIn = geofence?.enabled && !todayRecord && !pendingOooToday && !pendingWfhToday;
  const canCheckOut = geofence?.enabled && todayRecord?.status === "PRESENT" && !todayRecord.checkedOutAt;

  return (
    <div className="card">
      <div className="hint-text" style={{ textTransform: "uppercase", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em" }}>Today</div>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <span className={`status-dot status-dot-${todayRecord?.status || "none"}`} />
        {todayRecord ? (
          <StatusBadge status={todayRecord.status} />
        ) : pendingOooToday ? (
          <span className="badge-pill badge-PENDING_OOO">On Duty — pending approval</span>
        ) : pendingWfhToday ? (
          <span className="badge-pill badge-PENDING_WFH">Work From Home — pending approval</span>
        ) : (
          <span className="text-muted">Not marked yet</span>
        )}
        <div className="spacer" />
        {canCheckIn && (
          <button className="btn-primary" onClick={checkIn} disabled={checkingIn}>
            {checkingIn ? "Checking in…" : "Check in"}
          </button>
        )}
        {canCheckOut && (
          <button className="btn-primary" onClick={checkOut} disabled={checkingOut}>
            {checkingOut ? "Checking out…" : "Check out"}
          </button>
        )}
      </div>

      {geofence && !geofence.enabled && !todayRecord && !pendingOooToday && (
        <p className="hint-text">Self check-in isn't enabled. Ask your admin to mark your attendance.</p>
      )}

      {!pendingOooToday && (
        <div style={{ marginTop: 8 }}>
          <div className="toolbar" style={{ margin: 0 }}>
            {!todayRecord && !pendingWfhToday && (
              <button className="btn-sm" onClick={requestWfh} disabled={submittingWfh}>
                {submittingWfh ? "Sending…" : "Work From Home"}
              </button>
            )}
            {!showOooForm && <button className="btn-sm" onClick={() => setShowOooForm(true)}>On Duty</button>}
          </div>
          {showOooForm && (
            <div style={{ marginTop: 8 }}>
              <div className="form-row" style={{ alignItems: "flex-start" }}>
                <div>
                  <label>Date</label>
                  <DateInput min={today} value={oooDate} onChange={(e) => setOooDate(e.target.value)} />
                </div>
                <div>
                  <label>From</label>
                  <input type="time" value={oooStartTime} onChange={(e) => setOooStartTime(e.target.value)} />
                </div>
                <div>
                  <label>To</label>
                  <input type="time" value={oooEndTime} onChange={(e) => setOooEndTime(e.target.value)} />
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <textarea
                  rows={2}
                  placeholder="Reason for being on duty (e.g. client site visit, field work)"
                  value={oooReason}
                  onChange={(e) => setOooReason(e.target.value)}
                />
              </div>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <button className="btn-sm btn-primary" onClick={submitOoo} disabled={submittingOoo}>{submittingOoo ? "Submitting…" : "Submit Request"}</button>
                <button className="btn-sm" onClick={() => setShowOooForm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {checkInResult?.ok && (
        <p className="hint-text" style={{ color: "var(--good, #0ca30c)" }}>
          Checked in — you were {checkInResult.distanceMeters}m from the office.
        </p>
      )}
      {checkInResult && !checkInResult.ok && (
        <div style={{ marginTop: 8 }}>
          <ErrorText>{checkInResult.message}</ErrorText>
          {!showOooForm && <button className="btn-sm" onClick={() => setShowOooForm(true)}>On Duty</button>}
        </div>
      )}
      {checkOutResult?.ok && (
        <p className="hint-text" style={{ color: "var(--good, #0ca30c)" }}>
          Checked out — you were {checkOutResult.distanceMeters}m from the office.
        </p>
      )}
      {checkOutResult && !checkOutResult.ok && <ErrorText>{checkOutResult.message}</ErrorText>}
      <ErrorText>{error}</ErrorText>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      {!history ? <Loading /> : (
        <table>
          <thead><tr><th>Date</th><th>Status</th><th>Source</th><th>Note</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.date}>
                <td>{fmtDate(h.date)}</td>
                <td><StatusBadge status={h.status} /></td>
                <td className="text-muted">{h.source === "ADMIN" ? "Admin" : SOURCE_LABEL[h.source] || "-"}</td>
                <td className="text-muted">{h.note || "-"}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={4} className="empty-state">No records this month.</td></tr>}
          </tbody>
        </table>
      )}
      {wfhRequests?.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>My Work From Home Requests</h3>
          <table>
            <thead><tr><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              {wfhRequests.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.date)}</td>
                  <td><span className={`badge-pill badge-${r.status}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {oooRequests?.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>My On Duty Requests</h3>
          <table>
            <thead><tr><th>Date</th><th>Hours</th><th>Reason</th><th>Status</th></tr></thead>
            <tbody>
              {oooRequests.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.startTime} - {r.endTime}</td>
                  <td>{r.reason}</td>
                  <td><span className={`badge-pill badge-${r.status}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
