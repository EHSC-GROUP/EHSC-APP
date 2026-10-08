import { useEffect, useState } from "react";
import client, { errorMessage } from "../api/client";
import { ErrorText, Loading } from "./Misc";
import StatusBadge from "./StatusBadge";
import Modal from "./Modal";
import DateInput from "./DateInput";
import { fmtDate } from "../lib/dates";
import { useProjectClassification } from "../lib/useProjectClassification";
import { useDropdownLists } from "../lib/useDropdownLists";
import { TeamLeadSelect, TeamMembersPicker } from "./PeopleFields";

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

const INVOICE_STAGES = [1, 2, 3, 4, 5];

function toFormShape(project) {
  return {
    poNumber: project.poNumber || "",
    poValue: project.poValue ?? "",
    deliveryDueDate: project.deliveryDueDate || "",
    termsAndConditions: project.termsAndConditions || "",
    contractValue: project.contractValue ?? "",
    invoiceStage1Percent: project.invoiceStage1Percent ?? "",
    invoiceStage2Percent: project.invoiceStage2Percent ?? "",
    invoiceStage3Percent: project.invoiceStage3Percent ?? "",
    invoiceStage4Percent: project.invoiceStage4Percent ?? "",
    invoiceStage5Percent: project.invoiceStage5Percent ?? "",
    invoiceStage1Name: project.invoiceStage1Name || "",
    invoiceStage2Name: project.invoiceStage2Name || "",
    invoiceStage3Name: project.invoiceStage3Name || "",
    invoiceStage4Name: project.invoiceStage4Name || "",
    invoiceStage5Name: project.invoiceStage5Name || "",
    teamLeadId: project.teamLeadId || "",
    teamLeadName: project.teamLeadName || "",
    teamMembers: project.teamMembers || [],
    status: project.status || "",
    priority: project.priority || "",
    risk: project.risk || "",
    startDate: project.startDate || "",
    paymentStatus: project.paymentStatus || "",
    invoicedAmount: project.invoicedAmount ?? "",
    receivedAmount: project.receivedAmount ?? "",
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
export default function ProjectEditor({ project, company, onChanged, showPhases = true, showPhase2 = showPhases, estimatedValue }) {
  const { categoryLabel, serviceLabel, typeLabel } = useProjectClassification();
  const lists = useDropdownLists();
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
        <PlanActionsSection project={project} actions={project.phase3b?.actions || []} onChanged={onChanged} />
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
                {showPhases && project.projectCategory && <tr><td>Project Category</td><td>{categoryLabel(project.projectCategory)}</td></tr>}
                {showPhases && project.service && <tr><td>Service</td><td>{serviceLabel(project.projectCategory, project.service)}</td></tr>}
                {showPhases && project.projectType && <tr><td>Project Type</td><td>{typeLabel(project.projectType)}{project.projectSubType && ` — ${project.projectSubType}`}</td></tr>}
                {showPhases && project.region && <tr><td>Region</td><td>{project.region}</td></tr>}
                {showPhases && <tr><td>Team Lead</td><td>{project.teamLeadName || "-"}</td></tr>}
                {showPhases && <tr><td>Team Members</td><td>{(project.teamMembers || []).map((m) => m.name).join(", ") || "-"}</td></tr>}
                {showPhases && <tr><td>Project Status</td><td>{project.status || "-"}</td></tr>}
                {showPhases && <tr><td>Priority</td><td>{project.priority || "-"}</td></tr>}
                {showPhases && <tr><td>Risk</td><td>{project.risk || "-"}</td></tr>}
                {showPhases && <tr><td>Project Start Date</td><td>{fmtDate(project.startDate) || "-"}</td></tr>}
                {showPhases && <tr><td>PO Number</td><td>{project.poNumber || "-"}</td></tr>}
                {showPhases && <tr><td>PO Value</td><td>{project.poValue ?? "-"}</td></tr>}
                {showPhases && <tr><td>Target / Delivery Due Date</td><td>{fmtDate(project.deliveryDueDate) || "-"}</td></tr>}
                {showPhases && <tr><td>Terms and Conditions</td><td style={{ whiteSpace: "pre-wrap" }}>{project.termsAndConditions || "-"}</td></tr>}
                {showPhases && <tr><td>Value of Contract</td><td>{project.contractValue ?? "-"}</td></tr>}
                {showPhases && <tr><td>Payment Status</td><td>{project.paymentStatus || "-"}</td></tr>}
                {showPhases && <tr><td>Invoiced (₹)</td><td>{project.invoicedAmount ?? "-"}</td></tr>}
                {showPhases && <tr><td>Received (₹)</td><td>{project.receivedAmount ?? "-"}</td></tr>}
                {showPhases && <tr><td>Outstanding (₹)</td><td>{outstandingOf(project) ?? "-"}</td></tr>}
                {showPhases && project.sourceEnquiryNo && <tr><td>Source Enquiry</td><td>{project.sourceEnquiryNo}</td></tr>}
              </tbody>
            </table>
          )}

          {showPhases && section === "Company Details" && (
            <InvoiceStagesCard project={project} editable onChanged={onChanged} />
          )}

          {showPhase2 && section === "Conversation Stage" && (
            <div>
              <table>
                <tbody>
                  {estimatedValue !== undefined && <tr><td>Estimated Value</td><td>{estimatedValue ?? "-"}</td></tr>}
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
                    <div style={{ flex: 1 }}>{c.description} {c.date && <span className="hint-text">({fmtDate(c.date)})</span>}</div>
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
                    <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>{r.reply} {r.date && <span className="hint-text">({fmtDate(r.date)})</span>}</div>
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
                <>
                  <table>
                    <tbody>
                      <tr><td>Final Proposal After Negotiation</td><td style={{ whiteSpace: "pre-wrap" }}>{project.phase2?.finalProposalAfterNegotiation || "-"}</td></tr>
                      <tr><td>Work Order Date</td><td>{project.phase2?.workOrderDate || "-"}</td></tr>
                      <tr><td>Work Order Number</td><td>{project.phase2?.workOrderNumber || "-"}</td></tr>
                      <tr><td>Terms and Conditions</td><td style={{ whiteSpace: "pre-wrap" }}>{project.termsAndConditions || "-"}</td></tr>
                      <tr><td>Value of Contract</td><td>{project.contractValue ?? "-"}</td></tr>
                    </tbody>
                  </table>
                  <InvoiceStagesCard project={project} editable onChanged={onChanged} />
                </>
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
                    <div><label>Team Lead</label><TeamLeadSelect value={form.teamLeadId} onChange={(id, name) => setForm((f) => ({ ...f, teamLeadId: id, teamLeadName: name }))} /></div>
                    <div><label>Project Status</label><ListSelect value={form.status} options={lists.projectStatus} onChange={(v) => set("status", v)} /></div>
                  </div>
                  <label>Team Members</label>
                  <TeamMembersPicker value={form.teamMembers} onChange={(v) => set("teamMembers", v)} />
                  <div className="form-row">
                    <div><label>Priority</label><ListSelect value={form.priority} options={lists.priority} onChange={(v) => set("priority", v)} /></div>
                    <div><label>Risk</label><ListSelect value={form.risk} options={lists.risk} onChange={(v) => set("risk", v)} /></div>
                    <div><label>Project Start Date</label><DateInput value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
                  </div>
                  <div className="form-row">
                    <div><label>PO Number</label><input value={form.poNumber} onChange={(e) => set("poNumber", e.target.value)} /></div>
                    <div><label>PO Value</label><input type="number" min="0" step="0.01" value={form.poValue} onChange={(e) => set("poValue", e.target.value)} /></div>
                    <div><label>Target / Delivery Due Date</label><DateInput value={form.deliveryDueDate} onChange={(e) => set("deliveryDueDate", e.target.value)} /></div>
                  </div>
                  <label>Terms and Conditions</label>
                  <textarea rows={3} value={form.termsAndConditions} onChange={(e) => set("termsAndConditions", e.target.value)} />

                  <label>Value of Contract</label>
                  <input type="number" min="0" step="0.01" value={form.contractValue} onChange={(e) => set("contractValue", e.target.value)} />
                  <p className="hint-text mt-0">Set once the enquiry is confirmed (contract accepted / PO received) — each stage below is a percentage of this value.</p>
                  <InvoiceStageInputs form={form} set={set} />
                  <div className="form-row">
                    <div><label>Payment Status</label><ListSelect value={form.paymentStatus} options={lists.paymentStatus} onChange={(v) => set("paymentStatus", v)} /></div>
                    <div><label>Invoiced (₹)</label><input type="number" min="0" step="0.01" value={form.invoicedAmount} onChange={(e) => set("invoicedAmount", e.target.value)} /></div>
                    <div><label>Received (₹)</label><input type="number" min="0" step="0.01" value={form.receivedAmount} onChange={(e) => set("receivedAmount", e.target.value)} /></div>
                  </div>
                  <p className="hint-text mt-0">Outstanding is worked out automatically: invoiced minus received.</p>
                </>
              )}
            </div>
          )}

          {showPhase2 && section === "Conversation Stage" && (
            <div>
              <div className="form-row">
                <div><label>Proposal No.</label><input value={form.phase2.proposalNo} onChange={(e) => setPhase2("proposalNo", e.target.value)} /></div>
                <div><label>Proposal Date</label><DateInput value={form.phase2.proposalDate} onChange={(e) => setPhase2("proposalDate", e.target.value)} /></div>
                <div><label>Mode of Submission</label><input value={form.phase2.modeOfSubmission} onChange={(e) => setPhase2("modeOfSubmission", e.target.value)} placeholder="e.g. Email, In-person" /></div>
              </div>
              <div className="form-row">
                <div><label>Whom It Has Been Submitted</label><input value={form.phase2.submittedTo} onChange={(e) => setPhase2("submittedTo", e.target.value)} /></div>
                <div><label>Who Has Submitted</label><input value={form.phase2.submittedBy} onChange={(e) => setPhase2("submittedBy", e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div><label>Next Follow-up Due On</label><DateInput value={form.phase2.nextFollowUpDueOn} onChange={(e) => setPhase2("nextFollowUpDueOn", e.target.value)} /></div>
                <div><label>Next Follow-up Date</label><DateInput value={form.phase2.nextFollowUpDate} onChange={(e) => setPhase2("nextFollowUpDate", e.target.value)} /></div>
              </div>

              <div className="card">
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <strong>Conversation Log</strong>
                  <div className="spacer" />
                </div>
                {conversations.map((c, i) => (
                  <div key={c.id} className="toolbar" style={{ alignItems: "flex-start" }}>
                    <strong style={{ width: 40 }}>{ORDINALS[i] || `${i + 1}th`}</strong>
                    <div style={{ flex: 1 }}>{c.description} {c.date && <span className="hint-text">({fmtDate(c.date)})</span>}</div>
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
                    <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>{r.reply} {r.date && <span className="hint-text">({fmtDate(r.date)})</span>}</div>
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
                    <div><label>Work Order Date</label><DateInput value={form.phase2.workOrderDate} onChange={(e) => setPhase2("workOrderDate", e.target.value)} /></div>
                    <div><label>Work Order Number</label><input value={form.phase2.workOrderNumber} onChange={(e) => setPhase2("workOrderNumber", e.target.value)} /></div>
                  </div>
                  <label>Terms and Conditions</label>
                  <textarea rows={3} value={form.termsAndConditions} onChange={(e) => set("termsAndConditions", e.target.value)} />
                  <label>Value of Contract</label>
                  <input type="number" min="0" step="0.01" value={form.contractValue} onChange={(e) => set("contractValue", e.target.value)} />
                  <p className="hint-text mt-0">Each stage below is a percentage of this value.</p>
                  <InvoiceStageInputs form={form} set={set} />
                </>
              )}
            </div>
          )}

          {showPhases && section === "Implementation Phase" && (
            <div>
              <div className="form-row">
                <div><label>Work Order Date</label><DateInput value={form.phase3.workOrderDate} onChange={(e) => setPhase3("workOrderDate", e.target.value)} /></div>
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
                <div><label>Date</label><DateInput value={form.phase4.deliveryReportDate} onChange={(e) => setPhase4("deliveryReportDate", e.target.value)} /></div>
              </div>
              <label>Notes</label>
              <textarea rows={2} value={form.phase4.deliveryReportNotes} onChange={(e) => setPhase4("deliveryReportNotes", e.target.value)} />

              <h3>Invoice</h3>
              <div className="form-row">
                <div><label>Invoice Number</label><input value={form.phase4.invoiceNumber} onChange={(e) => setPhase4("invoiceNumber", e.target.value)} /></div>
                <div><label>Invoice Date</label><DateInput value={form.phase4.invoiceDate} onChange={(e) => setPhase4("invoiceDate", e.target.value)} /></div>
                <div><label>Invoice Amount</label><input type="number" min="0" step="0.01" value={form.phase4.invoiceAmount} onChange={(e) => setPhase4("invoiceAmount", e.target.value)} /></div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={form.phase4.paymentReceived} onChange={(e) => setPhase4("paymentReceived", e.target.checked)} />
                Payment received
              </label>
              <div className="form-row">
                <div><label>Payment Received Date</label><DateInput value={form.phase4.paymentReceivedDate} onChange={(e) => setPhase4("paymentReceivedDate", e.target.value)} /></div>
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
      <div style={{ flex: "0 0 150px" }}><DateInput value={date} onChange={(e) => setDate(e.target.value)} /></div>
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
      <div style={{ flex: "0 0 150px" }}><DateInput value={date} onChange={(e) => setDate(e.target.value)} /></div>
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

// The 4 invoice-stage percentages (set from the Company Details edit form)
// each get their own "mark complete" action here — a separate, always-live
// control rather than something bundled into the whole-project Edit/Save
// cycle, since marking a stage complete is a real business event (it fires
// a notification to every admin to raise that stage's invoice) and needs to
// stay a deliberate click, not a side effect of an unrelated field save.
// `editable` gates whether the checkboxes are interactive — read-only when
// shown as a mirror inside the BD enquiry's Conversation Stage tab, live
// when shown from the full project view (Company Profiles/Project Tracker).
function InvoiceStagesCard({ project, editable, onChanged }) {
  const [error, setError] = useState("");
  const [busyStage, setBusyStage] = useState(null);

  const rows = INVOICE_STAGES.map((n) => ({
    n,
    percent: project[`invoiceStage${n}Percent`],
    completed: !!project[`invoiceStage${n}Completed`],
    completedAt: project[`invoiceStage${n}CompletedAt`],
  }));
  const anySet = rows.some((r) => r.percent !== null && r.percent !== undefined);
  const total = rows.reduce((sum, r) => sum + (Number(r.percent) || 0), 0);

  async function toggle(n, completed) {
    setError("");
    setBusyStage(n);
    try {
      await client.put(`/projects/${project.id}/invoice-stages/${n}`, { completed });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyStage(null);
    }
  }

  return (
    <div className="card">
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <strong>Invoice Stages</strong>
        <div className="spacer" />
      </div>
      {!anySet && <p className="hint-text mt-0">No stage percentages set yet — click Edit above to add up to 5 stages, each with a name and a %.</p>}
      {rows.map((r) => {
        const isSet = r.percent !== null && r.percent !== undefined;
        const amount = isSet && project.contractValue != null ? Math.round((Number(project.contractValue) * Number(r.percent) / 100) * 100) / 100 : null;
        return (
          <div key={r.n} className="toolbar" style={{ marginBottom: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={r.completed}
                disabled={!editable || !isSet || busyStage === r.n}
                onChange={(e) => toggle(r.n, e.target.checked)}
              />
              <span>Stage {r.n}{project[`invoiceStage${r.n}Name`] ? ` · ${project[`invoiceStage${r.n}Name`]}` : ""} — {isSet ? `${r.percent}%${amount !== null ? ` (₹${amount})` : ""}` : "not set"}</span>
            </label>
            {r.completed && r.completedAt && <span className="hint-text">Completed {fmtDate(r.completedAt)}</span>}
          </div>
        );
      })}
      {anySet && <p className="hint-text" style={{ marginTop: 6 }}>Total {Math.round(total * 100) / 100}%{Math.abs(total - 100) > 0.01 ? " — the stages should add up to 100%." : ""}</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

// Stage name (the billing trigger, e.g. "After Internal Audit Completion") and
// its % of the contract, for up to five stages. Leave a stage blank to skip it.
function InvoiceStageInputs({ form, set }) {
  const total = INVOICE_STAGES.reduce((sum, n) => sum + (Number(form[`invoiceStage${n}Percent`]) || 0), 0);
  return (
    <div>
      {INVOICE_STAGES.map((n) => (
        <div key={n} className="form-row" style={{ alignItems: "flex-end", marginTop: 6 }}>
          <div style={{ flex: "1 1 260px" }}>
            <label className="hint-text mt-0">Stage {n} name</label>
            <input value={form[`invoiceStage${n}Name`]} onChange={(e) => set(`invoiceStage${n}Name`, e.target.value)} placeholder={n === 1 ? "e.g. Advance" : "e.g. After Internal Audit Completion"} />
          </div>
          <div style={{ flex: "0 0 110px" }}>
            <label className="hint-text mt-0">Stage {n} %</label>
            <input type="number" min="0" max="100" step="0.01" value={form[`invoiceStage${n}Percent`]} onChange={(e) => set(`invoiceStage${n}Percent`, e.target.value)} />
          </div>
        </div>
      ))}
      <p className="hint-text" style={{ marginTop: 6 }}>Total {Math.round(total * 100) / 100}%{total > 100.0001 ? " — more than 100%, it can't be saved." : total > 0 && Math.abs(total - 100) > 0.01 ? " — the stages should add up to 100%." : ""}</p>
    </div>
  );
}

function ListSelect({ value, options, onChange }) {
  // A value that was removed from the list later is still shown, so editing never silently drops it.
  const withCurrent = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select…</option>
      {withCurrent.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// Status, priority, risk, progress and timing for one plan action.
function ActionFacts({ action }) {
  const today = todayISO();
  const closed = action.completed || action.status === "Completed" || action.status === "Cancelled";
  let timing = null;
  if (action.dueDate && !closed) {
    const diff = Math.round((new Date(action.dueDate).getTime() - new Date(today).getTime()) / 86400000);
    timing = diff < 0
      ? <span className="overdue">Delayed {-diff} day{-diff === 1 ? "" : "s"}</span>
      : <span>{diff} day{diff === 1 ? "" : "s"} left</span>;
  }
  const status = action.status || (action.completed ? "Completed" : null);
  return (
    <div>
      <p className="hint-text mt-0" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {status && <span className="badge-pill badge-PENDING">{status}</span>}
        {action.priority && <span>Priority: <strong>{action.priority}</strong></span>}
        {action.risk && <span>Risk: <strong>{action.risk}</strong></span>}
        {action.percentComplete != null && <span>{action.percentComplete}% complete</span>}
        {timing}
        {action.escalationRequired && <span className="overdue">⚠ Escalation required</span>}
      </p>
      {action.deliverable && <p className="hint-text mt-0">Deliverable: {action.deliverable}</p>}
      {action.remarks && <p className="hint-text mt-0" style={{ whiteSpace: "pre-wrap" }}>Remarks: {action.remarks}</p>}
    </div>
  );
}

function outstandingOf(project) {
  if (project.invoicedAmount == null && project.receivedAmount == null) return null;
  return Math.round(((Number(project.invoicedAmount) || 0) - (Number(project.receivedAmount) || 0)) * 100) / 100;
}

// Phase III(b) — Project Plan: a numbered action list, independent of the
// rest of the project's Edit/Save toggle (same pattern as the Business
// Development action log — each add/toggle/delete saves immediately).
function PlanActionsSection({ project, actions, onChanged }) {
  const projectId = project.id;
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [showStages, setShowStages] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [dateForm, setDateForm] = useState({ startDate: "", dueDate: "" });
  const [savingDates, setSavingDates] = useState(false);
  const lists = useDropdownLists();
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
    setDateForm({
      startDate: action.startDate || "",
      dueDate: action.dueDate || "",
      status: action.status || (action.completed ? "Completed" : ""),
      priority: action.priority || "",
      risk: action.risk || "",
      percentComplete: action.percentComplete ?? (action.completed ? 100 : 0),
      deliverable: action.deliverable || "",
      escalationRequired: !!action.escalationRequired,
      remarks: action.remarks || "",
    });
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
        status: dateForm.status || undefined,
        priority: dateForm.priority || undefined,
        risk: dateForm.risk || undefined,
        percentComplete: dateForm.percentComplete,
        deliverable: dateForm.deliverable,
        escalationRequired: !!dateForm.escalationRequired,
        remarks: dateForm.remarks,
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
        <button className="btn-sm" onClick={() => setShowImport(true)}>Import Template</button>
        <button className="btn-sm" onClick={() => setShowStages(true)}>Invoice Stages</button>
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
                {a.stage && <span className="badge-pill badge-PENDING" title="Counts toward this invoice stage">Stage {a.stage}</span>}
              </label>
              <div className="spacer" />
              {editingId !== a.id && (
                <button className="btn-sm" onClick={() => startEditDates(a)}>Edit</button>
              )}
              <button className="btn-sm btn-danger" onClick={() => remove(a.id)}>Delete</button>
            </div>
            {editingId === a.id ? (
              <div style={{ marginBottom: 4 }}>
                <div className="form-row" style={{ alignItems: "flex-end" }}>
                  <div>
                    <label>Start Date</label>
                    <DateInput value={dateForm.startDate} onChange={(e) => setDateForm((f) => ({ ...f, startDate: e.target.value }))} />
                  </div>
                  <div>
                    <label>Due Date</label>
                    <DateInput value={dateForm.dueDate} onChange={(e) => setDateForm((f) => ({ ...f, dueDate: e.target.value }))} />
                  </div>
                  <div>
                    <label>Status</label>
                    <ListSelect value={dateForm.status} options={lists.projectStatus} onChange={(v) => setDateForm((f) => ({ ...f, status: v }))} />
                  </div>
                </div>
                <div className="form-row" style={{ alignItems: "flex-end" }}>
                  <div>
                    <label>Priority</label>
                    <ListSelect value={dateForm.priority} options={lists.priority} onChange={(v) => setDateForm((f) => ({ ...f, priority: v }))} />
                  </div>
                  <div>
                    <label>Risk</label>
                    <ListSelect value={dateForm.risk} options={lists.risk} onChange={(v) => setDateForm((f) => ({ ...f, risk: v }))} />
                  </div>
                  <div style={{ flex: "0 0 110px" }}>
                    <label>% Complete</label>
                    <input type="number" min="0" max="100" step="1" value={dateForm.percentComplete} onChange={(e) => setDateForm((f) => ({ ...f, percentComplete: e.target.value }))} />
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, paddingBottom: 8 }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={!!dateForm.escalationRequired} onChange={(e) => setDateForm((f) => ({ ...f, escalationRequired: e.target.checked }))} />
                    Escalation required
                  </label>
                </div>
                <label>Deliverable</label>
                <input value={dateForm.deliverable} onChange={(e) => setDateForm((f) => ({ ...f, deliverable: e.target.value }))} />
                <label>Remarks</label>
                <textarea rows={2} value={dateForm.remarks} onChange={(e) => setDateForm((f) => ({ ...f, remarks: e.target.value }))} />
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <button className="btn-sm btn-primary" onClick={() => saveDates(a.id)} disabled={savingDates}>{savingDates ? "Saving…" : "Save"}</button>
                  <button className="btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <p className="hint-text mt-0">
                Assigned to: {a.assignedToName || a.assignedTo} · Due: <span className={overdue ? "overdue" : ""}>{fmtDate(a.dueDate)}{overdue ? " (overdue)" : ""}</span>
                {a.startDate && <> · Started: {fmtDate(a.startDate)}</>}
                {a.completed && a.completedAt && <> · Completed: {fmtDate(a.completedAt)}</>}
              </p>
            )}
            {editingId !== a.id && <ActionFacts action={a} />}
            {predecessors.length > 0 && (
              <p className="hint-text mt-0">Depends on: {predecessors.map((p) => p.description).join(", ")}</p>
            )}
            {conflicting.length > 0 && (
              <p className="hint-text mt-0 overdue">
                ⚠ Starts before {conflicting.map((p) => `"${p.description}" (due ${fmtDate(p.dueDate)})`).join(", ")} finishes
              </p>
            )}
          </div>
        );
      })}

      {actions.length > 0 && (
        <div className="toolbar" style={{ marginTop: 16 }}>
          <div className="spacer" />
          <button type="button" className="btn-sm" onClick={() => setShowSaveTemplate(true)}>Save as Template</button>
        </div>
      )}

      {showAdd && (
        <AddPlanActionModal projectId={projectId} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); onChanged(); }} />
      )}
      {showWorkflow && (
        <WorkflowModal projectId={projectId} actions={actions} onClose={() => setShowWorkflow(false)} onSaved={() => { setShowWorkflow(false); onChanged(); }} />
      )}
      {showStages && (
        <InvoiceStageActionsModal project={project} actions={actions} onClose={() => setShowStages(false)} onSaved={() => { setShowStages(false); onChanged(); }} />
      )}
      {showImport && (
        <ImportTemplateModal project={project} onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); onChanged(); }} />
      )}
      {showSaveTemplate && (
        <SaveAsTemplateModal project={project} actions={actions} onClose={() => setShowSaveTemplate(false)} />
      )}
    </div>
  );
}

// Lets an admin pick, per stage, which of this plan's actions count toward
// it — naturally capped at however many actions actually exist, since it's
// a checklist, not a free-typed number. An action belongs to at most one
// stage (matches the single `stage` field each action carries), so
// checking it under one stage clears it from any other. Saved as a plain
// `stage` tag on each changed action — the same tag AddPlanActionModal
// sets one at a time; this just edits all of them from one place.
function InvoiceStageActionsModal({ project, actions, onClose, onSaved }) {
  const [activeStage, setActiveStage] = useState(1);
  const [selections, setSelections] = useState(() => {
    const out = {};
    for (const n of INVOICE_STAGES) out[n] = new Set(actions.filter((a) => a.stage === n).map((a) => a.id));
    return out;
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(actionId) {
    setSelections((cur) => {
      const next = {};
      for (const n of INVOICE_STAGES) next[n] = new Set(cur[n]);
      if (next[activeStage].has(actionId)) {
        next[activeStage].delete(actionId);
      } else {
        for (const n of INVOICE_STAGES) next[n].delete(actionId);
        next[activeStage].add(actionId);
      }
      return next;
    });
  }

  async function save() {
    setError("");
    setBusy(true);
    try {
      for (const a of actions) {
        let newStage = null;
        for (const n of INVOICE_STAGES) {
          if (selections[n].has(a.id)) { newStage = n; break; }
        }
        if (newStage !== (a.stage || null)) {
          await client.put(`/projects/${project.id}/plan-actions/${a.id}`, { stage: newStage });
        }
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const activeCompleted = !!project[`invoiceStage${activeStage}Completed`];

  return (
    <Modal title="Invoice Stages" onClose={onClose} wide>
      <p className="hint-text mt-0">
        Pick which actions in this Project Plan count toward each stage. Once every action ticked for a stage is
        checked off in the plan, that stage auto-completes and every admin is notified to raise that stage's
        invoice — no need to mark it manually.
      </p>
      <div className="drawer-tabs" style={{ marginBottom: 12, borderBottom: "none" }}>
        {INVOICE_STAGES.map((n) => (
          <button key={n} type="button" className={activeStage === n ? "active" : ""} onClick={() => setActiveStage(n)}>
            Stage {n}{project[`invoiceStage${n}Percent`] != null ? ` (${project[`invoiceStage${n}Percent`]}%)` : ""}
            {selections[n].size > 0 && <span className="badge-pill badge-PENDING" style={{ marginLeft: 6 }}>{selections[n].size}</span>}
          </button>
        ))}
      </div>
      {activeCompleted && <p className="hint-text mt-0"><span className="badge-pill badge-APPROVED">Stage {activeStage} already complete</span></p>}
      {actions.length === 0 && <div className="empty-state">No actions in this Project Plan yet.</div>}
      {actions.map((a) => (
        <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={selections[activeStage].has(a.id)}
            disabled={activeCompleted}
            onChange={() => toggle(a.id)}
          />
          <span style={{ textDecoration: a.completed ? "line-through" : "none" }}>{a.description}</span>
          {a.stage && a.stage !== activeStage && <span className="hint-text">(currently Stage {a.stage})</span>}
        </label>
      ))}
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" style={{ marginTop: 12 }} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </Modal>
  );
}

function daysBetween(fromISO, toISO) {
  const ms = new Date(toISO).getTime() - new Date(fromISO).getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

// Pulls a project type's template (as edited in Settings) into this project's
// Project Plan. Every row stays editable before importing - days after the
// start date and the resulting due date move together - and the (possibly
// adjusted) rows can also be written back to the template from here.
function ImportTemplateModal({ project, onClose, onImported }) {
  const { catalog } = useProjectClassification();
  const typeOptions = catalog?.allTypes || [];
  const [type, setType] = useState(project.projectType || "GHG");
  const [templates, setTemplates] = useState(null);
  const [startDate, setStartDate] = useState(todayISO());
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    client.get("/settings/project-plan-templates").then((r) => setTemplates(r.data)).catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    if (!templates) return;
    setTasks((templates[type] || []).map((t) => ({
      description: t.description,
      dayOffset: Number(t.dayOffset) || 0,
      stage: t.stage || "",
      dueDate: addDaysISO(startDate, t.dayOffset),
    })));
    setSavedMsg("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, type]);

  function changeStart(value) {
    setStartDate(value);
    if (value) setTasks((list) => list.map((t) => ({ ...t, dueDate: addDaysISO(value, t.dayOffset) })));
  }
  function updateTask(i, field, value) {
    setTasks((list) => list.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)));
  }
  function changeDays(i, days) {
    const n = Math.max(0, Number(days) || 0);
    setTasks((list) => list.map((t, idx) => (idx === i ? { ...t, dayOffset: n, dueDate: addDaysISO(startDate, n) } : t)));
  }
  function changeDue(i, due) {
    setTasks((list) => list.map((t, idx) => (idx === i ? { ...t, dueDate: due, dayOffset: due ? daysBetween(startDate, due) : t.dayOffset } : t)));
  }
  function removeTask(i) { setTasks((list) => list.filter((_, idx) => idx !== i)); }
  function addTask() {
    setTasks((list) => [...list, { description: "", dayOffset: 0, stage: "", dueDate: startDate }]);
  }

  async function doImport() {
    if (!startDate) return setError("Pick a start date.");
    if (tasks.length === 0) return setError("Nothing to import.");
    if (tasks.some((t) => !t.description.trim() || !t.dueDate)) return setError("Every action needs a description and a due date.");
    setError("");
    setBusy(true);
    try {
      await client.post(`/projects/${project.id}/plan-actions/import`, {
        tasks: tasks.map((t) => ({ description: t.description.trim(), startDate, dueDate: t.dueDate, stage: t.stage === "" ? null : Number(t.stage) })),
      });
      onImported();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (tasks.some((t) => !t.description.trim())) return setError("Every action needs a description.");
    setError("");
    setSavedMsg("");
    setBusy(true);
    try {
      const payload = tasks.map((t) => ({ description: t.description.trim(), dayOffset: Number(t.dayOffset) || 0, stage: t.stage === "" ? null : Number(t.stage) }));
      const res = await client.put("/settings/project-plan-templates", { [type]: payload });
      setTemplates(res.data);
      setSavedMsg(`Template for "${type}" updated.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import Project Plan Template" onClose={onClose} wide>
      <p className="hint-text mt-0">
        Adds these actions to the end of this Project Plan. Change the days or the due date of any action (they
        stay in sync), edit or remove rows, then import. "Save to Template" writes your changes back to the
        template for future projects.
      </p>
      <div className="form-row" style={{ alignItems: "flex-end" }}>
        <div>
          <label>Template (Project Type)</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label>Start Date</label>
          <DateInput value={startDate} onChange={(e) => changeStart(e.target.value)} />
        </div>
      </div>

      {!templates && !error && <p className="hint-text">Loading template...</p>}
      {tasks.map((t, i) => (
        <div key={i} className="form-row" style={{ marginTop: 8, alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 240px" }}>
            <label className="hint-text mt-0">Action</label>
            <input value={t.description} onChange={(e) => updateTask(i, "description", e.target.value)} />
          </div>
          <div style={{ flex: "0 0 90px" }}>
            <label className="hint-text mt-0">Days</label>
            <input type="number" min="0" step="1" value={t.dayOffset} onChange={(e) => changeDays(i, e.target.value)} />
          </div>
          <div style={{ flex: "0 0 150px" }}>
            <label className="hint-text mt-0">Due Date</label>
            <DateInput value={t.dueDate} onChange={(e) => changeDue(i, e.target.value)} />
          </div>
          <div style={{ flex: "0 0 100px" }}>
            <label className="hint-text mt-0">Stage</label>
            <select value={t.stage} onChange={(e) => updateTask(i, "stage", e.target.value ? Number(e.target.value) : "")}>
              <option value="">None</option>
              {INVOICE_STAGES.map((n) => <option key={n} value={n}>Stage {n}</option>)}
            </select>
          </div>
          <button type="button" className="btn-sm btn-danger" onClick={() => removeTask(i)}>Remove</button>
        </div>
      ))}
      {templates && <button type="button" className="btn-sm" style={{ marginTop: 10 }} onClick={addTask}>+ Add Row</button>}

      <ErrorText>{error}</ErrorText>
      {savedMsg && <p className="hint-text">{savedMsg}</p>}
      <div className="toolbar" style={{ marginTop: 16 }}>
        <button className="btn-primary" onClick={doImport} disabled={busy || !templates}>{busy ? "Working..." : "Import to Plan"}</button>
        <button type="button" onClick={saveTemplate} disabled={busy || !templates}>Save to Template</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// Turns this project's own (real, already-dated) Project Plan into a
// reusable template for future projects of the same type — day offsets are
// computed relative to the earliest date among these actions, and every
// row stays editable here before saving, same as editing a template
// directly in Settings.
function SaveAsTemplateModal({ project, actions, onClose }) {
  const { catalog } = useProjectClassification();
  const typeOptions = catalog?.allTypes || [];
  const [type, setType] = useState(project.projectType || "GHG");
  const [tasks, setTasks] = useState(() => {
    const baseline = actions.reduce((min, a) => {
      const d = a.startDate || a.dueDate;
      return !min || d < min ? d : min;
    }, null);
    return actions
      .slice()
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
      .map((a) => ({ description: a.description, dayOffset: baseline ? daysBetween(baseline, a.dueDate) : 0, stage: a.stage || "" }));
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  function updateTask(i, field, value) {
    setTasks((list) => list.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)));
  }
  function removeTask(i) { setTasks((list) => list.filter((_, idx) => idx !== i)); }

  async function save() {
    setError("");
    setSavedMsg("");
    setBusy(true);
    try {
      const payload = tasks.map((t) => ({ description: t.description, dayOffset: Number(t.dayOffset) || 0, stage: t.stage === "" ? null : Number(t.stage) }));
      await client.put("/settings/project-plan-templates", { [type]: payload });
      setSavedMsg(`Saved — future "${type}" projects will start from this plan once their contract is confirmed.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Save as Template" onClose={onClose} wide>
      <p className="hint-text mt-0">
        Saves this Project Plan as the starter template for every future project of the type you pick below — due
        dates are converted to days-after-confirmed, relative to this plan's earliest date. Review and adjust the
        description, days, or stage of any task before saving; this replaces that type's current template.
      </p>
      <label>Project Type</label>
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>

      {tasks.map((t, i) => (
        <div key={i} className="form-row" style={{ marginTop: 8, alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 280px" }}>
            <label className="hint-text mt-0">Task Description</label>
            <input value={t.description} onChange={(e) => updateTask(i, "description", e.target.value)} />
          </div>
          <div style={{ flex: "0 0 130px" }}>
            <label className="hint-text mt-0">Days After Confirmed</label>
            <input type="number" min="0" step="1" value={t.dayOffset} onChange={(e) => updateTask(i, "dayOffset", Number(e.target.value))} />
          </div>
          <div style={{ flex: "0 0 110px" }}>
            <label className="hint-text mt-0">Invoice Stage</label>
            <select value={t.stage} onChange={(e) => updateTask(i, "stage", e.target.value ? Number(e.target.value) : "")}>
              <option value="">None</option>
              {INVOICE_STAGES.map((n) => <option key={n} value={n}>Stage {n}</option>)}
            </select>
          </div>
          <button type="button" className="btn-sm btn-danger" onClick={() => removeTask(i)}>Remove</button>
        </div>
      ))}

      <ErrorText>{error}</ErrorText>
      {savedMsg && <p className="hint-text">{savedMsg}</p>}
      <div className="toolbar" style={{ marginTop: 16 }}>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save Template"}</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </Modal>
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
  const lists = useDropdownLists();
  const [form, setForm] = useState({ description: "", assignedTo: "", startDate: todayISO(), dueDate: "", stage: "", priority: "", risk: "", deliverable: "" });
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
            <div><label>Action Start Date</label><DateInput value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
            <div><label>Due Date</label><DateInput value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} required /></div>
            <div>
              <label>Invoice Stage (optional)</label>
              <select value={form.stage} onChange={(e) => set("stage", e.target.value)}>
                <option value="">None</option>
                {INVOICE_STAGES.map((n) => <option key={n} value={n}>Stage {n}</option>)}
              </select>
            </div>
          </div>
          <p className="hint-text mt-0">Tag this task to an invoice stage and, once every task tagged with that stage is checked off, it auto-completes — no need to mark it manually.</p>
          <div className="form-row">
            <div><label>Priority</label><ListSelect value={form.priority} options={lists.priority} onChange={(v) => set("priority", v)} /></div>
            <div><label>Risk</label><ListSelect value={form.risk} options={lists.risk} onChange={(v) => set("risk", v)} /></div>
          </div>
          <label>Deliverable</label>
          <input value={form.deliverable} onChange={(e) => set("deliverable", e.target.value)} placeholder="e.g. Gap assessment report" />
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
                <td>{fmtDate(c.voucherDate)}</td>
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
