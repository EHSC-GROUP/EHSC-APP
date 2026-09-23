import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";
import { financialYearOf } from "./dateUtils.js";

// "26-27" for FY start year 2026 (Apr 2026 - Mar 2027).
function fyLabel(fyStartYear) {
  return `${String(fyStartYear).slice(-2)}-${String(fyStartYear + 1).slice(-2)}`;
}

// Sequential, per-financial-year voucher numbers — "EV 26-27/001" for
// reimbursements, "MI 26-27/001" for material indents. The counter is keyed
// by (prefix, FY start year), so it resets to 001 on its own the moment a
// voucher's date rolls into a new FY — no rollover job needed.
export async function nextVoucherNumber(prefix, dateStr) {
  const fyStart = financialYearOf(dateStr);
  const label = fyLabel(fyStart);
  const counterRef = db.collection(COLLECTIONS.HR_SETTINGS).doc(`voucher_seq_${prefix}_${fyStart}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const next = (snap.exists ? snap.data().last : 0) + 1;
    tx.set(counterRef, { last: next, fyLabel: label, prefix }, { merge: true });
    return `${prefix} ${label}/${String(next).padStart(3, "0")}`;
  });
}

// Read-only preview of what the NEXT number would be, for showing on the
// submission form before the voucher is actually created — doesn't touch
// the counter, so opening/abandoning the form never burns a number. The
// real one is only ever assigned atomically by nextVoucherNumber() above,
// so this can drift by a number or two under concurrent submissions; it's
// a preview, not a reservation.
export async function peekNextVoucherNumber(prefix, dateStr) {
  const fyStart = financialYearOf(dateStr);
  const label = fyLabel(fyStart);
  const snap = await db.collection(COLLECTIONS.HR_SETTINGS).doc(`voucher_seq_${prefix}_${fyStart}`).get();
  const next = (snap.exists ? snap.data().last : 0) + 1;
  return `${prefix} ${label}/${String(next).padStart(3, "0")}`;
}
