import PDFDocument from "pdfkit";
import { numberToWords } from "./numberToWords.js";
import { drawLetterhead, drawFooter } from "./pdfBranding.js";

const PAGE = { left: 40, right: 555 };

function drawPayslipPage(doc, payslip) {
    drawLetterhead(doc, PAGE);
    doc.fontSize(12).font("Helvetica-Bold").text(`Payslip for ${payslip.period}`, { align: "center" });
    doc.moveDown();

    const infoTop = doc.y;
    doc.fontSize(9).font("Helvetica");
    const left = [
      ["Employee Name", payslip.name],
      ["Employee No.", payslip.employeeId],
      ["Designation", payslip.designation],
      ["Date of Joining", payslip.dateOfJoining || "-"],
    ];
    const right = [
      ["Days in Month", payslip.daysInMonth],
      ["Payable Days", payslip.payableDays],
      ["Present Days", payslip.presentDays],
      ["LOP Days", payslip.lopDays],
    ];
    left.forEach(([k, v], i) => doc.text(`${k}: ${v ?? "-"}`, 40, infoTop + i * 14));
    right.forEach(([k, v], i) => doc.text(`${k}: ${v ?? "-"}`, 320, infoTop + i * 14));
    doc.y = infoTop + left.length * 14 + 10;

    doc.moveDown();
    const tableTop = doc.y;
    const colWidths = [130, 80, 130, 80];
    const colX = [40, 170, 290, 420];
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Earnings", colX[0], tableTop);
    doc.text("Amount", colX[1], tableTop);
    doc.text("Deductions", colX[2], tableTop);
    doc.text("Amount", colX[3], tableTop);
    doc.moveTo(40, tableTop + 15).lineTo(555, tableTop + 15).stroke();

    const earnings = [
      ["Basic", payslip.basic],
      ["HRA", payslip.hra],
      ["Transportation Allowance", payslip.transportAllowance],
      ["Special Allowance", payslip.specialAllowance],
      ["Statutory Bonus-Others", payslip.others],
      ["Incentives", payslip.incentives],
    ];
    const deductions = [
      ["Professional Tax", payslip.pt],
      ["TDS", payslip.incomeTax],
      ["Medical Insurance", payslip.medicalAllowance],
      ["Other Deductions", payslip.othersDeduction],
    ];
    doc.font("Helvetica").fontSize(9);
    let rowY = tableTop + 22;
    for (let i = 0; i < Math.max(earnings.length, deductions.length); i++) {
      if (earnings[i]) {
        doc.text(earnings[i][0], colX[0], rowY);
        doc.text(Number(earnings[i][1] || 0).toFixed(2), colX[1], rowY);
      }
      if (deductions[i]) {
        doc.text(deductions[i][0], colX[2], rowY);
        doc.text(Number(deductions[i][1] || 0).toFixed(2), colX[3], rowY);
      }
      rowY += 16;
    }
    doc.moveTo(40, rowY).lineTo(555, rowY).stroke();
    rowY += 6;
    doc.font("Helvetica-Bold");
    doc.text("Total Earnings", colX[0], rowY);
    doc.text(Number(payslip.totalEarnings).toFixed(2), colX[1], rowY);
    doc.text("Total Deductions", colX[2], rowY);
    doc.text(Number(payslip.totalDeductions).toFixed(2), colX[3], rowY);

    rowY += 30;
    doc.fontSize(12).text(`Net Pay: Rs. ${Number(payslip.netPay).toFixed(2)}`, 40, rowY);
    rowY += 18;
    doc.fontSize(9).font("Helvetica-Oblique").text(`(${numberToWords(payslip.netPay)})`, 40, rowY, { width: 515 });

    doc.fontSize(9).font("Helvetica");
    doc.text("Employee Signature", 40, 760);
    doc.text("Authorized Signatory", 420, 760);
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
