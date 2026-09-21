import ExcelJS from "exceljs";

const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors the frontend Gantt's status coloring (frontend/src/pages/Admin/ProjectTracker.jsx
// + the --gantt-* tokens in styles.css) so the export looks like the on-screen chart.
const STATUS_COLOR = {
  good: "FF0CA30C", // completed
  critical: "FFD03B3B", // overdue
  pending: "FF2A78D6", // on track
};
const STATUS_LABEL = { good: "Completed", critical: "Overdue", pending: "On Track" };
const TODAY_FILL = "FFFFF3B0";
const LABEL_COLS = ["Client", "Action", "Assigned To", "Start", "Due", "Status"];
const DAY_COL_WIDTH = 3;

function parseDate(d) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function addDays(date, n) {
  return new Date(date.getTime() + n * DAY_MS);
}
function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}
function statusOf(action, today) {
  if (action.completed) return "good";
  const due = parseDate(action.dueDate);
  if (due && due < today) return "critical";
  return "pending";
}

// `rows`: [{ clientName, description, assignedToName, assignedTo, startDate, dueDate, completed }]
export async function buildGanttWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Gantt Chart", { views: [{ state: "frozen", xSplit: LABEL_COLS.length, ySplit: 3 }] });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let rangeStart = today;
  let rangeEnd = today;
  if (rows.length > 0) {
    let minDate = today;
    let maxDate = today;
    for (const r of rows) {
      const s = parseDate(r.startDate) || parseDate(r.dueDate);
      const d = parseDate(r.dueDate) || s;
      if (s && s < minDate) minDate = s;
      if (d && d > maxDate) maxDate = d;
    }
    rangeStart = addDays(minDate, -2);
    rangeEnd = addDays(maxDate, 2);
  } else {
    rangeStart = addDays(today, -3);
    rangeEnd = addDays(today, 11);
  }
  const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd));

  // Row 1: title + legend
  sheet.mergeCells(1, 1, 1, 4);
  const title = sheet.getCell(1, 1);
  title.value = `Project Tracker — Gantt export (${today.toISOString().slice(0, 10)})`;
  title.font = { bold: true, size: 13 };

  const legendStart = 6;
  ["good", "pending", "critical"].forEach((status, i) => {
    const col = legendStart + i * 2;
    const swatch = sheet.getCell(1, col);
    swatch.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_COLOR[status] } };
    const label = sheet.getCell(1, col + 1);
    label.value = STATUS_LABEL[status];
    label.font = { size: 10 };
  });

  // Row 2: month bands across the day columns
  let col = LABEL_COLS.length + 1;
  let d = 0;
  while (d <= totalDays) {
    const date = addDays(rangeStart, d);
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    let span = 1;
    while (d + span <= totalDays) {
      const next = addDays(rangeStart, d + span);
      if (`${next.getFullYear()}-${next.getMonth()}` !== monthKey) break;
      span++;
    }
    if (span > 1) sheet.mergeCells(2, col, 2, col + span - 1);
    const cell = sheet.getCell(2, col);
    cell.value = date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "center" };
    col += span;
    d += span;
  }

  // Row 3: header — label columns + one column per day
  LABEL_COLS.forEach((h, i) => {
    const cell = sheet.getCell(3, i + 1);
    cell.value = h;
    cell.font = { bold: true };
  });
  for (let i = 0; i <= totalDays; i++) {
    const date = addDays(rangeStart, i);
    const cell = sheet.getCell(3, LABEL_COLS.length + 1 + i);
    cell.value = date.getDate();
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "center" };
    if (daysBetween(today, date) === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TODAY_FILL } };
  }

  // Column widths
  sheet.getColumn(1).width = 18; // Client
  sheet.getColumn(2).width = 46; // Action
  sheet.getColumn(3).width = 18; // Assigned To
  sheet.getColumn(4).width = 11; // Start
  sheet.getColumn(5).width = 11; // Due
  sheet.getColumn(6).width = 11; // Status
  for (let i = 0; i <= totalDays; i++) sheet.getColumn(LABEL_COLS.length + 1 + i).width = DAY_COL_WIDTH;

  // Data rows, grouped by client with a bold separator row.
  let rowNum = 4;
  const byClient = new Map();
  for (const r of rows) {
    if (!byClient.has(r.clientName)) byClient.set(r.clientName, []);
    byClient.get(r.clientName).push(r);
  }

  for (const [clientName, actions] of byClient) {
    const groupRow = sheet.getRow(rowNum);
    groupRow.getCell(1).value = clientName;
    groupRow.getCell(1).font = { bold: true };
    sheet.mergeCells(rowNum, 1, rowNum, LABEL_COLS.length + totalDays + 1);
    groupRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF1F5" } };
    rowNum++;

    for (const a of actions) {
      const status = statusOf(a, today);
      const start = parseDate(a.startDate) || parseDate(a.dueDate) || today;
      const due = parseDate(a.dueDate) || start;
      const row = sheet.getRow(rowNum);
      row.getCell(1).value = clientName;
      row.getCell(2).value = a.description;
      row.getCell(3).value = a.assignedToName || a.assignedTo || "";
      row.getCell(4).value = a.startDate || "";
      row.getCell(5).value = a.dueDate || "";
      row.getCell(6).value = STATUS_LABEL[status];

      const startOffset = Math.max(0, daysBetween(rangeStart, start));
      const dueOffset = Math.min(totalDays, daysBetween(rangeStart, due));
      for (let i = startOffset; i <= dueOffset; i++) {
        row.getCell(LABEL_COLS.length + 1 + i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_COLOR[status] } };
      }
      rowNum++;
    }
  }

  return workbook;
}
