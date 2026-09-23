import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";
import MaterialIndentForm from "../../components/MaterialIndentForm";
import WalletBalanceBanner from "../../components/WalletBalanceBanner";
import { openAuthedFile } from "../../lib/openFile";

export default function MaterialIndents() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setError("");
    try {
      const params = {};
      if (status) params.status = status;
      const { data } = await client.get("/material-indents/admin", { params });
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [status]);

  async function decide(id, verb) {
    const comment = verb === "reject" ? window.prompt("Reason (optional):") || "" : undefined;
    try {
      await client.put(`/material-indents/${id}/${verb}`, comment !== undefined ? { comment } : {});
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function exportUrl(kind) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    const qs = params.toString();
    return `/api/material-indents/export/${kind}${qs ? `?${qs}` : ""}`;
  }

  const total = (list || []).reduce((s, r) => s + r.totalAmount, 0);

  return (
    <div>
      <div className="page-header">
        <h2>Material Indents</h2>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Indent</button>
      </div>
      <WalletBalanceBanner />

      <div className="stat-cards">
        <div className="stat-card"><div className="value">₹{total.toFixed(2)}</div><div className="label">Total Indented</div></div>
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
          <option value="">All statuses</option>
          {["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="spacer" />
        <button
          className="btn-sm"
          onClick={() => openAuthedFile(exportUrl("pdf"), { download: true, filename: "Material_Indents.pdf" }).catch((err) => setError(errorMessage(err)))}
        >
          Export PDF
        </button>
        <button
          className="btn-sm"
          onClick={() => openAuthedFile(exportUrl("excel"), { download: true, filename: "Material_Indent_Register.xlsx" }).catch((err) => setError(errorMessage(err)))}
        >
          Export Excel
        </button>
      </div>

      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Raised Date</th><th>Purpose</th><th>Amount</th><th>Status</th><th>Approved By</th><th></th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{r.name || r.userId}</td>
                  <td>{r.raisedDate}</td>
                  <td>{r.purpose}</td>
                  <td>₹{r.totalAmount.toFixed(2)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.verifiedApprovedBy || "-"}</td>
                  <td>
                    <div className="toolbar" style={{ margin: 0 }}>
                      {r.status === "PENDING" && <button className="btn-sm" onClick={() => decide(r.id, "approve")}>Approve</button>}
                      {r.status === "PENDING" && <button className="btn-sm" onClick={() => decide(r.id, "reject")}>Reject</button>}
                      {r.status === "PENDING" && <button className="btn-sm btn-danger" onClick={() => decide(r.id, "cancel")}>Cancel</button>}
                      <button className="btn-sm" onClick={() => openAuthedFile(`/api/material-indents/${r.id}/pdf`, { download: true, filename: `Material_Indent_${r.id}.pdf` }).catch((err) => setError(errorMessage(err)))}>PDF</button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={7} className="empty-state">No material indents.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showNew && <Modal title="New Material Indent" onClose={() => setShowNew(false)}>
        <MaterialIndentForm onSubmitted={() => { setShowNew(false); load(); }} />
      </Modal>}
    </div>
  );
}
