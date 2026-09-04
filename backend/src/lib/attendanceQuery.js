import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";
import { eachDate, monthBounds } from "./dateUtils.js";

// Returns a Map<dateStr, boolean> — true if the employee has any logged
// time that day. Informational only (systemLoginDays / muster 'P' marks);
// never used to set presentDays.
export async function attendanceMarksForMonth(userId, period) {
  const { start, end } = monthBounds(period);
  const dates = [...eachDate(start, end)];
  const refs = dates.map((d) =>
    db.collection(COLLECTIONS.ATTENDANCE_LOGS).doc(`${userId}_${d}`)
  );
  const snaps = await db.getAll(...refs);
  const marks = new Map();
  snaps.forEach((snap, i) => {
    const hasTime = snap.exists && (snap.data().totalMinutes || 0) > 0;
    marks.set(dates[i], hasTime);
  });
  return marks;
}
