import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";
import VoucherForm from "../../components/VoucherForm";
import { openAuthedFile } from "../../lib/openFile";

export default function MyReimbursements() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [access, setAccess] = useState(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setError("");
    try {
      const [profile, mine] = await Promise.all([
        client.get("/me/profile"),
        client.get("/reimbursements/mine"),
      ]);
      setAccess(!!profile.data.reimbursementAccess);
      setList(mine.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  if (access === false) {
    return (
      <div>
        <div className="page-header"><h2>Reimbursements</h2></div>
        <div className="card">Access has not been granted to you for reimbursement submissions. Contact HR if you believe this is a mistake.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Reimbursements</h2>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Voucher</button>
      </div>
      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Voucher Date</th><th>Paid To</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{r.voucherDate}</td><td>{r.paidTo}</td>
                  <td>₹{r.totalAmount.toFixed(2)} {r.billLink && <button className="btn-sm" onClick={() => openAuthedFile(r.billLink).catch((err) => setError(errorMessage(err)))}>bill</button>}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={4} className="empty-state">No reimbursements submitted yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {showNew && (
        <Modal title="New Expense Voucher" onClose={() => setShowNew(false)}>
          <VoucherForm requireBill onSubmitted={() => { setShowNew(false); load(); }} />
        </Modal>
      )}
    </div>
  );
}
