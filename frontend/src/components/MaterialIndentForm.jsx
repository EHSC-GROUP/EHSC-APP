import { useEffect, useState } from "react";
import client, { errorMessage } from "../api/client";
import { ErrorText } from "./Misc";

const emptyItem = () => ({ requiredDate: "", itemMaterial: "", qty: "", rate: "" });

// One Material Indent Form (MIF) — matches the paper EHSC MIF: raised
// date, a line-item table (item/material, qty, rate, computed amount) and
// a purpose note. Prepared By is always the submitter; Verified & Approved
// By is filled in on admin approval.
export default function MaterialIndentForm({ onSubmitted }) {
  const [raisedDate, setRaisedDate] = useState(new Date().toISOString().slice(0, 10));
  const [purpose, setPurpose] = useState("");
  const [items, setItems] = useState([emptyItem()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [voucherNo, setVoucherNo] = useState("");

  // Preview only — the real number is assigned atomically on submit, so
  // this can occasionally be off by one under concurrent submissions.
  useEffect(() => {
    client.get("/material-indents/next-voucher-no", { params: { date: raisedDate } })
      .then(({ data }) => setVoucherNo(data.voucherNo))
      .catch(() => setVoucherNo(""));
  }, [raisedDate]);

  function updateItem(i, field, value) {
    setItems((list) => list.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }
  function addItem() { setItems((list) => [...list, emptyItem()]); }
  function removeItem(i) { setItems((list) => list.filter((_, idx) => idx !== i)); }

  const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!purpose.trim()) return setError("Purpose of indent is required");
    const validItems = items.filter((i) => i.itemMaterial && Number(i.qty) > 0 && Number(i.rate) >= 0);
    if (validItems.length === 0) return setError("At least one item (material, quantity, rate) is required");

    setBusy(true);
    try {
      await client.post("/material-indents", { raisedDate, purpose, items: validItems });
      onSubmitted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="form-row">
        <div>
          <label>Voucher No</label>
          <input value={voucherNo || "…"} disabled title="Assigned automatically — this is a preview of the next number" />
        </div>
        <div>
          <label>Raised Date</label>
          <input type="date" value={raisedDate} onChange={(e) => setRaisedDate(e.target.value)} required />
        </div>
      </div>

      <label style={{ marginTop: 12 }}>Items</label>
      {items.map((item, i) => (
        <div key={i} className="card" style={{ marginBottom: 8, padding: 12 }}>
          <div className="form-row">
            <div style={{ flex: "0 0 170px" }}>
              <label className="hint-text mt-0">Required Date</label>
              <input type="date" value={item.requiredDate} onChange={(e) => updateItem(i, "requiredDate", e.target.value)} />
            </div>
            <div style={{ flex: "1 1 260px" }}>
              <label className="hint-text mt-0">Item / Material Description</label>
              <input value={item.itemMaterial} onChange={(e) => updateItem(i, "itemMaterial", e.target.value)} placeholder="e.g. 4-core armoured cable, 50m" />
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 8, alignItems: "flex-end" }}>
            <div style={{ flex: "0 0 90px" }}>
              <label className="hint-text mt-0">Qty</label>
              <input type="number" min="0" step="1" value={item.qty} onChange={(e) => updateItem(i, "qty", e.target.value)} />
            </div>
            <div style={{ flex: "0 0 110px" }}>
              <label className="hint-text mt-0">Rate</label>
              <input type="number" min="0" step="0.01" value={item.rate} onChange={(e) => updateItem(i, "rate", e.target.value)} />
            </div>
            <div style={{ flex: "0 0 120px" }}>
              <label className="hint-text mt-0">Amount</label>
              <div style={{ padding: "8px 0", fontWeight: 600 }}>₹{((Number(item.qty) || 0) * (Number(item.rate) || 0)).toFixed(2)}</div>
            </div>
            <div className="spacer" />
            <button type="button" className="btn-sm btn-danger" onClick={() => removeItem(i)} disabled={items.length === 1}>Remove</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn-sm" onClick={addItem}>+ Add Item</button>

      <p style={{ marginTop: 12 }}><strong>Total: ₹{total.toFixed(2)}</strong></p>

      <label>Required for / Purpose of Indent</label>
      <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} required />

      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? "Submitting…" : "Submit"}</button>
    </form>
  );
}
