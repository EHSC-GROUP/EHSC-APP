import ExcelJS from "exceljs";

const COLUMNS = [
  { header: "Employee ID", key: "employeeId", width: 14 },
  { header: "Name", key: "name", width: 22 },
  { header: "Designation", key: "designation", width: 18 },
  { header: "Days In Month", key: "daysInMonth", width: 12 },
  { header: "Payable Days", key: "payableDays", width: 12 },
  { header: "Present Days", key: "presentDays", width: 12 },
  { header: "Paid Leave Days", key: "paidLeaveDays", width: 14 },
  { header: "LOP Days", key: "lopDays", width: 10 },
  { header: "Gross", key: "gross", width: 12 },
  { header: "Basic", key: "basic", width: 12 },
  { header: "HRA", key: "hra", width: 12 },
  { header: "Others", key: "others", width: 12 },
  { header: "Incentives", key: "incentives", width: 12 },
  { header: "Total Earnings", key: "totalEarnings", width: 14 },
  { header: "PT", key: "pt", width: 10 },
  { header: "Income Tax", key: "incomeTax", width: 12 },
  { header: "ESI", key: "esi", width: 10 },
  { header: "Other Deductions", key: "othersDeduction", width: 14 },
  { header: "Total Deductions", key: "totalDeductions", width: 14 },
  { header: "Net Pay", key: "netPay", width: 14 },
  { header: "Status", key: "status", width: 12 },
];

export async function buildPayrollRegisterWorkbook(period, payslips) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Payroll ${period}`);
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };
  for (const p of payslips) sheet.addRow(p);
  return workbook;
}
