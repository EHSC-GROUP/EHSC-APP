import PDFDocument from "pdfkit";
import { numberToWords } from "./numberToWords.js";
import { drawTable } from "./pdfTable.js";
import { formatProjects } from "./reimbursementFormat.js";
import { drawLetterhead, drawFooter } from "./pdfBranding.js";

const PAGE_LEFT = 40;
const PAGE_RIGHT = 555;
const PAGE_WIDTH = PAGE_RIGHT - PAGE_LEFT;

function sectionTotal(items, field) {
  return items.reduce((s, i) => s + Number(i[field] || 0), 0);
}

// Backward-compat: claims submitted before the A/B/C redesign only have a
// flat `items` array ({date, description, amount}) — fold those into
// Section C (Any Other Expenses) so old claims still export cleanly.
function normalize(record) {
  const travelItems = record.travelItems || [];
  const conveyanceItems = record.conveyanceItems || [];
  let otherItems = record.otherItems || [];
  if (!record.travelItems && !record.conveyanceItems && !record.otherItems && Array.isArray(record.items)) {
    otherItems = record.items.map((i) => ({ date: i.date, details: i.description, amount: i.amount }));
  }
  return { travelItems, conveyanceItems, otherItems };
}

function drawClaimPage(doc, record) {
  const { travelItems, conveyanceItems, otherItems } = normalize(record);

  drawLetterhead(doc, { left: PAGE_LEFT, right: PAGE_RIGHT });
  doc.font("Helvetica-Bold").fontSize(12).text("Reimbursement Claim Form (RCF)", { align: "center", width: PAGE_WIDTH });
  doc.moveDown(0.6);

  const infoTop = doc.y;
  const submissionDate = record.appliedAt?.toDate ? record.appliedAt.toDate().toISOString().slice(0, 10) : (record.appliedAt || "-");
  const left = [
    ["Name of the Claimant", record.name],
    ["Journey Date", record.voucherDate],
    ["Journey Purpose", record.journeyPurpose],
    ["Project(s)", formatProjects(record)],
    ["Journey Station", record.journeyStation],
  ];
  const right = [
    ["Designation", record.designation],
    ["Submission Date", submissionDate],
    ["Claim Type", record.type],
    ["Paid To", record.paidTo],
  ];
  doc.font("Helvetica").fontSize(9);
  left.forEach(([k, v], i) => doc.text(`${k}: ${v || "-"}`, PAGE_LEFT, infoTop + i * 14, { width: 260 }));
  right.forEach(([k, v], i) => doc.text(`${k}: ${v || "-"}`, PAGE_LEFT + 290, infoTop + i * 14, { width: 225 }));
  doc.y = infoTop + left.length * 14 + 12;

  doc.font("Helvetica-Bold").fontSize(10).text("A. Travelling Expenses (outstation travel)", PAGE_LEFT, doc.y);
  doc.moveDown(0.2);
  let y = drawTable(
    doc,
    PAGE_LEFT,
    doc.y,
    [
      { header: "From Date", width: 60 },
      { header: "From Place", width: 100 },
      { header: "To Date", width: 60 },
      { header: "To Place", width: 100 },
      { header: "Mode", width: 90 },
      { header: "Fare (Rs.)", width: 75 },
    ],
    travelItems.map((i) => [i.fromDate, i.fromPlace, i.toDate, i.toPlace, i.mode || "-", Number(i.fare).toFixed(2)])
  );
  doc.font("Helvetica-Bold").fontSize(9).text(`Total (A): Rs. ${sectionTotal(travelItems, "fare").toFixed(2)}`, PAGE_LEFT, y + 4, { align: "right", width: PAGE_WIDTH });
  doc.y = y + 20;

  doc.font("Helvetica-Bold").fontSize(10).text("B. Conveyance Expenses (local travel)", PAGE_LEFT, doc.y);
  doc.moveDown(0.2);
  y = drawTable(
    doc,
    PAGE_LEFT,
    doc.y,
    [
      { header: "Date", width: 65 },
      { header: "From", width: 120 },
      { header: "To", width: 120 },
      { header: "Mode", width: 90 },
      { header: "Fare (Rs.)", width: 90 },
    ],
    conveyanceItems.map((i) => [i.date, i.from, i.to, i.mode || "-", Number(i.fare).toFixed(2)])
  );
  doc.font("Helvetica-Bold").fontSize(9).text(`Total (B): Rs. ${sectionTotal(conveyanceItems, "fare").toFixed(2)}`, PAGE_LEFT, y + 4, { align: "right", width: PAGE_WIDTH });
  doc.y = y + 20;

  doc.font("Helvetica-Bold").fontSize(10).text("C. Any Other Expenses (food bills, other office-related expenses)", PAGE_LEFT, doc.y);
  doc.moveDown(0.2);
  y = drawTable(
    doc,
    PAGE_LEFT,
    doc.y,
    [
      { header: "Date", width: 80 },
      { header: "Details", width: 305 },
      { header: "Amount (Rs.)", width: 100 },
    ],
    otherItems.map((i) => [i.date, i.details, Number(i.amount).toFixed(2)])
  );
  doc.font("Helvetica-Bold").fontSize(9).text(`Total (C): Rs. ${sectionTotal(otherItems, "amount").toFixed(2)}`, PAGE_LEFT, y + 4, { align: "right", width: PAGE_WIDTH });
  doc.y = y + 26;

  const summaryTop = doc.y;
  const advance = Number(record.advanceTaken || 0);
  const total = Number(record.totalAmount || 0);
  const balance = record.balance !== undefined ? Number(record.balance) : total - advance;
  doc.font("Helvetica").fontSize(9.5);
  const summaryLines = [
    ["Advance Taken from Office", `Rs. ${advance.toFixed(2)}`],
    ["Total Expenses (A+B+C)", `Rs. ${total.toFixed(2)}`],
    ["Balance if any", `Rs. ${balance.toFixed(2)}`],
    ["Total Expenses", `Rs. ${total.toFixed(2)}`],
    ["In Words", record.amountInWords || numberToWords(total)],
  ];
  summaryLines.forEach(([k, v], i) => {
    doc.font("Helvetica-Bold").text(`${k}:`, PAGE_LEFT, summaryTop + i * 15, { continued: true, width: 200 });
    doc.font("Helvetica").text(` ${v}`);
  });
  doc.y = summaryTop + summaryLines.length * 15 + 10;

  doc.font("Helvetica-Bold").fontSize(9).text(`Status: ${record.status}`, PAGE_LEFT, doc.y);
  doc.moveDown(2);

  const sigY = 760;
  const sigLabels = ["Signature of Claimant", "Head of the Dept", "Finance Dept", "Authorized Signatory"];
  const sigColW = PAGE_WIDTH / sigLabels.length;
  doc.font("Helvetica").fontSize(9);
  sigLabels.forEach((label, i) => {
    const cx = PAGE_LEFT + i * sigColW;
    doc.moveTo(cx, sigY).lineTo(cx + sigColW - 20, sigY).stroke();
    doc.text(label, cx, sigY + 4, { width: sigColW - 20 });
  });
}

// `records`: array of reimbursement docs (Firestore `id` + fields). One
// claim per page, laid out exactly like the EHSC Reimbursement Claim Form
// (RCF) — Sections A/B/C, Advance/Total/Balance, signature strip.
export function renderReimbursementPdf(records) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    records.forEach((record, idx) => {
      if (idx > 0) doc.addPage();
      drawClaimPage(doc, record);
      drawFooter(doc, { left: PAGE_LEFT, right: PAGE_RIGHT });
    });

    doc.end();
  });
}
