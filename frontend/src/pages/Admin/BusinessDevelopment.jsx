import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import Drawer from "../../components/Drawer";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";
import CompanyProfileEditor from "../../components/CompanyProfileEditor";

const APPROACH_MODES = ["EMAIL", "PHONE", "ON_SITE"];
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
  const [form, setForm] = useState({
    clientName: "", address: "", marketingSource: "", approachedByName: "", approachDate: todayISO(), approachMode: "EMAIL",
    contactPhone: "", contactEmail: "", topic: "", outcomeOfDiscussion: "", estimatedValue: "", remarks: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.post("/business-development", form);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New Enquiry" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-row">
          <div><label>Client / Company Name</label><input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} required /></div>
          <div><label>Marketing Source (how the enquiry was generated)</label><input value={form.marketingSource} onChange={(e) => set("marketingSource", e.target.value)} placeholder="e.g. Email campaign, Referral, Website, Exhibition" /></div>
        </div>

        <label>Address of the Company</label>
        <input value={form.address} onChange={(e) => set("address", e.target.value)} />

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
          <div><label>Contact Phone (optional)</label><input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></div>
          <div><label>Contact Email (optional)</label><input type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></div>
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

const TABS = ["Details", "Actions", "Company Profile"];

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
          {tab === "Company Profile" && (
            <CompanyProfileFromEnquiryTab enquiry={enquiry} />
          )}
        </>
      )}
    </Drawer>
  );
}

// A Company Profile is created automatically alongside every enquiry (see
// backend routes/businessDevelopment.js) — this tab just shows/edits it.
// Older enquiries created before that existed won't have one yet; offer a
// one-click backfill for those instead of the create form.
function CompanyProfileFromEnquiryTab({ enquiry }) {
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = none yet
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await client.get(`/company-profiles/${enquiry.id}`);
      setProfile(data);
    } catch (err) {
      if (err.response?.status === 404) setProfile(null);
      else setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [enquiry.id]);

  async function backfill() {
    setError("");
    setBusy(true);
    try {
      await client.post(`/business-development/${enquiry.id}/create-profile`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (profile === undefined) return <Loading />;

  if (profile === null) {
    return (
      <div className="card">
        <p className="mt-0">This enquiry was created before Company Profiles were auto-created. Create one now, pre-filled from this enquiry's details.</p>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" onClick={backfill} disabled={busy}>{busy ? "Creating…" : "Create Company Profile"}</button>
      </div>
    );
  }

  return <CompanyProfileEditor profile={profile} onChanged={load} showPhases={false} showPhase2 />;
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
      <input value={form.marketingSource || ""} onChange={(e) => set("marketingSource", e.target.value)} />
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
