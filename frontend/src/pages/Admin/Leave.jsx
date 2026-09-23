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
      <div className="page-header"><h2>Leave Management</h2></div>
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
        <button
          className="btn-sm"
          onClick={() => openAuthedFile(`/api/leave/card/export/pdf?fy=${fy}`, { download: true, filename: `Leave_Cards_FY${fy}.pdf` }).catch((err) => setError(errorMessage(err)))}
        >
          Export Leave Cards (PDF)
        </button>
        <button
          className="btn-sm"
          onClick={() => openAuthedFile(`/api/leave/card/export/excel?fy=${fy}`, { download: true, filename: `Leave_Cards_FY${fy}.xlsx` }).catch((err) => setError(errorMessage(err)))}
        >
          Export Leave Cards (Excel)
        </button>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ Record Leave</button>
      </div>
      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Dept</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{r.name || r.userId}</td>
                  <td>{r.department || "-"}</td>
                  <td>{r.leaveType}{r.halfDay ? " (H)" : ""}</td>
                  <td>{r.fromDate}</td><td>{r.toDate}</td><td>{r.days}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.reason}{r.medicalCertLink && <> · <button className="btn-sm" onClick={() => openAuthedFile(r.medicalCertLink).catch((err) => setError(errorMessage(err)))}>cert</button></>}</td>
                  <td>
                    <div className="toolbar" style={{ margin: 0 }}>
                      {r.actions?.canApprove && <button className="btn-sm" onClick={() => decide(r.id, "approve")}>Approve</button>}
                      {r.actions?.canApprove && <button className="btn-sm" onClick={() => decide(r.id, "reject")}>Reject</button>}
                      {r.status === "PENDING" && !r.actions?.canApprove && <span className="hint-text">Awaiting {r.department || "department"} admin</span>}
                      {["PENDING", "APPROVED"].includes(r.status) && <button className="btn-sm btn-danger" onClick={() => decide(r.id, "cancel")}>Cancel</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={9} className="empty-state">No leave requests.</td></tr>}
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
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  // Whole roster in one request — every employee's balances load together
  // instead of one lookup at a time.
  async function load() {
    setError("");
    try {
      const { data } = await client.get("/leave/balances", { params: { fy } });
      setData(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [fy]);

  async function adjust(userId, leaveTypeId, current) {
    const value = window.prompt(`New entitlement for ${leaveTypeId} (FY ${fy}):`, current);
    if (value === null) return;
    try {
      await client.put(`/leave/balances/${userId}/${leaveTypeId}`, { fy, entitlement: Number(value) });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = (data?.employees || []).filter(
    (e) => !q || (e.name || "").toLowerCase().includes(q) || e.userId.toLowerCase().includes(q) || (e.department || "").toLowerCase().includes(q)
  );

  return (
    <div>
      <div className="toolbar">
        <input placeholder="Search name, ID, department…" style={{ width: 240 }} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
          FY <input type="number" style={{ width: 90 }} value={fy} onChange={(e) => setFy(Number(e.target.value))} />
        </label>
      </div>
      <ErrorText>{error}</ErrorText>
      {!data ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                {data.leaveTypes.map((lt) => <th key={lt.id}>{lt.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.userId}>
                  <td>{e.name || e.userId}<div className="hint-text mt-0">{e.userId}</div></td>
                  <td>{e.department || "-"}</td>
                  {data.leaveTypes.map((lt) => {
                    const b = e.balances[lt.id] || { entitlement: 0, used: 0, remaining: 0 };
                    return (
                      <td key={lt.id}>
                        <span className={b.remaining <= 0 ? "wallet-amt-debit" : "wallet-amt-credit"}>{b.remaining}</span>
                        <span className="hint-text"> / {b.entitlement} (used {b.used})</span>
                        <button className="btn-sm" style={{ marginLeft: 8 }} onClick={() => adjust(e.userId, lt.id, b.entitlement)}>Adjust</button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={2 + data.leaveTypes.length} className="empty-state">No employees found.</td></tr>}
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
  const [form, setForm] = useState({ name: "", paidDaysPerYear: "", carryForward: false, monthlyCap: "", accrualPerMonth: "" });
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
        accrualPerMonth: form.accrualPerMonth === "" ? null : Number(form.accrualPerMonth),
      });
      setForm({ name: "", paidDaysPerYear: "", carryForward: false, monthlyCap: "", accrualPerMonth: "" });
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
          <div><label>Accrual / Month (blank = none)</label><input type="number" min="0" step="0.5" value={form.accrualPerMonth} onChange={(e) => set("accrualPerMonth", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={form.carryForward} onChange={(e) => set("carryForward", e.target.checked)} />
              Carry forward unused days to next FY
            </label>
          </div>
          <div />
        </div>
        <p className="hint-text mt-0">
          Accrual / Month automatically adds that many days to every active employee's entitlement on the 1st of
          each month, on top of whatever they already have — it does not replace or reset the current balance.
        </p>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Add"}</button>
      </form>

      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Name</th><th>Paid Days/Yr</th><th>Monthly Cap</th><th>Accrual/Month</th><th>Carry Forward</th><th></th></tr></thead>
            <tbody>
              {list.map((lt) => (
                <tr key={lt.id}>
                  <td>{lt.id}</td><td>{lt.name}</td><td>{lt.paidDaysPerYear}</td>
                  <td>{lt.monthlyCap ?? "Uncapped"}</td><td>{lt.accrualPerMonth ?? "None"}</td><td>{lt.carryForward ? "Yes" : "No"}</td>
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
