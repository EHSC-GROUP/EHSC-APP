import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";
import MaterialIndentForm from "../../components/MaterialIndentForm";
import { openAuthedFile } from "../../lib/openFile";

export default function MyMaterialIndents() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setError("");
    try {
      const { data } = await client.get("/material-indents/mine");
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  async function cancel(id) {
    if (!window.confirm("Cancel this indent?")) return;
    try {
      await client.put(`/material-indents/${id}/cancel`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Material Indents</h2>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Indent</button>
      </div>
      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Voucher No</th><th>Raised Date</th><th>Purpose</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{r.voucherNo || "-"}</td>
                  <td>{r.raisedDate}</td>
                  <td>{r.purpose}</td>
                  <td>₹{r.totalAmount.toFixed(2)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    <div className="toolbar" style={{ margin: 0 }}>
                      {r.status === "PENDING" && <button className="btn-sm btn-danger" onClick={() => cancel(r.id)}>Cancel</button>}
                      <button className="btn-sm" onClick={() => openAuthedFile(`/api/material-indents/${r.id}/pdf`, { download: true, filename: `Material_Indent_${r.id}.pdf` }).catch((err) => setError(errorMessage(err)))}>PDF</button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={5} className="empty-state">No material indents submitted yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {showNew && (
        <Modal title="New Material Indent" onClose={() => setShowNew(false)} wide>
          <MaterialIndentForm onSubmitted={() => { setShowNew(false); load(); }} />
        </Modal>
      )}
    </div>
  );
}
