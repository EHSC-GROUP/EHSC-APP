import ExcelJS from "exceljs";
import { db } from "../config/firebase.js";
import { COLLECTIONS, INVOICE_STAGE_NUMBERS } from "./constants.js";
import { financialYearOf, fmtDMY } from "./dateUtils.js";
import { serviceText, buildPipelineRows, pipelineTotals } from "./pipeline.js";

// ---- BD MIS + dashboard + monthly lists, for one financial year (Apr-Mar) ----
// Everything is worked out from what the app already records:
//   enquiries         -> BD_ENQUIRIES (approach date, company, estimated value, stage)
//   proposals sent    -> enquiries with a proposal date (typed, or set when the proposal was shared)
//   purchase orders   -> enquiries at "PO received" / "Contract accepted", dated by the Purchase Order date
//   payments received -> projects with an amount received and a payment received date

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STAGE_LABEL = {
  IN_PROGRESS: "Enquiry", PROPOSAL_SHARED: "Proposal Shared", TECHNICAL_NEGOTIATION: "Technical Negotiation",
  COMMERCIAL_NEGOTIATION: "Commercial Negotiation", PURCHASE_ORDER_RECEIVED: "Purchase Order Received",
  CONTRACT_ACCEPTED: "Contract Accepted", ENQUIRY_ON_HOLD: "On Hold", ENQUIRY_DROPPED: "Dropped",
};
const PO_STAGES = ["PURCHASE_ORDER_RECEIVED", "CONTRACT_ACCEPTED"];
const money = (n) => (n == null || Number.isNaN(Number(n)) ? 0 : Math.round(Number(n) * 100) / 100);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const isoToday = () => new Date().toISOString().slice(0, 10);
const isDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);

export function currentFY() {
  return financialYearOf(isoToday());
}

// The 12 months of the FY: [{ key: "2026-04", label: "Apr-26", name: "April 2026" }, ...]
export function fyMonths(fy) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? fy : fy + 1;
    return { key: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTH_NAMES[m - 1]}-${String(y).slice(2)}`, short: MONTH_NAMES[m - 1], name: `${FULL_MONTH[m - 1]} ${y}` };
  });
}

export async function buildMis(fy = currentFY()) {
  const months = fyMonths(fy);
  const idx = new Map(months.map((m, i) => [m.key, i]));
  const monthOf = (d) => (isDay(d) ? idx.get(d.slice(0, 7)) : undefined);

  const [enqSnap, projSnap] = await Promise.all([
    db.collection(COLLECTIONS.BD_ENQUIRIES).get(),
    db.collection(COLLECTIONS.PROJECTS).get(),
  ]);
  const projectByEnquiry = new Map(projSnap.docs.map((d) => [d.data().sourceEnquiryId, d.data()]));

  const enquiries = enqSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const zero = () => Array(12).fill(0);

  // 1/2. Enquiries received: a company's first enquiry is "New", later ones "Existing".
  const byCompany = new Map();
  for (const e of enquiries) {
    if (!byCompany.has(e.companyId)) byCompany.set(e.companyId, []);
    byCompany.get(e.companyId).push(e);
  }
  const isNew = new Map();
  for (const list of byCompany.values()) {
    const ms = (e) => (typeof e.createdAt?.toMillis === "function" ? e.createdAt.toMillis() : (e.createdAt?._seconds || 0) * 1000);
    list.sort((a, b) => String(a.approachDate).localeCompare(String(b.approachDate)) || ms(a) - ms(b));
    list.forEach((e, i) => isNew.set(e.id, i === 0));
  }
  const enqExisting = zero();
  const enqNew = zero();
  for (const e of enquiries) {
    const i = monthOf(e.approachDate);
    if (i === undefined) continue;
    (isNew.get(e.id) ? enqNew : enqExisting)[i] += 1;
  }

  // Proposals sent
  const proposals = [];
  let undatedProposals = 0;
  for (const e of enquiries) {
    const p = projectByEnquiry.get(e.id);
    if (!p?.phase2?.proposalNo && !p?.phase2?.proposalDate) continue;
    const date = p.phase2.proposalDate || p.phase2.proposalSharedAt || null;
    if (monthOf(date) === undefined) { if (!date) undatedProposals++; continue; }
    proposals.push({
      date, month: monthOf(date), company: e.clientName, proposalNo: p.phase2.proposalNo || "",
      details: e.topic || "", status: STAGE_LABEL[e.result] || e.result, value: money(e.estimatedValue),
    });
  }
  proposals.sort((a, b) => a.date.localeCompare(b.date) || a.company.localeCompare(b.company));

  // Purchase orders received
  const pos = [];
  let undatedPos = 0;
  for (const e of enquiries) {
    if (!PO_STAGES.includes(e.result)) continue;
    const p = projectByEnquiry.get(e.id) || {};
    const date = p.phase3?.workOrderDate || p.phase2?.workOrderDate || e.poReceivedAt || null;
    if (monthOf(date) === undefined) { if (!date) undatedPos++; continue; }
    pos.push({
      date, month: monthOf(date), company: e.clientName, services: serviceText(p.projectCategory ? p : { projectCategory: e.projectCategory, service: e.service, projectType: e.projectType }),
      poNo: p.poNumber || p.phase2?.workOrderNumber || p.phase3?.workOrderNumber || "", value: money(p.contractValue ?? p.poValue ?? e.estimatedValue),
    });
  }
  pos.sort((a, b) => a.date.localeCompare(b.date) || a.company.localeCompare(b.company));

  // Payments received (project-level: one dated amount per project)
  const payments = [];
  let undatedPayments = 0;
  for (const d of projSnap.docs) {
    const p = d.data();
    // One payment per invoice stage marked Paid.
    const paidStages = INVOICE_STAGE_NUMBERS.filter((n) => p[`invoiceStage${n}Paid`]);
    if (paidStages.length > 0) {
      const base = p.contractValue ?? p.poValue;
      for (const n of paidStages) {
        const date = p[`invoiceStage${n}PaidAt`] || null;
        if (monthOf(date) === undefined) { if (!date) undatedPayments++; continue; }
        const stageName = p[`invoiceStage${n}Name`];
        payments.push({
          date, month: monthOf(date), company: p.clientName, projectId: p.projectId, stage: n, stageName: stageName || "",
          amount: money((Number(base) * Number(p[`invoiceStage${n}Percent`])) / 100),
        });
      }
      continue;
    }
    // Older records: a single typed "received" amount with its date.
    if (!(Number(p.receivedAmount) > 0)) continue;
    const date = p.phase4?.paymentReceivedDate || null;
    if (monthOf(date) === undefined) { if (!date) undatedPayments++; continue; }
    payments.push({ date, month: monthOf(date), company: p.clientName, projectId: p.projectId, stage: 0, stageName: "", amount: money(p.receivedAmount) });
  }
  payments.sort((a, b) => a.date.localeCompare(b.date) || a.company.localeCompare(b.company));

  // Per-month sums
  const propCount = zero(), propValue = zero(), poCount = zero(), poValue = zero(), payValue = zero();
  for (const r of proposals) { propCount[r.month] += 1; propValue[r.month] = money(propValue[r.month] + r.value); }
  for (const r of pos) { poCount[r.month] += 1; poValue[r.month] = money(poValue[r.month] + r.value); }
  for (const r of payments) payValue[r.month] = money(payValue[r.month] + r.amount);
  const sum = (a) => money(a.reduce((s, x) => s + x, 0));
  const T = { proposals: sum(propCount), proposalValue: sum(propValue), pos: sum(poCount), poValue: sum(poValue), payments: sum(payValue) };

  const dashboard = {
    rows: months.map((m, i) => ({ month: m.label, proposals: propCount[i], proposalValue: propValue[i], pos: poCount[i], poValue: poValue[i], payments: payValue[i] })),
    totals: T,
    conversion: {
      proposalToPoNos: { value: T.proposals, poValue: T.pos, percent: pct(T.pos, T.proposals) },
      proposalToPoValue: { value: T.proposalValue, poValue: T.poValue, percent: pct(T.poValue, T.proposalValue) },
      poToPayment: { value: T.payments, poValue: T.poValue, percent: pct(T.payments, T.poValue) },
      averagePoValue: T.pos > 0 ? money(T.poValue / T.pos) : null,
      averageProposalValue: T.proposals > 0 ? money(T.proposalValue / T.proposals) : null,
    },
  };

  // Rows 7 and 8 are "as of today" snapshots, so they only fill the current month.
  const today = isoToday();
  const nowIdx = monthOf(today);
  const delayRow = Array(12).fill(null);
  const pendingRow = Array(12).fill(null);
  if (nowIdx !== undefined) {
    let delayed = 0, pending = 0;
    for (const d of projSnap.docs) {
      const p = d.data();
      if ((p.phase3b?.actions || []).some((a) => !a.completed && a.dueDate && a.dueDate < today)) delayed++;
      const inv = p.phase4?.invoiceDate;
      if (inv && !p.phase4?.paymentReceived && p.paymentStatus !== "Paid" && (new Date(today) - new Date(inv)) / 86400000 > 60) pending++;
    }
    delayRow[nowIdx] = delayed;
    pendingRow[nowIdx] = pending;
  }
  const blank = Array(12).fill(null);
  const mis = [
    { no: 1, category: "No. of Enquiries Received (Existing)", values: enqExisting },
    { no: 2, category: "No. of Enquiries Received (New)", values: enqNew },
    { no: 3, category: "No. of Proposal Sent", values: propCount },
    { no: 4, category: "No. of PO Received", values: poCount },
    { no: 5, category: "CII Assessments", values: blank, manual: true },
    { no: 6, category: "Any Feedback/Complaints", values: blank, manual: true },
    { no: 7, category: "Any Delay in Projects", values: delayRow, snapshot: true },
    { no: 8, category: "Payment Pending (Beyond 60 days)", values: pendingRow, snapshot: true },
    { no: 9, category: "Any New Services Introduced", values: blank, manual: true },
    { no: 10, category: "Paid inperson ESG Training", values: blank, manual: true },
    { no: 11, category: "Expenses", values: blank, manual: true },
  ];

  const pipelineRows = await buildPipelineRows();
  return {
    fy, fyLabel: `${fy}-${String(fy + 1).slice(2)}`, months,
    dashboard, mis, proposals, pos, payments,
    poSummary: months.map((m, i) => ({ month: m.label, count: poCount[i], value: poValue[i] })),
    pipeline: { rows: pipelineRows, totals: pipelineTotals(pipelineRows) },
    notes: { undatedProposals, undatedPos, undatedPayments },
  };
}

// ---- Excel, laid out like the company's own sheets ----
const box = (ws) => ws.eachRow((row) => row.eachCell((c) => { c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }; }));
const HEAD = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB4C6E7" } };
const BLUE = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
const YELLOW = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
const INR = "₹#,##0.00";

export async function buildMisWorkbook(data, month) {
  const wb = new ExcelJS.Workbook();
  const sel = month ? data.months.find((m) => m.key === month) : null;
  const inScope = (r) => !sel || data.months[r.month].key === sel.key;
  const scopeLabel = sel ? `the Month of ${sel.name}` : `FY ${data.fyLabel}`;

  // BD (the MIS report)
  {
    const ws = wb.addWorksheet("BD");
    ws.mergeCells("A1:N1");
    ws.getCell("A1").value = `MIS Report for the Year ${data.fy}-${data.fy + 1}`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.getCell("A1").alignment = { horizontal: "center" };
    ws.mergeCells("A2:N2");
    ws.getCell("A2").value = "BD MIS Report";
    ws.getCell("A2").font = { bold: true };
    ws.getCell("A2").alignment = { horizontal: "center" };
    const head = ws.addRow(["Sl. No.", "Category", ...data.months.map((m) => m.short)]);
    head.font = { bold: true };
    head.eachCell((c) => { c.fill = HEAD; c.alignment = { horizontal: "center" }; });
    for (const r of data.mis) ws.addRow([r.no, r.category, ...r.values.map((v) => (v === null || v === undefined ? "" : v))]);
    ws.getColumn(1).width = 8;
    ws.getColumn(2).width = 40;
    for (let c = 3; c <= 14; c++) ws.getColumn(c).width = 8;
    box(ws);
  }

  // BD Dashboard
  {
    const ws = wb.addWorksheet("BD Dashboard");
    ws.mergeCells("A1:F1");
    ws.getCell("A1").value = `BUSINESS DEVELOPMENT DASHBOARD - FY ${data.fy}-${String(data.fy + 1).slice(2)}`;
    ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    ws.getCell("A1").fill = BLUE;
    ws.addRow(["KEY PERFORMANCE METRICS"]).font = { bold: true, size: 12 };
    const head = ws.addRow(["Month", "Proposals Submitted", "Proposal Value", "No of Pos", "Purchase Orders Value", "Payments Received"]);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.eachCell((c) => { c.fill = BLUE; c.alignment = { horizontal: "center", wrapText: true }; });
    for (const r of data.dashboard.rows) ws.addRow([r.month, r.proposals || "", r.proposalValue || "", r.pos || "", r.poValue || "", r.payments || ""]);
    const t = data.dashboard.totals;
    const tot = ws.addRow(["TOTAL", t.proposals, t.proposalValue, t.pos, t.poValue, t.payments]);
    tot.font = { bold: true };
    tot.eachCell((c) => { c.fill = YELLOW; });
    ws.addRow([]);
    ws.addRow(["CONVERSION METRICS"]).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.lastRow.getCell(1).fill = BLUE;
    const mh = ws.addRow(["Metric", "Value", "PO Value", "%", "Target", "Performance"]);
    mh.font = { bold: true, color: { argb: "FFFFFFFF" } };
    mh.eachCell((c) => { c.fill = BLUE; });
    const c = data.dashboard.conversion;
    const p = (x) => (x == null ? "" : `${x}%`);
    ws.addRow(["Proposal to PO Conversion Nos", c.proposalToPoNos.value, c.proposalToPoNos.poValue, p(c.proposalToPoNos.percent), "", ""]);
    ws.addRow(["Proposal to PO Conversion Value", c.proposalToPoValue.value, c.proposalToPoValue.poValue, p(c.proposalToPoValue.percent), "", ""]);
    ws.addRow(["PO to Payment Collection", c.poToPayment.value, c.poToPayment.poValue, p(c.poToPayment.percent), "", ""]);
    ws.addRow(["Average PO Value", c.averagePoValue ?? "", "", "", "", ""]);
    ws.addRow(["Average Proposal Value", c.averageProposalValue ?? "", "", "", "", ""]);
    ws.addRow([]);
    ws.addRow(["Priority / Action Items and Key Insights & Observations can be noted here."]).font = { italic: true, color: { argb: "FF666666" } };
    ws.getColumn(1).width = 34;
    for (let col = 2; col <= 6; col++) ws.getColumn(col).width = 20;
    for (const col of ["C", "E", "F"]) ws.getColumn(col).numFmt = INR;
  }

  // Purchase orders (PO <month>)
  {
    const ws = wb.addWorksheet(sel ? `PO ${sel.short}` : "Purchase Orders");
    ws.mergeCells("A1:F1");
    ws.getCell("A1").value = `PO Details for ${scopeLabel}`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.addRow(["Sl No", "Company Name", "Services", "PO No/Agreement", "Date", "PO Value"]).font = { bold: true };
    const rows = data.pos.filter(inScope);
    rows.forEach((r, i) => ws.addRow([i + 1, r.company, r.services, r.poNo, fmtDMY(r.date), r.value]));
    const tot = ws.addRow(["", "", "TOTAL", "", "", money(rows.reduce((s, r) => s + r.value, 0))]);
    tot.font = { bold: true };
    [8, 32, 40, 22, 14, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getColumn(6).numFmt = INR;
    box(ws);
  }

  // Proposals (<month> Proposals)
  {
    const ws = wb.addWorksheet(sel ? `${sel.short} Proposals` : "Proposals");
    ws.mergeCells("A1:G1");
    ws.getCell("A1").value = `Proposals for ${scopeLabel}`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.addRow(["Sl. No.", "Date", "Name of the Company", "Client Name", "Proposal Details", "Status", "Value"]).font = { bold: true };
    const rows = data.proposals.filter(inScope);
    rows.forEach((r, i) => ws.addRow([i + 1, fmtDMY(r.date), r.company, r.company, `${r.proposalNo ? `${r.proposalNo} - ` : ""}${r.details}`, r.status, r.value]));
    const tot = ws.addRow(["", "", "", "", "TOTAL", "", money(rows.reduce((s, r) => s + r.value, 0))]);
    tot.font = { bold: true };
    tot.eachCell((c) => { c.fill = YELLOW; });
    [8, 14, 32, 32, 50, 24, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getColumn(7).numFmt = INR;
    box(ws);
  }

  // PO Summary
  {
    const ws = wb.addWorksheet("PO Summary");
    ws.addRow(["PO Received"]).font = { bold: true };
    ws.addRow(["Month", "No of Pos", "Value"]).font = { bold: true };
    for (const r of data.poSummary) ws.addRow([r.month, r.count || "", r.value || ""]);
    ws.addRow(["Total", data.dashboard.totals.pos, data.dashboard.totals.poValue]).font = { bold: true };
    ws.getColumn(1).width = 14; ws.getColumn(2).width = 12; ws.getColumn(3).width = 18; ws.getColumn(3).numFmt = INR;
  }

  // Payments, grouped by month with a total per month
  {
    const ws = wb.addWorksheet("Payments");
    ws.addRow(["Company", "Date", "Amount"]).font = { bold: true };
    data.months.forEach((m, i) => {
      const rows = data.payments.filter((r) => r.month === i);
      const mh = ws.addRow([m.label]);
      mh.font = { bold: true };
      mh.getCell(1).fill = YELLOW;
      for (const r of rows) ws.addRow([r.company, fmtDMY(r.date), r.amount]);
      const tot = ws.addRow([`${m.name.split(" ")[0]} Total`, "", money(rows.reduce((s, r) => s + r.amount, 0))]);
      tot.font = { bold: true };
      tot.getCell(1).fill = YELLOW;
      tot.getCell(3).fill = YELLOW;
    });
    ws.getColumn(1).width = 34; ws.getColumn(2).width = 14; ws.getColumn(3).width = 18; ws.getColumn(3).numFmt = INR;
  }

  // Project pipeline (Confirmed / Assured / Anticipated / Lost)
  {
    const ws = wb.addWorksheet("Project Details");
    ws.mergeCells("A1:G1");
    ws.getCell("A1").value = "EHS Consultants Project Details";
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.addRow(["Company", "Projects", "Value", "Confirmed", "Assured", "Anticipated Business", "LOST"]).font = { bold: true };
    for (const r of data.pipeline.rows) {
      ws.addRow([r.company, r.project ? `${r.project}${r.topic ? ` - ${r.topic}` : ""}` : r.topic, r.value,
        r.category === "confirmed" ? r.value : "", r.category === "assured" ? r.value : "", r.category === "anticipated" ? r.value : "", r.category === "lost" ? r.value : ""]);
    }
    const t = data.pipeline.totals;
    ws.addRow(["TOTAL Value", "", "", t.confirmed, t.assured, t.anticipated, t.lost]).font = { bold: true };
    [30, 40, 16, 16, 16, 20, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    for (const col of ["C", "D", "E", "F", "G"]) ws.getColumn(col).numFmt = INR;
    box(ws);
  }
  return wb;
}
