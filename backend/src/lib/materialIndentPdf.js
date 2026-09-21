import PDFDocument from "pdfkit";
import { drawTable } from "./pdfTable.js";
import { drawLetterhead, drawFooter } from "./pdfBranding.js";

const PAGE_LEFT = 40;
const PAGE_RIGHT = 555;
const PAGE_WIDTH = PAGE_RIGHT - PAGE_LEFT;

function drawIndentPage(doc, record) {
  const top = drawLetterhead(doc, { left: PAGE_LEFT, right: PAGE_RIGHT });
  doc.rect(PAGE_LEFT, top, PAGE_WIDTH, 20).stroke();
  doc.font("Helvetica-Bold").fontSize(11).text("Material Indent Form (MIF)", PAGE_LEFT, top + 6, { align: "center", width: PAGE_WIDTH });

  doc.font("Helvetica").fontSize(9);
  doc.text(`Raised Date: ${record.raisedDate || "-"}`, PAGE_LEFT, top + 32);
  doc.text(`Indent By: ${record.name || record.userId}`, PAGE_LEFT + 280, top + 32);
  doc.y = top + 50;

  const y = drawTable(
    doc,
    PAGE_LEFT,
    doc.y,
    [
      { header: "Sl.No", width: 35 },
      { header: "Required Date", width: 80 },
      { header: "Item / Material", width: 220 },
      { header: "Qty", width: 50 },
      { header: "Rate", width: 65 },
      { header: "Amount", width: PAGE_WIDTH - (35 + 80 + 220 + 50 + 65) },
    ],
    record.items.map((i, idx) => [idx + 1, i.requiredDate || "-", i.itemMaterial, i.qty, Number(i.rate).toFixed(2), Number(i.amount).toFixed(2)])
  );
  doc.font("Helvetica-Bold").fontSize(9).text(`Total: Rs. ${Number(record.totalAmount).toFixed(2)}`, PAGE_LEFT, y + 4, { align: "right", width: PAGE_WIDTH });
  doc.y = y + 24;

  doc.font("Helvetica-Bold").fontSize(9).text("Required for / Purpose of Indent", PAGE_LEFT, doc.y);
  doc.font("Helvetica").fontSize(9).text(record.purpose || "-", PAGE_LEFT, doc.y + 12, { width: PAGE_WIDTH });
  doc.y += 40;

  doc.font("Helvetica-Bold").fontSize(9).text(`Status: ${record.status}`, PAGE_LEFT, doc.y);
  doc.y += 30;

  doc.font("Helvetica").fontSize(9);
  doc.text(`Prepared By: ${record.preparedBy || record.name || "-"}`, PAGE_LEFT, doc.y);
  doc.text(`Verified & Approved By: ${record.verifiedApprovedBy || "-"}`, PAGE_LEFT + 280, doc.y);
}

// `records`: array of material indent docs. One indent per page, mirroring
// the EHSC Material Indent Form (MIF) layout.
export function renderMaterialIndentPdf(records) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    records.forEach((record, idx) => {
      if (idx > 0) doc.addPage();
      drawIndentPage(doc, record);
      drawFooter(doc, { left: PAGE_LEFT, right: PAGE_RIGHT });
    });

    doc.end();
  });
}
