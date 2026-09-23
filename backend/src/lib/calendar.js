import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";
import { computeWorkingDays, weekdayOf } from "./dateUtils.js";

const pad = (n) => String(n).padStart(2, "0");

// Holidays are entered once as a recurring list (month + day + name) and
// apply to every year — there are no per-year copies to maintain.
export async function getRecurringHolidays() {
  const snap = await db.collection(COLLECTIONS.HR_SETTINGS).doc("recurring_holidays").get();
  return snap.exists ? snap.data().holidays || [] : [];
}

// The recurring list resolved to concrete dates for one calendar year (a
// Feb 29 holiday simply doesn't occur in non-leap years), plus every
// HOLIDAY-type weekday rule (e.g. "every 3rd Saturday") resolved the same
// way — both feed the one holiday set every other calendar function reads.
export async function getHolidaysForYear(year) {
  const y = Number(year);
  const [holidays, weekdayRules] = await Promise.all([getRecurringHolidays(), getRecurringWeekdayRules()]);
  const fixed = holidays
    .filter((h) => {
      const d = new Date(Date.UTC(y, h.month - 1, h.day));
      return d.getUTCMonth() === h.month - 1 && d.getUTCDate() === h.day;
    })
    .map((h) => ({ date: `${y}-${pad(h.month)}-${pad(h.day)}`, name: h.name }));
  const fromWeekdayRules = resolveWeekdayRulesForYear(weekdayRules, y, "HOLIDAY");
  return [...fixed, ...fromWeekdayRules].sort((a, b) => (a.date < b.date ? -1 : 1));
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

// Predefined "Nth weekday of every month" rules — e.g. "every 3rd Saturday
// is a holiday" or "every 1st Saturday is WFH". weekday follows the same
// 0=Sunday..6=Saturday convention as weekly_off. type is "HOLIDAY" (folded
// into the holiday set below, same as a fixed-date holiday) or "WFH" (used
// only by payroll, see getWfhDateSetForRange — a working day, just remote).
export async function getRecurringWeekdayRules() {
  const snap = await db.collection(COLLECTIONS.HR_SETTINGS).doc("recurring_weekday_rules").get();
  return snap.exists ? snap.data().rules || [] : [];
}

// The Nth occurrence of `weekday` in a given month, or null if that month
// doesn't have one (e.g. a 5th Saturday in a 4-Saturday month).
function nthWeekdayDate(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function resolveWeekdayRulesForYear(rules, year, type) {
  const out = [];
  for (let month = 1; month <= 12; month++) {
    for (const r of rules) {
      if (r.type !== type) continue;
      const date = nthWeekdayDate(year, month, r.weekday, r.nth);
      if (date) out.push({ date, name: r.name });
    }
  }
  return out;
}

// Every WFH-rule date within a range, as a plain Set<dateStr> — payroll
// treats these as automatically present unless the employee already has an
// explicit attendance record for that exact date (see payslipCompute.js).
export async function getWfhDateSetForRange(fromStr, toStr) {
  const rules = await getRecurringWeekdayRules();
  if (!rules.some((r) => r.type === "WFH")) return new Set();
  const startYear = Number(fromStr.slice(0, 4));
  const endYear = Number(toStr.slice(0, 4));
  const set = new Set();
  for (let y = startYear; y <= endYear; y++) {
    for (const { date } of resolveWeekdayRulesForYear(rules, y, "WFH")) {
      if (date >= fromStr && date <= toStr) set.add(date);
    }
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
