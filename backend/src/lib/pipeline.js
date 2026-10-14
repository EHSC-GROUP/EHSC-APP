import ExcelJS from "exceljs";
import { db } from "../config/firebase.js";
import { COLLECTIONS, INVOICE_STAGE_NUMBERS } from "./constants.js";
import { PROJECT_CATEGORIES } from "./projectClassification.js";
import { fmtDMY } from "./dateUtils.js";

// Where an enquiry sits in the funnel decides which column of the pipeline
// report it counts in:
//   Confirmed    PO received / contract accepted
//   Assured      commercial negotiation
//   Anticipated  enquiry, proposal shared, technical negotiation
//   Lost         dropped
// On Hold enquiries are left off the report.
export const PIPELINE_CATEGORY = {
  PURCHASE_ORDER_RECEIVED: "confirmed",
  CONTRACT_ACCEPTED: "confirmed",
  COMMERCIAL_NEGOTIATION: "assured",
  IN_PROGRESS: "anticipated",
  PROPOSAL_SHARED: "anticipated",
  TECHNICAL_NEGOTIATION: "anticipated",
  ENQUIRY_DROPPED: "lost",
};

const money = (n) => (n == null || Number.isNaN(Number(n)) ? 0 : Math.round(Number(n) * 100) / 100);

// One row per enquiry, with the value that counts: the contract (or PO) value
// once confirmed, otherwise the estimated value.
export async function buildPipelineRows() {
  const [enqSnap, projSnap] = await Promise.all([
    db.collection(COLLECTIONS.BD_ENQUIRIES).get(),
    db.collection(COLLECTIONS.PROJECTS).get(),
  ]);
  const projectByEnquiry = new Map(projSnap.docs.map((d) => [d.data().sourceEnquiryId, d.data()]));
  const rows = [];
  for (const d of enqSnap.docs) {
    const e = d.data();
    const category = PIPELINE_CATEGORY[e.result];
    if (!category) continue; // on hold, or an unknown result
    const project = projectByEnquiry.get(d.id);
    const value = category === "confirmed"
      ? money(project?.contractValue ?? project?.poValue ?? e.estimatedValue)
      : money(e.estimatedValue);
    rows.push({
      enquiryNo: e.enquiryNo,
      company: e.clientName,
      project: e.projectId || project?.projectId || "",
      topic: e.topic || "",
      category,
      value,
    });
  }
  rows.sort((a, b) => a.company.localeCompare(b.company) || String(a.enquiryNo).localeCompare(String(b.enquiryNo), undefined, { numeric: true }));
  return rows;
}

export function pipelineTotals(rows) {
  const t = { confirmed: 0, assured: 0, anticipated: 0, lost: 0 };
  for (const r of rows) t[r.category] = money(t[r.category] + r.value);
  return t;
}

export async function buildPipelineWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Project Details");
  ws.columns = [
    { key: "company", width: 30 }, { key: "project", width: 30 }, { key: "value", width: 16 },
    { key: "confirmed", width: 16 }, { key: "assured", width: 16 }, { key: "anticipated", width: 18 }, { key: "lost", width: 16 }, { key: "remarks", width: 30 },
  ];
  ws.mergeCells("A1:H1");
  ws.getCell("A1").value = "EHS Consultants Project Details";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A1").alignment = { horizontal: "center" };
  const head = ws.addRow(["Company", "Projects", "Value", "Confirmed", "Assured", "Anticipated Business", "LOST", "Remarks"]);
  head.font = { bold: true };
  const fills = { D: "FFC6E0B4", E: "FFEDEDED", F: "FFFFF2CC", G: "FFF8CBAD" };
  for (const [col, argb] of Object.entries(fills)) head.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  for (const r of rows) {
    ws.addRow({
      company: r.company,
      project: r.project ? `${r.project}${r.topic ? ` - ${r.topic}` : ""}` : r.topic,
      value: r.value,
      confirmed: r.category === "confirmed" ? r.value : null,
      assured: r.category === "assured" ? r.value : null,
      anticipated: r.category === "anticipated" ? r.value : null,
      lost: r.category === "lost" ? r.value : null,
    });
  }
  const t = pipelineTotals(rows);
  const total = ws.addRow({ company: "TOTAL Value", confirmed: t.confirmed, assured: t.assured, anticipated: t.anticipated, lost: t.lost });
  total.font = { bold: true };
  for (const col of ["C", "D", "E", "F", "G"]) ws.getColumn(col).numFmt = "₹#,##0.00";
  ws.eachRow((row) => row.eachCell((c) => { c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }; }));
  return wb;
}

// ---- Invoice to be raised --------------------------------------------------
// One row per invoice stage that has been completed (its tasks are done, so
// Accounts should raise that invoice). Fully paid projects are left out.
export function serviceText(project) {
  const cat = PROJECT_CATEGORIES.find((c) => c.value === project.projectCategory);
  const svc = cat?.services.find((s) => s.value === project.service);
  const type = [...(cat?.types || []), ...(cat?.services.flatMap((s) => s.types) || [])].find((x) => x.value === project.projectType);
  return [cat?.label, svc?.label, type?.label].filter(Boolean).join(" - ");
}

// The row for one invoice stage, filled with whatever the project already
// holds; anything not known yet is left blank. Date = the Purchase Order date.
export function invoiceRowFor(p, n) {
  const pct = p[`invoiceStage${n}Percent`];
  if (pct == null) return null;
  const base = p.contractValue ?? p.poValue;
  const poValue = p.poValue ?? p.contractValue;
  return {
    company: p.clientName,
    poNo: p.poNumber || "",
    date: p.phase3?.workOrderDate || p.phase2?.workOrderDate || "",
    poValue: poValue == null ? null : money(poValue),
    percent: Number(pct),
    amount: base == null ? null : money((Number(base) * Number(pct)) / 100),
    services: serviceText(p),
    remarks: `Stage ${n}${p[`invoiceStage${n}Name`] ? ` - ${p[`invoiceStage${n}Name`]}` : ""} (${p.projectId})`,
  };
}

export async function buildInvoiceRows() {
  const snap = await db.collection(COLLECTIONS.PROJECTS).get();
  const rows = [];
  for (const d of snap.docs) {
    const p = d.data();
    if (p.paymentStatus === "Paid") continue;
    for (const n of INVOICE_STAGE_NUMBERS) {
      if (!p[`invoiceStage${n}Completed`] || p[`invoiceStage${n}Paid`]) continue;
      const row = invoiceRowFor(p, n);
      if (row) rows.push(row);
    }
  }
  rows.sort((a, b) => a.company.localeCompare(b.company) || a.date.localeCompare(b.date));
  return rows;
}

export async function buildInvoiceWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Invoice Details");
  ws.columns = [
    { key: "company", width: 30 }, { key: "poNo", width: 18 }, { key: "date", width: 14 }, { key: "poValue", width: 16 },
    { key: "percent", width: 14 }, { key: "amount", width: 16 }, { key: "services", width: 36 }, { key: "remarks", width: 44 },
  ];
  ws.mergeCells("A1:H1");
  ws.getCell("A1").value = "Invoice Details";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.addRow(["Company", "PO No", "Date", "PO Value", "% of PO Amount", "Invoice Amount", "Services", "Remarks"]).font = { bold: true };
  for (const r of rows) {
    ws.addRow({ ...r, date: fmtDMY(r.date), percent: `${r.percent}%` });
  }
  const total = ws.addRow({ percent: "Total", amount: money(rows.reduce((s, r) => s + (r.amount || 0), 0)) });
  total.font = { bold: true };
  for (const col of ["D", "F"]) ws.getColumn(col).numFmt = "₹#,##0.00";
  ws.eachRow((row) => row.eachCell((c) => { c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }; }));
  return wb;
}
