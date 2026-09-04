import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";
import VoucherForm from "../../components/VoucherForm";
import { openAuthedFile } from "../../lib/openFile";

export default function Reimbursements() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showAccess, setShowAccess] = useState(false);

  async function load() {
    setError("");
    try {
      const params = {};
      if (status) params.status = status;
      const { data } = await client.get("/reimbursements/admin", { params });
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [status]);

  async function decide(id, verb, extra) {
    try {
      await client.put(`/reimbursements/${id}/${verb}`, extra || {});
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function markPaid(id) {
    const paymentRef = window.prompt("Payment reference:");
    if (!paymentRef) return;
    const paymentDate = window.prompt("Payment date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!paymentDate) return;
    decide(id, "mark-paid", { paymentRef, paymentDate });
  }

  const totals = (list || []).reduce(
    (acc, r) => {
      acc.total += r.totalAmount;
      if (r.status === "PENDING") acc.pending += r.totalAmount;
      if (r.status === "PAID") acc.paid += r.totalAmount;
      return acc;
    },
    { total: 0, pending: 0, paid: 0 }
  );

  return (
    <div>
      <div className="page-header">
        <h2>Reimbursements</h2>
        <div className="toolbar">
          <button onClick={() => setShowAccess(true)}>Manage Access</button>
          <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Voucher</button>
        </div>
      </div>

      <div className="stat-cards">
        <div className="stat-card"><div className="value">₹{totals.total.toFixed(2)}</div><div className="label">Total Claimed</div></div>
        <div className="stat-card"><div className="value">₹{totals.pending.toFixed(2)}</div><div className="label">Pending</div></div>
        <div className="stat-card"><div className="value">₹{totals.paid.toFixed(2)}</div><div className="label">Paid</div></div>
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
          <option value="">All statuses</option>
          {["PENDING", "APPROVED", "PAID", "REJECTED", "CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Voucher Date</th><th>Paid To</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{r.name || r.userId}</td>
                  <td>{r.voucherDate}</td>
                  <td>{r.paidTo}</td>
                  <td>₹{r.totalAmount.toFixed(2)} {r.billLink && <button className="btn-sm" onClick={() => openAuthedFile(r.billLink).catch((err) => setError(errorMessage(err)))}>bill</button>}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    <div className="toolbar" style={{ margin: 0 }}>
                      {r.status === "PENDING" && <button className="btn-sm" onClick={() => decide(r.id, "approve")}>Approve</button>}
                      {r.status === "PENDING" && <button className="btn-sm" onClick={() => decide(r.id, "reject")}>Reject</button>}
                      {r.status === "APPROVED" && <button className="btn-sm" onClick={() => markPaid(r.id)}>Mark Paid</button>}
                      {["PENDING", "APPROVED"].includes(r.status) && <button className="btn-sm btn-danger" onClick={() => decide(r.id, "cancel")}>Cancel</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6} className="empty-state">No reimbursements.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showNew && <Modal title="New Expense Voucher" onClose={() => setShowNew(false)}>
        <VoucherForm requireBill={false} onSubmitted={() => { setShowNew(false); load(); }} />
      </Modal>}
      {showAccess && <AccessModal onClose={() => setShowAccess(false)} />}
    </div>
  );
}

function AccessModal({ onClose }) {
  const [profiles, setProfiles] = useState(null);
  const [granted, setGranted] = useState(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([client.get("/profiles"), client.get("/reimbursements/access")]).then(([p, a]) => {
      setProfiles(p.data.filter((x) => x.type === "employee"));
      setGranted(new Set(a.data));
    }).catch((err) => setError(errorMessage(err)));
  }, []);

  function toggle(userId) {
    setGranted((set) => {
      const next = new Set(set);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await client.put("/reimbursements/access", { userIds: [...granted] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Manage Reimbursement Access" onClose={onClose}>
      {!profiles ? <Loading /> : (
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {profiles.map((p) => (
            <label key={p.userId} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={granted.has(p.userId)} onChange={() => toggle(p.userId)} />
              {p.name} <span className="text-muted">({p.userId})</span>
            </label>
          ))}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" style={{ marginTop: 16 }} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </Modal>
  );
}
