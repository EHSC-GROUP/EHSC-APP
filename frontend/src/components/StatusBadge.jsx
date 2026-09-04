export default function StatusBadge({ status }) {
  if (!status) return null;
  return <span className={`badge-pill badge-${status}`}>{status.replace(/_/g, " ")}</span>;
}
