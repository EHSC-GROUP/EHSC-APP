import { useEffect, useRef, useState } from "react";
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

const PING_INTERVAL_MS = 60_000;
const SOURCE_LABEL = { SELF_GEOFENCE: "self check-in", BULK: "bulk" };

export default function MyAttendance() {
  return (
    <div>
      <div className="page-header"><h2>Attendance</h2></div>
      <DailyStatusSection />
      <TimeClockSection />
    </div>
  );
}

function DailyStatusSection() {
  const [month, setMonth] = useState(currentMonth());
  const [history, setHistory] = useState(null);
  const [geofence, setGeofence] = useState(null);
  const [error, setError] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInResult, setCheckInResult] = useState(null);

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

  const today = todayISO();
  const todayRecord = (history || []).find((h) => h.date === today);

  async function checkIn() {
    setCheckingIn(true);
    setCheckInResult(null);
    setError("");
    try {
      const { lat, lng } = await getCurrentPosition();
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

  const canCheckIn = geofence?.enabled && !todayRecord;

  return (
    <div className="card">
      <div className="toolbar">
        <h3 className="mt-0" style={{ marginRight: 8 }}>Today's Status</h3>
        <span className={`status-dot status-dot-${todayRecord?.status || "none"}`} />
        {todayRecord ? <StatusBadge status={todayRecord.status} /> : <span className="text-muted">Not marked yet</span>}
        <div className="spacer" />
        {canCheckIn && (
          <button className="btn-primary" onClick={checkIn} disabled={checkingIn}>
            {checkingIn ? "Checking in…" : "Check in"}
          </button>
        )}
      </div>

      {geofence && !geofence.enabled && !todayRecord && (
        <p className="hint-text">Self check-in isn't enabled. Ask your admin to mark your attendance.</p>
      )}

      {checkInResult?.ok && (
        <p className="hint-text" style={{ color: "var(--good, #0ca30c)" }}>
          Checked in — you were {checkInResult.distanceMeters}m from the office.
        </p>
      )}
      {checkInResult && !checkInResult.ok && <ErrorText>{checkInResult.message}</ErrorText>}
      <ErrorText>{error}</ErrorText>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <h3 className="mt-0" style={{ marginRight: 8 }}>Monthly History</h3>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      {!history ? <Loading /> : (
        <table>
          <thead><tr><th>Date</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.date}>
                <td>{h.date}</td>
                <td><StatusBadge status={h.status} /></td>
                <td className="text-muted">{h.source !== "ADMIN" ? SOURCE_LABEL[h.source] || "" : ""}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={3} className="empty-state">No records this month.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TimeClockSection() {
  const [month, setMonth] = useState(currentMonth());
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const pingRef = useRef(null);

  async function load() {
    setError("");
    try {
      const { data } = await client.get("/attendance/me", { params: { month } });
      setLogs(data);
      const today = new Date().toISOString().slice(0, 10);
      const todayLog = data.find((d) => d.date === today);
      setSessionActive(todayLog?.status === "IN_PROGRESS");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [month]);

  useEffect(() => {
    if (sessionActive) {
      pingRef.current = setInterval(() => client.post("/attendance/ping").catch(() => {}), PING_INTERVAL_MS);
    }
    return () => clearInterval(pingRef.current);
  }, [sessionActive]);

  async function login() {
    try {
      await client.post("/attendance/login");
      setSessionActive(true);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function logout() {
    try {
      await client.post("/attendance/logout");
      setSessionActive(false);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="page-header">
        <h3>Time Clock (Reference)</h3>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      <div className="card toolbar">
        {sessionActive ? (
          <>
            <span className="badge-pill badge-APPROVED">Session Active</span>
            <button className="btn-danger" onClick={logout}>Log Out of Session</button>
          </>
        ) : (
          <button className="btn-primary" onClick={login}>Log In Session</button>
        )}
      </div>
      <p className="hint-text">This is informational only and never determines your payslip Present Days.</p>

      <ErrorText>{error}</ErrorText>
      {!logs ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Status</th><th>Total Hours</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.date}><td>{l.date}</td><td>{l.status}</td><td>{(l.totalMinutes / 60).toFixed(1)}</td></tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={3} className="empty-state">No attendance recorded this month.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
