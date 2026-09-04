import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";
import { computeWorkingDays, weekdayOf } from "./dateUtils.js";

export async function getHolidaysForYear(year) {
  const snap = await db
    .collection(COLLECTIONS.HR_HOLIDAYS)
    .doc(String(year))
    .get();
  if (!snap.exists) return [];
  return snap.data().holidays || [];
}

// A leave range or payroll period can span the New Year boundary or two
// calendar years — fetch holiday docs for every year touched by the range.
export async function getHolidaySetForRange(fromStr, toStr) {
  const startYear = Number(fromStr.slice(0, 4));
  const endYear = Number(toStr.slice(0, 4));
  const set = new Set();
  for (let y = startYear; y <= endYear; y++) {
    const holidays = await getHolidaysForYear(y);
    for (const h of holidays) set.add(h.date);
  }
  return set;
}

export async function getWeeklyOffDays() {
  const snap = await db
    .collection(COLLECTIONS.HR_SETTINGS)
    .doc("weekly_off")
    .get();
  if (!snap.exists) return [0]; // default: Sunday
  return snap.data().days || [0];
}

export function isHoliday(dateStr, holidaySet) {
  return holidaySet.has(dateStr);
}

export function isWeeklyOff(dateStr, weeklyOffDays) {
  return weeklyOffDays.includes(weekdayOf(dateStr));
}

// Fetches calendar context and computes working days for a range in one call.
export async function workingDaysForRange(fromStr, toStr) {
  const [holidaySet, weeklyOffDays] = await Promise.all([
    getHolidaySetForRange(fromStr, toStr),
    getWeeklyOffDays(),
  ]);
  return computeWorkingDays(fromStr, toStr, holidaySet, weeklyOffDays);
}
