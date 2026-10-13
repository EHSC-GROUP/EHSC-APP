import { useEffect, useState } from "react";
import client, { errorMessage } from "../api/client";
import Modal from "./Modal";
import { Loading, ErrorText } from "./Misc";
import { fmtDate } from "../lib/dates";
import { openAuthedFile } from "../lib/openFile";

const inr = (n) => (n || n === 0 ? `₹${Number(n).toLocaleString("en-IN")}` : "");
const dash = (n) => (n ? inr(n) : "-");
const TABS = ["Dashboard", "BD MIS", "Proposals", "Purchase Orders", "Payments", "Pipeline"];

// MIS Report BD: the whole BD reporting pack for one financial year, with one
// Excel download laid out like the company's own sheets (BD, BD Dashboard, PO,
// Proposals, PO Summary, Payments, Project Details).
export default function MisReport({ onClose }) {
  const thisFy = (() => { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; })();
  const [fy, setFy] = useState(thisFy);
  const [month, setMonth] = useState(""); // "" = whole year (for the two monthly lists)
  const [tab, setTab] = useState("Dashboard");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    setError("");
    client.get("/business-development/mis", { params: { fy } }).then((r) => setData(r.data)).catch((err) => setError(errorMessage(err)));
  }, [fy]);

  function download() {
    const q = new URLSearchParams({ fy: String(fy) });
    if (month) q.set("month", month);
    openAuthedFile(`/api/business-development/mis/export?${q}`, { download: true, filename: `MIS_Report_BD_FY${fy}-${String(fy + 1).slice(2)}.xlsx` }).catch((err) => setError(errorMessage(err)));
  }

  const inMonth = (r) => !month || data.months[r.month].key === month;

  return (
    <Modal title="MIS Report BD" onClose={onClose} wide>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <label style={{ margin: 0 }}>Financial year</label>
        <select style={{ width: 150 }} value={fy} onChange={(e) => { setFy(Number(e.target.value)); setMonth(""); }}>
          {[thisFy + 1, thisFy, thisFy - 1, thisFy - 2].map((y) => <option key={y} value={y}>{y}-{String(y + 1).slice(2)}</option>)}
        </select>
        {["Proposals", "Purchase Orders"].includes(tab) && data && (
          <>
            <label style={{ margin: 0 }}>Month</label>
            <select style={{ width: 150 }} value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Whole year</option>
              {data.months.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
          </>
        )}
        <div className="spacer" />
        <button className="btn-primary" onClick={download} disabled={!data}>Download Excel</button>
      </div>

      <div className="drawer-tabs" style={{ marginBottom: 12 }}>
        {TABS.map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      <ErrorText>{error}</ErrorText>
      {!data ? (error ? null : <Loading />) : (
        <>
          {tab === "Dashboard" && <Dashboard d={data.dashboard} fyLabel={data.fyLabel} />}
          {tab === "BD MIS" && <BdMis rows={data.mis} months={data.months} fy={data.fy} />}
          {tab === "Proposals" && <Proposals rows={data.proposals.filter(inMonth)} />}
          {tab === "Purchase Orders" && <PurchaseOrders rows={data.pos.filter(inMonth)} />}
          {tab === "Payments" && <Payments rows={data.payments} months={data.months} />}
          {tab === "Pipeline" && <Pipeline p={data.pipeline} />}
          {(data.notes.undatedProposals + data.notes.undatedPos + data.notes.undatedPayments) > 0 && (
            <p className="hint-text">
              Left out because they have no date: {data.notes.undatedProposals} proposal(s), {data.notes.undatedPos} purchase order(s),{" "}
              {data.notes.undatedPayments} payment(s). Add the date in the project to include them.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

function Dashboard({ d, fyLabel }) {
  const c = d.conversion;
  const p = (x) => (x == null ? "-" : `${x}%`);
  return (
    <div>
      <h3 className="mt-0">Business Development Dashboard - FY {fyLabel}</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Month</th><th>Proposals Submitted</th><th>Proposal Value</th><th>No of POs</th><th>Purchase Orders Value</th><th>Payments Received</th></tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.month}><td>{r.month}</td><td>{r.proposals || "-"}</td><td>{dash(r.proposalValue)}</td><td>{r.pos || "-"}</td><td>{dash(r.poValue)}</td><td>{dash(r.payments)}</td></tr>
            ))}
            <tr style={{ fontWeight: 600 }}><td>TOTAL</td><td>{d.totals.proposals}</td><td>{inr(d.totals.proposalValue)}</td><td>{d.totals.pos}</td><td>{inr(d.totals.poValue)}</td><td>{inr(d.totals.payments)}</td></tr>
          </tbody>
        </table>
      </div>
      <h3>Conversion metrics</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Metric</th><th>Value</th><th>PO Value</th><th>%</th></tr></thead>
          <tbody>
            <tr><td>Proposal to PO conversion (numbers)</td><td>{c.proposalToPoNos.value}</td><td>{c.proposalToPoNos.poValue}</td><td>{p(c.proposalToPoNos.percent)}</td></tr>
            <tr><td>Proposal to PO conversion (value)</td><td>{inr(c.proposalToPoValue.value)}</td><td>{inr(c.proposalToPoValue.poValue)}</td><td>{p(c.proposalToPoValue.percent)}</td></tr>
            <tr><td>PO to payment collection</td><td>{inr(c.poToPayment.value)}</td><td>{inr(c.poToPayment.poValue)}</td><td>{p(c.poToPayment.percent)}</td></tr>
            <tr><td>Average PO value</td><td>{c.averagePoValue == null ? "-" : inr(c.averagePoValue)}</td><td></td><td></td></tr>
            <tr><td>Average proposal value</td><td>{c.averageProposalValue == null ? "-" : inr(c.averageProposalValue)}</td><td></td><td></td></tr>
          </tbody>
        </table>
      </div>
      <p className="hint-text">Proposal value is each enquiry's estimated value. A payment counts in the month of its payment received date.</p>
    </div>
  );
}

function BdMis({ rows, months, fy }) {
  return (
    <div>
      <h3 className="mt-0">MIS Report for the Year {fy}-{fy + 1} - BD MIS Report</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Sl. No.</th><th>Category</th>{months.map((m) => <th key={m.key}>{m.short}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.no}>
                <td>{r.no}</td>
                <td>{r.category}{r.snapshot ? <span className="hint-text"> (as of today)</span> : null}</td>
                {r.values.map((v, i) => <td key={i}>{v === null || v === undefined ? "" : v || "-"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint-text">
        New = a company's first enquiry; Existing = a repeat enquiry from a company already on file. "Delay in projects" and
        "Payment pending beyond 60 days" show today's position in the current month. The blank rows are not tracked in the app yet.
      </p>
    </div>
  );
}

function Proposals({ rows }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Sl. No.</th><th>Date</th><th>Company</th><th>Proposal Details</th><th>Status</th><th>Value</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.company}-${r.proposalNo}-${i}`}>
              <td>{i + 1}</td><td>{fmtDate(r.date)}</td><td>{r.company}</td>
              <td>{r.proposalNo ? <strong>{r.proposalNo} </strong> : null}{r.details}</td><td>{r.status}</td><td>{dash(r.value)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty-state">No proposals in this period.</td></tr>}
          <tr style={{ fontWeight: 600 }}><td colSpan={5}>TOTAL</td><td>{inr(total)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function PurchaseOrders({ rows }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Sl. No.</th><th>Company</th><th>Services</th><th>PO No / Agreement</th><th>Date</th><th>PO Value</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.company}-${r.poNo}-${i}`}><td>{i + 1}</td><td>{r.company}</td><td>{r.services}</td><td>{r.poNo || "-"}</td><td>{fmtDate(r.date)}</td><td>{dash(r.value)}</td></tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty-state">No purchase orders in this period.</td></tr>}
          <tr style={{ fontWeight: 600 }}><td colSpan={5}>TOTAL</td><td>{inr(total)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function Payments({ rows, months }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Company</th><th>Date</th><th>Amount</th></tr></thead>
        <tbody>
          {months.map((m, i) => {
            const list = rows.filter((r) => r.month === i);
            return [
              <tr key={m.key} style={{ background: "var(--bg)", fontWeight: 600 }}><td colSpan={3}>{m.label}</td></tr>,
              ...list.map((r) => <tr key={`${m.key}-${r.projectId}`}><td>{r.company}</td><td>{fmtDate(r.date)}</td><td>{inr(r.amount)}</td></tr>),
              <tr key={`${m.key}-t`} style={{ fontWeight: 600 }}><td>{m.name.split(" ")[0]} Total</td><td></td><td>{inr(list.reduce((s, r) => s + r.amount, 0))}</td></tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function Pipeline({ p }) {
  const cols = ["confirmed", "assured", "anticipated", "lost"];
  return (
    <div>
      <p className="hint-text mt-0">
        Confirmed = PO received or contract accepted · Assured = commercial negotiation · Anticipated = enquiry, proposal or
        technical negotiation · Lost = dropped. Enquiries on hold are not counted.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Company</th><th>Project</th><th>Value</th><th>Confirmed</th><th>Assured</th><th>Anticipated</th><th>Lost</th></tr></thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.enquiryNo}>
                <td>{r.company}</td>
                <td>{r.project || "-"}{r.topic ? <span className="hint-text"> · {r.topic}</span> : null}</td>
                <td>{inr(r.value) || "-"}</td>
                {cols.map((c) => <td key={c}>{r.category === c ? inr(r.value) || "-" : ""}</td>)}
              </tr>
            ))}
            {p.rows.length === 0 && <tr><td colSpan={7} className="empty-state">No enquiries in the pipeline yet.</td></tr>}
            <tr style={{ fontWeight: 600 }}><td colSpan={3}>TOTAL Value</td>{cols.map((c) => <td key={c}>{inr(p.totals[c]) || "₹0"}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
