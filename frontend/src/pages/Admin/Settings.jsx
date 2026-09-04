import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";

export default function Settings() {
  const [formula, setFormula] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState("");

  async function load() {
    try {
      const { data } = await client.get("/settings/earnings-formula");
      setFormula(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, []);

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
      setResetMsg(`Recomputed Basic/HRA/Others for ${data.employeesUpdated} employees using the current formula.`);
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
        <h3 className="mt-0">Earnings Formula</h3>
        <p className="hint-text mt-0">Basic = Gross × Basic%. HRA = Basic × HRA% (a percent of a percent, not of gross).</p>
        {!formula ? <Loading /> : (
          <form onSubmit={save}>
            <div className="form-row">
              <div><label>Basic %</label><input type="number" min="0" max="100" step="0.01" value={formula.basicPercent} onChange={(e) => setFormula({ ...formula, basicPercent: Number(e.target.value) })} /></div>
              <div><label>HRA % (of Basic)</label><input type="number" min="0" step="0.01" value={formula.hraPercent} onChange={(e) => setFormula({ ...formula, hraPercent: Number(e.target.value) })} /></div>
            </div>
            <ErrorText>{error}</ErrorText>
            <button className="btn-primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </form>
        )}
      </div>

      <div className="card">
        <h3 className="mt-0">Bulk Reset Salary Structures</h3>
        <p className="hint-text mt-0">
          Recomputes Basic/HRA/Others for every existing salary structure version using the current formula above.
          This is irreversible and does not touch already-generated payslips (each snapshots its own numbers).
        </p>
        <ConfirmButton
          className="btn-danger"
          confirmText="This will overwrite Basic/HRA/Others on every employee's salary structure history. Continue?"
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
