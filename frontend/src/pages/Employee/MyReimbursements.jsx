import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";
import VoucherForm from "../../components/VoucherForm";
import AdvancesPanel from "../../components/AdvancesPanel";
import { openAuthedFile } from "../../lib/openFile";

// One link per attached bill; claims filed before multi-bill upload only
// carry a single legacy billLink.
export function BillLinks({ record, onError }) {
  const bills = record.bills?.length ? record.bills : record.billLink ? [{ link: record.billLink, name: "bill" }] : [];
  return bills.map((b, i) => (
    <button key={i} className="btn-sm" style={{ marginLeft: 4 }} title={b.name} onClick={() => openAuthedFile(b.link).catch((err) => onError(errorMessage(err)))}>
      {bills.length > 1 ? `bill ${i + 1}` : "bill"}
    </button>
  ));
}

export default function MyReimbursements() {
  const [tab, setTab] = useState("Vouchers");
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
        {tab === "Vouchers" && <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Voucher</button>}
      </div>
      <div className="drawer-tabs">
        {["Vouchers", "Advances"].map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "Advances" && <AdvancesPanel admin={false} />}

      {tab === "Vouchers" && (
        <>
          <ErrorText>{error}</ErrorText>
          {!list ? <Loading /> : (
            <div className="card table-wrap">
              <table>
                <thead><tr><th>Voucher Date</th><th>Type</th><th>Amount</th><th>Advance Applied</th><th>Payable</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <td>{r.voucherDate}</td>
                      <td><StatusBadge status={r.type || "GENERAL"} /></td>
                      <td>₹{r.totalAmount.toFixed(2)} <BillLinks record={r} onError={setError} /></td>
                      <td>{["APPROVED", "SETTLED", "PAID"].includes(r.status) ? `₹${Number(r.advanceTaken || 0).toFixed(2)}` : "-"}</td>
                      <td>{["APPROVED", "SETTLED", "PAID"].includes(r.status) ? `₹${Number(r.payableAmount ?? r.totalAmount).toFixed(2)}` : "-"}</td>
                      <td>
                        <StatusBadge status={r.status} />
                        {r.awaiting && <div className="hint-text mt-0">{r.awaiting}</div>}
                      </td>
                      <td><button className="btn-sm" onClick={() => openAuthedFile(`/api/reimbursements/${r.id}/pdf`, { download: true, filename: `Reimbursement_${r.id}.pdf` }).catch((err) => setError(errorMessage(err)))}>PDF</button></td>
                    </tr>
                  ))}
                  {list.length === 0 && <tr><td colSpan={8} className="empty-state">No reimbursements submitted yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {showNew && (
            <Modal title="New Expense Voucher" wide onClose={() => setShowNew(false)}>
              <VoucherForm requireBill onSubmitted={() => { setShowNew(false); load(); }} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
