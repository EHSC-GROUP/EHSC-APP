import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";
import { useFeatureFlags } from "../../context/FeatureFlagsContext";

export default function Settings() {
  const { refresh: refreshFlags } = useFeatureFlags();
  const [formula, setFormula] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState("");
  const [flags, setFlags] = useState(null);
  const [flagsError, setFlagsError] = useState("");
  const [flagsBusy, setFlagsBusy] = useState(false);

  async function load() {
    try {
      const { data } = await client.get("/settings/earnings-formula");
      setFormula(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

  async function loadFlags() {
    try {
      const { data } = await client.get("/settings/feature-flags");
      setFlags(data);
    } catch (err) {
      setFlagsError(errorMessage(err));
    }
  }
  useEffect(() => { loadFlags(); }, []);

  async function toggleFlag(name) {
    setFlagsBusy(true);
    setFlagsError("");
    try {
      const { data } = await client.put("/settings/feature-flags", { [name]: !flags[name] });
      setFlags(data);
      refreshFlags();
    } catch (err) {
      setFlagsError(errorMessage(err));
    } finally {
      setFlagsBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.put("/settings/earnings-formula", formula);
      alert("Saved. New salary structure versions will use this formula.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    setBusy(true);
    setResetMsg("");
    try {
      const { data } = await client.post("/salary-structures/reset-all");
      setResetMsg(`Recomputed all earnings components for ${data.employeesUpdated} employees using the current formula.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header"><h2>Settings</h2></div>

      <div className="card">
        <h3 className="mt-0">Feature Flags</h3>
        <p className="hint-text mt-0">
          Features held back until they're ready to switch on — stays off across every restart and every
          deployment (including going live) until you flip it here yourself.
        </p>
        {!flags ? <Loading /> : (
          <>
            <div className="toolbar" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>Project Management Module</strong>
                <div className="hint-text mt-0">
                  Business Development, Company Profiles and Project Tracker — the whole PM suite. Off for the
                  HR/Payroll go-live; switch it back on here whenever it's needed again.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={`badge-pill ${flags.projectManagement ? "badge-APPROVED" : "badge-CANCELLED"}`}>
                  {flags.projectManagement ? "Enabled" : "Disabled"}
                </span>
                <button className="btn-sm" disabled={flagsBusy} onClick={() => toggleFlag("projectManagement")}>
                  {flagsBusy ? "Saving…" : flags.projectManagement ? "Disable" : "Enable"}
                </button>
              </div>
            </div>
            <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 14 }}>
              <div>
                <strong>Project-wise Reimbursement Costing</strong>
                <div className="hint-text mt-0">
                  Lets a reimbursement claim be linked to a project, and adds a "Costing" tab on each project
                  showing the running total spent. Needs Project Management finalized and live first.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={`badge-pill ${flags.projectCosting ? "badge-APPROVED" : "badge-CANCELLED"}`}>
                  {flags.projectCosting ? "Enabled" : "Disabled"}
                </span>
                <button className="btn-sm" disabled={flagsBusy} onClick={() => toggleFlag("projectCosting")}>
                  {flagsBusy ? "Saving…" : flags.projectCosting ? "Disable" : "Enable"}
                </button>
              </div>
            </div>
          </>
        )}
        <ErrorText>{flagsError}</ErrorText>
      </div>

      <div className="card">
        <h3 className="mt-0">Earnings Formula</h3>
        <p className="hint-text mt-0">
          Basic = Gross × Basic%. HRA, Transportation Allowance and Special Allowance are each a
          percent of <strong>Basic</strong> (not of gross). Anything left over of gross shows as "Statutory Bonus-Others".
        </p>
        {!formula ? <Loading /> : (
          <form onSubmit={save}>
            <div className="form-row">
              <div><label>Basic % (of Gross)</label><input type="number" min="0" max="100" step="0.01" value={formula.basicPercent} onChange={(e) => setFormula({ ...formula, basicPercent: Number(e.target.value) })} /></div>
              <div><label>HRA % (of Basic)</label><input type="number" min="0" step="0.01" value={formula.hraPercent} onChange={(e) => setFormula({ ...formula, hraPercent: Number(e.target.value) })} /></div>
            </div>
            <div className="form-row">
              <div><label>Transportation Allowance % (of Basic)</label><input type="number" min="0" step="0.01" value={formula.transportPercent} onChange={(e) => setFormula({ ...formula, transportPercent: Number(e.target.value) })} /></div>
              <div><label>Special Allowance % (of Basic)</label><input type="number" min="0" step="0.01" value={formula.specialPercent} onChange={(e) => setFormula({ ...formula, specialPercent: Number(e.target.value) })} /></div>
            </div>
            <ErrorText>{error}</ErrorText>
            <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </form>
        )}
      </div>

      <div className="card">
        <h3 className="mt-0">Bulk Reset Salary Structures</h3>
        <p className="hint-text mt-0">
          Recomputes every earnings component (Basic, HRA, Transportation, Special, Statutory Bonus-Others) for every existing salary structure version using the current formula above.
          This is irreversible and does not touch already-generated payslips (each snapshots its own numbers).
        </p>
        <ConfirmButton
          className="btn-danger"
          confirmText="This will overwrite the earnings split on every employee's salary structure history. Continue?"
          onConfirm={resetAll}
          disabled={busy}
        >
          Reset All Salary Structures
        </ConfirmButton>
        {resetMsg && <p className="hint-text">{resetMsg}</p>}
      </div>
    </div>
  );
}
