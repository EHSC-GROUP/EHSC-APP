import { useState } from "react";
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
      <label>Raised Date</label>
      <input type="date" value={raisedDate} onChange={(e) => setRaisedDate(e.target.value)} required />

      <label style={{ marginTop: 12 }}>Items</label>
      {items.map((item, i) => (
        <div className="form-row" key={i} style={{ marginBottom: 6 }}>
          <div style={{ flex: "0 0 140px" }}><input type="date" value={item.requiredDate} onChange={(e) => updateItem(i, "requiredDate", e.target.value)} title="Required Date" /></div>
          <div style={{ flex: "3 1 320px" }}><input value={item.itemMaterial} onChange={(e) => updateItem(i, "itemMaterial", e.target.value)} placeholder="Item / Material description" /></div>
          <div style={{ flex: "0 0 80px" }}><input type="number" min="0" step="1" value={item.qty} onChange={(e) => updateItem(i, "qty", e.target.value)} placeholder="Qty" /></div>
          <div style={{ flex: "0 0 100px" }}><input type="number" min="0" step="0.01" value={item.rate} onChange={(e) => updateItem(i, "rate", e.target.value)} placeholder="Rate" /></div>
          <div style={{ flex: "0 0 100px", display: "flex", alignItems: "center" }}>₹{((Number(item.qty) || 0) * (Number(item.rate) || 0)).toFixed(2)}</div>
          <button type="button" className="btn-sm" onClick={() => removeItem(i)} disabled={items.length === 1}>&times;</button>
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
