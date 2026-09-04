import { useEffect, useRef, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const PING_INTERVAL_MS = 60_000;

export default function MyAttendance() {
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
        <h2>Attendance</h2>
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
