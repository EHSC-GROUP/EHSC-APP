import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";
import StatusBadge from "../../components/StatusBadge";
import { getCurrentPosition } from "../../lib/geolocation";
import { useAuth } from "../../context/AuthContext";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const SOURCE_LABEL = { SELF_GEOFENCE: "Self check-in", BULK: "Bulk", SELF_OOO_REQUEST: "Self check-in" };

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
  const [error, setError] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInResult, setCheckInResult] = useState(null);
  const [lastCoords, setLastCoords] = useState(null);
  const [showOooForm, setShowOooForm] = useState(false);
  const [oooReason, setOooReason] = useState("");
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

  const today = todayISO();
  const todayRecord = (history || []).find((h) => h.date === today);
  const pendingOooToday = (oooRequests || []).find((r) => r.date === today && r.status === "PENDING");

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

  async function submitOoo() {
    if (!oooReason.trim()) return setError("Please give a reason for the Out of Office request.");
    setSubmittingOoo(true);
    setError("");
    try {
      await client.post("/attendance/ooo-requests", {
        date: today,
        reason: oooReason,
        lat: lastCoords?.lat,
        lng: lastCoords?.lng,
      });
      setShowOooForm(false);
      setOooReason("");
      setCheckInResult(null);
      loadOooRequests();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmittingOoo(false);
    }
  }

  const canCheckIn = geofence?.enabled && !todayRecord && !pendingOooToday;

  return (
    <div className="card">
      <div className="hint-text" style={{ textTransform: "uppercase", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em" }}>Today</div>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <span className={`status-dot status-dot-${todayRecord?.status || "none"}`} />
        {todayRecord ? (
          <StatusBadge status={todayRecord.status} />
        ) : pendingOooToday ? (
          <span className="badge-pill badge-PENDING_OOO">Out of Office — pending approval</span>
        ) : (
          <span className="text-muted">Not marked yet</span>
        )}
        <div className="spacer" />
        {canCheckIn && (
          <button className="btn-primary" onClick={checkIn} disabled={checkingIn}>
            {checkingIn ? "Checking in…" : "Check in"}
          </button>
        )}
      </div>

      {geofence && !geofence.enabled && !todayRecord && !pendingOooToday && (
        <p className="hint-text">Self check-in isn't enabled. Ask your admin to mark your attendance.</p>
      )}

      {checkInResult?.ok && (
        <p className="hint-text" style={{ color: "var(--good, #0ca30c)" }}>
          Checked in — you were {checkInResult.distanceMeters}m from the office.
        </p>
      )}
      {checkInResult && !checkInResult.ok && (
        <div style={{ marginTop: 8 }}>
          <ErrorText>{checkInResult.message}</ErrorText>
          {!showOooForm ? (
            <button className="btn-sm" onClick={() => setShowOooForm(true)}>Request Out of Office</button>
          ) : (
            <div className="form-row" style={{ marginTop: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <textarea
                  rows={2}
                  placeholder="Why are you out of office today? (e.g. client site visit, field work)"
                  value={oooReason}
                  onChange={(e) => setOooReason(e.target.value)}
                />
              </div>
              <button className="btn-sm btn-primary" onClick={submitOoo} disabled={submittingOoo}>{submittingOoo ? "Submitting…" : "Submit Request"}</button>
              <button className="btn-sm" onClick={() => setShowOooForm(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
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
                <td>{h.date}</td>
                <td><StatusBadge status={h.status} /></td>
                <td className="text-muted">{h.source === "ADMIN" ? "Admin" : SOURCE_LABEL[h.source] || "-"}</td>
                <td className="text-muted">{h.note || "-"}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={4} className="empty-state">No records this month.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

