import { db } from "../config/firebase.js";
import { COLLECTIONS, ATTENDANCE_STATUS_VALUES } from "./constants.js";
import { eachDate, monthBounds } from "./dateUtils.js";

const PRESENT_EQUIVALENT = new Set([
  ATTENDANCE_STATUS_VALUES.PRESENT,
  ATTENDANCE_STATUS_VALUES.HALF_DAY,
  ATTENDANCE_STATUS_VALUES.OUT_OF_OFFICE,
]);

// Returns a Map<dateStr, boolean> — true if the employee has a Daily
// Status record that counts as present-equivalent that day (marked
// Present, Half Day, or an approved Out of Office). Informational only
// (systemPresentDays / muster 'P' marks); never used to set presentDays —
// that stays manual-entry-only, always (see payslipCompute.js).
export async function attendanceMarksForMonth(userId, period) {
  const { start, end } = monthBounds(period);
  const dates = [...eachDate(start, end)];
  const refs = dates.map((d) =>
    db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(`${userId}_${d}`)
  );
  const snaps = await db.getAll(...refs);
  const marks = new Map();
  snaps.forEach((snap, i) => {
    const present = snap.exists && PRESENT_EQUIVALENT.has(snap.data().status);
    marks.set(dates[i], present);
  });
  return marks;
}
