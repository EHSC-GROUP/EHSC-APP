import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import Drawer from "../../components/Drawer";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";
import { openAuthedFile } from "../../lib/openFile";

export default function EmployeeProfiles() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  async function load() {
    setError("");
    try {
      const { data } = await client.get("/profiles", { params: { includeArchived } });
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => { load(); }, [includeArchived]);

  const filtered = (list || []).filter((p) => {
    const q = search.toLowerCase();
    return !q || [p.name, p.userId, p.employeeId, p.designation, p.department].some((v) => (v || "").toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="page-header">
        <h2>Employee Profiles</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Profile</button>
      </div>

      <div className="toolbar">
        <input style={{ maxWidth: 280 }} placeholder="Search name, ID, designation…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <ErrorText>{error}</ErrorText>
      {!list ? (
        <Loading />
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>User ID</th><th>Type</th><th>Designation</th><th>Department</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.userId} style={{ cursor: "pointer" }} onClick={() => setSelected(p.userId)}>
                  <td>{p.name}{p.disabled && <span className="text-muted"> (archived)</span>}</td>
                  <td>{p.userId}</td>
                  <td>{p.type}</td>
                  <td>{p.designation || "-"}</td>
                  <td>{p.department || "-"}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} className="empty-state">No profiles found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateProfileModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {selected && (
        <ProfileDrawer
          userId={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function CreateProfileModal({ onClose, onCreated }) {
  const [type, setType] = useState("employee");
  const [form, setForm] = useState({ name: "", designation: "", department: "", email: "", phone: "" });
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { data } = await client.post("/profiles", { ...form, type });
      setResult(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal title="Profile Created" onClose={() => { onClose(); onCreated(); }}>
        <p>New login created. Share these credentials securely — the temporary password is shown only once.</p>
        <p><strong>User ID:</strong> {result.userId}</p>
        <p><strong>Temporary Password:</strong> {result.tempPassword}</p>
        <button className="btn-primary" onClick={() => { onClose(); onCreated(); }}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title="New Employee Profile" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="employee">Employee</option>
          <option value="external">External / Vendor</option>
        </select>

        <label>Name</label>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} required />

        {type === "employee" && (
          <>
            <div className="form-row">
              <div><label>Designation</label><input value={form.designation} onChange={(e) => set("designation", e.target.value)} /></div>
              <div><label>Department</label><input value={form.department} onChange={(e) => set("department", e.target.value)} /></div>
            </div>
          </>
        )}
        <div className="form-row">
          <div><label>Email</label><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        </div>

        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? "Creating…" : "Create"}</button>
      </form>
    </Modal>
  );
}

const TABS = ["Profile", "Salary", "Leave Balances", "Files"];

function ProfileDrawer({ userId, onClose, onChanged }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Profile");

  async function load() {
    try {
      const { data } = await client.get(`/profiles/${userId}`);
      setProfile(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => { load(); }, [userId]);

  return (
    <Drawer onClose={onClose}>
      {!profile ? (
        error ? <ErrorText>{error}</ErrorText> : <Loading />
      ) : (
        <>
          <div className="modal-header">
            <h3>{profile.name} <span className="text-muted">({profile.userId})</span></h3>
            <button className="btn-sm" onClick={onClose}>Close</button>
          </div>
          <div className="drawer-tabs">
            {TABS.filter((t) => profile.type === "employee" || (t !== "Salary" && t !== "Leave Balances")).map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
          {tab === "Profile" && <ProfileTab profile={profile} onSaved={() => { load(); onChanged(); }} />}
          {tab === "Salary" && profile.type === "employee" && <SalaryTab userId={userId} />}
          {tab === "Leave Balances" && profile.type === "employee" && <LeaveBalanceTab userId={userId} />}
          {tab === "Files" && <FilesTab userId={userId} type={profile.type} />}
        </>
      )}
    </Drawer>
  );
}

function ProfileTab({ profile, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(profile);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetResult, setResetResult] = useState(null);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.put(`/profiles/${profile.userId}`, form);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!window.confirm("Generate a new temporary password for this user?")) return;
    try {
      const { data } = await client.post(`/auth/admin/reset-password/${profile.userId}`);
      setResetResult(data.tempPassword);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function archive() {
    if (!window.confirm("Archive this account? Login will be disabled but all records are kept.")) return;
    try {
      await client.delete(`/profiles/${profile.userId}`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function restore() {
    try {
      await client.post(`/profiles/${profile.userId}/restore`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const isExternal = profile.type === "external";

  if (!editing) {
    return (
      <div>
        <div className="toolbar">
          <StatusBadge status={profile.status} />
          <div className="spacer" />
          <button className="btn-sm" onClick={() => setEditing(true)}>Edit</button>
        </div>
        <table>
          <tbody>
            <tr><td>Type</td><td>{profile.type}</td></tr>
            {!isExternal && <tr><td>Employee ID</td><td>{profile.employeeId || "-"}</td></tr>}
            {!isExternal && <tr><td>Designation</td><td>{profile.designation || "-"}</td></tr>}
            {!isExternal && <tr><td>Department</td><td>{profile.department || "-"}</td></tr>}
            {!isExternal && <tr><td>Date of Joining</td><td>{profile.dateOfJoining || "-"}</td></tr>}
            {!isExternal && <tr><td>Date of Leaving</td><td>{profile.dateOfLeaving || "-"}</td></tr>}
            {!isExternal && <tr><td>Father/Husband Name</td><td>{profile.fatherOrHusbandName || "-"}</td></tr>}
            {!isExternal && <tr><td>Gender</td><td>{profile.gender || "-"}</td></tr>}
            <tr><td>Email</td><td>{profile.email || "-"}</td></tr>
            <tr><td>Phone</td><td>{profile.phone || "-"}</td></tr>
            <tr><td>ESI Number</td><td>{profile.esiNumber || "-"}</td></tr>
            <tr><td>UAN</td><td>{profile.uan || "-"}</td></tr>
            <tr><td>Reimbursement Access</td><td>{profile.reimbursementAccess ? "Granted" : "Not granted"}</td></tr>
          </tbody>
        </table>

        <div className="toolbar" style={{ marginTop: 20 }}>
          <button className="btn-sm" onClick={resetPassword}>Reset Password</button>
          {profile.disabled ? (
            <button className="btn-sm" onClick={restore}>Restore Access</button>
          ) : (
            <ConfirmButton className="btn-sm btn-danger" onConfirm={archive} confirmText="Archive this account?">Archive</ConfirmButton>
          )}
        </div>
        {resetResult && <p className="hint-text">New temporary password: <strong>{resetResult}</strong></p>}
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <form onSubmit={save}>
      <label>Name</label>
      <input value={form.name || ""} onChange={(e) => set("name", e.target.value)} required />
      {!isExternal && (
        <>
          <div className="form-row">
            <div><label>Employee ID</label><input value={form.employeeId || ""} onChange={(e) => set("employeeId", e.target.value)} /></div>
            <div><label>Designation</label><input value={form.designation || ""} onChange={(e) => set("designation", e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div><label>Department</label><input value={form.department || ""} onChange={(e) => set("department", e.target.value)} /></div>
            <div><label>Gender</label><input value={form.gender || ""} onChange={(e) => set("gender", e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div><label>Date of Joining</label><input type="date" value={form.dateOfJoining || ""} onChange={(e) => set("dateOfJoining", e.target.value)} /></div>
            <div><label>Date of Leaving</label><input type="date" value={form.dateOfLeaving || ""} onChange={(e) => set("dateOfLeaving", e.target.value)} /></div>
          </div>
          <label>Father / Husband Name</label>
          <input value={form.fatherOrHusbandName || ""} onChange={(e) => set("fatherOrHusbandName", e.target.value)} />
        </>
      )}
      <div className="form-row">
        <div><label>Email</label><input type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
        <div><label>Phone</label><input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div><label>ESI Number</label><input value={form.esiNumber || ""} onChange={(e) => set("esiNumber", e.target.value)} /></div>
        <div><label>UAN</label><input value={form.uan || ""} onChange={(e) => set("uan", e.target.value)} /></div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={!!form.reimbursementAccess} onChange={(e) => set("reimbursementAccess", e.target.checked)} />
        Reimbursement access granted
      </label>

      <ErrorText>{error}</ErrorText>
      <div className="toolbar" style={{ marginTop: 16 }}>
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => { setForm(profile); setEditing(false); }}>Cancel</button>
      </div>
    </form>
  );
}

function SalaryTab({ userId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [gross, setGross] = useState("");
  const [preview, setPreview] = useState(null);

  async function load() {
    try {
      const { data } = await client.get(`/salary-structures/${userId}`);
      setData(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [userId]);

  useEffect(() => {
    if (!gross || Number(gross) <= 0) { setPreview(null); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await client.get("/salary-structures/formula/preview", { params: { gross } });
        setPreview(data);
      } catch { /* ignore preview errors */ }
    }, 300);
    return () => clearTimeout(t);
  }, [gross]);

  if (!data) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  return (
    <div>
      <div className="toolbar">
        <strong>Current: {data.current ? `₹${data.current.gross} (from ${data.current.effectiveFrom})` : "None"}</strong>
        <div className="spacer" />
        <button className="btn-sm" onClick={() => setShowNew((s) => !s)}>{showNew ? "Cancel" : "+ New Version"}</button>
      </div>

      {showNew && <NewVersionForm userId={userId} gross={gross} setGross={setGross} preview={preview} onCreated={() => { setShowNew(false); setGross(""); load(); }} />}

      <table>
        <thead><tr><th>Effective From</th><th>Gross</th><th>Basic</th><th>HRA</th><th>Others</th><th>PT</th><th>ESI</th></tr></thead>
        <tbody>
          {data.versions.map((v) => (
            <tr key={v.effectiveFrom}>
              <td>{v.effectiveFrom}</td><td>{v.gross}</td><td>{v.basic}</td><td>{v.hra}</td><td>{v.others}</td>
              <td>{v.pt}</td><td>{v.esiApplicable ? `${v.esiPercent}%` : "-"}</td>
            </tr>
          ))}
          {data.versions.length === 0 && <tr><td colSpan={7} className="empty-state">No salary structure yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function NewVersionForm({ userId, gross, setGross, preview, onCreated }) {
  const [form, setForm] = useState({ effectiveFrom: "", pt: 0, esiApplicable: false, esiPercent: 0, pfApplicable: false, pfPercent: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.post(`/salary-structures/${userId}`, { ...form, gross: Number(gross) });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <div className="form-row">
        <div><label>Effective From</label><input type="date" value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} required /></div>
        <div><label>Gross</label><input type="number" min="0" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} required /></div>
      </div>
      {preview && <p className="hint-text">Basic: {preview.basic} · HRA: {preview.hra} · Others: {preview.others}</p>}
      <div className="form-row">
        <div><label>Professional Tax (flat)</label><input type="number" min="0" step="0.01" value={form.pt} onChange={(e) => set("pt", e.target.value)} /></div>
        <div><label>ESI %</label><input type="number" min="0" step="0.01" value={form.esiPercent} onChange={(e) => set("esiPercent", e.target.value)} disabled={!form.esiApplicable} /></div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={form.esiApplicable} onChange={(e) => set("esiApplicable", e.target.checked)} />
        ESI Applicable
      </label>
      <div className="form-row">
        <div><label>PF %</label><input type="number" min="0" step="0.01" value={form.pfPercent} onChange={(e) => set("pfPercent", e.target.value)} disabled={!form.pfApplicable} /></div>
        <div />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={form.pfApplicable} onChange={(e) => set("pfApplicable", e.target.checked)} />
        PF Applicable
      </label>
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Add Version"}</button>
    </form>
  );
}

function LeaveBalanceTab({ userId }) {
  const [balances, setBalances] = useState(null);
  const [error, setError] = useState("");
  const fy = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;

  async function load() {
    try {
      const { data } = await client.get(`/leave/balances/${userId}`, { params: { fy } });
      setBalances(data.balances);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [userId]);

  async function adjust(leaveTypeId, current) {
    const value = window.prompt(`New entitlement for ${leaveTypeId} (FY ${fy}):`, current);
    if (value === null) return;
    try {
      await client.put(`/leave/balances/${userId}/${leaveTypeId}`, { fy, entitlement: Number(value) });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!balances) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  return (
    <table>
      <thead><tr><th>Leave Type</th><th>Entitlement</th><th>Used</th><th>Remaining</th><th></th></tr></thead>
      <tbody>
        {Object.entries(balances).map(([id, b]) => (
          <tr key={id}>
            <td>{id}</td><td>{b.entitlement}</td><td>{b.used}</td><td>{b.remaining}</td>
            <td><button className="btn-sm" onClick={() => adjust(id, b.entitlement)}>Adjust</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FilesTab({ userId, type }) {
  const isExternal = type === "external";
  const endpoint = isExternal ? "bills" : "documents";
  const [files, setFiles] = useState(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [month, setMonth] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await client.get(`/${endpoint}/${userId}`);
      setFiles(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [userId]);

  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    if (isExternal) form.append("month", month);
    else form.append("category", "General");
    try {
      await client.post(`/${endpoint}/${userId}`, form);
      setTitle(""); setMonth(""); setFile(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this file?")) return;
    try {
      await client.delete(`/${endpoint}/${id}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <form onSubmit={upload} className="card">
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        {isExternal && (<><label>Month (YYYY-MM)</label><input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="2026-04" required /></>)}
        <label>File</label>
        <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={(e) => setFile(e.target.files[0])} required />
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
      </form>

      {!files ? <Loading /> : (
        <table>
          <thead><tr><th>Title</th>{isExternal && <th>Month</th>}<th></th></tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td><button className="btn-sm" onClick={() => openAuthedFile(f.fileUrl).catch((err) => setError(errorMessage(err)))}>{f.title}</button></td>
                {isExternal && <td>{f.month}</td>}
                <td><button className="btn-sm btn-danger" onClick={() => remove(f.id)}>Delete</button></td>
              </tr>
            ))}
            {files.length === 0 && <tr><td colSpan={isExternal ? 3 : 2} className="empty-state">No files yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
