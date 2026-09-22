import ExcelJS from "exceljs";
import { formatProjects } from "./reimbursementFormat.js";

const COLUMNS = [
  { header: "Employee", key: "name", width: 20 },
  { header: "Raised By (Employee ID)", key: "userId", width: 18 },
  { header: "Designation", key: "designation", width: 18 },
  { header: "Voucher Date", key: "voucherDate", width: 14 },
  { header: "Type", key: "type", width: 14 },
  { header: "Project(s)", key: "projects", width: 26 },
  { header: "Journey Purpose", key: "journeyPurpose", width: 22 },
  { header: "Destination", key: "journeyStation", width: 16 },
  { header: "Travelling (A)", key: "travelTotal", width: 14 },
  { header: "Conveyance (B)", key: "conveyanceTotal", width: 14 },
  { header: "Other (C)", key: "otherTotal", width: 12 },
  { header: "Advance Applied", key: "advanceTaken", width: 14 },
  { header: "Total Expenses", key: "totalAmount", width: 14 },
  { header: "Payable", key: "balance", width: 12 },
  { header: "Status", key: "status", width: 12 },
  { header: "Payment Ref", key: "paymentRef", width: 16 },
  { header: "Payment Date", key: "paymentDate", width: 14 },
];

function sectionTotal(items, field) {
  return (items || []).reduce((s, i) => s + Number(i[field] || 0), 0);
}

// Legacy flat-`items` claims (pre A/B/C redesign) have no travel/conveyance
// breakdown — their amount lands entirely under Other (C) here.
function otherTotalFor(record) {
  if (record.otherItems || record.travelItems || record.conveyanceItems) {
    return sectionTotal(record.otherItems, "amount");
  }
  return (record.items || []).reduce((s, i) => s + Number(i.amount || 0), 0);
}

export async function buildReimbursementRegisterWorkbook(records) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reimbursements");
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };

  for (const r of records) {
    sheet.addRow({
      name: r.name,
      userId: r.userId,
      designation: r.designation || "",
      voucherDate: r.voucherDate,
      type: r.type || "GENERAL",
      projects: formatProjects(r),
      journeyPurpose: r.journeyPurpose || "",
      journeyStation: r.journeyStation || "",
      travelTotal: sectionTotal(r.travelItems, "fare"),
      conveyanceTotal: sectionTotal(r.conveyanceItems, "fare"),
      otherTotal: otherTotalFor(r),
      advanceTaken: Number(r.advanceTaken || 0),
      totalAmount: Number(r.totalAmount || 0),
      balance: r.balance !== undefined ? Number(r.balance) : Number(r.totalAmount || 0) - Number(r.advanceTaken || 0),
      status: r.status,
      paymentRef: r.paymentRef || "",
      paymentDate: r.paymentDate || "",
    });
  }
  return workbook;
}
