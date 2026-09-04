import { useState } from "react";
import client, { errorMessage } from "../api/client";
import { numberToWords } from "../lib/numberToWords";
import { ErrorText } from "./Misc";

const emptyItem = () => ({ date: "", description: "", amount: "" });

// Shared by the admin's own-expense flow and employee self-service (which
// additionally requires a bill upload) — one voucher form, one place the
// itemized-total math lives.
export default function VoucherForm({ requireBill, onSubmitted }) {
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidTo, setPaidTo] = useState("");
  const [items, setItems] = useState([emptyItem()]);
  const [bill, setBill] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const total = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  function updateItem(i, field, value) {
    setItems((list) => list.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }
  function addItem() { setItems((list) => [...list, emptyItem()]); }
  function removeItem(i) { setItems((list) => list.filter((_, idx) => idx !== i)); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (requireBill && !bill) return setError("A bill copy is required");
    const validItems = items.filter((i) => i.date && i.description && Number(i.amount) > 0);
    if (validItems.length === 0) return setError("At least one item (date, description, amount) is required");

    setBusy(true);
    try {
      const form = new FormData();
      form.append("voucherDate", voucherDate);
      form.append("paidTo", paidTo);
      form.append("items", JSON.stringify(validItems));
      if (bill) form.append("bill", bill);
      await client.post("/reimbursements", form);
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
        <div><label>Voucher Date</label><input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} required /></div>
        <div><label>Paid To</label><input value={paidTo} onChange={(e) => setPaidTo(e.target.value)} required /></div>
      </div>

      <label>Items</label>
      {items.map((item, i) => (
        <div className="form-row" key={i} style={{ marginBottom: 6 }}>
          <div style={{ flex: "0 0 140px" }}><input type="date" value={item.date} onChange={(e) => updateItem(i, "date", e.target.value)} placeholder="Date" /></div>
          <div><input value={item.description} onChange={(e) => updateItem(i, "description", e.target.value)} placeholder="Description" /></div>
          <div style={{ flex: "0 0 110px" }}><input type="number" min="0" step="0.01" value={item.amount} onChange={(e) => updateItem(i, "amount", e.target.value)} placeholder="Amount" /></div>
          <button type="button" className="btn-sm" onClick={() => removeItem(i)} disabled={items.length === 1}>&times;</button>
        </div>
      ))}
      <button type="button" className="btn-sm" onClick={addItem}>+ Add Item</button>

      <p style={{ marginTop: 12 }}><strong>Total: ₹{total.toFixed(2)}</strong></p>
      <p className="hint-text">{numberToWords(total)}</p>

      <label>Bill Copy {requireBill ? "(required)" : "(optional)"}</label>
      <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={(e) => setBill(e.target.files[0])} required={requireBill} />

      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? "Submitting…" : "Submit"}</button>
    </form>
  );
}
