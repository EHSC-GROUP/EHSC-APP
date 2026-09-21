import { useEffect, useState } from "react";
import client, { errorMessage } from "../api/client";
import { ErrorText, Loading } from "./Misc";
import StatusBadge from "./StatusBadge";

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

function toFormShape(project) {
  return {
    poNumber: project.poNumber || "",
    poValue: project.poValue ?? "",
    deliveryDueDate: project.deliveryDueDate || "",
    termsAndConditions: project.termsAndConditions || "",
    phase2: withEmptyFallback(emptyPhase2(), project.phase2),
    phase3: withEmptyFallback(emptyPhase3(), project.phase3),
    phase4: withEmptyFallback(emptyPhase4(), project.phase4),
  };
}

// Edits one Project (PO/contract, Phase II "Conversation Stage",
// Implementation Phase work order, Project Plan, Project Completion) — the
// company itself (name/address/contact/company code) is a separate,
// lightweight record shown here read-only via `company`, since a company
// can have several projects and editing its identity shouldn't happen from
// inside one of them. `showPhases` gates Company Details (the read-only
// company/PO/contract summary) plus Implementation Phase/Project
// Plan/Project Completion — that level of detail belongs to the standalone
// Company Profiles page, not a quick look from the enquiry. `showPhase2` is
// independent: Conversation Stage (the proposal/follow-up tracking,
// internally still "phase2") is the *only* thing the BD enquiry drawer
// shows (no tab bar, since it's the single section) — defaults to
// following `showPhases` so any other caller keeps the old all-or-nothing
// behavior.
export default function ProjectEditor({ project, company, onChanged, showPhases = true, showPhase2 = showPhases }) {
  // Project Costing (REQ-04) is a disabled-by-default feature — only add
  // the tab once an admin has switched it on in Settings.
  const [costingEnabled, setCostingEnabled] = useState(false);
  useEffect(() => {
    if (!showPhases) return;
    client.get("/settings/feature-flags").then(({ data }) => setCostingEnabled(!!data.projectCosting)).catch(() => setCostingEnabled(false));
  }, [showPhases]);

  const sections = [
    ...(showPhases ? ["Company Details"] : []),
    ...(showPhase2 ? ["Conversation Stage"] : []),
    ...(showPhases ? ["Implementation Phase", "Project Plan", "Project Completion"] : []),
    ...(showPhases && costingEnabled ? ["Costing"] : []),
  ];
  const hasTabs = sections.length > 1;

  const [section, setSection] = useState(sections[0]);
  const branch = (company?.branches || []).find((b) => b.id === project.branchId);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => toFormShape(project));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function setPhase2(k, v) { setForm((f) => ({ ...f, phase2: { ...f.phase2, [k]: v } })); }
  function setPhase3(k, v) { setForm((f) => ({ ...f, phase3: { ...f.phase3, [k]: v } })); }
  function setPhase4(k, v) { setForm((f) => ({ ...f, phase4: { ...f.phase4, [k]: v } })); }

  async function save(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.put(`/projects/${project.id}`, form);
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
      await client.post(`/projects/${project.id}/conversations`, { date, description });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function removeConversation(convId) {
    try {
      await client.delete(`/projects/${project.id}/conversations/${convId}`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function addClientReply(date, reply) {
    try {
      await client.post(`/projects/${project.id}/client-replies`, { date, reply });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function removeClientReply(replyId) {
    try {
      await client.delete(`/projects/${project.id}/client-replies/${replyId}`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const conversations = project.phase2?.conversations || [];
  const clientReplies = project.phase2?.clientReplies || [];
  const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
  const isProjectPlan = showPhases && section === "Project Plan";
  const isCosting = showPhases && costingEnabled && section === "Costing";

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
        {!editing && !isProjectPlan && !isCosting && <button className="btn-sm" onClick={() => { setForm(toFormShape(project)); setEditing(true); }}>Edit</button>}
      </div>

      {isProjectPlan ? (
        <PlanActionsSection projectId={project.id} actions={project.phase3b?.actions || []} onChanged={onChanged} />
      ) : isCosting ? (
        <ProjectCostingTab projectId={project.id} />
      ) : !editing ? (
        <div>
          {showPhases && section === "Company Details" && (
            <table>
              <tbody>
                <tr><td>Project ID</td><td>{project.projectId}</td></tr>
                <tr><td>Company</td><td>{branch?.companyCode} — {company?.clientName}</td></tr>
                <tr><td>Address</td><td>{branch?.address || "-"}</td></tr>
                <tr><td>Contact Person</td><td>{branch?.contactPersonName || "-"}</td></tr>
                <tr><td>Contact Phone</td><td>{branch?.contactPhone || "-"}</td></tr>
                {showPhases && <tr><td>PO Number</td><td>{project.poNumber || "-"}</td></tr>}
                {showPhases && <tr><td>PO Value</td><td>{project.poValue ?? "-"}</td></tr>}
                {showPhases && <tr><td>Delivery Due Date</td><td>{project.deliveryDueDate || "-"}</td></tr>}
                {showPhases && <tr><td>Terms and Conditions</td><td style={{ whiteSpace: "pre-wrap" }}>{project.termsAndConditions || "-"}</td></tr>}
                {showPhases && project.sourceEnquiryNo && <tr><td>Source Enquiry</td><td>{project.sourceEnquiryNo}</td></tr>}
              </tbody>
            </table>
          )}

          {showPhase2 && section === "Conversation Stage" && (
            <div>
              <table>
                <tbody>
                  <tr><td>Proposal No.</td><td>{project.phase2?.proposalNo || "-"}</td></tr>
                  <tr><td>Proposal Date</td><td>{project.phase2?.proposalDate || "-"}</td></tr>
                  <tr><td>Mode of Submission</td><td>{project.phase2?.modeOfSubmission || "-"}</td></tr>
                  <tr><td>Whom It Has Been Submitted</td><td>{project.phase2?.submittedTo || "-"}</td></tr>
                  <tr><td>Who Has Submitted</td><td>{project.phase2?.submittedBy || "-"}</td></tr>
                  <tr><td>Next Follow-up Due On</td><td>{project.phase2?.nextFollowUpDueOn || "-"}</td></tr>
                  <tr><td>Next Follow-up Date</td><td>{project.phase2?.nextFollowUpDate || "-"}</td></tr>
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
                <input type="checkbox" style={{ width: "auto" }} checked={!!project.phase2?.respondedInFavour} disabled />
                Responded in favour
              </label>
              {project.phase2?.respondedInFavour && (
                <table>
                  <tbody>
                    <tr><td>Final Proposal After Negotiation</td><td style={{ whiteSpace: "pre-wrap" }}>{project.phase2?.finalProposalAfterNegotiation || "-"}</td></tr>
                    <tr><td>Work Order Date</td><td>{project.phase2?.workOrderDate || "-"}</td></tr>
                    <tr><td>Work Order Number</td><td>{project.phase2?.workOrderNumber || "-"}</td></tr>
                  </tbody>
                </table>
              )}
            </div>
          )}

          {showPhases && section === "Implementation Phase" && (
            <table>
              <tbody>
                <tr><td>Work Order Date</td><td>{project.phase3?.workOrderDate || "-"}</td></tr>
                <tr><td>Work Order Number</td><td>{project.phase3?.workOrderNumber || "-"}</td></tr>
                <tr><td>Work Order Description</td><td style={{ whiteSpace: "pre-wrap" }}>{project.phase3?.workOrderDescription || "-"}</td></tr>
                <tr><td>Delivery Conditions / Scope of Work</td><td style={{ whiteSpace: "pre-wrap" }}>{project.phase3?.deliveryConditions || "-"}</td></tr>
                <tr><td>Payment Terms</td><td style={{ whiteSpace: "pre-wrap" }}>{project.phase3?.paymentTerms || "-"}</td></tr>
              </tbody>
            </table>
          )}

          {showPhases && section === "Project Completion" && (
            <div>
              <h3 className="mt-0">Delivery Report</h3>
              <table>
                <tbody>
                  <tr><td>Submitted</td><td>{project.phase4?.deliveryReportSubmitted ? "Yes" : "No"}</td></tr>
                  <tr><td>Date</td><td>{project.phase4?.deliveryReportDate || "-"}</td></tr>
                  <tr><td>Notes</td><td style={{ whiteSpace: "pre-wrap" }}>{project.phase4?.deliveryReportNotes || "-"}</td></tr>
                </tbody>
              </table>
              <h3>Invoice</h3>
              <table>
                <tbody>
                  <tr><td>Invoice Number</td><td>{project.phase4?.invoiceNumber || "-"}</td></tr>
                  <tr><td>Invoice Date</td><td>{project.phase4?.invoiceDate || "-"}</td></tr>
                  <tr><td>Invoice Amount</td><td>{project.phase4?.invoiceAmount ?? "-"}</td></tr>
                  <tr><td>Payment Received</td><td>{project.phase4?.paymentReceived ? "Yes" : "No"}</td></tr>
                  <tr><td>Payment Received Date</td><td>{project.phase4?.paymentReceivedDate || "-"}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          <ErrorText>{error}</ErrorText>
        </div>
      ) : (
        <form onSubmit={save}>
          {showPhases && section === "Company Details" && (
            <div>
              <p className="hint-text mt-0">
                Company name, address and contact are edited from the company itself (Company Profiles), not per-project.
              </p>
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

          {showPhases && section === "Implementation Phase" && (
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
            <button type="button" onClick={() => { setForm(toFormShape(project)); setEditing(false); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// A plain div, not a <form> — this renders inside the outer Company
// Details/Conversation Stage/Implementation Phase <form> while that's in edit mode, and a <form>
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

  if (!open) return <button type="button" className="btn-sm" onClick={() => setOpen(true)}>+ Add Question</button>;

  return (
    <div className="form-row" style={{ marginTop: 8 }}>
      <div style={{ flex: "0 0 150px" }}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="Question asked to the client"
        />
      </div>
      <button type="button" className="btn-sm btn-primary" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add"}</button>
      <button type="button" className="btn-sm" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

// Same shape as AddConversationInline, but for what the client actually
// says back to us — kept as its own dated log rather than a single
// overwritable field, since a client may reply more than once before
// "Responded in favour" is ever ticked.
function AddClientReplyInline({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reply || busy) return;
    setBusy(true);
    await onAdd(date, reply);
    setBusy(false);
    setDate("");
    setReply("");
    setOpen(false);
  }

  if (!open) return <button type="button" className="btn-sm" onClick={() => setOpen(true)}>+ Add Client Reply</button>;

  return (
    <div className="form-row" style={{ marginTop: 8 }}>
      <div style={{ flex: "0 0 150px" }}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div>
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="What the client said"
        />
      </div>
      <button type="button" className="btn-sm btn-primary" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add"}</button>
      <button type="button" className="btn-sm" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// Phase III(b) — Project Plan: a numbered action list, independent of the
// rest of the project's Edit/Save toggle (same pattern as the Business
// Development action log — each add/toggle/delete saves immediately).
function PlanActionsSection({ projectId, actions, onChanged }) {
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [dateForm, setDateForm] = useState({ startDate: "", dueDate: "" });
  const [savingDates, setSavingDates] = useState(false);
  const sorted = [...actions].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const byId = new Map(actions.map((a) => [a.id, a]));

  async function toggleComplete(action) {
    try {
      await client.put(`/projects/${projectId}/plan-actions/${action.id}`, { completed: !action.completed });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(actionId) {
    if (!window.confirm("Delete this action?")) return;
    try {
      await client.delete(`/projects/${projectId}/plan-actions/${actionId}`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function startEditDates(action) {
    setEditingId(action.id);
    setDateForm({ startDate: action.startDate || "", dueDate: action.dueDate || "" });
    setError("");
  }

  async function saveDates(actionId) {
    if (!dateForm.dueDate) return setError("Due date is required.");
    setSavingDates(true);
    setError("");
    try {
      await client.put(`/projects/${projectId}/plan-actions/${actionId}`, {
        startDate: dateForm.startDate || null,
        dueDate: dateForm.dueDate,
      });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingDates(false);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="spacer" />
        {actions.length > 1 && (
          <button className="btn-sm" onClick={() => setShowWorkflow(true)}>Define Workflow</button>
        )}
        <button className="btn-sm" onClick={() => setShowAdd(true)}>+ Add Action</button>
      </div>
      <ErrorText>{error}</ErrorText>
      {sorted.length === 0 && <div className="empty-state">No actions logged yet.</div>}
      {sorted.map((a, i) => {
        const overdue = !a.completed && a.dueDate < todayISO();
        const predecessors = (a.dependsOn || []).map((depId) => byId.get(depId)).filter(Boolean);
        const conflicting = a.startDate ? predecessors.filter((p) => p.dueDate && a.startDate < p.dueDate) : [];
        return (
          <div key={a.id} className="card" style={{ marginBottom: 10 }}>
            <div className="toolbar" style={{ marginBottom: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={a.completed} onChange={() => toggleComplete(a)} />
                <strong>Action #{i + 1}:</strong>
                <span style={{ textDecoration: a.completed ? "line-through" : "none" }}>{a.description}</span>
              </label>
              <div className="spacer" />
              {editingId !== a.id && (
                <button className="btn-sm" onClick={() => startEditDates(a)}>Edit Dates</button>
              )}
              <button className="btn-sm btn-danger" onClick={() => remove(a.id)}>Delete</button>
            </div>
            {editingId === a.id ? (
              <div className="form-row" style={{ alignItems: "flex-end", marginBottom: 4 }}>
                <div>
                  <label>Start Date</label>
                  <input type="date" value={dateForm.startDate} onChange={(e) => setDateForm((f) => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label>Due Date</label>
                  <input type="date" value={dateForm.dueDate} onChange={(e) => setDateForm((f) => ({ ...f, dueDate: e.target.value }))} />
                </div>
                <button className="btn-sm btn-primary" onClick={() => saveDates(a.id)} disabled={savingDates}>{savingDates ? "Saving…" : "Save"}</button>
                <button className="btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            ) : (
              <p className="hint-text mt-0">
                Assigned to: {a.assignedToName || a.assignedTo} · Due: <span className={overdue ? "overdue" : ""}>{a.dueDate}{overdue ? " (overdue)" : ""}</span>
                {a.startDate && <> · Started: {a.startDate}</>}
                {a.completed && a.completedAt && <> · Completed: {new Date(a.completedAt).toLocaleDateString()}</>}
              </p>
            )}
            {predecessors.length > 0 && (
              <p className="hint-text mt-0">Depends on: {predecessors.map((p) => p.description).join(", ")}</p>
            )}
            {conflicting.length > 0 && (
              <p className="hint-text mt-0 overdue">
                ⚠ Starts before {conflicting.map((p) => `"${p.description}" (due ${p.dueDate})`).join(", ")} finishes
              </p>
            )}
          </div>
        );
      })}

      {showAdd && (
        <AddPlanActionModal projectId={projectId} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); onChanged(); }} />
      )}
      {showWorkflow && (
        <WorkflowModal projectId={projectId} actions={actions} onClose={() => setShowWorkflow(false)} onSaved={() => { setShowWorkflow(false); onChanged(); }} />
      )}
    </div>
  );
}

// Lets the admin say, for each action, which other actions must be done
// first — a many-to-many "depends on" set per action, not just a single
// predecessor, since real work often waits on more than one prior step.
// Saved per-action (only ones that actually changed) via the same PUT the
// rest of plan-actions editing uses; the backend rejects unknown ids and
// circular dependencies.
// Reconstructs a 1st/2nd/3rd... order from existing single-predecessor
// dependsOn chains, if they cleanly form one straight line. Anything messier
// (branches, multiple predecessors from earlier testing, no chain at all)
// just falls back to due-date order as a sensible starting point.
function deriveInitialOrder(actions) {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const parentOf = new Map(actions.map((a) => [a.id, (a.dependsOn || [])[0] || null]));
  const isSingleChain = actions.every((a) => (a.dependsOn || []).length <= 1);
  if (isSingleChain) {
    const childOf = new Map();
    let branched = false;
    for (const a of actions) {
      const parent = parentOf.get(a.id);
      if (parent) {
        if (childOf.has(parent)) branched = true;
        childOf.set(parent, a.id);
      }
    }
    const roots = actions.filter((a) => !parentOf.get(a.id));
    if (!branched && roots.length === 1) {
      const order = [];
      const seen = new Set();
      let cur = roots[0];
      while (cur && !seen.has(cur.id)) {
        order.push(cur);
        seen.add(cur.id);
        const nextId = childOf.get(cur.id);
        cur = nextId ? byId.get(nextId) : null;
      }
      if (order.length === actions.length) return order;
    }
  }
  return [...actions].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}

// A straight numbered sequence — action 2 waits on action 1, action 3 waits
// on action 2, and so on. Reordered with Up/Down rather than drag-and-drop
// to avoid a DnD dependency for a short list.
function WorkflowModal({ projectId, actions, onClose, onSaved }) {
  const [order, setOrder] = useState(() => deriveInitialOrder(actions));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function move(index, dir) {
    setOrder((cur) => {
      const target = index + dir;
      if (target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    setError("");
    setBusy(true);
    try {
      for (let i = 0; i < order.length; i++) {
        const a = order[i];
        const newDeps = i === 0 ? [] : [order[i - 1].id];
        const before = [...(a.dependsOn || [])].sort().join(",");
        const after = [...newDeps].sort().join(",");
        if (before !== after) {
          await client.put(`/projects/${projectId}/plan-actions/${a.id}`, { dependsOn: newDeps });
        }
      }
      onSaved();
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
          <h3>Define Workflow</h3>
          <button className="btn-sm" onClick={onClose}>Close</button>
        </div>
        <p className="hint-text mt-0">Set the order these actions happen in — each one waits on the one right before it.</p>
        {order.map((a, i) => (
          <div key={a.id} className="card" style={{ marginBottom: 8 }}>
            <div className="toolbar" style={{ margin: 0 }}>
              <strong style={{ width: 24 }}>{i + 1}.</strong>
              <div style={{ flex: 1 }}>
                <div>{a.description}</div>
                <div className="hint-text">{a.assignedToName || a.assignedTo}</div>
              </div>
              <button type="button" className="btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>Move up</button>
              <button type="button" className="btn-sm" onClick={() => move(i, 1)} disabled={i === order.length - 1}>Move down</button>
            </div>
          </div>
        ))}
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save Order"}</button>
      </div>
    </div>
  );
}

function AddPlanActionModal({ projectId, onClose, onAdded }) {
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
      await client.post(`/projects/${projectId}/plan-actions`, { ...form, assignedToName: employee?.name });
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

const COST_TYPES = ["GENERAL", "TRAVEL", "ACCOMMODATION", "ADVANCE"];
const COST_TYPE_LABEL = { GENERAL: "General", TRAVEL: "Travel", ACCOMMODATION: "Accommodation", ADVANCE: "Advance" };

// REQ-04: running cost spent on this project, built from every
// reimbursement claim linked to it (REQ-03) — rejected/cancelled claims
// never counted as spend, and "Paid" is broken out separately from
// "Committed" (pending/approved but not yet paid) so the two never get
// added together into one misleading number.
function ProjectCostingTab({ projectId }) {
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client.get("/reimbursements/admin", { params: { projectId } })
      .then(({ data }) => setClaims(data))
      .catch((err) => setError(errorMessage(err)));
  }, [projectId]);

  if (!claims) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const counted = claims.filter((c) => !["REJECTED", "CANCELLED"].includes(c.status));
  const paid = counted.filter((c) => c.status === "PAID");
  const committed = counted.filter((c) => c.status !== "PAID");
  const sum = (list) => list.reduce((s, c) => s + c.totalAmount, 0);

  const byType = COST_TYPES.map((type) => {
    const list = counted.filter((c) => (c.type || "GENERAL") === type);
    return { type, count: list.length, total: sum(list) };
  }).filter((row) => row.count > 0);

  return (
    <div>
      <p className="hint-text mt-0">
        Built from every reimbursement claim linked to this project. Rejected and cancelled claims are never
        counted; "Paid" and "Committed" (approved or pending, not yet paid out) are kept separate.
      </p>
      <div className="stat-cards">
        <div className="stat-card"><div className="value">₹{sum(counted).toFixed(2)}</div><div className="label">Total Cost So Far</div></div>
        <div className="stat-card"><div className="value">₹{sum(paid).toFixed(2)}</div><div className="label">Paid</div></div>
        <div className="stat-card"><div className="value">₹{sum(committed).toFixed(2)}</div><div className="label">Committed (not yet paid)</div></div>
      </div>

      <div className="card">
        <h3 className="mt-0">By Claim Type</h3>
        <table>
          <thead><tr><th>Type</th><th>Claims</th><th>Total</th></tr></thead>
          <tbody>
            {byType.map((row) => (
              <tr key={row.type}>
                <td>{COST_TYPE_LABEL[row.type]}</td>
                <td>{row.count}</td>
                <td>₹{row.total.toFixed(2)}</td>
              </tr>
            ))}
            {byType.length === 0 && <tr><td colSpan={3} className="empty-state">No reimbursements linked to this project yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h3 className="mt-0">All Linked Claims</h3>
        <table>
          <thead><tr><th>Employee</th><th>Date</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id}>
                <td>{c.name || c.userId}</td>
                <td>{c.voucherDate}</td>
                <td><StatusBadge status={c.type || "GENERAL"} /></td>
                <td>₹{c.totalAmount.toFixed(2)}</td>
                <td><StatusBadge status={c.status} /></td>
              </tr>
            ))}
            {claims.length === 0 && <tr><td colSpan={5} className="empty-state">No reimbursements linked to this project yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
