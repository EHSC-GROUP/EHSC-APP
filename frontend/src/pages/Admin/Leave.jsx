import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";
import { openAuthedFile } from "../../lib/openFile";

function currentFY() {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

export default function Leave() {
  const [tab, setTab] = useState("Register");
  return (
    <div>
      <div className="page-header"><h2>Leave</h2></div>
      <div className="drawer-tabs">
        {["Register", "Balances", "Types"].map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "Register" && <LeaveRegister />}
      {tab === "Balances" && <LeaveBalances />}
      {tab === "Types" && <LeaveTypes />}
    </div>
  );
}

function LeaveRegister() {
  const [fy, setFy] = useState(currentFY());
  const [status, setStatus] = useState("");
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setError("");
    try {
      const params = { fy };
      if (status) params.status = status;
      const { data } = await client.get("/leave/requests", { params });
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [fy, status]);

  async function decide(id, verb) {
    const comment = verb === "reject" ? window.prompt("Reason (optional):") || "" : undefined;
    try {
      await client.put(`/leave/requests/${id}/${verb}`, comment !== undefined ? { comment } : {});
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <label style={{ margin: 0 }}>FY</label>
        <input type="number" style={{ width: 100 }} value={fy} onChange={(e) => setFy(Number(e.target.value))} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
          <option value="">All statuses</option>
          {["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="spacer" />
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ Record Leave</button>
      </div>
      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{r.name || r.userId}</td>
                  <td>{r.leaveType}{r.halfDay ? " (H)" : ""}</td>
                  <td>{r.fromDate}</td><td>{r.toDate}</td><td>{r.days}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.reason}{r.medicalCertLink && <> · <button className="btn-sm" onClick={() => openAuthedFile(r.medicalCertLink).catch((err) => setError(errorMessage(err)))}>cert</button></>}</td>
                  <td>
                    <div className="toolbar" style={{ margin: 0 }}>
                      {r.status === "PENDING" && <button className="btn-sm" onClick={() => decide(r.id, "approve")}>Approve</button>}
                      {r.status === "PENDING" && <button className="btn-sm" onClick={() => decide(r.id, "reject")}>Reject</button>}
                      {["PENDING", "APPROVED"].includes(r.status) && <button className="btn-sm btn-danger" onClick={() => decide(r.id, "cancel")}>Cancel</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={8} className="empty-state">No leave requests.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {showNew && <RecordLeaveModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function RecordLeaveModal({ onClose, onCreated }) {
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [form, setForm] = useState({ userId: "", leaveType: "", fromDate: "", toDate: "", halfDay: false, reason: "" });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { client.get("/leave-types").then((r) => setLeaveTypes(r.data)); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  useEffect(() => {
    if (form.leaveType === "HALF_DAY" || !form.fromDate || !form.toDate || form.fromDate > form.toDate) { setPreview(null); return; }
    client.get("/leave/working-days-preview", { params: { from: form.fromDate, to: form.toDate, halfDay: form.halfDay } })
      .then((r) => setPreview(r.data)).catch(() => setPreview(null));
  }, [form.fromDate, form.toDate, form.halfDay, form.leaveType]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.post("/leave/requests", { ...form, userId: form.userId.toUpperCase() });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const isHalfDayType = form.leaveType === "HALF_DAY";

  return (
    <Modal title="Record Leave" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Employee User ID</label>
        <input value={form.userId} onChange={(e) => set("userId", e.target.value)} required />
        <label>Leave Type</label>
        <select value={form.leaveType} onChange={(e) => set("leaveType", e.target.value)} required>
          <option value="">Select…</option>
          {leaveTypes.map((lt) => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
          <option value="LOP">Loss of Pay (admin only)</option>
          <option value="HALF_DAY">Half Day (admin only)</option>
        </select>
        <div className="form-row">
          <div><label>From</label><input type="date" value={form.fromDate} onChange={(e) => set("fromDate", e.target.value)} required /></div>
          <div><label>To</label><input type="date" value={isHalfDayType ? form.fromDate : form.toDate} onChange={(e) => set("toDate", e.target.value)} disabled={isHalfDayType} required /></div>
        </div>
        {!isHalfDayType && (
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={form.halfDay} onChange={(e) => set("halfDay", e.target.checked)} />
            Half-day trim on last day
          </label>
        )}
        {preview && <p className="hint-text">Working days: {preview.fullDays}{form.halfDay ? ` (net ${preview.days})` : ""}</p>}
        <label>Reason</label>
        <textarea value={form.reason} onChange={(e) => set("reason", e.target.value)} rows={2} />
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Record"}</button>
      </form>
    </Modal>
  );
}

function LeaveBalances() {
  const [fy, setFy] = useState(currentFY());
  const [userId, setUserId] = useState("");
  const [balances, setBalances] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    if (!userId) return;
    setError("");
    try {
      const { data } = await client.get(`/leave/balances/${userId.toUpperCase()}`, { params: { fy } });
      setBalances(data.balances);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function adjust(leaveTypeId, current) {
    const value = window.prompt(`New entitlement for ${leaveTypeId} (FY ${fy}):`, current);
    if (value === null) return;
    try {
      await client.put(`/leave/balances/${userId.toUpperCase()}/${leaveTypeId}`, { fy, entitlement: Number(value) });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <input placeholder="Employee User ID" style={{ width: 200 }} value={userId} onChange={(e) => setUserId(e.target.value)} />
        <input type="number" style={{ width: 100 }} value={fy} onChange={(e) => setFy(Number(e.target.value))} />
        <button onClick={load}>Load</button>
      </div>
      <ErrorText>{error}</ErrorText>
      {balances && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Leave Type</th><th>Entitlement</th><th>Used</th><th>Remaining</th><th></th></tr></thead>
            <tbody>
              {Object.entries(balances).map(([id, b]) => (
                <tr key={id}>
                  <td>{id}</td><td>{b.entitlement}</td><td>{b.used}</td><td>{b.remaining}</td>
                  <td><button className="btn-sm" onClick={() => adjust(id, b.entitlement)}>Adjust</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LeaveTypes() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", paidDaysPerYear: "", carryForward: false, monthlyCap: "" });
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await client.get("/leave-types");
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.post("/leave-types", {
        ...form,
        paidDaysPerYear: Number(form.paidDaysPerYear),
        monthlyCap: form.monthlyCap === "" ? null : Number(form.monthlyCap),
      });
      setForm({ name: "", paidDaysPerYear: "", carryForward: false, monthlyCap: "" });
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm(`Delete leave type ${id}?`)) return;
    try {
      await client.delete(`/leave-types/${id}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="card">
        <h3 className="mt-0">Add Leave Type</h3>
        <div className="form-row">
          <div><label>Name</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
          <div><label>Paid Days / Year</label><input type="number" min="0" value={form.paidDaysPerYear} onChange={(e) => set("paidDaysPerYear", e.target.value)} required /></div>
        </div>
        <div className="form-row">
          <div><label>Monthly Cap (blank = uncapped)</label><input type="number" min="0" value={form.monthlyCap} onChange={(e) => set("monthlyCap", e.target.value)} /></div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={form.carryForward} onChange={(e) => set("carryForward", e.target.checked)} />
              Carry forward unused days to next FY
            </label>
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Add"}</button>
      </form>

      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Name</th><th>Paid Days/Yr</th><th>Monthly Cap</th><th>Carry Forward</th><th></th></tr></thead>
            <tbody>
              {list.map((lt) => (
                <tr key={lt.id}>
                  <td>{lt.id}</td><td>{lt.name}</td><td>{lt.paidDaysPerYear}</td>
                  <td>{lt.monthlyCap ?? "Uncapped"}</td><td>{lt.carryForward ? "Yes" : "No"}</td>
                  <td><button className="btn-sm btn-danger" onClick={() => remove(lt.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
