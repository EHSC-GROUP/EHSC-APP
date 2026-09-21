import { useEffect, useState } from "react";
import client, { errorMessage } from "../api/client";
import Modal from "./Modal";
import StatusBadge from "./StatusBadge";
import { Loading, ErrorText } from "./Misc";

// Advance requests. `admin` switches between the employee's own view
// (request + track + wallet balance) and the approver view (department
// approve -> superadmin final approve, buttons driven by server-side
// per-row permissions so a wrong-department admin never sees them).
export default function AdvancesPanel({ admin }) {
  const [list, setList] = useState(null);
  const [balance, setBalance] = useState(0);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setError("");
    try {
      if (admin) {
        const { data } = await client.get("/advances/admin");
        setList(data);
      } else {
        const { data } = await client.get("/advances/mine");
        setList(data.advances);
        setBalance(data.balance);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [admin]);

  async function act(id, verb) {
    const comment = verb === "reject" ? window.prompt("Reason (optional):") || "" : undefined;
    try {
      await client.put(`/advances/${id}/${verb}`, comment !== undefined ? { comment } : {});
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="toolbar">
        {!admin && (
          <div className="stat-card" style={{ margin: 0 }}>
            <div className="value">₹{Number(balance).toFixed(2)}</div>
            <div className="label">Advance wallet balance</div>
          </div>
        )}
        <div className="spacer" />
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ Request Advance</button>
      </div>
      {!admin && (
        <p className="hint-text">
          Approved advances form a wallet. Each reimbursement voucher is deducted from it once approved — you're only paid
          out for whatever exceeds the remaining advance.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                {admin && <th>Employee</th>}
                <th>Purpose</th><th>Amount</th><th>Remaining</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  {admin && <td>{a.name || a.userId}<div className="hint-text mt-0">{a.department || "no department"}</div></td>}
                  <td>{a.purpose}</td>
                  <td>₹{Number(a.amount).toFixed(2)}</td>
                  <td>{a.status === "APPROVED" ? `₹${Number(a.remainingBalance).toFixed(2)}` : "-"}</td>
                  <td>
                    <StatusBadge status={a.status} />
                    {a.awaiting && <div className="hint-text mt-0">{a.awaiting}</div>}
                  </td>
                  <td>
                    <div className="toolbar" style={{ margin: 0 }}>
                      {admin && a.actions?.canDeptApprove && <button className="btn-sm" onClick={() => act(a.id, "dept-approve")}>Approve (Dept)</button>}
                      {admin && a.actions?.canFinalApprove && <button className="btn-sm" onClick={() => act(a.id, "final-approve")}>Final Approve</button>}
                      {admin && a.actions?.canReject && <button className="btn-sm" onClick={() => act(a.id, "reject")}>Reject</button>}
                      {admin ? (a.actions?.canCancel && <button className="btn-sm btn-danger" onClick={() => act(a.id, "cancel")}>Cancel</button>)
                        : ["PENDING", "DEPT_APPROVED"].includes(a.status) && <button className="btn-sm btn-danger" onClick={() => act(a.id, "cancel")}>Cancel</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={admin ? 6 : 5} className="empty-state">No advances.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {showNew && <NewAdvanceModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function NewAdvanceModal({ onClose, onCreated }) {
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.post("/advances", { amount: Number(amount), purpose });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Request an Advance" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Amount (₹)</label>
        <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <label>Purpose</label>
        <textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
        <p className="hint-text">Goes to your department admin first, then the superadmin for final approval.</p>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Submitting…" : "Submit Request"}</button>
      </form>
    </Modal>
  );
}
