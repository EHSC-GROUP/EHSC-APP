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

const SOURCE_LABEL = { SELF_GEOFENCE: "Self check-in", BULK: "Bulk", SELF_OOO_REQUEST: "Self check-in", SELF_TRAVEL_REQUEST: "Travel request" };

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

// Explains location access before the browser's own permission prompt
// appears, so the first check-in doesn't feel like a random popup. Shows
// the fix in plain words if the browser has already blocked it.
function LocationPermissionNotice() {
  const [state, setState] = useState(null); // "granted" | "prompt" | "denied" | null (unknown)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let status;
    let cancelled = false;
    if (!navigator.permissions?.query) {
      setState("prompt");
      return;
    }
    navigator.permissions.query({ name: "geolocation" }).then((s) => {
      if (cancelled) return;
      status = s;
      setState(s.state);
      s.onchange = () => setState(s.state);
    }).catch(() => setState("prompt"));
    return () => { cancelled = true; if (status) status.onchange = null; };
  }, []);

  async function enable() {
    setBusy(true);
    setError("");
    try {
      await getCurrentPosition();
      setState("granted");
    } catch (err) {
      setError(err.message);
      setState((s) => (s === "granted" ? "prompt" : s));
    } finally {
      setBusy(false);
    }
  }

  if (state === "granted" || state === null) return null;

  if (state === "denied") {
    return (
      <div className="card" style={{ borderLeft: "4px solid #d97706" }}>
        <strong>Location is blocked for this site</strong>
        <p className="hint-text mt-0">
          Check-in needs your location to confirm you're at the office. Click the lock icon in the address bar,
          open Site settings, set Location to <em>Allow</em>, then refresh this page.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ borderLeft: "4px solid #1d4ed8" }}>
      <strong>Turn on location to mark attendance</strong>
      <p className="hint-text mt-0">
        Check-in uses your location only at the moment you tap it, to confirm you're inside the office area.
        Your browser will ask for permission next — tap <em>Allow</em>.
      </p>
      <button className="btn-primary" onClick={enable} disabled={busy}>
        {busy ? "Waiting for permission…" : "Enable location"}
      </button>
      <ErrorText>{error}</ErrorText>
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
  const [travelRequests, setTravelRequests] = useState(null);
  const [showTravelForm, setShowTravelForm] = useState(false);
  const [travelReason, setTravelReason] = useState("");
  const [submittingTravel, setSubmittingTravel] = useState(false);

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

  async function loadTravelRequests() {
    try {
      const { data } = await client.get("/attendance/travel-requests/mine");
      setTravelRequests(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { loadTravelRequests(); }, []);

  const today = todayISO();
  const todayRecord = (history || []).find((h) => h.date === today);
  const pendingOooToday = (oooRequests || []).find((r) => r.date === today && r.status === "PENDING");
  const pendingTravelToday = (travelRequests || []).find((r) => r.date === today && r.status === "PENDING");

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

  async function submitTravel() {
    if (!travelReason.trim()) return setError("Please give a reason for the travel request.");
    setSubmittingTravel(true);
    setError("");
    try {
      await client.post("/attendance/travel-requests", { date: today, reason: travelReason });
      setShowTravelForm(false);
      setTravelReason("");
      loadTravelRequests();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmittingTravel(false);
    }
  }

  const canCheckIn = geofence?.enabled && !todayRecord && !pendingOooToday && !pendingTravelToday;

  return (
    <>
      {canCheckIn && <LocationPermissionNotice />}
      <div className="card">
      <div className="hint-text" style={{ textTransform: "uppercase", fontWeight: 700, fontSize: 11, letterSpacing: "0.05em" }}>Today</div>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <span className={`status-dot status-dot-${todayRecord?.status || "none"}`} />
        {todayRecord ? (
          <StatusBadge status={todayRecord.status} />
        ) : pendingOooToday ? (
          <span className="badge-pill badge-PENDING_OOO">Out of Office — pending approval</span>
        ) : pendingTravelToday ? (
          <span className="badge-pill badge-PENDING_TRAVEL">Travel — pending approval</span>
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

      {!todayRecord && !pendingOooToday && !pendingTravelToday && (
        <div style={{ marginTop: 8 }}>
          {!showTravelForm ? (
            <button className="btn-sm" onClick={() => setShowTravelForm(true)}>Request to Travel</button>
          ) : (
            <div className="form-row" style={{ marginTop: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <textarea
                  rows={2}
                  placeholder="Where are you traveling for work, and why? (e.g. client site visit)"
                  value={travelReason}
                  onChange={(e) => setTravelReason(e.target.value)}
                />
              </div>
              <button className="btn-sm btn-primary" onClick={submitTravel} disabled={submittingTravel}>{submittingTravel ? "Submitting…" : "Submit Request"}</button>
              <button className="btn-sm" onClick={() => setShowTravelForm(false)}>Cancel</button>
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
    </>
  );
}

