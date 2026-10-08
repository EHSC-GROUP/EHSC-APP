// Every date shown to users is DD/MM/YYYY. Values are still stored and sent
// as ISO (YYYY-MM-DD) — only the display and the date inputs use this format.

const pad = (n) => String(n).padStart(2, "0");

// Accepts "YYYY-MM-DD", a full ISO timestamp, a Date, or a Firestore timestamp.
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const secs = v._seconds ?? v.seconds;
    if (secs != null) return new Date(secs * 1000);
    return null;
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return null; // plain date handled below
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(v) {
  if (!v) return "";
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m && v.length === 10) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = toDate(v);
  if (!d) return typeof v === "string" ? v : "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function fmtDateTime(v) {
  const d = toDate(v);
  if (!d) return fmtDate(v);
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "DD/MM/YYYY" -> "YYYY-MM-DD" ("" if not a real date).
export function parseDMY(text) {
  const m = (text || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (d.getFullYear() !== Number(yyyy) || d.getMonth() !== Number(mm) - 1 || d.getDate() !== Number(dd)) return "";
  return `${yyyy}-${mm}-${dd}`;
}
