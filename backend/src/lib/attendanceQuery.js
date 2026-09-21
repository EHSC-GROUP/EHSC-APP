import { db } from "../config/firebase.js";
import { COLLECTIONS, ATTENDANCE_STATUS_VALUES } from "./constants.js";
import { eachDate, monthBounds } from "./dateUtils.js";

// How much of a day each attendance status counts as being present: a full
// day for Present and for an approved Out of Office / Travel day, half a day
// for Half Day, nothing otherwise.
const PRESENT_WEIGHT = {
  [ATTENDANCE_STATUS_VALUES.PRESENT]: 1,
  [ATTENDANCE_STATUS_VALUES.OUT_OF_OFFICE]: 1,
  [ATTENDANCE_STATUS_VALUES.TRAVEL]: 1,
  [ATTENDANCE_STATUS_VALUES.HALF_DAY]: 0.5,
};

// Map<dateStr, weight> — 1, 0.5 or 0 — for each day of the month, from the
// employee's Daily Status records. Feeds the payslip's Present Days (which
// an admin can still override by hand) and the muster 'P' marks.
export async function attendanceWeightsForMonth(userId, period) {
  const { start, end } = monthBounds(period);
  const dates = [...eachDate(start, end)];
  const refs = dates.map((d) => db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(`${userId}_${d}`));
  const snaps = await db.getAll(...refs);
  const weights = new Map();
  snaps.forEach((snap, i) => {
    weights.set(dates[i], snap.exists ? PRESENT_WEIGHT[snap.data().status] || 0 : 0);
  });
  return weights;
}

// Map<dateStr, boolean> — true if that day counts as present at all.
export async function attendanceMarksForMonth(userId, period) {
  const weights = await attendanceWeightsForMonth(userId, period);
  return new Map([...weights].map(([date, w]) => [date, w > 0]));
}
