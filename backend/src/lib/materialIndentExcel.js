import ExcelJS from "exceljs";

const COLUMNS = [
  { header: "Voucher No", key: "voucherNo", width: 16 },
  { header: "Raised Date", key: "raisedDate", width: 14 },
  { header: "Indent By", key: "name", width: 20 },
  { header: "Item / Material", key: "itemMaterial", width: 28 },
  { header: "Required Date", key: "requiredDate", width: 14 },
  { header: "Qty", key: "qty", width: 10 },
  { header: "Rate", key: "rate", width: 12 },
  { header: "Amount", key: "amount", width: 14 },
  { header: "Purpose", key: "purpose", width: 26 },
  { header: "Status", key: "status", width: 12 },
  { header: "Prepared By", key: "preparedBy", width: 18 },
  { header: "Verified & Approved By", key: "verifiedApprovedBy", width: 20 },
];

// One row per item (not per indent) so quantities/rates stay analyzable —
// the indent-level fields repeat across its item rows.
export async function buildMaterialIndentRegisterWorkbook(records) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Material Indents");
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };

  for (const r of records) {
    for (const item of r.items) {
      sheet.addRow({
        voucherNo: r.voucherNo || "",
        raisedDate: r.raisedDate,
        name: r.name || r.userId,
        itemMaterial: item.itemMaterial,
        requiredDate: item.requiredDate || "",
        qty: item.qty,
        rate: item.rate,
        amount: item.amount,
        purpose: r.purpose,
        status: r.status,
        preparedBy: r.preparedBy || "",
        verifiedApprovedBy: r.verifiedApprovedBy || "",
      });
    }
  }
  return workbook;
}
