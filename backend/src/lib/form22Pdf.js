import PDFDocument from "pdfkit";

const COMPANY_NAME = process.env.COMPANY_NAME || "Your Company Pvt Ltd";
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || "";

// Karnataka Muster Roll cum Register of Wages (Form 22) — one landscape
// page per employee, built from the exact same computed payslip data
// (dayMarks, basic/hra/others/deductions) so the export always reconciles
// with the payslip for the same period.
export function renderForm22Pdf(period, payslips) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    payslips.forEach((p, idx) => {
      if (idx > 0) doc.addPage();
      drawPage(doc, period, p);
    });

    doc.end();
  });
}

function drawPage(doc, period, p) {
  doc.fontSize(14).font("Helvetica-Bold").text(COMPANY_NAME, { align: "center" });
  if (COMPANY_ADDRESS) doc.fontSize(9).font("Helvetica").text(COMPANY_ADDRESS, { align: "center" });
  doc.fontSize(11).font("Helvetica-Bold").text("Muster Roll cum Register of Wages (Form 22)", { align: "center" });
  doc.fontSize(9).font("Helvetica").text(`Wage Period: ${period}`, { align: "center" });
  doc.moveDown();

  const infoY = doc.y;
  doc.fontSize(9);
  doc.text(`Name: ${p.name || ""}`, 30, infoY);
  doc.text(`Employee No: ${p.employeeId || ""}`, 300, infoY);
  doc.text(`Designation: ${p.designation || ""}`, 550, infoY);
  doc.text(`Date of Joining: ${p.dateOfJoining || "-"}`, 30, infoY + 14);
  doc.text(`Days in Month: ${p.daysInMonth}`, 300, infoY + 14);
  doc.text(`Payable Days: ${p.payableDays}`, 550, infoY + 14);
  doc.y = infoY + 32;

  // Day-by-day muster row.
  doc.moveDown(0.5);
  const marks = p.dayMarks || [];
  const startX = 30;
  const colW = (802 - 60) / Math.max(marks.length, 1);
  const rowY = doc.y;
  doc.fontSize(7).font("Helvetica-Bold");
  marks.forEach((m, i) => doc.text(String(m.day), startX + i * colW, rowY, { width: colW, align: "center" }));
  doc.font("Helvetica");
  marks.forEach((m, i) => doc.text(m.mark, startX + i * colW, rowY + 10, { width: colW, align: "center" }));
  doc.y = rowY + 26;

  doc.moveDown();
  doc.fontSize(8).font("Helvetica-Oblique").text("H = Holiday, W = Weekly Off, P = Present, A = Absent, HD = Half Day, other codes = leave type", 30, doc.y);
  doc.moveDown();

  const tableTop = doc.y + 6;
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text("Earnings", 30, tableTop);
  doc.text("Amount", 150, tableTop);
  doc.text("Deductions", 300, tableTop);
  doc.text("Amount", 420, tableTop);
  doc.moveTo(30, tableTop + 14).lineTo(770, tableTop + 14).stroke();

  const earnings = [["Basic", p.basic], ["HRA", p.hra], ["Others", p.others], ["Incentives", p.incentives]];
  const deductions = [["PT", p.pt], ["Income Tax", p.incomeTax], ["ESI", p.esi], ["Other Deductions", p.othersDeduction]];
  doc.font("Helvetica").fontSize(9);
  let rowY2 = tableTop + 20;
  for (let i = 0; i < 4; i++) {
    doc.text(earnings[i][0], 30, rowY2);
    doc.text(Number(earnings[i][1] || 0).toFixed(2), 150, rowY2);
    doc.text(deductions[i][0], 300, rowY2);
    doc.text(Number(deductions[i][1] || 0).toFixed(2), 420, rowY2);
    rowY2 += 14;
  }
  doc.font("Helvetica-Bold");
  doc.text(`Total Earnings: ${Number(p.totalEarnings).toFixed(2)}`, 30, rowY2 + 6);
  doc.text(`Total Deductions: ${Number(p.totalDeductions).toFixed(2)}`, 300, rowY2 + 6);
  doc.text(`Net Wage: ${Number(p.netPay).toFixed(2)}`, 570, rowY2 + 6);

  doc.font("Helvetica").fontSize(9);
  doc.text("Signature of Employee", 30, 520);
  doc.text("Signature of Employer", 620, 520);
}
