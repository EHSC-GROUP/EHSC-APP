// Indian digit grouping (##,##,###.##), used everywhere a rupee amount is
// shown in the Payslip Generator.
export function formatINR(amount) {
  const n = Number(amount || 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
