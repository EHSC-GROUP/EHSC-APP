import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import StatusBadge from "../../components/StatusBadge";
import DateInput from "../../components/DateInput";
import { Loading, ErrorText } from "../../components/Misc";
import { fmtDate } from "../../lib/dates";

// Personal details a person can correct themselves. Everything the company
// controls (employee ID, designation, department, joining date, official
// email, ESI/UAN) stays read-only.
const EDITABLE = ["fatherOrHusbandName", "dateOfBirth", "anniversaryDate", "gender", "personalEmail", "phone", "address", "emergencyContactName", "emergencyContactPhone"];

export default function MyProfile() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  async function load() {
    try {
      const r = await client.get("/me/profile");
      setProfile(r.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  if (!profile) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const isExternal = profile.type === "associate";
  // The seeded superadmin has no HR profile record, so there is nothing to edit.
  const canEdit = !isExternal && !profile.noHrProfile;

  function startEdit() {
    const f = {};
    for (const k of EDITABLE) f[k] = profile[k] || "";
    setForm(f);
    setError("");
    setSaved("");
    setEditing(true);
  }
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.put("/me/profile", form);
      await load();
      setEditing(false);
      setSaved("Your details were updated.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div>
        <div className="page-header"><h2>Edit HR Details</h2></div>
        <form className="card" onSubmit={save}>
          <p className="hint-text mt-0">
            You can update your personal details here. Your employee ID, designation, department, joining date and
            official email are managed by HR.
          </p>
          <div className="form-row">
            <div><label>Father / Spouse Name</label><input value={form.fatherOrHusbandName} onChange={(e) => set("fatherOrHusbandName", e.target.value)} required /></div>
            <div>
              <label>Gender</label>
              <select value={form.gender} onChange={(e) => set("gender", e.target.value)}>
                <option value="">Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div><label>Birth Date</label><DateInput value={form.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("dateOfBirth", e.target.value)} required /></div>
            <div><label>Anniversary Date (optional)</label><DateInput value={form.anniversaryDate} onChange={(e) => set("anniversaryDate", e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div><label>Personal Email</label><input type="email" value={form.personalEmail} onChange={(e) => set("personalEmail", e.target.value)} /></div>
            <div><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          </div>
          <label>Address</label>
          <textarea rows={3} value={form.address} onChange={(e) => set("address", e.target.value)} />
          <div className="form-row">
            <div><label>Emergency Contact Name</label><input value={form.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} /></div>
            <div><label>Emergency Contact Phone</label><input value={form.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone", e.target.value)} /></div>
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>HR Details</h2>
        {canEdit && <button className="btn-primary" onClick={startEdit}>Edit my details</button>}
      </div>
      {saved && <p className="hint-text" style={{ color: "var(--success)" }}>{saved}</p>}
      <div className="card">
        <div className="toolbar"><StatusBadge status={profile.status} /></div>
        <table>
          <tbody>
            <tr><td>Name</td><td>{profile.name}</td></tr>
            <tr><td>User ID</td><td>{profile.userId}</td></tr>
            {!isExternal && <tr><td>Employee ID</td><td>{profile.employeeId || "-"}</td></tr>}
            {!isExternal && <tr><td>Designation</td><td>{profile.designation || "-"}</td></tr>}
            {!isExternal && <tr><td>Department</td><td>{profile.department || "-"}</td></tr>}
            {!isExternal && <tr><td>Reporting Manager</td><td>{profile.reportingManager || "-"}</td></tr>}
            {!isExternal && <tr><td>Gender</td><td>{profile.gender || "-"}</td></tr>}
            {!isExternal && <tr><td>Father/Spouse Name</td><td>{profile.fatherOrHusbandName || "-"}</td></tr>}
            {!isExternal && <tr><td>Birth Date</td><td>{fmtDate(profile.dateOfBirth) || "-"}</td></tr>}
            {!isExternal && <tr><td>Anniversary Date</td><td>{fmtDate(profile.anniversaryDate) || "-"}</td></tr>}
            {!isExternal && <tr><td>Date of Joining</td><td>{fmtDate(profile.dateOfJoining) || "-"}</td></tr>}
            {!isExternal && <tr><td>Professional Email</td><td>{profile.professionalEmail || "-"}</td></tr>}
            {!isExternal && <tr><td>Personal Email</td><td>{profile.personalEmail || "-"}</td></tr>}
            {isExternal && <tr><td>Email</td><td>{profile.email || "-"}</td></tr>}
            <tr><td>Phone</td><td>{profile.phone || "-"}</td></tr>
            <tr><td>Address</td><td style={{ whiteSpace: "pre-wrap" }}>{profile.address || "-"}</td></tr>
            {!isExternal && <tr><td>Emergency Contact</td><td>{profile.emergencyContactName || "-"}{profile.emergencyContactPhone ? ` · ${profile.emergencyContactPhone}` : ""}</td></tr>}
            <tr><td>ESI Number</td><td>{profile.esiNumber || "-"}</td></tr>
            <tr><td>UAN</td><td>{profile.uan || "-"}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
