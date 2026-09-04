import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText } from "../../components/Misc";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Attendance() {
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
      <div className="page-header">
        <h2>Attendance</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <p className="hint-text">Reference only — never used to set payslip Present Days.</p>
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
