// Shared bordered-table drawing helper for pdfkit documents — used by the
// reimbursement claim form, leave card and material indent form exports so
// their tables render consistently (same cell/border/font logic).
export function drawTable(doc, x, y, columns, rows, { rowHeight = 16 } = {}) {
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);
  let curY = y;

  doc.font("Helvetica-Bold").fontSize(8);
  columns.reduce((cx, col) => {
    doc.rect(cx, curY, col.width, rowHeight).stroke();
    doc.text(col.header, cx + 3, curY + 4, { width: col.width - 6 });
    return cx + col.width;
  }, x);
  curY += rowHeight;

  doc.font("Helvetica").fontSize(8);
  if (rows.length === 0) {
    doc.rect(x, curY, totalWidth, rowHeight).stroke();
    doc.text("—", x + 3, curY + 4);
    curY += rowHeight;
  } else {
    for (const row of rows) {
      columns.reduce((cx, col, i) => {
        doc.rect(cx, curY, col.width, rowHeight).stroke();
        doc.text(String(row[i] ?? ""), cx + 3, curY + 4, { width: col.width - 6 });
        return cx + col.width;
      }, x);
      curY += rowHeight;
    }
  }
  return curY;
}
