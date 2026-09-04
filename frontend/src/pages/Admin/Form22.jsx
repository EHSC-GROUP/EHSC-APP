import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import { ErrorText } from "../../components/Misc";
import { openAuthedFile } from "../../lib/openFile";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Form22() {
  const [month, setMonth] = useState(currentMonth());
  const [mode, setMode] = useState("all");
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    client.get("/profiles").then((r) => setProfiles(r.data.filter((p) => p.type === "employee"))).catch((err) => setError(errorMessage(err)));
  }, []);

  function toggle(userId) {
    setSelected((set) => {
      const next = new Set(set);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  async function download() {
    if (mode === "selected" && selected.size === 0) {
      setError("Select at least one employee");
      return;
    }
    setError("");
    const params = new URLSearchParams({ period: month });
    if (mode === "selected") params.set("userIds", [...selected].join(","));
    try {
      await openAuthedFile(`/api/form22/export?${params.toString()}`, { download: true, filename: `Form22_${month}.pdf` });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="page-header"><h2>Statutory Register (Form 22)</h2></div>
      <p className="hint-text">Karnataka Muster Roll cum Register of Wages — reuses the exact same payroll computation as the payslip for the period.</p>

      <div className="card">
        <div className="form-row">
          <div><label>Wage Period</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <div>
            <label>Employees</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="all">All Employees</option>
              <option value="selected">Selected Employees</option>
            </select>
          </div>
        </div>

        {mode === "selected" && (
          <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10 }}>
            {profiles.map((p) => (
              <label key={p.userId} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={selected.has(p.userId)} onChange={() => toggle(p.userId)} />
                {p.name} <span className="text-muted">({p.userId})</span>
              </label>
            ))}
          </div>
        )}

        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 16 }} onClick={download}>Download PDF</button>
      </div>
    </div>
  );
}
