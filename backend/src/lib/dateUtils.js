// Pure date helpers — no DB access. Dates are always "YYYY-MM-DD" strings
// in local (company) time; we parse them as UTC-noon to avoid DST/timezone
// off-by-one bugs when doing day arithmetic.

export function parseISODate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function toISODate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr, n) {
  const d = parseISODate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

// Weekday, JS convention: 0 = Sunday .. 6 = Saturday.
export function weekdayOf(dateStr) {
  return parseISODate(dateStr).getUTCDay();
}

export function daysInMonth(year, month /* 1-12 */) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthBounds(period /* "YYYY-MM" */) {
  const [y, m] = period.split("-").map(Number);
  const start = `${period}-01`;
  const end = `${period}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  return { year: y, month: m, start, end };
}

// Financial year = 1 April - 31 March, identified by its start year.
export function financialYearOf(dateStr) {
  const d = parseISODate(dateStr);
  const month = d.getUTCMonth() + 1; // 1-12
  const year = d.getUTCFullYear();
  return month >= 4 ? year : year - 1;
}

export function fyBounds(fyStartYear) {
  return {
    start: `${fyStartYear}-04-01`,
    end: `${fyStartYear + 1}-03-31`,
  };
}

// All calendar dates from `from` to `to` inclusive, as an array of ISO strings.
export function* eachDate(fromStr, toStr) {
  let cur = fromStr;
  while (cur <= toStr) {
    yield cur;
    cur = addDays(cur, 1);
  }
}

export function calendarDaysBetween(fromStr, toStr) {
  let count = 0;
  for (const _ of eachDate(fromStr, toStr)) count++;
  return count;
}

// Working days = calendar days in range, minus company holidays, minus
// weekly-off weekdays. `holidaySet` is a Set of "YYYY-MM-DD" strings.
export function computeWorkingDays(fromStr, toStr, holidaySet, weeklyOffDays) {
  let count = 0;
  for (const date of eachDate(fromStr, toStr)) {
    if (holidaySet.has(date)) continue;
    if (weeklyOffDays.includes(weekdayOf(date))) continue;
    count++;
  }
  return count;
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function round1(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10) / 10;
}

// Clamp two ranges to their overlap (inclusive ISO date strings), or null.
export function overlapRange(aFrom, aTo, bFrom, bTo) {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  if (from > to) return null;
  return { from, to };
}
