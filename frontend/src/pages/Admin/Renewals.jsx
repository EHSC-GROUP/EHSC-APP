import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import DateInput from "../../components/DateInput";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";
import { fmtDate } from "../../lib/dates";

export const STATUS = {
  OVERDUE: { label: "Overdue", cls: "badge-REJECTED" },
  DUE_TODAY: { label: "Due today", cls: "badge-REJECTED" },
  DUE_TOMORROW: { label: "Due tomorrow", cls: "badge-PENDING" },
  OK: { label: "On track", cls: "badge-APPROVED" },
};

// Items that need action: due tomorrow, due today or overdue.
export function RenewalAlerts({ items, frequencies, onOpen }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="card" style={{ borderLeft: "4px solid #dc2626" }}>
      <strong>Renewal alerts</strong>
      <div style={{ marginTop: 6 }}>
        {items.map((i) => (
          <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "4px 0" }}>
            <span className={`badge-pill ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
            <strong>{i.name}</strong>
            <span className="hint-text">{frequencies?.[i.frequency]} · {fmtDate(i.nextDueDate)}{i.daysLeft < 0 ? ` · ${-i.daysLeft} day(s) late` : ""}</span>
          </div>
        ))}
      </div>
      {onOpen && <button className="btn-sm" style={{ marginTop: 8 }} onClick={onOpen}>Open Renewals</button>}
    </div>
  );
}

const emptyForm = () => ({ name: "", frequency: "MONTHLY", activatedOn: "", nextDueDate: "", notes: "" });

// Recurring payments and renewals (electricity, recharges, licences, rent
// agreement...). Each has a next due date; the app reminds the superadmin by
// email and in the bell before it falls due. Superadmin only.
export default function Renewals() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | item
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await client.get("/renewals");
      setData(r.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  async function renewed(item) {
    setError("");
    try {
      const r = await client.post(`/renewals/${item.id}/renewed`);
      setNotice(`${item.name} marked as renewed. Next due ${fmtDate(r.data.nextDueDate)}.`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function remove(item) {
    try {
      await client.delete(`/renewals/${item.id}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function loadStarter() {
    setBusy(true);
    setError("");
    try {
      const r = await client.post("/renewals/seed-defaults");
      setNotice(`${r.data.added} items loaded from the company's renewals sheet.`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await client.post("/renewals/run-reminders");
      if (r.data.reminded === 0) setNotice("Nothing is due tomorrow, today or overdue right now, so no email was sent.");
      else if (r.data.email.sent) setNotice(`Reminder for ${r.data.reminded} item(s) emailed to ${r.data.email.to}.`);
      else setNotice(`The email for ${r.data.reminded} item(s) was NOT sent: ${r.data.email.reason}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <ErrorText>{error}</ErrorText> : <Loading />;
  const attention = data.items.filter((i) => i.status !== "OK" && i.active !== false).length;

  return (
    <div>
      <div className="page-header">
        <h2>Recurring Payments &amp; Renewals Monitor</h2>
        <div className="toolbar" style={{ margin: 0 }}>
          <button onClick={sendNow} disabled={busy || attention === 0} title={attention === 0 ? "Nothing is due" : "Email the reminder now"}>Send reminder now</button>
          <button className="btn-primary" onClick={() => setEditing("new")}>+ Add Item</button>
        </div>
      </div>

      <p className="hint-text mt-0">
        An email goes to <strong>{data.recipient}</strong> the day before an item is due. Items due tomorrow, due today or
        overdue are shown in the alerts box below.{" "}
        {data.emailConfigured
          ? "Email sending is set up."
          : <span className="overdue">Email sending is not set up on this server yet, so no email is sent.</span>}
      </p>
      <RenewalAlerts items={data.items.filter((i) => i.active !== false && i.status !== "OK")} frequencies={data.frequencies} />
      {notice && <p className="hint-text" style={{ color: "var(--success)" }}>{notice}</p>}
      <ErrorText>{error}</ErrorText>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>#</th><th>Item</th><th>Frequency</th><th>Activated</th><th>Next Due Date</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data.items.map((i, n) => (
              <tr key={i.id} style={i.active === false ? { opacity: 0.5 } : undefined}>
                <td>{n + 1}</td>
                <td><strong>{i.name}</strong>{i.notes ? <div className="hint-text mt-0">{i.notes}</div> : null}</td>
                <td>{data.frequencies[i.frequency]}</td>
                <td>{fmtDate(i.activatedOn) || "-"}</td>
                <td>{fmtDate(i.nextDueDate)}</td>
                <td>
                  <span className={`badge-pill ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
                  <div className="hint-text mt-0">{i.daysLeft < 0 ? `${-i.daysLeft} day(s) late` : i.daysLeft === 0 ? "today" : `in ${i.daysLeft} day(s)`}</div>
                </td>
                <td>
                  <div className="toolbar" style={{ margin: 0 }}>
                    <ConfirmButton className="btn-sm btn-primary" onConfirm={() => renewed(i)} confirmText={`Mark "${i.name}" as renewed / paid and move to the next due date?`}>Mark renewed</ConfirmButton>
                    <button className="btn-sm" onClick={() => setEditing(i)}>Edit</button>
                    <ConfirmButton className="btn-sm btn-danger" onConfirm={() => remove(i)} confirmText={`Delete "${i.name}"?`}>Delete</ConfirmButton>
                  </div>
                </td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-state">
                  No items yet. Add them one by one, or load the company's list (Electricity bill, Airtel recharge, Act WiFi, Quick Heal, Microsoft 365, Rent agreement renewal).
                  <div style={{ marginTop: 10 }}><button className="btn-primary" onClick={loadStarter} disabled={busy}>Load the company's renewals list</button></div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && <ItemModal item={editing === "new" ? null : editing} frequencies={data.frequencies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function ItemModal({ item, frequencies, onClose, onSaved }) {
  const [form, setForm] = useState(item ? {
    name: item.name, frequency: item.frequency, activatedOn: item.activatedOn || "", nextDueDate: item.nextDueDate,
    notes: item.notes || "",
  } : emptyForm());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (item) await client.put(`/renewals/${item.id}`, form);
      else await client.post("/renewals", form);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={item ? "Edit item" : "Add item"} onClose={onClose}>
      <form onSubmit={save}>
        <label>Item</label>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Electricity bill, Microsoft 365, Rent agreement renewal" required />
        <label>Frequency</label>
        <select value={form.frequency} onChange={(e) => set("frequency", e.target.value)}>
          {Object.entries(frequencies).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <div className="form-row">
          <div><label>Activated on (optional)</label><DateInput value={form.activatedOn} onChange={(e) => set("activatedOn", e.target.value)} /></div>
          <div><label>Next due date</label><DateInput value={form.nextDueDate} onChange={(e) => set("nextDueDate", e.target.value)} required /></div>
        </div>
        <label>Notes (optional)</label>
        <input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </form>
    </Modal>
  );
}
