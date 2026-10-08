import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";

// The client's dropdown values (from their Lists sheet). The superadmin can
// edit them in Settings; anything not edited falls back to these defaults.
export const DEFAULT_DROPDOWN_LISTS = Object.freeze({
  projectStatus: ["Not Started", "Planning", "Ongoing", "On Hold", "Completed", "Cancelled"],
  priority: ["Critical", "High", "Medium", "Low"],
  risk: ["Low", "Medium", "High", "Critical"],
  paymentStatus: ["Not Invoiced", "Invoice Pending", "Invoiced", "Partially Paid", "Paid", "Overdue"],
  region: ["Asia Pacific", "Europe", "America", "Africa"],
});

export const DROPDOWN_LIST_LABELS = Object.freeze({
  projectStatus: "Project / Task Status",
  priority: "Priority",
  risk: "Risk",
  paymentStatus: "Payment Status",
  region: "Region",
});

const ref = () => db.collection(COLLECTIONS.HR_SETTINGS).doc("dropdown_lists");

export async function getDropdownLists() {
  const snap = await ref().get();
  const stored = snap.exists ? snap.data() : {};
  const out = {};
  for (const key of Object.keys(DEFAULT_DROPDOWN_LISTS)) {
    out[key] = Array.isArray(stored[key]) && stored[key].length > 0 ? stored[key] : [...DEFAULT_DROPDOWN_LISTS[key]];
  }
  return out;
}

// `updates` is { listKey: [values] } for any subset of lists. Returns the
// full merged lists, or throws a 400 with what is wrong.
export async function saveDropdownLists(updates, userId) {
  const clean = {};
  for (const [key, values] of Object.entries(updates || {})) {
    if (!(key in DEFAULT_DROPDOWN_LISTS)) throw Object.assign(new Error(`Unknown list: ${key}`), { status: 400 });
    if (!Array.isArray(values)) throw Object.assign(new Error(`${DROPDOWN_LIST_LABELS[key]} must be a list of values`), { status: 400 });
    const trimmed = values.map((v) => String(v).trim()).filter(Boolean);
    if (trimmed.length === 0) throw Object.assign(new Error(`${DROPDOWN_LIST_LABELS[key]} needs at least one value`), { status: 400 });
    if (trimmed.some((v) => v.length > 40)) throw Object.assign(new Error(`${DROPDOWN_LIST_LABELS[key]}: each value must be 40 characters or fewer`), { status: 400 });
    if (new Set(trimmed.map((v) => v.toLowerCase())).size !== trimmed.length) {
      throw Object.assign(new Error(`${DROPDOWN_LIST_LABELS[key]} has a repeated value`), { status: 400 });
    }
    clean[key] = trimmed;
  }
  await ref().set({ ...clean, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: userId }, { merge: true });
  return getDropdownLists();
}

// Returns an error string if `value` is set but not in that list, else null.
export function listValueError(lists, key, value) {
  if (value === undefined || value === null || value === "") return null;
  return lists[key].includes(value) ? null : `${DROPDOWN_LIST_LABELS[key]} must be one of: ${lists[key].join(", ")}`;
}

// Starting values for a brand-new project / plan action: Medium priority, Low
// risk, and the first status / payment status in each list.
export function startingValues(lists) {
  const pick = (list, preferred) => (list.includes(preferred) ? preferred : list[0]);
  return {
    status: lists.projectStatus[0],
    priority: pick(lists.priority, "Medium"),
    risk: pick(lists.risk, "Low"),
    paymentStatus: lists.paymentStatus[0],
  };
}
