import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import Drawer from "../../components/Drawer";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";
import ProjectEditor from "../../components/ProjectEditor";

export default function CompanyProfiles() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(null);

  async function load() {
    setError("");
    try {
      const { data } = await client.get("/company-profiles");
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = (list || []).filter((p) => {
    const q = search.toLowerCase();
    if (!q) return true;
    const branchText = (p.branches || []).map((b) => `${b.companyCode} ${b.contactPersonName}`).join(" ");
    return [p.clientName, String(p.parentNumber), branchText].some((v) => (v || "").toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="page-header">
        <h2>Company Profiles</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Company</button>
      </div>
      <p className="hint-text">
        One record per client company — a company can have several branches and carry several projects over time.
        New enquiries usually create a company (and its first branch/project) automatically; use "New Company" here
        only for a client with no enquiry yet.
      </p>

      <div className="toolbar">
        <input style={{ maxWidth: 280 }} placeholder="Search company #, name, branch, contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Client / Company</th><th>Branches</th><th>Primary Contact</th></tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const primary = (p.branches || [])[0];
                return (
                  <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setSelected(p.id)}>
                    <td>{p.parentNumber}</td>
                    <td>{p.clientName}</td>
                    <td>{(p.branches || []).length}</td>
                    <td>{primary?.contactPersonName || "-"}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={4} className="empty-state">No companies yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateCompanyModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {selected && <CompanyDrawer id={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}

function CreateCompanyModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ clientName: "", address: "", contactPersonName: "", contactPhone: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.post("/company-profiles", form);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New Company" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-row">
          <div><label>Client / Company Name</label><input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} required /></div>
          <div><label>Address (first branch)</label><input value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div><label>Contact Person Name</label><input value={form.contactPersonName} onChange={(e) => set("contactPersonName", e.target.value)} /></div>
          <div><label>Contact Phone</label><input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></div>
        </div>
        <p className="hint-text mt-0">
          A company number (150, 151, ...) is assigned automatically, and its first branch (01) is created with the
          details above. Add more branches or projects from the company's page after creating it.
        </p>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? "Saving…" : "Create Company"}</button>
      </form>
    </Modal>
  );
}

function CompanyDrawer({ id, onClose, onChanged }) {
  const [company, setCompany] = useState(null);
  const [projects, setProjects] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [clientNameForm, setClientNameForm] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectBranchId, setNewProjectBranchId] = useState("");

  async function loadCompany() {
    try {
      const { data } = await client.get(`/company-profiles/${id}`);
      setCompany(data);
      setClientNameForm(data.clientName);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function loadProjects() {
    try {
      const { data } = await client.get("/projects", { params: { companyId: id } });
      setProjects(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { loadCompany(); loadProjects(); }, [id]);

  async function saveCompany(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.put(`/company-profiles/${id}`, { clientName: clientNameForm });
      setEditing(false);
      loadCompany();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeCompany() {
    try {
      await client.delete(`/company-profiles/${id}`);
      onClose();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function removeBranch(branchId) {
    setError("");
    try {
      await client.delete(`/company-profiles/${id}/branches/${branchId}`);
      loadCompany();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function addProject() {
    if (!newProjectBranchId) return setError("Select which branch this project belongs to");
    setBusy(true);
    setError("");
    try {
      const { data } = await client.post("/projects", { companyId: id, branchId: newProjectBranchId });
      setShowAddProject(false);
      await loadProjects();
      setSelectedProjectId(data.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (selectedProjectId) {
    return (
      <Drawer onClose={onClose}>
        <ProjectDrawerContent
          projectId={selectedProjectId}
          company={company}
          onBack={() => { setSelectedProjectId(null); loadProjects(); }}
          onChanged={loadProjects}
        />
      </Drawer>
    );
  }

  const branches = company?.branches || [];

  return (
    <Drawer onClose={onClose}>
      {!company ? (
        error ? <ErrorText>{error}</ErrorText> : <Loading />
      ) : (
        <>
          <div className="modal-header">
            <h3>#{company.parentNumber} — {company.clientName}</h3>
            <button className="btn-sm" onClick={onClose}>Close</button>
          </div>

          {!editing ? (
            <button className="btn-sm" onClick={() => setEditing(true)}>Edit Company Name</button>
          ) : (
            <form onSubmit={saveCompany}>
              <label>Client / Company Name</label>
              <input value={clientNameForm} onChange={(e) => setClientNameForm(e.target.value)} required />
              <ErrorText>{error}</ErrorText>
              <div className="toolbar">
                <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
                <button type="button" onClick={() => { setClientNameForm(company.clientName); setEditing(false); }}>Cancel</button>
              </div>
            </form>
          )}

          <div className="card" style={{ marginTop: 16 }}>
            <div className="toolbar">
              <h3 className="mt-0" style={{ marginRight: 8 }}>Branches</h3>
              <div className="spacer" />
              <button className="btn-sm" onClick={() => setShowAddBranch(true)}>+ Add Branch</button>
            </div>
            <ErrorText>{error}</ErrorText>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Code</th><th>Address</th><th>Contact Person</th><th>Contact Phone</th><th></th></tr></thead>
                <tbody>
                  {branches.map((b) => (
                    <tr key={b.id}>
                      <td>{b.companyCode}</td>
                      <td>{b.address || "-"}</td>
                      <td>{b.contactPersonName || "-"}</td>
                      <td>{b.contactPhone || "-"}</td>
                      <td>
                        {branches.length > 1 && (
                          <ConfirmButton className="btn-sm btn-danger" onConfirm={() => removeBranch(b.id)} confirmText="Delete this branch?">Delete</ConfirmButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="toolbar">
              <h3 className="mt-0" style={{ marginRight: 8 }}>Projects</h3>
              <div className="spacer" />
              <button className="btn-sm" onClick={() => { setNewProjectBranchId(branches[0]?.id || ""); setShowAddProject(true); }}>+ Add Project</button>
            </div>
            <ErrorText>{error}</ErrorText>
            {!projects ? <Loading /> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Project ID</th><th>Branch</th><th>PO Number</th><th>PO Value</th><th>Source Enquiry</th></tr></thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setSelectedProjectId(p.id)}>
                        <td>{p.projectId}</td>
                        <td>{p.companyCode}</td>
                        <td>{p.poNumber || "-"}</td>
                        <td>{p.poValue ?? "-"}</td>
                        <td>{p.sourceEnquiryNo || "-"}</td>
                      </tr>
                    ))}
                    {projects.length === 0 && <tr><td colSpan={5} className="empty-state">No projects yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {showAddBranch && (
            <AddBranchModal companyId={id} onClose={() => setShowAddBranch(false)} onAdded={() => { setShowAddBranch(false); loadCompany(); }} />
          )}

          {showAddProject && (
            <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowAddProject(false)}>
              <div className="modal">
                <div className="modal-header">
                  <h3>Add Project</h3>
                  <button className="btn-sm" onClick={() => setShowAddProject(false)}>Close</button>
                </div>
                <label>Branch</label>
                <select value={newProjectBranchId} onChange={(e) => setNewProjectBranchId(e.target.value)}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.companyCode} — {b.address || "no address"}</option>)}
                </select>
                <p className="hint-text mt-0">
                  Creates a new project under {company.clientName} with the next project ID (PRJ{company.parentNumber}
                  {String((company.projectSeq || 0) + 1).padStart(3, "0")}). You'll fill in PO details and phases after.
                </p>
                <ErrorText>{error}</ErrorText>
                <button className="btn-primary" onClick={addProject} disabled={busy}>{busy ? "Creating…" : "Create Project"}</button>
              </div>
            </div>
          )}

          <div className="toolbar" style={{ marginTop: 16 }}>
            <ConfirmButton className="btn-sm btn-danger" onConfirm={removeCompany} confirmText="Delete this company, all its branches and projects permanently?">Delete Company</ConfirmButton>
          </div>
        </>
      )}
    </Drawer>
  );
}

function AddBranchModal({ companyId, onClose, onAdded }) {
  const [form, setForm] = useState({ address: "", contactPersonName: "", contactPhone: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.post(`/company-profiles/${companyId}/branches`, form);
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add Branch" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Address</label>
        <input value={form.address} onChange={(e) => set("address", e.target.value)} required />
        <div className="form-row">
          <div><label>Contact Person Name</label><input value={form.contactPersonName} onChange={(e) => set("contactPersonName", e.target.value)} /></div>
          <div><label>Contact Phone</label><input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></div>
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Add Branch"}</button>
      </form>
    </Modal>
  );
}

function ProjectDrawerContent({ projectId, company, onBack, onChanged }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const { data } = await client.get(`/projects/${projectId}`);
      setProject(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [projectId]);

  async function remove() {
    try {
      await client.delete(`/projects/${projectId}`);
      onChanged();
      onBack();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <div className="modal-header">
        <h3>{project?.projectId || "Project"}</h3>
        <button className="btn-sm" onClick={onBack}>← Back to Company</button>
      </div>
      {!project ? (
        error ? <ErrorText>{error}</ErrorText> : <Loading />
      ) : (
        <>
          <ProjectEditor project={project} company={company} onChanged={() => { load(); onChanged(); }} showPhase2={false} />
          <div className="toolbar" style={{ marginTop: 16 }}>
            <ConfirmButton className="btn-sm btn-danger" onConfirm={remove} confirmText="Delete this project permanently?">Delete Project</ConfirmButton>
          </div>
        </>
      )}
    </>
  );
}
