import { useEffect, useState } from "react";
import client, { errorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { numberToWords } from "../lib/numberToWords";
import { ErrorText } from "./Misc";

const emptyTravelItem = () => ({ fromDate: "", fromPlace: "", toDate: "", toPlace: "", mode: "", fare: "" });
const emptyConveyanceItem = () => ({ date: "", from: "", to: "", mode: "", fare: "" });
const emptyOtherItem = () => ({ date: "", details: "", amount: "" });
const emptyProject = () => ({ projectId: "", amountSpent: "" });

// Cash advances are requested from the Advances tab now, not filed as a claim type.
const TYPE_OPTIONS = [
  { value: "GENERAL", label: "General" },
  { value: "TRAVEL", label: "Travel" },
  { value: "ACCOMMODATION", label: "Accommodation" },
];

// One Reimbursement Claim Form (RCF) — mirrors the paper form: header
// details, then Section A (outstation travel), B (local conveyance) and C
// (any other expense), the project(s) the money was spent on, and the bills.
export default function VoucherForm({ requireBill, onSubmitted }) {
  const { user } = useAuth();
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidTo, setPaidTo] = useState("");
  const [type, setType] = useState("GENERAL");
  const [journeyPurpose, setJourneyPurpose] = useState("");
  const [journeyStation, setJourneyStation] = useState("");

  const [projects, setProjects] = useState([emptyProject()]);
  const [projectPicklist, setProjectPicklist] = useState(null);
  const [costingEnabled, setCostingEnabled] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);

  const [travelItems, setTravelItems] = useState([]);
  const [conveyanceItems, setConveyanceItems] = useState([]);
  const [otherItems, setOtherItems] = useState([emptyOtherItem()]);

  const [bills, setBills] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Until Project Management is live (feature flag off) a project is just a
  // typed Project ID; once it's switched on this becomes a dropdown.
  useEffect(() => {
    client.get("/settings/feature-flags")
      .then(({ data }) => {
        setCostingEnabled(!!data.projectCosting);
        if (data.projectCosting) {
          client.get("/projects/picklist").then(({ data }) => setProjectPicklist(data)).catch(() => setProjectPicklist([]));
        }
      })
      .catch(() => setCostingEnabled(false));
  }, []);

  useEffect(() => {
    if (!user?.userId) return;
    client.get(`/advances/wallet/${user.userId}`).then(({ data }) => setWalletBalance(data.balance || 0)).catch(() => {});
  }, [user?.userId]);

  function updateRow(setter, i, field, value) {
    setter((list) => list.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }

  const travelTotal = travelItems.reduce((s, i) => s + (Number(i.fare) || 0), 0);
  const conveyanceTotal = conveyanceItems.reduce((s, i) => s + (Number(i.fare) || 0), 0);
  const otherTotal = otherItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const total = travelTotal + conveyanceTotal + otherTotal;

  const namedProjects = projects.filter((p) => p.projectId.trim());
  const splitting = projects.length > 1;
  const allocated = projects.reduce((s, p) => s + (Number(p.amountSpent) || 0), 0);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (requireBill && bills.length === 0) return setError("At least one bill copy is required");

    const validTravel = travelItems.filter((i) => i.fromDate && i.fromPlace && i.toDate && i.toPlace && Number(i.fare) > 0);
    const validConveyance = conveyanceItems.filter((i) => i.date && i.from && i.to && Number(i.fare) > 0);
    const validOther = otherItems.filter((i) => i.date && i.details && Number(i.amount) > 0);
    if (validTravel.length === 0 && validConveyance.length === 0 && validOther.length === 0) {
      return setError("At least one expense item (Travelling, Conveyance or Other) is required");
    }
    if (splitting) {
      if (namedProjects.length !== projects.length) return setError("Enter a Project ID on every project row (or remove the empty ones)");
      if (Math.abs(allocated - total) > 0.01) {
        return setError(`Project amounts add up to ₹${allocated.toFixed(2)} but the voucher total is ₹${total.toFixed(2)}`);
      }
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append("voucherDate", voucherDate);
      form.append("paidTo", paidTo);
      form.append("type", type);
      if (journeyPurpose) form.append("journeyPurpose", journeyPurpose);
      if (journeyStation) form.append("journeyStation", journeyStation);
      form.append("projects", JSON.stringify(namedProjects.map((p) => ({ projectId: p.projectId.trim(), amountSpent: splitting ? Number(p.amountSpent) : undefined }))));
      form.append("travelItems", JSON.stringify(validTravel));
      form.append("conveyanceItems", JSON.stringify(validConveyance));
      form.append("otherItems", JSON.stringify(validOther));
      bills.forEach((b) => form.append("bills", b));
      await client.post("/reimbursements", form);
      onSubmitted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {walletBalance > 0 && (
        <p className="hint-text" style={{ background: "#eff6ff", padding: "8px 12px", borderRadius: 8 }}>
          You hold an unspent advance of <strong>₹{walletBalance.toFixed(2)}</strong>. Once approved, this voucher is deducted
          from it first — you're only paid out for whatever exceeds it.
        </p>
      )}

      <div className="form-row">
        <div><label>Journey / Voucher Date</label><input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} required /></div>
        <div><label>Paid To</label><input value={paidTo} onChange={(e) => setPaidTo(e.target.value)} required /></div>
      </div>

      <div className="form-row">
        <div>
          <label>Claim Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div><label>Journey Station</label><input value={journeyStation} onChange={(e) => setJourneyStation(e.target.value)} placeholder="Optional" /></div>
      </div>
      <label>Journey Purpose</label>
      <input value={journeyPurpose} onChange={(e) => setJourneyPurpose(e.target.value)} placeholder="Optional" />

      <ItemSection
        title="A. Travelling Expenses (outstation travel)"
        items={travelItems}
        onAdd={() => setTravelItems((l) => [...l, emptyTravelItem()])}
        onRemove={(i) => setTravelItems((l) => l.filter((_, idx) => idx !== i))}
        total={travelTotal}
        render={(item, i) => (
          <>
            <div style={{ flex: "0 0 150px" }}><input type="date" value={item.fromDate} onChange={(e) => updateRow(setTravelItems, i, "fromDate", e.target.value)} title="From Date" /></div>
            <div style={{ flex: "1 1 140px" }}><input value={item.fromPlace} onChange={(e) => updateRow(setTravelItems, i, "fromPlace", e.target.value)} placeholder="From Place" /></div>
            <div style={{ flex: "0 0 150px" }}><input type="date" value={item.toDate} onChange={(e) => updateRow(setTravelItems, i, "toDate", e.target.value)} title="To Date" /></div>
            <div style={{ flex: "1 1 140px" }}><input value={item.toPlace} onChange={(e) => updateRow(setTravelItems, i, "toPlace", e.target.value)} placeholder="To Place" /></div>
            <div style={{ flex: "1 1 100px" }}><input value={item.mode} onChange={(e) => updateRow(setTravelItems, i, "mode", e.target.value)} placeholder="Mode" /></div>
            <div style={{ flex: "0 0 100px" }}><input type="number" min="0" step="0.01" value={item.fare} onChange={(e) => updateRow(setTravelItems, i, "fare", e.target.value)} placeholder="Fare" /></div>
          </>
        )}
      />

      <ItemSection
        title="B. Conveyance Expenses (local travel)"
        items={conveyanceItems}
        onAdd={() => setConveyanceItems((l) => [...l, emptyConveyanceItem()])}
        onRemove={(i) => setConveyanceItems((l) => l.filter((_, idx) => idx !== i))}
        total={conveyanceTotal}
        render={(item, i) => (
          <>
            <div style={{ flex: "0 0 150px" }}><input type="date" value={item.date} onChange={(e) => updateRow(setConveyanceItems, i, "date", e.target.value)} title="Date" /></div>
            <div style={{ flex: "1 1 140px" }}><input value={item.from} onChange={(e) => updateRow(setConveyanceItems, i, "from", e.target.value)} placeholder="From" /></div>
            <div style={{ flex: "1 1 140px" }}><input value={item.to} onChange={(e) => updateRow(setConveyanceItems, i, "to", e.target.value)} placeholder="To" /></div>
            <div style={{ flex: "1 1 100px" }}><input value={item.mode} onChange={(e) => updateRow(setConveyanceItems, i, "mode", e.target.value)} placeholder="Mode" /></div>
            <div style={{ flex: "0 0 100px" }}><input type="number" min="0" step="0.01" value={item.fare} onChange={(e) => updateRow(setConveyanceItems, i, "fare", e.target.value)} placeholder="Fare" /></div>
          </>
        )}
      />

      <ItemSection
        title="C. Any Other Expenses (food bills, other office-related expenses)"
        items={otherItems}
        onAdd={() => setOtherItems((l) => [...l, emptyOtherItem()])}
        onRemove={(i) => setOtherItems((l) => l.filter((_, idx) => idx !== i))}
        total={otherTotal}
        render={(item, i) => (
          <>
            <div style={{ flex: "0 0 150px" }}><input type="date" value={item.date} onChange={(e) => updateRow(setOtherItems, i, "date", e.target.value)} title="Date" /></div>
            <div style={{ flex: "1 1 180px" }}><input value={item.details} onChange={(e) => updateRow(setOtherItems, i, "details", e.target.value)} placeholder="Details" /></div>
            <div style={{ flex: "0 0 110px" }}><input type="number" min="0" step="0.01" value={item.amount} onChange={(e) => updateRow(setOtherItems, i, "amount", e.target.value)} placeholder="Amount" /></div>
          </>
        )}
      />

      <p style={{ marginTop: 16 }}><strong>Total Expenses (A+B+C): ₹{total.toFixed(2)}</strong></p>
      <p className="hint-text mt-0">{numberToWords(total)}</p>

      <div style={{ marginTop: 16 }}>
        <label>Project(s) (optional)</label>
        {projects.map((p, i) => (
          <div className="form-row" key={i} style={{ marginBottom: 6, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              {costingEnabled ? (
                <select value={p.projectId} onChange={(e) => updateRow(setProjects, i, "projectId", e.target.value)}>
                  <option value="">— Select project —</option>
                  {(projectPicklist || []).map((pr) => <option key={pr.id} value={pr.projectId}>{pr.projectId} — {pr.clientName}</option>)}
                </select>
              ) : (
                <input value={p.projectId} onChange={(e) => updateRow(setProjects, i, "projectId", e.target.value)} placeholder="Project ID (e.g. PRJ150001)" />
              )}
            </div>
            {splitting && (
              <div style={{ flex: "0 0 160px" }}>
                <input type="number" min="0" step="0.01" value={p.amountSpent} onChange={(e) => updateRow(setProjects, i, "amountSpent", e.target.value)} placeholder="Money spent on this project" />
              </div>
            )}
            {projects.length > 1 && (
              <button type="button" className="btn-sm" onClick={() => setProjects((l) => l.filter((_, idx) => idx !== i))}>&times;</button>
            )}
          </div>
        ))}
        <div className="toolbar" style={{ margin: 0 }}>
          <button type="button" className="btn-sm" onClick={() => setProjects((l) => [...l, emptyProject()])}>+ Add Project</button>
          <div className="spacer" />
          {splitting ? (
            <span className="hint-text" style={{ color: Math.abs(allocated - total) > 0.01 ? "var(--danger, #b91c1c)" : undefined }}>
              Allocated ₹{allocated.toFixed(2)} of ₹{total.toFixed(2)}
            </span>
          ) : namedProjects.length === 1 ? (
            <span className="hint-text">The full ₹{total.toFixed(2)} counts as spent on this project.</span>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label>Bill Copies {requireBill ? "(at least one required)" : "(optional)"} — you can attach several</label>
        <input
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          onChange={(e) => setBills(Array.from(e.target.files))}
          required={requireBill}
        />
        {bills.length > 0 && <p className="hint-text mt-0">{bills.length} file{bills.length > 1 ? "s" : ""}: {bills.map((b) => b.name).join(", ")}</p>}
      </div>

      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? "Submitting…" : "Submit"}</button>
    </form>
  );
}

function ItemSection({ title, items, onAdd, onRemove, total, render }) {
  return (
    <div style={{ marginTop: 16 }}>
      <label>{title}</label>
      {items.map((item, i) => (
        <div className="form-row" key={i} style={{ marginBottom: 6, flexWrap: "wrap" }}>
          {render(item, i)}
          <button type="button" className="btn-sm" onClick={() => onRemove(i)}>&times;</button>
        </div>
      ))}
      <div className="toolbar" style={{ margin: 0 }}>
        <button type="button" className="btn-sm" onClick={onAdd}>+ Add Row</button>
        <div className="spacer" />
        <span className="hint-text">Section total: ₹{total.toFixed(2)}</span>
      </div>
    </div>
  );
}
