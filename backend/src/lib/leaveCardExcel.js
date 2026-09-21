import ExcelJS from "exceljs";

const COLUMNS = [
  { header: "Sl.No", key: "slNo", width: 8 },
  { header: "Reasons for Leave", key: "reasonsForLeave", width: 32 },
  { header: "From", key: "from", width: 14 },
  { header: "To", key: "to", width: 14 },
  { header: "No. of Days", key: "days", width: 12 },
  { header: "Leave Balance", key: "balance", width: 14 },
  { header: "Remarks", key: "remarks", width: 16 },
];

// Sheet names are capped at 31 chars and can't repeat within a workbook —
// dedupe by suffixing a counter if two employees somehow collide once
// truncated.
function safeSheetName(workbook, name) {
  const base = name.replace(/[*?:/\\[\]]/g, " ").slice(0, 28);
  let candidate = base || "Employee";
  let n = 2;
  while (workbook.getWorksheet(candidate)) {
    candidate = `${base} (${n++})`.slice(0, 31);
  }
  return candidate;
}

function addCardSheet(workbook, card) {
  const sheet = workbook.addWorksheet(safeSheetName(workbook, `${card.name} ${card.fy}`));
  sheet.addRow([`Leave Card for the Year ${card.fy}-${String(card.fy + 1).slice(-2)}`]).font = { bold: true, size: 13 };
  sheet.addRow([]);
  sheet.addRow(["Name", card.name, "", "Emp Code", card.employeeId]);
  sheet.addRow(["Department", card.department || "", "", "Location", card.location || ""]);
  sheet.addRow(["Date of Joining", card.dateOfJoining || "", "", "Date of Confirmation", card.dateOfConfirmation || ""]);
  sheet.addRow(["Previous Year's Accumulation", card.previousAccumulation, "", "Eligibility as on", card.eligibility]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(COLUMNS.map((c) => c.header));
  headerRow.font = { bold: true };
  for (const r of card.rows) {
    sheet.addRow([r.slNo, r.reasonsForLeave, r.from, r.to, r.days, r.balance === null ? "-" : r.balance, r.remarks]);
  }
  COLUMNS.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });
  return sheet;
}

// `cards`: array of getLeaveCardData() results — one worksheet per
// employee, laid out to mirror the printed Leave Card (BE-HR-F01).
export async function buildLeaveCardWorkbook(cards) {
  const workbook = new ExcelJS.Workbook();
  for (const card of cards) addCardSheet(workbook, card);
  return workbook;
}
