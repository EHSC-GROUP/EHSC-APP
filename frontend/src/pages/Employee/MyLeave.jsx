import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";
import { openAuthedFile } from "../../lib/openFile";
import DateInput from "../../components/DateInput";
import { fmtDate } from "../../lib/dates";

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
  const [showComp, setShowComp] = useState(false);
  const [compRequests, setCompRequests] = useState([]);
  const fy = currentFY();

  async function load() {
    setError("");
    try {
      const [b, r, c] = await Promise.all([
        client.get(`/leave/balances/${user.userId}`, { params: { fy } }),
        client.get("/leave/requests/mine", { params: { fy } }),
        client.get("/leave/comp-off/mine"),
      ]);
      setBalances(b.data.balances);
      setRequests(r.data);
      setCompRequests(c.data);
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
        <div className="toolbar">
          <button
            className="btn-sm"
            onClick={() => openAuthedFile(`/api/leave/card/${user.userId}/pdf?fy=${fy}`, { download: true, filename: `Leave_Card_FY${fy}.pdf` }).catch((err) => setError(errorMessage(err)))}
          >
            Download Leave Card
          </button>
          <button className="btn-sm" onClick={() => setShowComp(true)}>Request Comp Off</button>
          <button className="btn-primary" onClick={() => setShowApply(true)}>+ Apply for Leave</button>
        </div>
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
                  <td>{r.leaveType}{r.halfDay ? " (H)" : ""}</td><td>{fmtDate(r.fromDate)}</td><td>{fmtDate(r.toDate)}</td><td>{r.days}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{["PENDING", "APPROVED"].includes(r.status) && <button className="btn-sm btn-danger" onClick={() => cancel(r.id)}>Cancel</button>}</td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td colSpan={6} className="empty-state">No leave requests yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {compRequests.length > 0 && (
        <div className="card table-wrap">
          <h3 className="mt-0">Comp Off</h3>
          <table>
            <thead><tr><th>Day worked</th><th>Makes up leave</th><th>Days given back</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {compRequests.map((c) => (
                <tr key={c.id}>
                  <td>{fmtDate(c.workedDate)}</td>
                  <td>{c.leaveType} · {fmtDate(c.leaveFrom)} - {fmtDate(c.leaveTo)}</td>
                  <td>{c.credit}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.status === "PENDING" && <button className="btn-sm btn-danger" onClick={async () => { try { await client.put(`/leave/comp-off/${c.id}/cancel`); load(); } catch (err) { setError(errorMessage(err)); } }}>Cancel</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showComp && <CompOffModal onClose={() => setShowComp(false)} onSubmitted={() => { setShowComp(false); load(); }} />}

      {showApply && (
        <ApplyLeaveModal
          leaveTypeIds={Object.keys(balances || {})}
          requests={requests}
          onClose={() => setShowApply(false)}
          onSubmitted={() => { setShowApply(false); load(); }}
        />
      )}
    </div>
  );
}

// Work on a holiday or weekly off to give back a leave day already taken.
function CompOffModal({ onClose, onSubmitted }) {
  const [options, setOptions] = useState(null);
  const [workedDate, setWorkedDate] = useState("");
  const [leaveRequestId, setLeaveRequestId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get("/leave/comp-off/options").then((r) => setOptions(r.data)).catch((err) => setError(errorMessage(err)));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.post("/leave/comp-off", { workedDate, leaveRequestId });
      onSubmitted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Request Comp Off" onClose={onClose}>
      <p className="hint-text mt-0">
        Worked on a holiday or weekly off to make up for a leave you took? Once approved, that leave day is given back to your balance.
      </p>
      {!options ? <Loading /> : (
        <form onSubmit={submit}>
          <label>Day you worked</label>
          <select value={workedDate} onChange={(e) => setWorkedDate(e.target.value)} required>
            <option value="">Select…</option>
            {options.workedDays.map((d) => <option key={d.date} value={d.date}>{fmtDate(d.date)}{d.credit < 1 ? " (half day)" : ""}</option>)}
          </select>
          {options.workedDays.length === 0 && <p className="hint-text">No eligible day. You need attendance marked on a holiday or weekly off.</p>}
          <label>Leave it makes up for</label>
          <select value={leaveRequestId} onChange={(e) => setLeaveRequestId(e.target.value)} required>
            <option value="">Select…</option>
            {options.leaves.map((l) => <option key={l.id} value={l.id}>{l.leaveType} · {fmtDate(l.fromDate)} - {fmtDate(l.toDate)} ({l.available} day{l.available === 1 ? "" : "s"} to give back)</option>)}
          </select>
          {options.leaves.length === 0 && <p className="hint-text">No approved leave with days left to give back.</p>}
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy || !workedDate || !leaveRequestId}>{busy ? "Submitting…" : "Submit"}</button>
        </form>
      )}
    </Modal>
  );
}

function ApplyLeaveModal({ leaveTypeIds, requests, onClose, onSubmitted }) {
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [leaveType, setLeaveType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { client.get("/leave-types").then((r) => setLeaveTypes(r.data)); }, []);

  useEffect(() => {
    if (!fromDate || !toDate || fromDate > toDate) { setPreview(null); return; }
    client.get("/leave/working-days-preview", { params: { from: fromDate, to: toDate, halfDay } })
      .then((r) => setPreview(r.data)).catch(() => setPreview(null));
  }, [fromDate, toDate, halfDay]);

  const halfDayAllowed = true;

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("leaveType", leaveType);
      form.append("fromDate", fromDate);
      form.append("toDate", toDate);
      form.append("halfDay", halfDayAllowed && halfDay);
      form.append("reason", reason);
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
          <div><label>From</label><DateInput value={fromDate} onChange={(e) => setFromDate(e.target.value)} required /></div>
          <div><label>To</label><DateInput value={toDate} onChange={(e) => setToDate(e.target.value)} required /></div>
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

        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Submitting…" : "Apply"}</button>
      </form>
    </Modal>
  );
}
