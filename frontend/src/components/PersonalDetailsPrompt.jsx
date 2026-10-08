import { useEffect, useState } from "react";
import client, { errorMessage } from "../api/client";
import DateInput from "./DateInput";
import Modal from "./Modal";
import { ErrorText } from "./Misc";

// A banner that stays at the top until the employee has filled in the three
// personal details HR needs: father / spouse name, birth date, and (optional)
// anniversary date. Renders nothing for anyone without an HR profile
// (e.g. the bootstrap superadmin) or once the details are complete.
export default function PersonalDetailsPrompt() {
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fatherOrHusbandName: "", dateOfBirth: "", anniversaryDate: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get("/me/profile").then((r) => {
      setProfile(r.data);
      setForm({
        fatherOrHusbandName: r.data.fatherOrHusbandName || "",
        dateOfBirth: r.data.dateOfBirth || "",
        anniversaryDate: r.data.anniversaryDate || "",
      });
    }).catch(() => {});
  }, []);

  if (!profile || profile.type === "associate" || profile.noHrProfile) return null;
  if (profile.fatherOrHusbandName && profile.dateOfBirth) return null;

  async function save(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.put("/me/personal-details", form);
      setProfile((p) => ({ ...p, ...form }));
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card" style={{ background: "#fef3c7", border: "1px solid #fcd34d", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 20 }}>🔔</span>
        <div style={{ flex: "1 1 260px" }}>
          <strong>Please complete your details</strong>
          <div className="hint-text mt-0">HR needs your father / spouse name and your birth date. Anniversary date is optional.</div>
        </div>
        <button className="btn-primary" onClick={() => setOpen(true)}>Fill now</button>
      </div>
      {open && (
        <Modal title="Your personal details" onClose={() => setOpen(false)}>
          <form onSubmit={save}>
            <label>Father / Spouse Name</label>
            <input value={form.fatherOrHusbandName} onChange={(e) => setForm((f) => ({ ...f, fatherOrHusbandName: e.target.value }))} required />
            <label>Birth Date</label>
            <DateInput value={form.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))} required />
            <label>Anniversary Date <span className="hint-text">(optional)</span></label>
            <DateInput value={form.anniversaryDate} onChange={(e) => setForm((f) => ({ ...f, anniversaryDate: e.target.value }))} />
            <ErrorText>{error}</ErrorText>
            <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving..." : "Save"}</button>
          </form>
        </Modal>
      )}
    </>
  );
}
