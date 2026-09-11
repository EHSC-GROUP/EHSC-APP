import { useEffect, useState } from "react";
import client, { errorMessage } from "../api/client";
import { ErrorText } from "./Misc";

const emptyPhase2 = () => ({
  proposalNo: "", proposalDate: "", modeOfSubmission: "", submittedTo: "", submittedBy: "",
  nextFollowUpDueOn: "", nextFollowUpDate: "", respondedInFavour: false,
  finalProposalAfterNegotiation: "", workOrderDate: "", workOrderNumber: "",
});
const emptyPhase3 = () => ({
  workOrderDate: "", workOrderNumber: "", workOrderDescription: "", deliveryConditions: "", paymentTerms: "",
});
const emptyPhase4 = () => ({
  deliveryReportSubmitted: false, deliveryReportDate: "", deliveryReportNotes: "",
  invoiceNumber: "", invoiceDate: "", invoiceAmount: "", paymentReceived: false, paymentReceivedDate: "",
});

// Coalesces null/undefined to "" per-field so a stored null (Firestore's
// default for an unset date) never overwrites the empty-string default a
// controlled <input> needs — a shallow spread of the two objects wouldn't
// catch this, since null is a defined value that wins the spread.
function withEmptyFallback(defaults, stored) {
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (stored?.[key] !== undefined && stored[key] !== null) out[key] = stored[key];
  }
  return out;
}

function toFormShape(profile) {
  return {
    clientName: profile.clientName || "",
    address: profile.address || "",
    contactPersonName: profile.contactPersonName || "",
    contactPhone: profile.contactPhone || "",
    poNumber: profile.poNumber || "",
    poValue: profile.poValue ?? "",
    deliveryDueDate: profile.deliveryDueDate || "",
    termsAndConditions: profile.termsAndConditions || "",
    phase2: withEmptyFallback(emptyPhase2(), profile.phase2),
    phase3: withEmptyFallback(emptyPhase3(), profile.phase3),
    phase4: withEmptyFallback(emptyPhase4(), profile.phase4),
  };
}

// Shared by the Company Profiles page's drawer and the Business
// Development enquiry drawer's "Company Profile" tab — same record, same
// editing UI, whichever screen it's opened from. `showPhases` gates
// Phase III/Project Plan/Project Completion plus the PO/contract summary —
// that level of detail belongs to the standalone Company Profiles page, not
// a quick look from the enquiry. `showPhase2` is independent: Conversation
// Stage (the proposal/follow-up tracking, internally still "phase2") lives
// only in the BD enquiry drawer, not on the standalone page — defaults to
// following `showPhases` so any other caller keeps the old all-or-nothing
// behavior.
export default function CompanyProfileEditor({ profile, onChanged, showPhases = true, showPhase2 = showPhases }) {
  const [section, setSection] = useState("Company Details");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => toFormShape(profile));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const sections = [
    "Company Details",
    ...(showPhase2 ? ["Conversation Stage"] : []),
    ...(showPhases ? ["Phase III", "Project Plan", "Project Completion"] : []),
  ];
  const hasTabs = sections.length > 1;

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function setPhase2(k, v) { setForm((f) => ({ ...f, phase2: { ...f.phase2, [k]: v } })); }
  function setPhase3(k, v) { setForm((f) => ({ ...f, phase3: { ...f.phase3, [k]: v } })); }
  function setPhase4(k, v) { setForm((f) => ({ ...f, phase4: { ...f.phase4, [k]: v } })); }

  async function save(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.put(`/company-profiles/${profile.id}`, form);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addConversation(date, description) {
    try {
      await client.post(`/company-profiles/${profile.id}/conversations`, { date, description });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function removeConversation(convId) {
    try {
      await client.delete(`/company-profiles/${profile.id}/conversations/${convId}`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function addClientReply(date, reply) {
    try {
      await client.post(`/company-profiles/${profile.id}/client-replies`, { date, reply });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function removeClientReply(replyId) {
    try {
      await client.delete(`/company-profiles/${profile.id}/client-replies/${replyId}`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const conversations = profile.phase2?.conversations || [];
  const clientReplies = profile.phase2?.clientReplies || [];
  const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
  const isProjectPlan = showPhases && section === "Project Plan";

  return (
    <div>
      <div className="toolbar">
        {hasTabs && (
          <div className="drawer-tabs" style={{ marginBottom: 0, borderBottom: "none" }}>
            {sections.map((s) => (
              <button key={s} className={section === s ? "active" : ""} onClick={() => setSection(s)}>{s}</button>
            ))}
          </div>
        )}
        <div className="spacer" />
        {!editing && !isProjectPlan && <button className="btn-sm" onClick={() => { setForm(toFormShape(profile)); setEditing(true); }}>Edit</button>}
      </div>

      {isProjectPlan ? (
        <PlanActionsSection profileId={profile.id} actions={profile.phase3b?.actions || []} onChanged={onChanged} />
      ) : !editing ? (
        <div>
          {(!hasTabs || section === "Company Details") && (
            <table>
              <tbody>
                <tr><td>Client / Company</td><td>{profile.clientName}</td></tr>
                <tr><td>Address</td><td>{profile.address || "-"}</td></tr>
                <tr><td>Contact Person</td><td>{profile.contactPersonName || "-"}</td></tr>
                <tr><td>Contact Phone</td><td>{profile.contactPhone || "-"}</td></tr>
                {showPhases && <tr><td>PO Number</td><td>{profile.poNumber || "-"}</td></tr>}
                {showPhases && <tr><td>PO Value</td><td>{profile.poValue ?? "-"}</td></tr>}
                {showPhases && <tr><td>Delivery Due Date</td><td>{profile.deliveryDueDate || "-"}</td></tr>}
                {showPhases && <tr><td>Terms and Conditions</td><td style={{ whiteSpace: "pre-wrap" }}>{profile.termsAndConditions || "-"}</td></tr>}
                {showPhases && profile.sourceEnquiryNo && <tr><td>Source Enquiry</td><td>{profile.sourceEnquiryNo}</td></tr>}
              </tbody>
            </table>
          )}

          {showPhase2 && section === "Conversation Stage" && (
            <div>
              <table>
                <tbody>
                  <tr><td>Proposal No.</td><td>{profile.phase2?.proposalNo || "-"}</td></tr>
                  <tr><td>Proposal Date</td><td>{profile.phase2?.proposalDate || "-"}</td></tr>
                  <tr><td>Mode of Submission</td><td>{profile.phase2?.modeOfSubmission || "-"}</td></tr>
                  <tr><td>Whom It Has Been Submitted</td><td>{profile.phase2?.submittedTo || "-"}</td></tr>
                  <tr><td>Who Has Submitted</td><td>{profile.phase2?.submittedBy || "-"}</td></tr>
                  <tr><td>Next Follow-up Due On</td><td>{profile.phase2?.nextFollowUpDueOn || "-"}</td></tr>
                  <tr><td>Next Follow-up Date</td><td>{profile.phase2?.nextFollowUpDate || "-"}</td></tr>
                </tbody>
              </table>

              <div className="card">
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <strong>Conversation Log</strong>
                  <div className="spacer" />
                </div>
                {conversations.map((c, i) => (
                  <div key={c.id} className="toolbar" style={{ alignItems: "flex-start" }}>
                    <strong style={{ width: 40 }}>{ORDINALS[i] || `${i + 1}th`}</strong>
                    <div style={{ flex: 1 }}>{c.description} {c.date && <span className="hint-text">({c.date})</span>}</div>
                    <button className="btn-sm btn-danger" onClick={() => removeConversation(c.id)}>Delete</button>
                  </div>
                ))}
                {conversations.length === 0 && <p className="hint-text mt-0">No conversations logged yet.</p>}
                <AddConversationInline onAdd={addConversation} />
              </div>

              <div className="card">
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <strong>Client Replies</strong>
                  <div className="spacer" />
                </div>
                {clientReplies.map((r, i) => (
                  <div key={r.id} className="toolbar" style={{ alignItems: "flex-start" }}>
                    <strong style={{ width: 40 }}>{ORDINALS[i] || `${i + 1}th`}</strong>
                    <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>{r.reply} {r.date && <span className="hint-text">({r.date})</span>}</div>
                    <button className="btn-sm btn-danger" onClick={() => removeClientReply(r.id)}>Delete</button>
                  </div>
                ))}
                {clientReplies.length === 0 && <p className="hint-text mt-0">No replies received yet.</p>}
                <AddClientReplyInline onAdd={addClientReply} />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={!!profile.phase2?.respondedInFavour} disabled />
                Responded in favour
              </label>
              {profile.phase2?.respondedInFavour && (
                <table>
                  <tbody>
                    <tr><td>Final Proposal After Negotiation</td><td style={{ whiteSpace: "pre-wrap" }}>{profile.phase2?.finalProposalAfterNegotiation || "-"}</td></tr>
                    <tr><td>Work Order Date</td><td>{profile.phase2?.workOrderDate || "-"}</td></tr>
                    <tr><td>Work Order Number</td><td>{profile.phase2?.workOrderNumber || "-"}</td></tr>
                  </tbody>
                </table>
              )}
            </div>
          )}

          {showPhases && section === "Phase III" && (
            <table>
              <tbody>
                <tr><td>Work Order Date</td><td>{profile.phase3?.workOrderDate || "-"}</td></tr>
                <tr><td>Work Order Number</td><td>{profile.phase3?.workOrderNumber || "-"}</td></tr>
                <tr><td>Work Order Description</td><td style={{ whiteSpace: "pre-wrap" }}>{profile.phase3?.workOrderDescription || "-"}</td></tr>
                <tr><td>Delivery Conditions / Scope of Work</td><td style={{ whiteSpace: "pre-wrap" }}>{profile.phase3?.deliveryConditions || "-"}</td></tr>
                <tr><td>Payment Terms</td><td style={{ whiteSpace: "pre-wrap" }}>{profile.phase3?.paymentTerms || "-"}</td></tr>
              </tbody>
            </table>
          )}

          {showPhases && section === "Project Completion" && (
            <div>
              <h3 className="mt-0">Delivery Report</h3>
              <table>
                <tbody>
                  <tr><td>Submitted</td><td>{profile.phase4?.deliveryReportSubmitted ? "Yes" : "No"}</td></tr>
                  <tr><td>Date</td><td>{profile.phase4?.deliveryReportDate || "-"}</td></tr>
                  <tr><td>Notes</td><td style={{ whiteSpace: "pre-wrap" }}>{profile.phase4?.deliveryReportNotes || "-"}</td></tr>
                </tbody>
              </table>
              <h3>Invoice</h3>
              <table>
                <tbody>
                  <tr><td>Invoice Number</td><td>{profile.phase4?.invoiceNumber || "-"}</td></tr>
                  <tr><td>Invoice Date</td><td>{profile.phase4?.invoiceDate || "-"}</td></tr>
                  <tr><td>Invoice Amount</td><td>{profile.phase4?.invoiceAmount ?? "-"}</td></tr>
                  <tr><td>Payment Received</td><td>{profile.phase4?.paymentReceived ? "Yes" : "No"}</td></tr>
                  <tr><td>Payment Received Date</td><td>{profile.phase4?.paymentReceivedDate || "-"}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          <ErrorText>{error}</ErrorText>
        </div>
      ) : (
        <form onSubmit={save}>
          {(!hasTabs || section === "Company Details") && (
            <div>
              <div className="form-row">
                <div><label>Client / Company Name</label><input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} required /></div>
                <div><label>Address</label><input value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div><label>Contact Person Name</label><input value={form.contactPersonName} onChange={(e) => set("contactPersonName", e.target.value)} /></div>
                <div><label>Contact Phone</label><input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></div>
              </div>
              {showPhases && (
                <>
                  <div className="form-row">
                    <div><label>PO Number</label><input value={form.poNumber} onChange={(e) => set("poNumber", e.target.value)} /></div>
                    <div><label>PO Value</label><input type="number" min="0" step="0.01" value={form.poValue} onChange={(e) => set("poValue", e.target.value)} /></div>
                    <div><label>Delivery Due Date</label><input type="date" value={form.deliveryDueDate} onChange={(e) => set("deliveryDueDate", e.target.value)} /></div>
                  </div>
                  <label>Terms and Conditions</label>
                  <textarea rows={3} value={form.termsAndConditions} onChange={(e) => set("termsAndConditions", e.target.value)} />
                </>
              )}
            </div>
          )}

          {showPhase2 && section === "Conversation Stage" && (
            <div>
              <div className="form-row">
                <div><label>Proposal No.</label><input value={form.phase2.proposalNo} onChange={(e) => setPhase2("proposalNo", e.target.value)} /></div>
                <div><label>Proposal Date</label><input type="date" value={form.phase2.proposalDate} onChange={(e) => setPhase2("proposalDate", e.target.value)} /></div>
                <div><label>Mode of Submission</label><input value={form.phase2.modeOfSubmission} onChange={(e) => setPhase2("modeOfSubmission", e.target.value)} placeholder="e.g. Email, In-person" /></div>
              </div>
              <div className="form-row">
                <div><label>Whom It Has Been Submitted</label><input value={form.phase2.submittedTo} onChange={(e) => setPhase2("submittedTo", e.target.value)} /></div>
                <div><label>Who Has Submitted</label><input value={form.phase2.submittedBy} onChange={(e) => setPhase2("submittedBy", e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div><label>Next Follow-up Due On</label><input type="date" value={form.phase2.nextFollowUpDueOn} onChange={(e) => setPhase2("nextFollowUpDueOn", e.target.value)} /></div>
                <div><label>Next Follow-up Date</label><input type="date" value={form.phase2.nextFollowUpDate} onChange={(e) => setPhase2("nextFollowUpDate", e.target.value)} /></div>
              </div>

              <div className="card">
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <strong>Conversation Log</strong>
                  <div className="spacer" />
                </div>
                {conversations.map((c, i) => (
                  <div key={c.id} className="toolbar" style={{ alignItems: "flex-start" }}>
                    <strong style={{ width: 40 }}>{ORDINALS[i] || `${i + 1}th`}</strong>
                    <div style={{ flex: 1 }}>{c.description} {c.date && <span className="hint-text">({c.date})</span>}</div>
                    <button type="button" className="btn-sm btn-danger" onClick={() => removeConversation(c.id)}>Delete</button>
                  </div>
                ))}
                {conversations.length === 0 && <p className="hint-text mt-0">No conversations logged yet.</p>}
                <AddConversationInline onAdd={addConversation} />
              </div>

              <div className="card">
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <strong>Client Replies</strong>
                  <div className="spacer" />
                </div>
                {clientReplies.map((r, i) => (
                  <div key={r.id} className="toolbar" style={{ alignItems: "flex-start" }}>
                    <strong style={{ width: 40 }}>{ORDINALS[i] || `${i + 1}th`}</strong>
                    <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>{r.reply} {r.date && <span className="hint-text">({r.date})</span>}</div>
                    <button type="button" className="btn-sm btn-danger" onClick={() => removeClientReply(r.id)}>Delete</button>
                  </div>
                ))}
                {clientReplies.length === 0 && <p className="hint-text mt-0">No replies received yet.</p>}
                <AddClientReplyInline onAdd={addClientReply} />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={form.phase2.respondedInFavour} onChange={(e) => setPhase2("respondedInFavour", e.target.checked)} />
                Responded in favour
              </label>
              {form.phase2.respondedInFavour && (
                <>
                  <label>Final Proposal Submission After Negotiation</label>
                  <textarea rows={2} value={form.phase2.finalProposalAfterNegotiation} onChange={(e) => setPhase2("finalProposalAfterNegotiation", e.target.value)} />
                  <div className="form-row">
                    <div><label>Work Order Date</label><input type="date" value={form.phase2.workOrderDate} onChange={(e) => setPhase2("workOrderDate", e.target.value)} /></div>
                    <div><label>Work Order Number</label><input value={form.phase2.workOrderNumber} onChange={(e) => setPhase2("workOrderNumber", e.target.value)} /></div>
                  </div>
                </>
              )}
            </div>
          )}

          {showPhases && section === "Phase III" && (
            <div>
              <div className="form-row">
                <div><label>Work Order Date</label><input type="date" value={form.phase3.workOrderDate} onChange={(e) => setPhase3("workOrderDate", e.target.value)} /></div>
                <div><label>Work Order Number</label><input value={form.phase3.workOrderNumber} onChange={(e) => setPhase3("workOrderNumber", e.target.value)} /></div>
              </div>
              <label>Work Order Description</label>
              <textarea rows={2} value={form.phase3.workOrderDescription} onChange={(e) => setPhase3("workOrderDescription", e.target.value)} />
              <label>Delivery Conditions / Scope of Work</label>
              <textarea rows={2} value={form.phase3.deliveryConditions} onChange={(e) => setPhase3("deliveryConditions", e.target.value)} />
              <label>Payment Terms</label>
              <textarea rows={2} value={form.phase3.paymentTerms} onChange={(e) => setPhase3("paymentTerms", e.target.value)} />
            </div>
          )}

          {showPhases && section === "Project Completion" && (
            <div>
              <h3 className="mt-0">Delivery Report</h3>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={form.phase4.deliveryReportSubmitted} onChange={(e) => setPhase4("deliveryReportSubmitted", e.target.checked)} />
                Delivery report submitted
              </label>
              <div className="form-row">
                <div><label>Date</label><input type="date" value={form.phase4.deliveryReportDate} onChange={(e) => setPhase4("deliveryReportDate", e.target.value)} /></div>
              </div>
              <label>Notes</label>
              <textarea rows={2} value={form.phase4.deliveryReportNotes} onChange={(e) => setPhase4("deliveryReportNotes", e.target.value)} />

              <h3>Invoice</h3>
              <div className="form-row">
                <div><label>Invoice Number</label><input value={form.phase4.invoiceNumber} onChange={(e) => setPhase4("invoiceNumber", e.target.value)} /></div>
                <div><label>Invoice Date</label><input type="date" value={form.phase4.invoiceDate} onChange={(e) => setPhase4("invoiceDate", e.target.value)} /></div>
                <div><label>Invoice Amount</label><input type="number" min="0" step="0.01" value={form.phase4.invoiceAmount} onChange={(e) => setPhase4("invoiceAmount", e.target.value)} /></div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={form.phase4.paymentReceived} onChange={(e) => setPhase4("paymentReceived", e.target.checked)} />
                Payment received
              </label>
              <div className="form-row">
                <div><label>Payment Received Date</label><input type="date" value={form.phase4.paymentReceivedDate} onChange={(e) => setPhase4("paymentReceivedDate", e.target.value)} /></div>
              </div>
            </div>
          )}

          <ErrorText>{error}</ErrorText>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => { setForm(toFormShape(profile)); setEditing(false); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// A plain div, not a <form> — this renders inside the outer Company
// Details/Conversation Stage/Phase III <form> while that's in edit mode, and a <form>
// cannot be nested inside another <form> (the browser would either drop it
// or route its submit to the outer one instead of this handler).
function AddConversationInline({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!description || busy) return;
    setBusy(true);
    await onAdd(date, description);
    setBusy(false);
    setDate("");
    setDescription("");
    setOpen(false);
  }

  if (!open) return <button type="button" className="btn-sm" onClick={() => setOpen(true)}>+ Add Conversation</button>;

  return (
    <div className="form-row" style={{ marginTop: 8 }}>
      <div style={{ flex: "0 0 150px" }}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="Conversation description"
        />
      </div>
      <button type="button" className="btn-sm btn-primary" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add"}</button>
      <button type="button" className="btn-sm" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// Phase III(b) — Project Plan: a numbered action list, independent of the
// rest of the profile's Edit/Save toggle (same pattern as the Business
// Development action log — each add/toggle/delete saves immediately).
function PlanActionsSection({ profileId, actions, onChanged }) {
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const sorted = [...actions].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  async function toggleComplete(action) {
    try {
      await client.put(`/company-profiles/${profileId}/plan-actions/${action.id}`, { completed: !action.completed });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(actionId) {
    if (!window.confirm("Delete this action?")) return;
    try {
      await client.delete(`/company-profiles/${profileId}/plan-actions/${actionId}`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="spacer" />
        <button className="btn-sm" onClick={() => setShowAdd(true)}>+ Add Action</button>
      </div>
      <ErrorText>{error}</ErrorText>
      {sorted.length === 0 && <div className="empty-state">No actions logged yet.</div>}
      {sorted.map((a, i) => {
        const overdue = !a.completed && a.dueDate < todayISO();
        return (
          <div key={a.id} className="card" style={{ marginBottom: 10 }}>
            <div className="toolbar" style={{ marginBottom: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={a.completed} onChange={() => toggleComplete(a)} />
                <strong>Action #{i + 1}:</strong>
                <span style={{ textDecoration: a.completed ? "line-through" : "none" }}>{a.description}</span>
              </label>
              <div className="spacer" />
              <button className="btn-sm btn-danger" onClick={() => remove(a.id)}>Delete</button>
            </div>
            <p className="hint-text mt-0">
              Assigned to: {a.assignedToName || a.assignedTo} · Due: <span className={overdue ? "overdue" : ""}>{a.dueDate}{overdue ? " (overdue)" : ""}</span>
              {a.startDate && <> · Started: {a.startDate}</>}
              {a.completed && a.completedAt && <> · Completed: {new Date(a.completedAt).toLocaleDateString()}</>}
            </p>
          </div>
        );
      })}

      {showAdd && (
        <AddPlanActionModal profileId={profileId} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); onChanged(); }} />
      )}
    </div>
  );
}

function AddPlanActionModal({ profileId, onClose, onAdded }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ description: "", assignedTo: "", startDate: todayISO(), dueDate: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get("/profiles").then((r) => setEmployees(r.data.filter((p) => !p.disabled))).catch(() => {});
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.assignedTo) return setError("Assign this action to an employee");
    setBusy(true);
    try {
      const employee = employees.find((emp) => emp.userId === form.assignedTo);
      await client.post(`/company-profiles/${profileId}/plan-actions`, { ...form, assignedToName: employee?.name });
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>Add Project Plan Action</h3>
          <button className="btn-sm" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={submit}>
          <label>What action is to be taken</label>
          <textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} required />
          <label>Responsibility — assign to employee</label>
          <select value={form.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} required>
            <option value="">Select employee…</option>
            {employees.map((emp) => <option key={emp.userId} value={emp.userId}>{emp.name} ({emp.userId})</option>)}
          </select>
          <div className="form-row">
            <div><label>Action Start Date</label><input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
            <div><label>Due Date</label><input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} required /></div>
          </div>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Add Action"}</button>
        </form>
      </div>
    </div>
  );
}
