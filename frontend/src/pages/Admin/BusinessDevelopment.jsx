import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import Drawer from "../../components/Drawer";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";
import ProjectEditor from "../../components/ProjectEditor";

const APPROACH_MODES = ["EMAIL", "PHONE", "ON_SITE"];
const MARKETING_SOURCES = ["Email Campaign", "Referral", "Website", "Exhibition"];
const RESULTS = ["IN_PROGRESS", "PURCHASE_ORDER_RECEIVED", "CONTRACT_ACCEPTED", "ENQUIRY_ON_HOLD", "ENQUIRY_DROPPED"];
const RESULT_LABELS = {
  IN_PROGRESS: "In Progress",
  PURCHASE_ORDER_RECEIVED: "Purchase Order Received",
  CONTRACT_ACCEPTED: "Contract Accepted",
  ENQUIRY_ON_HOLD: "Enquiry On Hold",
  ENQUIRY_DROPPED: "Enquiry Dropped",
};
const MODE_LABELS = { EMAIL: "Email", PHONE: "Phone", ON_SITE: "On-site Enquiry" };

const todayISO = () => new Date().toISOString().slice(0, 10);

function nextAction(enquiry) {
  const open = (enquiry.actions || []).filter((a) => !a.completed);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
}

export default function BusinessDevelopment() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(null);

  async function load() {
    setError("");
    try {
      const params = {};
      if (resultFilter) params.result = resultFilter;
      const { data } = await client.get("/business-development", { params });
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [resultFilter]);

  const filtered = (list || []).filter((e) => {
    const q = search.toLowerCase();
    return !q || [e.enquiryNo, e.clientName, e.approachedByName, e.marketingSource].some((v) => (v || "").toLowerCase().includes(q));
  });

  const stats = (list || []).reduce(
    (acc, e) => {
      acc.total++;
      if (e.result === "IN_PROGRESS") acc.inProgress++;
      else if (["PURCHASE_ORDER_RECEIVED", "CONTRACT_ACCEPTED"].includes(e.result)) acc.won++;
      else if (e.result === "ENQUIRY_ON_HOLD") acc.onHold++;
      else if (e.result === "ENQUIRY_DROPPED") acc.dropped++;
      return acc;
    },
    { total: 0, inProgress: 0, won: 0, onHold: 0, dropped: 0 }
  );

  return (
    <div>
      <div className="page-header">
        <h2>Business Development</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Enquiry</button>
      </div>

      <div className="stat-cards">
        <div className="stat-card"><div className="value">{stats.total}</div><div className="label">Total Enquiries</div></div>
        <div className="stat-card"><div className="value">{stats.inProgress}</div><div className="label">In Progress</div></div>
        <div className="stat-card"><div className="value">{stats.won}</div><div className="label">Won (PO / Contract)</div></div>
        <div className="stat-card"><div className="value">{stats.onHold}</div><div className="label">On Hold</div></div>
        <div className="stat-card"><div className="value">{stats.dropped}</div><div className="label">Dropped</div></div>
      </div>

      <div className="toolbar">
        <input style={{ maxWidth: 280 }} placeholder="Search enquiry no, client, contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ width: 200 }} value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
          <option value="">All results</option>
          {RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABELS[r]}</option>)}
        </select>
      </div>

      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Enquiry No</th><th>Client</th><th>Approached By</th><th>Date</th><th>Mode</th>
                <th>Next Action</th><th>Result</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const na = nextAction(e);
                const overdue = na && na.dueDate < todayISO();
                return (
                  <tr key={e.id} style={{ cursor: "pointer" }} onClick={() => setSelected(e.id)}>
                    <td>{e.enquiryNo}</td>
                    <td>{e.clientName}</td>
                    <td>{e.approachedByName}</td>
                    <td>{e.approachDate}</td>
                    <td>{MODE_LABELS[e.approachMode] || e.approachMode}</td>
                    <td className={overdue ? "overdue" : ""}>
                      {na ? `${na.description} (due ${na.dueDate}${overdue ? " — overdue" : ""})` : "—"}
                    </td>
                    <td><StatusBadge status={e.result} /></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={7} className="empty-state">No enquiries logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateEnquiryModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
      )}
      {selected && (
        <EnquiryDrawer id={selected} onClose={() => setSelected(null)} onChanged={load} />
      )}
    </div>
  );
}

function CreateEnquiryModal({ onClose, onCreated }) {
  const [companyMode, setCompanyMode] = useState("new"); // "new" | "existing"
  const [branchMode, setBranchMode] = useState("existing"); // "existing" | "new" — only used when companyMode === "existing"
  const [companies, setCompanies] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({
    companyId: "", branchId: "", clientName: "", address: "",
    marketingSource: "", referralType: "", referredByEmployeeId: "", referredByExternalName: "", referredByExternalPhone: "",
    approachedByName: "", approachDate: todayISO(), approachMode: "EMAIL",
    contactPhone: "", contactEmail: "", topic: "", outcomeOfDiscussion: "", estimatedValue: "", remarks: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedCompany = companies.find((c) => c.id === form.companyId);
  const branches = selectedCompany?.branches || [];

  useEffect(() => {
    client.get("/company-profiles").then((r) => setCompanies(r.data)).catch(() => {});
    client.get("/profiles").then((r) => setEmployees(r.data.filter((p) => !p.disabled))).catch(() => {});
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (companyMode === "existing") {
      if (!form.companyId) return setError("Select an existing company");
      if (branchMode === "existing" && !form.branchId) return setError("Select a branch");
      if (branchMode === "new" && !form.address) return setError("Address is required for a new branch");
    }
    if (companyMode === "new" && !form.clientName) return setError("Client / Company Name is required");
    setBusy(true);
    try {
      const payload = { ...form };
      if (companyMode === "existing") {
        delete payload.clientName;
        if (branchMode === "existing") {
          delete payload.address;
        } else {
          delete payload.branchId;
        }
      } else {
        delete payload.companyId;
        delete payload.branchId;
      }
      if (payload.marketingSource !== "Referral") {
        delete payload.referralType;
        delete payload.referredByEmployeeId;
        delete payload.referredByExternalName;
        delete payload.referredByExternalPhone;
      } else if (payload.referralType === "EMPLOYEE") {
        delete payload.referredByExternalName;
        delete payload.referredByExternalPhone;
      } else if (payload.referralType === "EXTERNAL") {
        delete payload.referredByEmployeeId;
      }
      const employee = employees.find((emp) => emp.userId === form.referredByEmployeeId);
      if (employee) payload.referredByEmployeeName = employee.name;
      await client.post("/business-development", payload);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const emailRequired = form.approachMode === "EMAIL";
  const phoneRequired = form.approachMode === "PHONE";

  return (
    <Modal title="New Enquiry" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="drawer-tabs" style={{ marginBottom: 12, borderBottom: "none" }}>
          <button type="button" className={companyMode === "new" ? "active" : ""} onClick={() => setCompanyMode("new")}>New Company</button>
          <button type="button" className={companyMode === "existing" ? "active" : ""} onClick={() => setCompanyMode("existing")}>Existing Company</button>
        </div>

        {companyMode === "existing" ? (
          <div>
            <label>Company</label>
            <select value={form.companyId} onChange={(e) => { set("companyId", e.target.value); set("branchId", ""); setBranchMode("existing"); }} required>
              <option value="">Select a company…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>#{c.parentNumber} — {c.clientName}</option>)}
            </select>

            {form.companyId && (
              <>
                <div className="drawer-tabs" style={{ marginBottom: 8, marginTop: 8, borderBottom: "none" }}>
                  <button type="button" className={branchMode === "existing" ? "active" : ""} onClick={() => setBranchMode("existing")}>Existing Branch</button>
                  <button type="button" className={branchMode === "new" ? "active" : ""} onClick={() => setBranchMode("new")}>New Branch</button>
                </div>
                {branchMode === "existing" ? (
                  <select value={form.branchId} onChange={(e) => set("branchId", e.target.value)} required>
                    <option value="">Select a branch…</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.companyCode} — {b.address || "no address"}</option>)}
                  </select>
                ) : (
                  <input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Address of the new branch" required />
                )}
                <p className="hint-text mt-0">
                  A new project (PRJ{selectedCompany?.parentNumber}{String((selectedCompany?.projectSeq || 0) + 1).padStart(3, "0")}) will be added under this company.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="form-row">
            <div><label>Client / Company Name</label><input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} required /></div>
            <div><label>Address of the Company</label><input value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
          </div>
        )}

        <label>Marketing Source (how the enquiry was generated)</label>
        <select value={form.marketingSource} onChange={(e) => set("marketingSource", e.target.value)}>
          <option value="">Select…</option>
          {MARKETING_SOURCES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        {form.marketingSource === "Referral" && (
          <div className="card" style={{ marginTop: 8 }}>
            <label>Referred by</label>
            <div className="toolbar" style={{ marginTop: 0 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <input type="radio" style={{ width: "auto" }} checked={form.referralType === "EMPLOYEE"} onChange={() => set("referralType", "EMPLOYEE")} />
                An employee
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <input type="radio" style={{ width: "auto" }} checked={form.referralType === "EXTERNAL"} onChange={() => set("referralType", "EXTERNAL")} />
                An external person
              </label>
            </div>
            {form.referralType === "EMPLOYEE" && (
              <select value={form.referredByEmployeeId} onChange={(e) => set("referredByEmployeeId", e.target.value)} required>
                <option value="">Select employee…</option>
                {employees.map((emp) => <option key={emp.userId} value={emp.userId}>{emp.name} ({emp.userId})</option>)}
              </select>
            )}
            {form.referralType === "EXTERNAL" && (
              <div className="form-row">
                <div><label>Person's Name</label><input value={form.referredByExternalName} onChange={(e) => set("referredByExternalName", e.target.value)} required /></div>
                <div><label>Contact Number</label><input value={form.referredByExternalPhone} onChange={(e) => set("referredByExternalPhone", e.target.value)} required /></div>
              </div>
            )}
          </div>
        )}

        <div className="form-row">
          <div><label>Approached By (contact person name)</label><input value={form.approachedByName} onChange={(e) => set("approachedByName", e.target.value)} required /></div>
          <div><label>Date of Approach</label><input type="date" value={form.approachDate} onChange={(e) => set("approachDate", e.target.value)} required /></div>
          <div>
            <label>Mode of Approach</label>
            <select value={form.approachMode} onChange={(e) => set("approachMode", e.target.value)} required>
              {APPROACH_MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div><label>Contact Phone{!phoneRequired && " (optional)"}</label><input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} required={phoneRequired} /></div>
          <div><label>Contact Email{!emailRequired && " (optional)"}</label><input type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} required={emailRequired} /></div>
          <div><label>Estimated Value (optional)</label><input type="number" min="0" step="0.01" value={form.estimatedValue} onChange={(e) => set("estimatedValue", e.target.value)} /></div>
        </div>

        <label>Description</label>
        <textarea rows={2} value={form.topic} onChange={(e) => set("topic", e.target.value)} />

        <label>Outcome of Discussion</label>
        <textarea rows={3} value={form.outcomeOfDiscussion} onChange={(e) => set("outcomeOfDiscussion", e.target.value)} />

        <label>Remarks</label>
        <textarea rows={2} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} />

        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? "Saving…" : "Create Enquiry"}</button>
      </form>
    </Modal>
  );
}

const TABS = ["Details", "Actions", "Conversation Stage"];

function EnquiryDrawer({ id, onClose, onChanged }) {
  const [enquiry, setEnquiry] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Details");

  async function load() {
    try {
      const { data } = await client.get(`/business-development/${id}`);
      setEnquiry(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [id]);

  return (
    <Drawer onClose={onClose}>
      {!enquiry ? (
        error ? <ErrorText>{error}</ErrorText> : <Loading />
      ) : (
        <>
          <div className="modal-header">
            <h3>{enquiry.enquiryNo} <span className="text-muted">— {enquiry.clientName}</span></h3>
            <button className="btn-sm" onClick={onClose}>Close</button>
          </div>
          <div className="drawer-tabs">
            {TABS.map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t}{t === "Actions" && (enquiry.actions || []).filter((a) => !a.completed).length > 0 && (
                  <span className="badge-pill badge-PENDING" style={{ marginLeft: 6 }}>{(enquiry.actions || []).filter((a) => !a.completed).length}</span>
                )}
              </button>
            ))}
          </div>
          {tab === "Details" && (
            <DetailsTab enquiry={enquiry} onSaved={() => { load(); onChanged(); }} onDeleted={() => { onClose(); onChanged(); }} />
          )}
          {tab === "Actions" && (
            <ActionsTab enquiryId={enquiry.id} actions={enquiry.actions || []} onChanged={() => { load(); onChanged(); }} />
          )}
          {tab === "Conversation Stage" && (
            <CompanyProfileFromEnquiryTab enquiry={enquiry} />
          )}
        </>
      )}
    </Drawer>
  );
}

// A Project (and its parent Company, if new) is created automatically
// alongside every enquiry (see backend routes/businessDevelopment.js) —
// this tab just shows/edits that project.
function CompanyProfileFromEnquiryTab({ enquiry }) {
  const [project, setProject] = useState(undefined); // undefined = loading, null = none found
  const [company, setCompany] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const { data } = await client.get("/projects", { params: { sourceEnquiryId: enquiry.id } });
      const found = data[0] || null;
      setProject(found);
      if (found?.companyId) {
        const { data: companyData } = await client.get(`/company-profiles/${found.companyId}`);
        setCompany(companyData);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [enquiry.id]);

  if (project === undefined) return <Loading />;
  if (project === null) return <div className="card empty-state">No project linked to this enquiry.</div>;
  if (error) return <ErrorText>{error}</ErrorText>;

  return <ProjectEditor project={project} company={company} onChanged={load} showPhases={false} showPhase2 />;
}

function DetailsTab({ enquiry, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(enquiry);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.put(`/business-development/${enquiry.id}`, form);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateResult(result) {
    try {
      await client.put(`/business-development/${enquiry.id}`, { result });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    try {
      await client.delete(`/business-development/${enquiry.id}`);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!editing) {
    return (
      <div>
        <div className="toolbar">
          <label style={{ margin: 0 }}>Result</label>
          <select style={{ width: 220 }} value={enquiry.result} onChange={(e) => updateResult(e.target.value)}>
            {RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABELS[r]}</option>)}
          </select>
          <div className="spacer" />
          <button className="btn-sm" onClick={() => setEditing(true)}>Edit</button>
        </div>
        <table>
          <tbody>
            <tr><td>Client / Company</td><td>{enquiry.clientName}</td></tr>
            <tr><td>Address</td><td>{enquiry.address || "-"}</td></tr>
            <tr><td>Marketing Source</td><td>{enquiry.marketingSource || "-"}</td></tr>
            {enquiry.marketingSource === "Referral" && (
              <tr>
                <td>Referred By</td>
                <td>
                  {enquiry.referralType === "EMPLOYEE"
                    ? `${enquiry.referredByEmployeeName || enquiry.referredByEmployeeId} (employee)`
                    : `${enquiry.referredByExternalName} — ${enquiry.referredByExternalPhone} (external)`}
                </td>
              </tr>
            )}
            <tr><td>Approached By</td><td>{enquiry.approachedByName}</td></tr>
            <tr><td>Approach Date</td><td>{enquiry.approachDate}</td></tr>
            <tr><td>Mode of Approach</td><td>{MODE_LABELS[enquiry.approachMode] || enquiry.approachMode}</td></tr>
            <tr><td>Contact Phone</td><td>{enquiry.contactPhone || "-"}</td></tr>
            <tr><td>Contact Email</td><td>{enquiry.contactEmail || "-"}</td></tr>
            <tr><td>Estimated Value</td><td>{enquiry.estimatedValue ?? "-"}</td></tr>
            <tr><td>Description</td><td style={{ whiteSpace: "pre-wrap" }}>{enquiry.topic || "-"}</td></tr>
            <tr><td>Outcome of Discussion</td><td style={{ whiteSpace: "pre-wrap" }}>{enquiry.outcomeOfDiscussion || "-"}</td></tr>
            <tr><td>Remarks</td><td style={{ whiteSpace: "pre-wrap" }}>{enquiry.remarks || "-"}</td></tr>
          </tbody>
        </table>
        <div className="toolbar" style={{ marginTop: 16 }}>
          <ConfirmButton className="btn-sm btn-danger" onConfirm={remove} confirmText="Delete this enquiry permanently?">Delete Enquiry</ConfirmButton>
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <form onSubmit={save}>
      <label>Client / Company Name</label>
      <input value={form.clientName || ""} onChange={(e) => set("clientName", e.target.value)} required />
      <label>Address</label>
      <input value={form.address || ""} onChange={(e) => set("address", e.target.value)} />
      <label>Marketing Source</label>
      <select value={form.marketingSource || ""} onChange={(e) => set("marketingSource", e.target.value)}>
        <option value="">Select…</option>
        {MARKETING_SOURCES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <div className="form-row">
        <div><label>Approached By</label><input value={form.approachedByName || ""} onChange={(e) => set("approachedByName", e.target.value)} required /></div>
        <div><label>Approach Date</label><input type="date" value={form.approachDate || ""} onChange={(e) => set("approachDate", e.target.value)} required /></div>
      </div>
      <label>Mode of Approach</label>
      <select value={form.approachMode} onChange={(e) => set("approachMode", e.target.value)}>
        {APPROACH_MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
      </select>
      <div className="form-row">
        <div><label>Contact Phone</label><input value={form.contactPhone || ""} onChange={(e) => set("contactPhone", e.target.value)} /></div>
        <div><label>Contact Email</label><input type="email" value={form.contactEmail || ""} onChange={(e) => set("contactEmail", e.target.value)} /></div>
        <div><label>Estimated Value</label><input type="number" min="0" step="0.01" value={form.estimatedValue ?? ""} onChange={(e) => set("estimatedValue", e.target.value)} /></div>
      </div>
      <label>Description</label>
      <textarea rows={2} value={form.topic || ""} onChange={(e) => set("topic", e.target.value)} />
      <label>Outcome of Discussion</label>
      <textarea rows={3} value={form.outcomeOfDiscussion || ""} onChange={(e) => set("outcomeOfDiscussion", e.target.value)} />
      <label>Remarks</label>
      <textarea rows={2} value={form.remarks || ""} onChange={(e) => set("remarks", e.target.value)} />

      <ErrorText>{error}</ErrorText>
      <div className="toolbar" style={{ marginTop: 16 }}>
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => { setForm(enquiry); setEditing(false); }}>Cancel</button>
      </div>
    </form>
  );
}

function ActionsTab({ enquiryId, actions, onChanged }) {
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");

  const sorted = [...actions].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  async function toggleComplete(action) {
    try {
      await client.put(`/business-development/${enquiryId}/actions/${action.id}`, { completed: !action.completed });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(actionId) {
    if (!window.confirm("Delete this action?")) return;
    try {
      await client.delete(`/business-development/${enquiryId}/actions/${actionId}`);
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
      {sorted.map((a) => {
        const overdue = !a.completed && a.dueDate < todayISO();
        return (
          <div key={a.id} className="card" style={{ marginBottom: 10 }}>
            <div className="toolbar" style={{ marginBottom: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={a.completed} onChange={() => toggleComplete(a)} />
                <strong style={{ textDecoration: a.completed ? "line-through" : "none" }}>{a.description}</strong>
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
        <AddActionModal enquiryId={enquiryId} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); onChanged(); }} />
      )}
    </div>
  );
}

function AddActionModal({ enquiryId, onClose, onAdded }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ description: "", assignedTo: "", dueDate: "", startDate: todayISO() });
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
      await client.post(`/business-development/${enquiryId}/actions`, {
        ...form,
        assignedToName: employee?.name,
      });
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add Action" onClose={onClose}>
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
    </Modal>
  );
}
