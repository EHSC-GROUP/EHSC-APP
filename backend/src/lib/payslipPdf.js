import PDFDocument from "pdfkit";
import { numberToWords } from "./numberToWords.js";
import { drawLetterhead, drawFooter } from "./pdfBranding.js";
import { fmtDMY } from "./dateUtils.js";

const PAGE = { left: 40, right: 555 };
const BLUE = "#1d4ed8";
const LIGHT_GREY = "#f1f5f9";
const COMPANY_NAME = process.env.COMPANY_NAME || "EHS Consultants";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(period) {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
}

function money(n) {
  return Number(n || 0).toFixed(2);
}

// A bordered rectangular grid of [label, value] cells, `perRow` per row —
// the §1 info block (Name/Employee No., Designation/DOJ, Days in
// Month/Payable Days).
function drawInfoTable(doc, rows, { left, right }) {
  const cols = 2;
  const colWidth = (right - left) / cols;
  const rowHeight = 18;
  const top = doc.y;
  doc.lineWidth(0.75).rect(left, top, right - left, rowHeight * rows.length).stroke();
  for (let r = 0; r < rows.length; r++) {
    if (r > 0) doc.moveTo(left, top + r * rowHeight).lineTo(right, top + r * rowHeight).stroke();
    for (let c = 0; c < cols; c++) {
      const cell = rows[r][c];
      if (!cell) continue;
      const x = left + c * colWidth;
      if (c > 0) doc.moveTo(x, top + r * rowHeight).lineTo(x, top + (r + 1) * rowHeight).stroke();
      doc.font("Helvetica-Bold").fontSize(9).text(`${cell[0]}: `, x + 8, top + r * rowHeight + 5, { continued: true });
      doc.font("Helvetica").text(`${cell[1] ?? "-"}`);
    }
  }
  doc.y = top + rowHeight * rows.length + 10;
}

function drawPayslipPage(doc, payslip) {
  drawLetterhead(doc, PAGE);
  doc.fontSize(12).font("Helvetica-Bold").fillColor("#000")
    .text(`Pay slip for the month of ${monthLabel(payslip.period)}`, PAGE.left, doc.y, { align: "center", width: PAGE.right - PAGE.left });
  doc.moveDown(0.5);

  drawInfoTable(doc, [
    [["Name", payslip.name], ["Employee No.", payslip.employeeId]],
    [["Designation", payslip.designation], ["Date of Joining", fmtDMY(payslip.dateOfJoining) || "-"]],
    [["Days in Month", payslip.daysInMonth], ["Payable Days", payslip.payableDays]],
  ], PAGE);

  // Earnings / Deductions table — header row filled solid blue, white bold text.
  const colX = [PAGE.left, PAGE.left + 190, PAGE.left + 300, PAGE.right - 85];
  const headerTop = doc.y;
  doc.rect(PAGE.left, headerTop, PAGE.right - PAGE.left, 18).fill(BLUE);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);
  doc.text("Earnings", colX[0] + 6, headerTop + 5);
  doc.text("Deductions", colX[2] + 6, headerTop + 5);
  doc.fillColor("#000");

  const earnings = [
    ["Basic", payslip.basic],
    ["HRA", payslip.hra],
    ["Transportation Allowance", payslip.transportAllowance],
    ["Special Allowance", payslip.specialAllowance],
    ["Statutory Bonus-Others", payslip.others],
    ...(payslip.incentives ? [["Incentives", payslip.incentives]] : []),
  ];
  const deductions = [
    ["Professional Tax", payslip.pt],
    ["Income Tax (TDS)", payslip.incomeTax],
    ["ESI", payslip.esi],
    ...(payslip.othersDeduction ? [["Other Deductions", payslip.othersDeduction]] : []),
  ];

  doc.font("Helvetica").fontSize(9);
  let rowY = headerTop + 24;
  const rowCount = Math.max(earnings.length, deductions.length);
  for (let i = 0; i < rowCount; i++) {
    if (earnings[i]) {
      doc.text(earnings[i][0], colX[0], rowY, { width: colX[1] - colX[0] - 6 });
      doc.text(money(earnings[i][1]), colX[1] - 60, rowY, { width: 60, align: "right" });
    }
    if (deductions[i]) {
      doc.text(deductions[i][0], colX[2], rowY, { width: colX[3] - colX[2] - 6 });
      doc.text(money(deductions[i][1]), colX[3], rowY, { width: PAGE.right - colX[3], align: "right" });
    }
    rowY += 15;
  }
  doc.moveTo(PAGE.left, rowY).lineTo(PAGE.right, rowY).lineWidth(0.5).stroke();

  // Totals row, light-grey fill.
  const totalsTop = rowY + 2;
  doc.rect(PAGE.left, totalsTop, PAGE.right - PAGE.left, 18).fill(LIGHT_GREY);
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(9);
  doc.text("Gross Income:", colX[0], totalsTop + 5, { width: colX[1] - colX[0] - 6 });
  doc.text(money(payslip.totalEarnings), colX[1] - 60, totalsTop + 5, { width: 60, align: "right" });
  doc.text("Total Deduction:", colX[2], totalsTop + 5, { width: colX[3] - colX[2] - 6 });
  doc.text(money(payslip.totalDeductions), colX[3], totalsTop + 5, { width: PAGE.right - colX[3], align: "right" });

  doc.y = totalsTop + 30;

  // Bordered Net Pay box.
  const netTop = doc.y;
  const netHeight = 42;
  doc.rect(PAGE.left, netTop, PAGE.right - PAGE.left, netHeight).lineWidth(0.75).stroke();
  doc.font("Helvetica-Bold").fontSize(12).text(`Net Pay: Rs. ${money(payslip.netPay)}`, PAGE.left + 10, netTop + 8);
  doc.font("Helvetica").fontSize(9).text(`(Rupees ${numberToWords(payslip.netPay).replace(/ Only$/, "")} Only)`, PAGE.left + 10, netTop + 25, { width: PAGE.right - PAGE.left - 20 });

  doc.y = netTop + netHeight + 26;
  doc.font("Helvetica-Bold").fontSize(9).text(`For ${COMPANY_NAME}`, PAGE.right - 180, doc.y, { width: 180, align: "center" });
  doc.font("Helvetica").fontSize(9).text("Authorized Signatory", PAGE.right - 180, doc.y + 32, { width: 180, align: "center" });
}

export function renderPayslipPdf(payslip) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    drawPayslipPage(doc, payslip);
    drawFooter(doc, PAGE);
    doc.end();
  });
}

// One page per payslip, in the order given.
export function renderConsolidatedPayslipPdf(payslips) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    payslips.forEach((p, i) => {
      if (i > 0) doc.addPage();
      drawPayslipPage(doc, p);
      drawFooter(doc, PAGE);
    });
    doc.end();
  });
}
