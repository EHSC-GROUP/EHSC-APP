// Projects on a voucher as one readable string, e.g. "PRJ1 (Rs. 500.00), PRJ2 (Rs. 300.00)".
// A single project shows just its ID (it carries the whole total). Claims
// filed before multi-project support only have a free-text `projectName`.
export function formatProjects(record) {
  const projects = record.projects || [];
  if (projects.length === 1) return projects[0].projectId;
  if (projects.length > 1) return projects.map((p) => `${p.projectId} (Rs. ${Number(p.amountSpent).toFixed(2)})`).join(", ");
  return record.projectName || "";
}
