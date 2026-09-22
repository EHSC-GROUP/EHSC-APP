import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import { Loading, ErrorText } from "../../components/Misc";
import { openAuthedFile } from "../../lib/openFile";

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftPeriod(period, delta) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Every YYYY-MM from `from` through `to`, inclusive.
function periodsBetween(from, to) {
  const out = [];
  for (let p = from; p <= to; p = shiftPeriod(p, 1)) out.push(p);
  return out;
}

export default function Payslips() {
  const [rangeMode, setRangeMode] = useState("1");
  const [customFrom, setCustomFrom] = useState(currentPeriod());
  const [customTo, setCustomTo] = useState(currentPeriod());
  const [period, setPeriod] = useState(currentPeriod());
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [genResult, setGenResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    setError("");
    try {
      const { data } = await client.get("/payslips", { params: { period } });
      setList(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => { load(); }, [period]);

  // Periods to generate: the selected month only, the last 3 or 6 months
  // ending at the selected month, or an explicit custom from-to range.
  function periodsToGenerate() {
    if (rangeMode === "custom") return periodsBetween(customFrom, customTo);
    const n = Number(rangeMode);
    return periodsBetween(shiftPeriod(period, -(n - 1)), period);
  }

  async function generateAll() {
    const periods = periodsToGenerate();
    if (periods.length === 0) return setError("The 'from' month must not be after the 'to' month.");
    if (periods.length > 24) return setError("Please pick a range of 24 months or fewer.");
    setBusy(true);
    setGenResult(null);
    setError("");
    try {
      const generated = [];
      const skipped = [];
      for (const p of periods) {
        const { data } = await client.post("/payslips/generate", { period: p });
        data.generated.forEach((u) => generated.push(`${u} (${p})`));
        data.skipped.forEach((x) => skipped.push({ userId: `${x.userId} (${p})`, reason: x.reason }));
      }
      setGenResult({ generated, skipped, periods });
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function generateOne(userId) {
    setBusy(true);
    try {
      await client.post("/payslips/generate", { period, userIds: [userId] });
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function action(userId, verb) {
    try {
      await client.post(`/payslips/${userId}/${period}/${verb}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(userId) {
    if (!window.confirm("Delete this payslip?")) return;
    try {
      await client.delete(`/payslips/${userId}/${period}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function exportExcel() {
    try {
      await openAuthedFile(`/api/payslips/excel/export?period=${period}`, {
        download: true,
        filename: `Payroll_Register_${period}.xlsx`,
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function viewPdf(userId) {
    try {
      await openAuthedFile(`/api/payslips/${userId}/${period}/pdf`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Payslips</h2>
        <div className="toolbar">
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <select value={rangeMode} onChange={(e) => setRangeMode(e.target.value)} style={{ width: 150 }}>
            <option value="1">This month</option>
            <option value="3">Last 3 months</option>
            <option value="6">Last 6 months</option>
            <option value="custom">Custom range</option>
          </select>
          {rangeMode === "custom" && (
            <>
              <label style={{ margin: 0 }}>From</label>
              <input type="month" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <label style={{ margin: 0 }}>To</label>
              <input type="month" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </>
          )}
          <button className="btn-primary" onClick={generateAll} disabled={busy}>{busy ? "Generating…" : "Generate for All"}</button>
          <button onClick={exportExcel}>Export Excel</button>
        </div>
      </div>

      {genResult && (
        <div className="card">
          <strong>Generated:</strong> {genResult.generated.length}
          {genResult.periods && genResult.periods.length > 1 && ` across ${genResult.periods.length} months (${genResult.periods[0]} to ${genResult.periods[genResult.periods.length - 1]})`}
          {genResult.skipped.length > 0 && (
            <div>
              <strong>Skipped:</strong>
              <ul>
                {genResult.skipped.map((s) => <li key={s.userId}>{s.userId}: {s.reason}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Employee</th><th>Gross</th><th>Total Earnings</th><th>Total Deductions</th><th>Net Pay</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.userId}>
                  <td>{p.name || p.userId}</td>
                  <td>{p.gross ?? "-"}</td>
                  <td>{p.totalEarnings ?? "-"}</td>
                  <td>{p.totalDeductions ?? "-"}</td>
                  <td>{p.netPay ?? "-"}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>
                    <div className="toolbar" style={{ margin: 0 }}>
                      {p.status === "NOT_GENERATED" && <button className="btn-sm" onClick={() => generateOne(p.userId)}>Generate</button>}
                      {p.status === "DRAFT" && <button className="btn-sm" onClick={() => setEditing(p)}>Edit</button>}
                      {p.status === "DRAFT" && <button className="btn-sm" onClick={() => generateOne(p.userId)}>Regenerate</button>}
                      {p.status === "DRAFT" && <button className="btn-sm" onClick={() => action(p.userId, "finalize")}>Finalize</button>}
                      {p.status === "FINALIZED" && <button className="btn-sm" onClick={() => viewPdf(p.userId)}>View PDF</button>}
                      {p.status === "FINALIZED" && <button className="btn-sm" onClick={() => action(p.userId, "publish")}>Publish</button>}
                      {p.status === "FINALIZED" && <button className="btn-sm" onClick={() => action(p.userId, "unfinalize")}>Un-finalize</button>}
                      {p.status === "PUBLISHED" && <button className="btn-sm" onClick={() => viewPdf(p.userId)}>View PDF</button>}
                      {p.status === "PUBLISHED" && <button className="btn-sm" onClick={() => action(p.userId, "unpublish")}>Unpublish</button>}
                      {p.status !== "NOT_GENERATED" && <button className="btn-sm btn-danger" onClick={() => remove(p.userId)}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={7} className="empty-state">No employees found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditPayslipModal
          payslip={editing}
          period={period}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function EditPayslipModal({ payslip, period, onClose, onSaved }) {
  const [form, setForm] = useState({
    presentDays: payslip.presentDays,
    incentives: payslip.incentives,
    pt: payslip.pt,
    incomeTax: payslip.incomeTax,
    medicalAllowance: payslip.medicalAllowance ?? 0,
    othersDeduction: payslip.othersDeduction,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [useAttendance, setUseAttendance] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.put(`/payslips/${payslip.userId}/${period}`, {
        presentDays: Number(form.presentDays),
        useAttendance,
        incentives: Number(form.incentives),
        pt: Number(form.pt),
        incomeTax: Number(form.incomeTax),
        medicalAllowance: Number(form.medicalAllowance),
        othersDeduction: Number(form.othersDeduction),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit Payslip — ${payslip.name || payslip.userId} (${period})`} onClose={onClose} wide>
      <div className="card" style={{ marginBottom: 12 }}>
        <p className="hint-text mt-0">
          Days in month: {payslip.daysInMonth} · Working days: {payslip.workingDays} · Days present per attendance: {payslip.systemPresentDays} ·
          Paid leave days: {payslip.paidLeaveDays} · LOP days: {payslip.lopDays}
        </p>
        {payslip.dayMarks && (
          <div className="muster-grid">
            {payslip.dayMarks.map((m) => (
              <div key={m.date} className="muster-cell" title={m.date}>{m.day}<br />{m.mark}</div>
            ))}
          </div>
        )}
      </div>
      <form onSubmit={submit}>
        <div className="form-row">
          <div>
            <label>
              Present Days{" "}
              <span className="hint-text">
                {payslip.presentDaysManual ? "(entered manually)" : "(from attendance, incl. Out of Office / Travel)"}
              </span>
            </label>
            <input type="number" min="0" step="0.5" value={form.presentDays} onChange={(e) => set("presentDays", e.target.value)} required />
            {payslip.presentDaysManual && (
              <button type="button" className="btn-sm" style={{ marginTop: 6 }} onClick={() => setUseAttendance(true) || set("presentDays", payslip.systemPresentDays)}>
                Use attendance ({payslip.systemPresentDays})
              </button>
            )}
          </div>
          <div><label>Incentives</label><input type="number" step="0.01" value={form.incentives} onChange={(e) => set("incentives", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div><label>Professional Tax</label><input type="number" step="0.01" value={form.pt} onChange={(e) => set("pt", e.target.value)} /></div>
          <div><label>Medical Insurance</label><input type="number" step="0.01" value={form.medicalAllowance} onChange={(e) => set("medicalAllowance", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div><label>TDS</label><input type="number" step="0.01" value={form.incomeTax} onChange={(e) => set("incomeTax", e.target.value)} /></div>
          <div><label>Other Deductions</label><input type="number" step="0.01" value={form.othersDeduction} onChange={(e) => set("othersDeduction", e.target.value)} /></div>
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </form>
    </Modal>
  );
}
