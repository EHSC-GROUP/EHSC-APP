import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";
import { useFeatureFlags } from "../../context/FeatureFlagsContext";
import { useProjectClassification } from "../../lib/useProjectClassification";


// Editable per-project-type starter task list for the Project Plan —
// applied automatically the moment a project's contract is confirmed
// ("Responded in favour" ticked), but only into a still-empty plan.
function ProjectPlanTemplatesCard() {
  const { catalog } = useProjectClassification();
  const typeOptions = catalog?.allTypes || [];
  const [templates, setTemplates] = useState(null);
  const [type, setType] = useState("GHG");
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  async function load() {
    try {
      const { data } = await client.get("/settings/project-plan-templates");
      setTemplates(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (templates) setTasks(templates[type] || []); }, [type, templates]);

  function updateTask(i, field, value) {
    setTasks((list) => list.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)));
  }
  function addTask() { setTasks((list) => [...list, { description: "", dayOffset: 0, stage: "" }]); }
  function removeTask(i) { setTasks((list) => list.filter((_, idx) => idx !== i)); }

  async function save() {
    setError("");
    setSavedMsg("");
    setBusy(true);
    try {
      const { data } = await client.put("/settings/project-plan-templates", { [type]: tasks });
      setTemplates(data);
      setSavedMsg(`Saved — new "${type}" projects will use this task list once their contract is confirmed.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 className="mt-0">Project Plan Templates</h3>
      <p className="hint-text mt-0">
        Once a project's enquiry is confirmed (Responded in favour, on the Conversation Stage tab), its Project
        Plan is auto-filled from the template below matching its Project Type — only if the Project Plan is still
        empty, so it never overwrites a plan someone already built by hand. Due dates are set this many days after
        the date it's confirmed. Tag a task to an Invoice Stage (optional) and, once every task tagged with that
        stage is checked off in the Project Plan, that stage auto-completes and the superadmin is notified to
        raise the invoice — no need to mark it manually.
      </p>
      {!templates ? <Loading /> : (
        <>
          <label>Project Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          {tasks.map((t, i) => (
            <div key={i} className="form-row" style={{ marginTop: 8, alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 320px" }}>
                <label className="hint-text mt-0">Task Description</label>
                <input value={t.description} onChange={(e) => updateTask(i, "description", e.target.value)} />
              </div>
              <div style={{ flex: "0 0 140px" }}>
                <label className="hint-text mt-0">Days After Confirmed</label>
                <input type="number" min="0" step="1" value={t.dayOffset} onChange={(e) => updateTask(i, "dayOffset", Number(e.target.value))} />
              </div>
              <div style={{ flex: "0 0 120px" }}>
                <label className="hint-text mt-0">Invoice Stage</label>
                <select value={t.stage ?? ""} onChange={(e) => updateTask(i, "stage", e.target.value ? Number(e.target.value) : "")}>
                  <option value="">None</option>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Stage {n}</option>)}
                </select>
              </div>
              <button type="button" className="btn-sm btn-danger" onClick={() => removeTask(i)}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn-sm" style={{ marginTop: 8 }} onClick={addTask}>+ Add Task</button>

          <ErrorText>{error}</ErrorText>
          {savedMsg && <p className="hint-text">{savedMsg}</p>}
          <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </>
      )}
    </div>
  );
}

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

      {flags?.projectManagement && <ProjectPlanTemplatesCard />}

      <div className="card">
        <h3 className="mt-0">Earnings Formula</h3>
        <p className="hint-text mt-0">
          Basic, HRA, Special Allowances and Transportation Allowance are each a percent of <strong>Gross</strong>.
          Anything left over of gross shows as "Statutory Bonus-Others".
        </p>
        {!formula ? <Loading /> : (
          <form onSubmit={save}>
            <div className="form-row">
              <div><label>Basic % (of Gross)</label><input type="number" min="0" max="100" step="0.01" value={formula.basicPercent} onChange={(e) => setFormula({ ...formula, basicPercent: Number(e.target.value) })} /></div>
              <div><label>HRA % (of Gross)</label><input type="number" min="0" step="0.01" value={formula.hraPercent} onChange={(e) => setFormula({ ...formula, hraPercent: Number(e.target.value) })} /></div>
            </div>
            <div className="form-row">
              <div><label>Special Allowances % (of Gross)</label><input type="number" min="0" step="0.01" value={formula.specialPercent} onChange={(e) => setFormula({ ...formula, specialPercent: Number(e.target.value) })} /></div>
              <div><label>Transportation Allowance % (of Gross)</label><input type="number" min="0" step="0.01" value={formula.transportPercent} onChange={(e) => setFormula({ ...formula, transportPercent: Number(e.target.value) })} /></div>
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
