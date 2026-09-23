import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";
import VoucherForm from "../../components/VoucherForm";
import AdvancesPanel from "../../components/AdvancesPanel";
import WalletBalanceBanner from "../../components/WalletBalanceBanner";
import { BillLinks } from "../Employee/MyReimbursements";
import { openAuthedFile } from "../../lib/openFile";

export default function Reimbursements() {
  const [tab, setTab] = useState("Vouchers");
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showAccess, setShowAccess] = useState(false);

  async function load() {
    setError("");
    try {
      const params = {};
      if (status) params.status = status;
      if (type) params.type = type;
      const { data } = await client.get("/reimbursements/admin", { params });
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [status, type]);

  async function decide(id, verb, extra) {
    try {
      await client.put(`/reimbursements/${id}/${verb}`, extra || {});
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function reject(id) {
    const comment = window.prompt("Reason (optional):") || "";
    decide(id, "reject", { comment });
  }

  function markPaid(r) {
    const payable = Number(r.payableAmount ?? r.totalAmount).toFixed(2);
    const paymentRef = window.prompt(`Payment reference (paying ₹${payable}):`);
    if (!paymentRef) return;
    const paymentDate = window.prompt("Payment date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!paymentDate) return;
    decide(r.id, "mark-paid", { paymentRef, paymentDate });
  }

  function exportUrl(kind) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    const qs = params.toString();
    return `/api/reimbursements/export/${kind}${qs ? `?${qs}` : ""}`;
  }

  const totals = (list || []).reduce(
    (acc, r) => {
      acc.total += r.totalAmount;
      if (["PENDING", "TL_APPROVED", "DEPT_APPROVED"].includes(r.status)) acc.pending += r.totalAmount;
      if (r.status === "PAID") acc.paid += Number(r.paidAmount ?? r.totalAmount);
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
          {tab === "Vouchers" && <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Voucher</button>}
        </div>
      </div>
      <WalletBalanceBanner />
      <div className="drawer-tabs">
        {["Vouchers", "Advances"].map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "Advances" && <AdvancesPanel admin />}

      {tab === "Vouchers" && (
        <>
          <p className="hint-text mt-0">
            The employee's department admin approves, then the superadmin gives final approval — departments with a
            Team Leader assigned get an extra approval from them first. Vouchers are drawn from the employee's
            advance wallet first — only the excess is ever paid.
          </p>
          <div className="stat-cards">
            <div className="stat-card"><div className="value">₹{totals.total.toFixed(2)}</div><div className="label">Total Claimed</div></div>
            <div className="stat-card"><div className="value">₹{totals.pending.toFixed(2)}</div><div className="label">Awaiting approval</div></div>
            <div className="stat-card"><div className="value">₹{totals.paid.toFixed(2)}</div><div className="label">Paid out</div></div>
          </div>

          <div className="toolbar">
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180 }}>
              <option value="">All statuses</option>
              {["PENDING", "TL_APPROVED", "DEPT_APPROVED", "APPROVED", "SETTLED", "PAID", "REJECTED", "CANCELLED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 160 }}>
              <option value="">All types</option>
              {["GENERAL", "TRAVEL", "ACCOMMODATION"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="spacer" />
            <button
              className="btn-sm"
              onClick={() => openAuthedFile(exportUrl("pdf"), { download: true, filename: "Reimbursement_Claims.pdf" }).catch((err) => setError(errorMessage(err)))}
            >
              Export PDF
            </button>
            <button
              className="btn-sm"
              onClick={() => openAuthedFile(exportUrl("excel"), { download: true, filename: "Reimbursement_Register.xlsx" }).catch((err) => setError(errorMessage(err)))}
            >
              Export Excel
            </button>
          </div>

          <ErrorText>{error}</ErrorText>
          {!list ? <Loading /> : (
            <div className="card table-wrap">
              <table>
                <thead><tr><th>Employee</th><th>Voucher Date</th><th>Type</th><th>Amount</th><th>Advance Applied</th><th>Payable</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name || r.userId}<div className="hint-text mt-0">{r.department || "no department"}</div></td>
                      <td>{r.voucherDate}</td>
                      <td><StatusBadge status={r.type || "GENERAL"} /></td>
                      <td>₹{r.totalAmount.toFixed(2)} <BillLinks record={r} onError={setError} /></td>
                      <td>{["APPROVED", "SETTLED", "PAID"].includes(r.status) ? `₹${Number(r.advanceTaken || 0).toFixed(2)}` : "-"}</td>
                      <td>{["APPROVED", "SETTLED", "PAID"].includes(r.status) ? `₹${Number(r.payableAmount ?? r.totalAmount).toFixed(2)}` : "-"}</td>
                      <td>
                        <StatusBadge status={r.status} />
                        {r.awaiting && <div className="hint-text mt-0">{r.awaiting}</div>}
                      </td>
                      <td>
                        <div className="toolbar" style={{ margin: 0 }}>
                          {r.actions?.canTeamLeadApprove && <button className="btn-sm" onClick={() => decide(r.id, "tl-approve")}>Approve (Team Lead)</button>}
                          {r.actions?.canDeptApprove && <button className="btn-sm" onClick={() => decide(r.id, "dept-approve")}>Approve (Dept)</button>}
                          {r.actions?.canFinalApprove && <button className="btn-sm" onClick={() => decide(r.id, "final-approve")}>Final Approve</button>}
                          {r.actions?.canReject && <button className="btn-sm" onClick={() => reject(r.id)}>Reject</button>}
                          {r.actions?.canMarkPaid && <button className="btn-sm" onClick={() => markPaid(r)}>Mark Paid</button>}
                          {(r.actions?.canCancel || (r.status === "APPROVED" && r.actions?.canMarkPaid)) && (
                            <button className="btn-sm btn-danger" onClick={() => decide(r.id, "cancel")}>Cancel</button>
                          )}
                          <button className="btn-sm" onClick={() => openAuthedFile(`/api/reimbursements/${r.id}/pdf`, { download: true, filename: `Reimbursement_${r.id}.pdf` }).catch((err) => setError(errorMessage(err)))}>PDF</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {list.length === 0 && <tr><td colSpan={8} className="empty-state">No reimbursements.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {showNew && <Modal title="New Expense Voucher" wide onClose={() => setShowNew(false)}>
            <VoucherForm requireBill={false} onSubmitted={() => { setShowNew(false); load(); }} />
          </Modal>}
        </>
      )}
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
      setProfiles(p.data.filter((x) => ["employee", "admin"].includes(x.type)));
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
