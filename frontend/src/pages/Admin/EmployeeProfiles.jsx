import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import Drawer from "../../components/Drawer";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";
import { openAuthedFile } from "../../lib/openFile";
import Form22 from "./Form22";

// kind "staff" = employees and admins; kind "associate" = external parties.
export default function EmployeeProfiles({ kind = "staff" }) {
  const isAssociateList = kind === "associate";
  const [showForm22, setShowForm22] = useState(false);
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
    if (isAssociateList ? p.type !== "associate" : p.type === "associate") return false;
    const q = search.toLowerCase();
    return !q || [p.name, p.userId, p.employeeId, p.designation, p.department].some((v) => (v || "").toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="page-header">
        <h2>{isAssociateList ? "Associate Profiles" : "Employee Profiles"}</h2>
        <div className="toolbar" style={{ margin: 0 }}>
          {!isAssociateList && <button onClick={() => setShowForm22(true)}>Form 22</button>}
          <button className="btn-primary" onClick={() => setShowCreate(true)}>{isAssociateList ? "+ New Associate Profile" : "+ New Employee Profile"}</button>
        </div>
      </div>

      <div className="toolbar">
        <input style={{ maxWidth: 280 }} placeholder={isAssociateList ? "Search name, ID…" : "Search name, ID, designation…"} value={search} onChange={(e) => setSearch(e.target.value)} />
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
                <th>Name</th><th>User ID</th><th>Type</th><th>Designation</th><th>Department</th><th>Net Salary</th><th>Status</th>
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
                  <td className="amt-gross">{p.netSalary != null ? `₹${p.netSalary.toFixed(2)}` : "-"}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="empty-state">No profiles found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showForm22 && (
        <Modal title="Form 22 — Statutory Register" wide onClose={() => setShowForm22(false)}>
          <Form22 />
        </Modal>
      )}
      {showCreate && <CreateProfileModal kind={kind} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
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

const DEPARTMENTS = ["BD", "HR", "Operations", "Finance", "Business Management"];
const TYPE_LABEL = { employee: "Employee", admin: "Admin", team_leader: "Team Leader", associate: "Associate" };
const isStaff = (type) => type === "employee" || type === "admin" || type === "team_leader";

function CreateProfileModal({ kind, onClose, onCreated }) {
  const [type, setType] = useState(kind === "associate" ? "associate" : "employee");
  const [form, setForm] = useState({
    name: "", firstName: "", lastName: "", designation: "", department: "",
    address: "", professionalEmail: "", personalEmail: "", email: "", phone: "",
    reportingManager: "", emergencyContactName: "", emergencyContactPhone: "",
  });
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
        <p>New login created. They must change this temporary password the first time they sign in.</p>
        <p><strong>User ID:</strong> {result.userId}</p>
        <p><strong>Temporary Password:</strong> {result.tempPassword}</p>
        <button className="btn-primary" onClick={() => { onClose(); onCreated(); }}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title={kind === "associate" ? "New Associate Profile" : "New Profile"} onClose={onClose} wide>
      <form onSubmit={submit}>
        {kind !== "associate" && (
          <>
            <label>Profile Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(TYPE_LABEL).filter(([v]) => v !== "associate").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </>
        )}

        {isStaff(type) ? (
          <>
            <div className="form-row">
              <div><label>First Name</label><input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} required /></div>
              <div><label>Last Name</label><input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} required /></div>
            </div>
            <p className="hint-text mt-0">Employee ID is auto-generated (EHSC123, EHSC124, ...) and becomes the login User ID.</p>
            <div className="form-row">
              <div><label>Designation</label><input value={form.designation} onChange={(e) => set("designation", e.target.value)} /></div>
              <div>
                <label>Department</label>
                <select value={form.department} onChange={(e) => set("department", e.target.value)} required>
                  <option value="">Select…</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div><label>Professional Email</label><input type="email" value={form.professionalEmail} onChange={(e) => set("professionalEmail", e.target.value)} required /></div>
              <div><label>Personal Email</label><input type="email" value={form.personalEmail} onChange={(e) => set("personalEmail", e.target.value)} required /></div>
            </div>
            <div className="form-row">
              <div><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
              <div><label>Reporting Manager</label><input value={form.reportingManager} onChange={(e) => set("reportingManager", e.target.value)} /></div>
            </div>
            <div className="form-row">
              <div><label>Emergency Contact Name</label><input value={form.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} /></div>
              <div><label>Emergency Contact Phone</label><input value={form.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone", e.target.value)} /></div>
            </div>
          </>
        ) : (
          <>
            <label>Name</label>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} required />
            <div className="form-row">
              <div><label>Email</label><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
              <div><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
            </div>
          </>
        )}
        <label>Address</label>
        <textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />

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
            {TABS.filter((t) => isStaff(profile.type) || (t !== "Salary" && t !== "Leave Balances")).map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
          {tab === "Profile" && <ProfileTab profile={profile} onSaved={() => { load(); onChanged(); }} />}
          {tab === "Salary" && isStaff(profile.type) && <SalaryTab userId={userId} />}
          {tab === "Leave Balances" && isStaff(profile.type) && <LeaveBalanceTab userId={userId} />}
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

  const isExternal = profile.type === "associate";

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
            <tr><td>Type</td><td>{TYPE_LABEL[profile.type] || profile.type}</td></tr>
            {!isExternal && <tr><td>Employee ID</td><td>{profile.employeeId || "-"}</td></tr>}
            {!isExternal && <tr><td>Designation</td><td>{profile.designation || "-"}</td></tr>}
            {!isExternal && <tr><td>Department</td><td>{profile.department || "-"}</td></tr>}
            {!isExternal && <tr><td>Date of Joining</td><td>{profile.dateOfJoining || "-"}</td></tr>}
            {!isExternal && <tr><td>Date of Leaving</td><td>{profile.dateOfLeaving || "-"}</td></tr>}
            {!isExternal && <tr><td>Father/Husband Name</td><td>{profile.fatherOrHusbandName || "-"}</td></tr>}
            {!isExternal && <tr><td>Gender</td><td>{profile.gender || "-"}</td></tr>}
            {!isExternal && <tr><td>Professional Email</td><td>{profile.professionalEmail || "-"}</td></tr>}
            {!isExternal && <tr><td>Personal Email</td><td>{profile.personalEmail || "-"}</td></tr>}
            {isExternal && <tr><td>Email</td><td>{profile.email || "-"}</td></tr>}
            <tr><td>Phone</td><td>{profile.phone || "-"}</td></tr>
            {!isExternal && <tr><td>Reporting Manager</td><td>{profile.reportingManager || "-"}</td></tr>}
            <tr><td>Emergency Contact Name</td><td>{profile.emergencyContactName || "-"}</td></tr>
            <tr><td>Emergency Contact Phone</td><td>{profile.emergencyContactPhone || "-"}</td></tr>
            <tr><td>Address</td><td style={{ whiteSpace: "pre-wrap" }}>{profile.address || "-"}</td></tr>
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
        {resetResult && <p className="hint-text">Password reset to <strong>{resetResult}</strong> — they must change it at next sign-in.</p>}
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <form onSubmit={save}>
      {isExternal ? (
        <>
          <label>Name</label>
          <input value={form.name || ""} onChange={(e) => set("name", e.target.value)} required />
        </>
      ) : (
        <div className="form-row">
          <div><label>First Name</label><input value={form.firstName || ""} onChange={(e) => set("firstName", e.target.value)} required /></div>
          <div><label>Last Name</label><input value={form.lastName || ""} onChange={(e) => set("lastName", e.target.value)} required /></div>
        </div>
      )}
      {!isExternal && (
        <>
          <div className="form-row">
            <div><label>Employee ID</label><input value={profile.userId} disabled title="Always matches the login User ID" /></div>
            <div><label>Designation</label><input value={form.designation || ""} onChange={(e) => set("designation", e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div>
              <label>Department</label>
              <select value={form.department || ""} onChange={(e) => set("department", e.target.value)} required>
                <option value="">Select…</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
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
      {isExternal ? (
        <div className="form-row">
          <div><label>Email</label><input type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
          <div><label>Phone</label><input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
        </div>
      ) : (
        <>
          <div className="form-row">
            <div><label>Professional Email</label><input type="email" value={form.professionalEmail || ""} onChange={(e) => set("professionalEmail", e.target.value)} required /></div>
            <div><label>Personal Email</label><input type="email" value={form.personalEmail || ""} onChange={(e) => set("personalEmail", e.target.value)} required /></div>
          </div>
          <div className="form-row">
            <div><label>Phone</label><input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
            <div><label>Reporting Manager</label><input value={form.reportingManager || ""} onChange={(e) => set("reportingManager", e.target.value)} /></div>
          </div>
        </>
      )}
      <div className="form-row">
        <div><label>Emergency Contact Name</label><input value={form.emergencyContactName || ""} onChange={(e) => set("emergencyContactName", e.target.value)} /></div>
        <div><label>Emergency Contact Phone</label><input value={form.emergencyContactPhone || ""} onChange={(e) => set("emergencyContactPhone", e.target.value)} /></div>
      </div>
      <label>Address</label>
      <textarea rows={2} value={form.address || ""} onChange={(e) => set("address", e.target.value)} />
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
        <strong>Current: {data.current ? <span className="amt-gross">₹{data.current.gross} (from {data.current.effectiveFrom})</span> : "None"}</strong>
        <div className="spacer" />
        <button className="btn-sm" onClick={() => setShowNew((s) => !s)}>{showNew ? "Cancel" : "+ New Version"}</button>
      </div>

      {showNew && <NewVersionForm userId={userId} gross={gross} setGross={setGross} preview={preview} onCreated={() => { setShowNew(false); setGross(""); load(); }} />}

      <table>
        <thead><tr><th>Effective From</th><th>Gross</th><th>Basic</th><th>HRA</th><th>Special Allow.</th><th>Transport</th><th>Statutory Bonus-Others</th><th>PT</th><th>Medical Ins.</th><th>TDS</th><th>Net Salary</th></tr></thead>
        <tbody>
          {data.versions.map((v) => (
            <tr key={v.effectiveFrom}>
              <td>{v.effectiveFrom}</td>
              <td className="amt-gross">₹{v.gross}</td>
              <td className="amt-basic">₹{v.basic}</td>
              <td className="amt-hra">₹{v.hra}</td>
              <td className="amt-allow">₹{v.special || 0}</td>
              <td className="amt-allow">₹{v.transport || 0}</td>
              <td className="amt-others">₹{v.others}</td>
              <td className="amt-deduction">₹{v.pt}</td>
              <td className="amt-deduction">₹{v.medicalAllowance || 0}</td>
              <td className="amt-deduction">₹{v.tds || 0}</td>
              <td className="amt-gross">₹{netSalaryOf(v).toFixed(2)}</td>
            </tr>
          ))}
          {data.versions.length === 0 && <tr><td colSpan={11} className="empty-state">No salary structure yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Reference net salary for a full month, before any attendance-based
// proration — gross minus the flat deductions on that version. The actual
// payslip's net pay can differ (it prorates with payable days).
function netSalaryOf(v) {
  return Number(v.gross || 0) - Number(v.pt || 0) - Number(v.medicalAllowance || 0) - Number(v.tds || 0);
}

const COMPONENT_FIELDS = [
  ["basic", "Basic"],
  ["hra", "HRA"],
  ["special", "Special Allowances (Mobile, Uniform, Maintenance, Internet)"],
  ["transport", "Transportation Allowance"],
];

function NewVersionForm({ userId, gross, setGross, preview, onCreated }) {
  const [form, setForm] = useState({ effectiveFrom: "", pt: 0, medicalAllowance: 0, tds: 0 });
  const [comps, setComps] = useState({ basic: "", hra: "", special: "", transport: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  // Auto-fill every earnings component from the formula whenever the gross
  // changes (the parent debounces the preview request).
  useEffect(() => {
    if (!preview) {
      setComps({ basic: "", hra: "", special: "", transport: "" });
      return;
    }
    setComps({ basic: preview.basic, hra: preview.hra, special: preview.special, transport: preview.transport });
  }, [preview]);

  const grossNum = Number(gross) || 0;
  const componentSum = COMPONENT_FIELDS.reduce((s, [k]) => s + (Number(comps[k]) || 0), 0);
  const others = Math.round((grossNum - componentSum) * 100) / 100;

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (others < 0) return setError("The earnings components add up to more than the gross.");
    setBusy(true);
    try {
      await client.post(`/salary-structures/${userId}`, {
        ...form,
        gross: grossNum,
        components: Object.fromEntries(COMPONENT_FIELDS.map(([k]) => [k, Number(comps[k]) || 0])),
      });
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

      <h4 style={{ margin: "12px 0 0" }}>Earnings</h4>
      <p className="hint-text mt-0">Filled in automatically from the gross using the earnings formula — adjust any of them if needed.</p>
      <div className="form-row" style={{ flexWrap: "wrap" }}>
        {COMPONENT_FIELDS.map(([k, label]) => (
          <div key={k} style={{ flex: "1 1 45%" }}>
            <label>{label}</label>
            <input type="number" min="0" step="0.01" value={comps[k]} onChange={(e) => setComps((c) => ({ ...c, [k]: e.target.value }))} />
          </div>
        ))}
        <div style={{ flex: "1 1 45%" }}>
          <label>Statutory Bonus-Others (remainder of gross)</label>
          <input value={grossNum ? others.toFixed(2) : ""} disabled style={others < 0 ? { borderColor: "var(--danger)" } : undefined} />
        </div>
      </div>

      <h4 style={{ margin: "12px 0 4px" }}>Deductions (enter amounts)</h4>
      <div className="form-row">
        <div><label>PT (flat)</label><input type="number" min="0" step="0.01" value={form.pt} onChange={(e) => set("pt", e.target.value)} /></div>
        <div><label>Medical Insurance (flat)</label><input type="number" min="0" step="0.01" value={form.medicalAllowance} onChange={(e) => set("medicalAllowance", e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div><label>TDS (flat)</label><input type="number" min="0" step="0.01" value={form.tds} onChange={(e) => set("tds", e.target.value)} /></div>
        <div />
      </div>
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
  const isExternal = type === "associate";
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
