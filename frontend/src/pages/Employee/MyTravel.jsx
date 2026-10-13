import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import CalendarPicker from "../../components/CalendarPicker";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";
import DateInput from "../../components/DateInput";
import { fmtDate, fmtRange } from "../../lib/dates";

const todayISO = () => new Date().toISOString().slice(0, 10);

// Ask for approval to travel on a date — usually well in advance. Once an
// admin approves, that day is marked Travel (counted as present).
export default function MyTravel() {
  const [requests, setRequests] = useState(null);
  const [date, setDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await client.get("/attendance/travel-requests/mine");
      setRequests(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!date) return setError("Pick the first day of travel on the calendar.");
    const end = toDate || date;
    if (end < date) return setError("The To date can't be before the From date.");
    setBusy(true);
    try {
      await client.post("/attendance/travel-requests", { fromDate: date, toDate: end, reason });
      setNotice(`Travel request for ${fmtDate(date)}${end !== date ? ` – ${fmtDate(end)}` : ""} sent for approval.`);
      setDate("");
      setToDate("");
      setReason("");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Dot colours on the calendar: pending = amber, approved = green.
  const markers = {};
  for (const r of requests || []) {
    const last = r.toDate || r.date;
    for (let d = r.date, i = 0; d <= last && i < 62; i++) {
      if (r.status === "PENDING") markers[d] = "pending";
      else if (r.status === "APPROVED" && !markers[d]) markers[d] = "approved";
      d = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    }
  }

  return (
    <div>
      <div className="page-header"><h2>Travel</h2></div>
      <p className="hint-text mt-0">Pick the first day on the calendar, then the last day if you're travelling for more than one day. You can request it well ahead of time.</p>

      <form className="card" onSubmit={submit}>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          <div>
            <CalendarPicker value={date} onChange={setDate} minDate={todayISO()} markers={markers} />
            <div className="hint-text">
              <span className="cal-legend pending" /> Pending &nbsp; <span className="cal-legend approved" /> Approved
            </div>
          </div>
          <div style={{ flex: "1 1 260px" }}>
            <div className="form-row">
              <div>
                <label style={{ marginTop: 0 }}>From</label>
                <input value={fmtDate(date)} readOnly placeholder="Pick on the calendar" />
              </div>
              <div>
                <label style={{ marginTop: 0 }}>To (last day)</label>
                <DateInput min={date || todayISO()} value={toDate} onChange={(e) => setToDate(e.target.value)} placeholder="Same day" />
              </div>
            </div>
            <label>Where are you travelling, and why?</label>
            <textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client site visit in Hyderabad" required />
            <ErrorText>{error}</ErrorText>
            {notice && <p className="hint-text" style={{ color: "var(--success)" }}>{notice}</p>}
            <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Sending…" : "Request Approval"}</button>
          </div>
        </div>
      </form>

      <h3>My travel requests</h3>
      {!requests ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Travel Dates</th><th>Reason</th><th>Status</th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{fmtRange(r)}</td>
                  <td>{r.reason}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td colSpan={3} className="empty-state">No travel requests yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
