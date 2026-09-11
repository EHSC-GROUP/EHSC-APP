import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import Drawer from "../../components/Drawer";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";
import CompanyProfileEditor from "../../components/CompanyProfileEditor";

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
    return !q || [p.clientName, p.poNumber, p.contactPersonName].some((v) => (v || "").toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="page-header">
        <h2>Company Profiles</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Company Profile</button>
      </div>
      <p className="hint-text">
        Created automatically alongside every Business Development enquiry — tracks the client through proposal,
        work order, and execution. Use "New Company Profile" here only for a client with no enquiry history, or to
        backfill an older enquiry.
      </p>

      <div className="toolbar">
        <input style={{ maxWidth: 280 }} placeholder="Search client, PO number, contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Client / Company</th><th>PO Number</th><th>PO Value</th><th>Delivery Due Date</th><th>Contact Person</th><th>Source Enquiry</th></tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setSelected(p.id)}>
                  <td>{p.clientName}</td>
                  <td>{p.poNumber || "-"}</td>
                  <td>{p.poValue ?? "-"}</td>
                  <td>{p.deliveryDueDate || "-"}</td>
                  <td>{p.contactPersonName || "-"}</td>
                  <td>{p.sourceEnquiryNo || "-"}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} className="empty-state">No company profiles yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateCompanyProfileModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {selected && <CompanyProfileDrawer id={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}

const emptyForm = {
  clientName: "", address: "", contactPersonName: "", contactPhone: "",
  poNumber: "", poValue: "", deliveryDueDate: "", termsAndConditions: "",
};

function CreateCompanyProfileModal({ onClose, onCreated }) {
  const [enquiriesWithoutProfile, setEnquiriesWithoutProfile] = useState([]);
  const [selectedEnquiryId, setSelectedEnquiryId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Every enquiry gets a profile automatically now, so this dropdown only
    // needs to offer enquiries that predate that (i.e. don't have one yet).
    Promise.all([client.get("/business-development"), client.get("/company-profiles")]).then(([e, p]) => {
      const linkedIds = new Set(p.data.map((x) => x.sourceEnquiryId).filter(Boolean));
      setEnquiriesWithoutProfile(e.data.filter((x) => !linkedIds.has(x.id)));
    }).catch(() => {});
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function importFrom(enquiryId) {
    setSelectedEnquiryId(enquiryId);
    if (!enquiryId) return;
    const e = enquiriesWithoutProfile.find((x) => x.id === enquiryId);
    if (!e) return;
    setForm((f) => ({
      ...f,
      clientName: e.clientName || "",
      address: e.address || "",
      contactPersonName: e.approachedByName || "",
      contactPhone: e.contactPhone || "",
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const enquiry = enquiriesWithoutProfile.find((x) => x.id === selectedEnquiryId);
      await client.post("/company-profiles", {
        ...form,
        sourceEnquiryId: enquiry?.id || null,
        sourceEnquiryNo: enquiry?.enquiryNo || null,
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New Company Profile" onClose={onClose} wide>
      {enquiriesWithoutProfile.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <label>Import from an older Enquiry (optional)</label>
          <select value={selectedEnquiryId} onChange={(e) => importFrom(e.target.value)}>
            <option value="">Select an enquiry to auto-fill company/contact details…</option>
            {enquiriesWithoutProfile.map((e) => (
              <option key={e.id} value={e.id}>{e.enquiryNo} — {e.clientName} ({e.approachedByName})</option>
            ))}
          </select>
          <p className="hint-text mt-0">Fills Client Name, Address, Contact Person and Contact Phone below — all remain editable.</p>
        </div>
      )}

      <form onSubmit={submit}>
        <div className="form-row">
          <div><label>Client / Company Name</label><input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} required /></div>
          <div><label>Address</label><input value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div><label>Contact Person Name</label><input value={form.contactPersonName} onChange={(e) => set("contactPersonName", e.target.value)} /></div>
          <div><label>Contact Phone</label><input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div><label>PO Number</label><input value={form.poNumber} onChange={(e) => set("poNumber", e.target.value)} /></div>
          <div><label>PO Value</label><input type="number" min="0" step="0.01" value={form.poValue} onChange={(e) => set("poValue", e.target.value)} /></div>
          <div><label>Delivery Due Date</label><input type="date" value={form.deliveryDueDate} onChange={(e) => set("deliveryDueDate", e.target.value)} /></div>
        </div>
        <label>Terms and Conditions</label>
        <textarea rows={4} value={form.termsAndConditions} onChange={(e) => set("termsAndConditions", e.target.value)} />

        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? "Saving…" : "Create Company Profile"}</button>
      </form>
    </Modal>
  );
}

function CompanyProfileDrawer({ id, onClose, onChanged }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const { data } = await client.get(`/company-profiles/${id}`);
      setProfile(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [id]);

  async function remove() {
    try {
      await client.delete(`/company-profiles/${id}`);
      onClose();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Drawer onClose={onClose}>
      {!profile ? (
        error ? <ErrorText>{error}</ErrorText> : <Loading />
      ) : (
        <>
          <div className="modal-header">
            <h3>{profile.clientName}</h3>
            <button className="btn-sm" onClick={onClose}>Close</button>
          </div>
          <CompanyProfileEditor profile={profile} onChanged={() => { load(); onChanged(); }} showPhase2={false} />
          <div className="toolbar" style={{ marginTop: 16 }}>
            <ConfirmButton className="btn-sm btn-danger" onConfirm={remove} confirmText="Delete this company profile permanently?">Delete Profile</ConfirmButton>
          </div>
        </>
      )}
    </Drawer>
  );
}
