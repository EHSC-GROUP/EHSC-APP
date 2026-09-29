import { useEffect, useState } from "react";
import client, { errorMessage } from "../../api/client";
import Modal from "../../components/Modal";
import { Loading, ErrorText, ConfirmButton } from "../../components/Misc";
import { openAuthedFile } from "../../lib/openFile";
import { formatINR } from "../../lib/currency";

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function money(v) {
  return v === null || v === undefined ? "—" : formatINR(v);
}

const STATUS_LABEL = { NOT_GENERATED: "Not Generated", DRAFT: "Draft", FINALIZED: "Finalized", PUBLISHED: "Published" };

function StatusPill({ status }) {
  return <span className={`badge-pill badge-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export default function Payslips() {
  const [period, setPeriod] = useState(currentPeriod());
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [downloadRangeFor, setDownloadRangeFor] = useState(null);

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

  async function generateAll() {
    setBusy(true);
    setError("");
    try {
      await client.post("/payslips/generate", { period });
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

  const generatedCount = (list || []).filter((p) => p.status !== "NOT_GENERATED").length;

  return (
    <div>
      <div className="page-header">
        <h2>Payslip Generator</h2>
        <div className="toolbar">
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <button className="btn-primary" onClick={generateAll} disabled={busy}>{busy ? "Generating…" : "Generate for All"}</button>
          <button onClick={exportExcel}>Download Excel Register</button>
        </div>
      </div>

      {list && <p className="hint-text mt-0">{generatedCount} of {list.length} generated</p>}

      <ErrorText>{error}</ErrorText>
      {!list ? <Loading /> : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Employee</th><th>Gross Income</th><th>Total Deductions</th><th>Net Income</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.userId}>
                  <td>{p.name || p.userId}</td>
                  <td>{money(p.totalEarnings)}</td>
                  <td>{money(p.totalDeductions)}</td>
                  <td>{money(p.netPay)}</td>
                  <td><StatusPill status={p.status} /></td>
                  <td>
                    <div className="toolbar" style={{ margin: 0, flexWrap: "wrap" }}>
                      {p.status === "NOT_GENERATED" && <button className="btn-sm" onClick={() => generateOne(p.userId)}>Generate</button>}
                      {p.status !== "NOT_GENERATED" && <button className="btn-sm" onClick={() => setEditing(p)}>Edit</button>}
                      {p.status === "DRAFT" && <button className="btn-sm" onClick={() => action(p.userId, "finalize")}>Finalize</button>}
                      {p.status === "FINALIZED" && <button className="btn-sm" onClick={() => action(p.userId, "publish")}>Publish</button>}
                      {(p.status === "FINALIZED" || p.status === "PUBLISHED") && <button className="btn-sm" onClick={() => viewPdf(p.userId)}>View PDF</button>}
                      {p.status !== "NOT_GENERATED" && <button className="btn-sm" onClick={() => setDownloadRangeFor(p)}>Download Range</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6} className="empty-state">No employees found.</td></tr>}
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
          onDeleted={() => { setEditing(null); load(); }}
        />
      )}
      {downloadRangeFor && (
        <DownloadRangeModal payslip={downloadRangeFor} period={period} onClose={() => setDownloadRangeFor(null)} />
      )}
    </div>
  );
}

function DownloadRangeModal({ payslip, period, onClose }) {
  const [from, setFrom] = useState(period);
  const [to, setTo] = useState(period);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function download() {
    setError("");
    setBusy(true);
    try {
      await openAuthedFile(`/api/payslips/${payslip.userId}/consolidated?from=${from}&to=${to}`, {
        download: true,
        filename: `Payslips_${payslip.userId}_${from}_to_${to}.pdf`,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Download Range — ${payslip.name || payslip.userId}`} onClose={onClose}>
      <div className="form-row">
        <div><label>From</label><input type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label>To</label><input type="month" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" style={{ marginTop: 12 }} onClick={download} disabled={busy}>{busy ? "Downloading…" : "Download"}</button>
    </Modal>
  );
}

// ---- Edit Draft modal — the color-coded attendance calendar window --------

const WEEKDAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

const LEGEND = [
  { key: "P", label: "Present" },
  { key: "HD", label: "Half Day" },
  { key: "OOO", label: "Out of Office" },
  { key: "LEAVE", label: "Leave" },
  { key: "A", label: "Absent (LOP)" },
  { key: "H", label: "Holiday" },
  { key: "W", label: "Weekly Off" },
  { key: "DUE", label: "Not Yet Due" },
];

function categorize(mark) {
  if (mark === "P") return "P";
  if (mark === "HD" || mark === "P(H)" || mark.endsWith("(H)")) return "HD";
  if (mark === "OOO") return "OOO";
  if (mark === "A") return "A";
  if (mark === "H") return "H";
  if (mark === "W") return "W";
  if (mark === "-") return "DUE";
  return "LEAVE";
}

function tooltipLabel(dateStr, mark, leaveNameById) {
  let label;
  if (mark === "P") label = "Present";
  else if (mark === "HD" || mark === "P(H)") label = "Half Day";
  else if (mark === "OOO") label = "Out of Office (approved)";
  else if (mark === "A") label = "Absent (Loss of Pay)";
  else if (mark === "H") label = "Holiday";
  else if (mark === "W") label = "Weekly Off";
  else if (mark === "-") label = "Not yet due — this day hasn't happened yet";
  else if (mark.endsWith("(H)")) {
    const id = mark.slice(0, -3);
    label = `${leaveNameById[id] || id} (Half Day)`;
  } else {
    label = leaveNameById[mark] || mark;
  }
  return `${dateStr} — ${label}`;
}

// Payslips generated before this rebuild stored dayMarks as an array of
// {day, date, mark} objects, not a flat string per day — tolerate both so
// an old, already-finalized payslip doesn't crash the modal.
function normalizeMark(entry) {
  if (typeof entry === "string") return entry;
  return entry?.mark ?? "-";
}

function AttendanceCalendar({ payslip }) {
  const [y, m] = payslip.period.split("-").map(Number);
  const leadingBlanks = new Date(y, m - 1, 1).getDay();
  const marks = payslip.dayMarks || [];
  const leaveNameById = Object.fromEntries((payslip.leaveBreakdown || []).map((l) => [l.id, l.name]));

  return (
    <div>
      <div className="payslip-calendar">
        {WEEKDAY_HEADERS.map((h, i) => <div key={i} className="payslip-calendar-header">{h}</div>)}
        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} className="payslip-day-blank" />)}
        {marks.map((entry, i) => {
          const day = i + 1;
          const mark = normalizeMark(entry);
          const dateStr = `${payslip.period}-${String(day).padStart(2, "0")}`;
          const cat = categorize(mark);
          return (
            <div key={day} className={`payslip-day-cell payslip-day-${cat}`} title={tooltipLabel(dateStr, mark, leaveNameById)}>
              <span className="payslip-day-num">{day}</span>
              {mark}
            </div>
          );
        })}
      </div>
      <div className="payslip-legend">
        {LEGEND.map((l) => (
          <div key={l.key} className="payslip-legend-item">
            <span className={`payslip-legend-swatch payslip-day-${l.key}`} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function EditPayslipModal({ payslip, period, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState({
    presentDays: payslip.presentDays,
    incentives: payslip.incentives,
    pt: payslip.pt,
    incomeTax: payslip.incomeTax,
    esi: payslip.esi ?? 0,
    othersDeduction: payslip.othersDeduction,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [useAttendance, setUseAttendance] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  const presentDaysChanged = Number(form.presentDays) !== Number(payslip.presentDays);
  const isLockedStatus = payslip.status === "FINALIZED" || payslip.status === "PUBLISHED";

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (isLockedStatus) {
      const ok = window.confirm(
        `This payslip is ${payslip.status.toLowerCase()}. Saving will regenerate its PDF in place with the new numbers. Continue?`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await client.put(`/payslips/${payslip.userId}/${period}`, {
        presentDays: Number(form.presentDays),
        useAttendance,
        incentives: Number(form.incentives),
        pt: Number(form.pt),
        incomeTax: Number(form.incomeTax),
        esi: Number(form.esi),
        othersDeduction: Number(form.othersDeduction),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await client.delete(`/payslips/${payslip.userId}/${period}`);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const leaveTypeRows = (payslip.leaveBreakdown || []).filter((l) => l.id !== "LOP" && l.id !== "HALF_DAY");
  const totalLeavesConsumed = (payslip.leaveBreakdown || []).reduce((s, l) => s + (l.id === "LOP" || l.id === "HALF_DAY" ? 0 : Number(l.days || 0)), 0);

  return (
    <Modal title={`Edit Payslip — ${payslip.name || payslip.userId} (${period})`} onClose={onClose} wide>
      <div className="card" style={{ marginBottom: 12 }}>
        <h4 className="mt-0">Attendance Calendar</h4>
        <AttendanceCalendar payslip={payslip} />
      </div>

      <div className="payslip-stat-strip">
        <div className="stat-block">
          <div className="stat-value" style={{ color: "#1d4ed8" }}>{payslip.payableDays}</div>
          <div className="stat-label">Payable Days{payslip.presentDaysManual && <> *</>}</div>
        </div>
        <div className="stat-block">
          <div className="stat-value" style={{ color: "#b91c1c" }}>{payslip.lopDays}</div>
          <div className="stat-label">Loss of Pay{payslip.presentDaysManual && <> *</>}</div>
        </div>
      </div>
      {payslip.presentDaysManual && <p className="hint-text mt-0">* recalculated when you save</p>}

      <div className="card">
        <h4 className="mt-0">Leave Consumed</h4>
        <div className="payslip-stat-strip" style={{ background: "transparent", padding: 0, margin: "0 0 8px" }}>
          <div className="stat-block">
            <div className="stat-value">{totalLeavesConsumed}</div>
            <div className="stat-label">Total Leaves Consumed</div>
          </div>
        </div>
        <div className="payslip-leave-grid">
          {leaveTypeRows.map((l) => (
            <div key={l.id} className={`payslip-leave-stat ${Number(l.days) === 0 ? "zero" : ""}`}>
              <div className="value">{l.days}</div>
              <div className="label">{l.name} {l.monthlyCap != null && `(cap ${l.monthlyCap})`}</div>
              {l.excessLop > 0 && <div className="hint-text overdue" style={{ marginTop: 2 }}>{l.excessLop} exceeds cap → LOP</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h4 className="mt-0">Earnings (reference)</h4>
        <p className="hint-text mt-0">Prorated by Payable Days / Days in Month.</p>
        <div className="form-row">
          <div><label>Basic</label><input value={formatINR(payslip.basic)} disabled /></div>
          <div><label>HRA</label><input value={formatINR(payslip.hra)} disabled /></div>
          <div><label>Others</label><input value={formatINR(payslip.others)} disabled /></div>
        </div>
      </div>

      <form onSubmit={submit}>
        <div className="form-row">
          <div>
            <label>Present Days</label>
            <input type="number" min="0" step="0.5" value={form.presentDays} onChange={(e) => { set("presentDays", e.target.value); setUseAttendance(false); }} required />
            <p className="hint-text mt-0">System login (reference only): {payslip.systemLoginDays ?? 0} day(s)</p>
            {payslip.presentDaysManual && (
              <button type="button" className="btn-sm" onClick={() => { setUseAttendance(true); set("presentDays", payslip.attendancePresentDays); }}>
                Use attendance ({payslip.attendancePresentDays})
              </button>
            )}
            {presentDaysChanged && <p className="hint-text overdue mt-0">Changing this recalculates Basic/HRA/Others/Payable Days on save.</p>}
          </div>
          <div><label>Incentives / Arrears</label><input type="number" step="0.01" value={form.incentives} onChange={(e) => set("incentives", e.target.value)} /></div>
        </div>

        <h4>Deductions</h4>
        <div className="form-row">
          <div><label>Professional Tax</label><input type="number" step="0.01" value={form.pt} onChange={(e) => set("pt", e.target.value)} /></div>
          <div><label>Income Tax (TDS)</label><input type="number" step="0.01" value={form.incomeTax} onChange={(e) => set("incomeTax", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div><label>ESI</label><input type="number" step="0.01" value={form.esi} onChange={(e) => set("esi", e.target.value)} /></div>
          <div><label>Others</label><input type="number" step="0.01" value={form.othersDeduction} onChange={(e) => set("othersDeduction", e.target.value)} /></div>
        </div>

        <div className="payslip-totals-footer">
          <div className="stat-block">
            <div className="stat-value">{formatINR(payslip.totalEarnings)}</div>
            <div className="stat-label">Gross Income</div>
          </div>
          <div className="stat-block">
            <div className="stat-value">{formatINR(payslip.totalDeductions)}</div>
            <div className="stat-label">Total Deductions</div>
          </div>
          <div className="stat-block">
            <div className="stat-value" style={{ color: "#16a34a" }}>{formatINR(payslip.netPay)}</div>
            <div className="stat-label">Net Income</div>
          </div>
        </div>

        <ErrorText>{error}</ErrorText>
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button type="button" onClick={onClose}>Cancel</button>
          <div className="spacer" />
          <ConfirmButton
            className="btn-danger"
            onConfirm={remove}
            confirmText={
              isLockedStatus
                ? `This payslip is ${payslip.status.toLowerCase()} — deleting it removes its generated PDF too. Continue?`
                : "Delete this payslip?"
            }
          >
            Delete Payslip
          </ConfirmButton>
        </div>
      </form>
    </Modal>
  );
}
