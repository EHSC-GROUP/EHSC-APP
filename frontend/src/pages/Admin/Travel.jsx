import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";

// Approval of travel requests. Approving marks the employee as "Travel"
// (counted as present) on the requested date.
export default function Travel() {
  const [status, setStatus] = useState("PENDING");
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setError("");
    try {
      const { data } = await client.get("/attendance/travel-requests", { params: status ? { status } : {} });
      setRequests(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [status]);

  async function decide(id, action) {
    setBusyId(id);
    setError("");
    try {
      await client.put(`/attendance/travel-requests/${id}/${action}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header"><h2>Travel</h2></div>
      <p className="hint-text mt-0">
        Employees ask for approval to travel on a date, often in advance. Approving marks them as on Travel for that
        day, which counts as present.
      </p>

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180 }}>
          <option value="PENDING">Pending approval</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All requests</option>
        </select>
      </div>

      <ErrorText>{error}</ErrorText>
      {!requests ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Travel Date</th><th>Reason</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.name} <span className="text-muted">({r.userId})</span></td>
                  <td>{r.date}</td>
                  <td>{r.reason}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    {r.status === "PENDING" && (
                      <div className="toolbar" style={{ margin: 0 }}>
                        <button className="btn-sm btn-primary" disabled={busyId === r.id} onClick={() => decide(r.id, "approve")}>Approve</button>
                        <button className="btn-sm btn-danger" disabled={busyId === r.id} onClick={() => decide(r.id, "reject")}>Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td colSpan={5} className="empty-state">No travel requests.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
