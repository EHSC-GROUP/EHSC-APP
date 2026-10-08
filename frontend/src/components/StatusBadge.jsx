// Display wording differs from the stored status codes in a few places:
// Out of Office is shown as "On Duty", and an Absent day is Loss of Pay.
const LABELS = {
  OUT_OF_OFFICE: "On Duty",
  PENDING_OOO: "On Duty — pending approval",
  ABSENT: "LOP",
  WFH: "Work From Home",
  PENDING_WFH: "Work From Home — pending approval",
};

export default function StatusBadge({ status }) {
  if (!status) return null;
  return <span className={`badge-pill badge-${status}`}>{LABELS[status] || status.replace(/_/g, " ")}</span>;
}
