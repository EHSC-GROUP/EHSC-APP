// Removes BULK-created attendance records that fall on a weekly off (Sunday) or a
// company holiday, 1-14 Oct 2026. Those days were never working days, so they
// should not read Present. Records from any other source are never touched.
// Dry run by default; add --apply to delete.
import { db } from "../src/config/firebase.js";
import { getHolidaySetForRange, getWeeklyOffDays } from "../src/lib/calendar.js";
import { weekdayOf } from "../src/lib/dateUtils.js";

const APPLY = process.argv.includes("--apply");
const [from, to] = ["2026-10-01", "2026-10-14"];
const [holidays, weeklyOff] = await Promise.all([getHolidaySetForRange(from, to), getWeeklyOffDays()]);
console.log("Weekly off weekdays:", weeklyOff, "| holidays:", [...holidays].join(", ") || "none");

const snap = await db.collection("attendance_status").where("source", "==", "BULK").get();
let n = 0;
for (const d of snap.docs) {
  const r = d.data();
  if (r.date < from || r.date > to) continue;
  if (!holidays.has(r.date) && !weeklyOff.includes(weekdayOf(r.date))) continue;
  console.log(`${APPLY ? "DELETE" : "WOULD "} ${r.date} ${r.userId} ${r.status}/BULK`);
  n++;
  if (APPLY) await d.ref.delete();
}
console.log(`${n} record(s) ${APPLY ? "deleted" : "would be deleted"}.`);
process.exit(0);
