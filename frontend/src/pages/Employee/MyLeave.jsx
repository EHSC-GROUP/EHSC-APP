import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";

function currentFY() {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

export default function MyLeave() {
  const { user } = useAuth();
  const [balances, setBalances] = useState(null);
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState("");
  const [showApply, setShowApply] = useState(false);
  const fy = currentFY();

  async function load() {
    setError("");
    try {
      const [b, r] = await Promise.all([
        client.get(`/leave/balances/${user.userId}`, { params: { fy } }),
        client.get("/leave/requests/mine", { params: { fy } }),
      ]);
      setBalances(b.data.balances);
      setRequests(r.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  async function cancel(id) {
    if (!window.confirm("Cancel this leave request?")) return;
    try {
      await client.put(`/leave/requests/${id}/cancel`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Leave</h2>
        <button className="btn-primary" onClick={() => setShowApply(true)}>+ Apply for Leave</button>
      </div>

      {balances && (
        <div className="stat-cards">
          {Object.entries(balances).map(([id, b]) => (
            <div className="stat-card" key={id}>
              <div className="value">{b.remaining}</div>
              <div className="label">{id} remaining ({b.used}/{b.entitlement} used)</div>
            </div>
          ))}
        </div>
      )}

      <ErrorText>{error}</ErrorText>
      {!requests ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.leaveType}{r.halfDay ? " (H)" : ""}</td><td>{r.fromDate}</td><td>{r.toDate}</td><td>{r.days}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{["PENDING", "APPROVED"].includes(r.status) && <button className="btn-sm btn-danger" onClick={() => cancel(r.id)}>Cancel</button>}</td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td colSpan={6} className="empty-state">No leave requests yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showApply && (
        <ApplyLeaveModal
          leaveTypeIds={Object.keys(balances || {})}
          onClose={() => setShowApply(false)}
          onSubmitted={() => { setShowApply(false); load(); }}
        />
      )}
    </div>
  );
}

function ApplyLeaveModal({ leaveTypeIds, onClose, onSubmitted }) {
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leaveType, setLeaveType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { client.get("/leave-types").then((r) => setLeaveTypes(r.data)); }, []);

  useEffect(() => {
    if (!fromDate || !toDate || fromDate > toDate) { setPreview(null); return; }
    client.get("/leave/working-days-preview", { params: { from: fromDate, to: toDate, halfDay } })
      .then((r) => setPreview(r.data)).catch(() => setPreview(null));
  }, [fromDate, toDate, halfDay]);

  const medicalCertRequired = preview?.medicalCertRequired;
  const halfDayAllowed = !medicalCertRequired;

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (medicalCertRequired && !file) return setError("A medical certificate is required for leave longer than 3 working days");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("leaveType", leaveType);
      form.append("fromDate", fromDate);
      form.append("toDate", toDate);
      form.append("halfDay", halfDayAllowed && halfDay);
      form.append("reason", reason);
      if (file) form.append("medicalCert", file);
      await client.post("/leave/requests/self", form);
      onSubmitted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Apply for Leave" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Leave Type</label>
        <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} required>
          <option value="">Select…</option>
          {leaveTypes.map((lt) => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
        </select>
        <div className="form-row">
          <div><label>From</label><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} required /></div>
          <div><label>To</label><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} required /></div>
        </div>

        {preview && <p className="hint-text">Working days: {preview.fullDays}{halfDay && halfDayAllowed ? ` (net ${preview.days})` : ""}</p>}

        {halfDayAllowed && (
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} />
            Half-day trim on last day
          </label>
        )}

        <label>Reason</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />

        {medicalCertRequired && (
          <>
            <label>Medical Certificate (required for &gt;3 working days)</label>
            <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={(e) => setFile(e.target.files[0])} required />
          </>
        )}

        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Submitting…" : "Apply"}</button>
      </form>
    </Modal>
  );
}
