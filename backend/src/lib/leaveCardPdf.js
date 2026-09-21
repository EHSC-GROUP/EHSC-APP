import PDFDocument from "pdfkit";
import { drawTable } from "./pdfTable.js";
import { drawLetterhead, drawFooter } from "./pdfBranding.js";

const PAGE_LEFT = 30;
const PAGE_RIGHT = 812; // landscape A4 (841.89pt wide) minus 30pt margins each side

function drawCardPage(doc, card) {
  drawLetterhead(doc, { left: PAGE_LEFT, right: PAGE_RIGHT });
  doc.font("Helvetica-Bold").fontSize(12).text(`Leave Card for the Year ${card.fy}-${String(card.fy + 1).slice(-2)}`, { align: "center", width: PAGE_RIGHT - PAGE_LEFT });
  doc.moveDown(0.6);

  const infoTop = doc.y;
  doc.font("Helvetica").fontSize(9);
  const left = [
    ["Name", card.name],
    ["Department", card.department || "-"],
    ["Date of Joining", card.dateOfJoining || "-"],
  ];
  const mid = [
    ["Emp Code", card.employeeId],
    ["Location", card.location || "-"],
    ["Date of Confirmation", card.dateOfConfirmation || "-"],
  ];
  const right = [
    ["Previous Year's Accumulation", card.previousAccumulation],
    ["Eligibility as on", card.eligibility],
  ];
  left.forEach(([k, v], i) => doc.text(`${k}: ${v || "-"}`, PAGE_LEFT, infoTop + i * 14, { width: 240 }));
  mid.forEach(([k, v], i) => doc.text(`${k}: ${v || "-"}`, PAGE_LEFT + 260, infoTop + i * 14, { width: 240 }));
  right.forEach(([k, v], i) => doc.text(`${k}: ${v}`, PAGE_LEFT + 540, infoTop + i * 14, { width: 220 }));
  doc.y = infoTop + left.length * 14 + 14;

  const fixedWidths = [28, 190, 60, 60, 50, 110, 110, 60];
  const columns = [
    { header: "Sl.No", width: fixedWidths[0] },
    { header: "Reasons for Leave", width: fixedWidths[1] },
    { header: "From", width: fixedWidths[2] },
    { header: "To", width: fixedWidths[3] },
    { header: "No. of Days", width: fixedWidths[4] },
    { header: "Employee's Signature", width: fixedWidths[5] },
    { header: "Approval Authority/HR", width: fixedWidths[6] },
    { header: "Leave Balance", width: fixedWidths[7] },
    { header: "Remarks", width: (PAGE_RIGHT - PAGE_LEFT) - fixedWidths.reduce((s, w) => s + w, 0) },
  ];
  const rows = card.rows.map((r) => [r.slNo, r.reasonsForLeave, r.from, r.to, r.days, "", "", r.balance === null ? "-" : r.balance, r.remarks]);
  drawTable(doc, PAGE_LEFT, doc.y, columns, rows);
}

// One employee's Leave Card per page — header details (name, emp code,
// department, location, joining/confirmation dates, previous accumulation
// & this year's eligibility) plus a running leave log with blank
// signature/approval columns, matching the paper BE-HR-F01 leave card.
export function renderLeaveCardPdf(cards) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    cards.forEach((card, idx) => {
      if (idx > 0) doc.addPage();
      drawCardPage(doc, card);
      drawFooter(doc, { left: PAGE_LEFT, right: PAGE_RIGHT });
    });

    doc.end();
  });
}
