import { db } from "../config/firebase.js";
import { COLLECTIONS, LOP, HALF_DAY } from "./constants.js";
import {
  eachDate,
  monthBounds,
  weekdayOf,
  round1,
  round2,
} from "./dateUtils.js";
import { getHolidaySetForRange, getWeeklyOffDays } from "./calendar.js";
import { getLeaveTypes } from "./leaveBalances.js";
import { attendanceMarksForMonth } from "./attendanceQuery.js";
import { getCurrentSalaryVersion } from "./salaryStructures.js";

// Expands one APPROVED leave request into per-day contributions, clipped to
// the payroll period, skipping holidays/weekly-offs (those never consume a
// leave day — the request's own `days` total was computed the same way at
// apply time). The half-day trim (if halfDay: true) only ever applies to
// the request's actual last day (toDate), not the period's last day.
function expandLeaveRequestToDays(request, periodStart, periodEnd, holidaySet, weeklyOffDays) {
  const from = request.fromDate > periodStart ? request.fromDate : periodStart;
  const to = request.toDate < periodEnd ? request.toDate : periodEnd;
  if (from > to) return [];

  const out = [];
  for (const date of eachDate(from, to)) {
    if (holidaySet.has(date)) continue;
    if (weeklyOffDays.includes(weekdayOf(date))) continue;
    const isHalfDay = request.halfDay && date === request.toDate;
    out.push({ date, leaveType: request.leaveType, amount: isHalfDay ? 0.5 : 1 });
  }
  return out;
}

async function getApprovedLeaveRequestsOverlapping(userId, periodStart, periodEnd) {
  const snap = await db
    .collection(COLLECTIONS.HR_LEAVE_REQUESTS)
    .where("userId", "==", userId)
    .where("status", "==", "APPROVED")
    .where("toDate", ">=", periodStart)
    .get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.fromDate <= periodEnd);
}

// Core muster + leave computation, shared by payslip generation and the
// statutory register export so the two always reconcile.
export async function computeMusterAndLeave(userId, period) {
  const { year, month, start, end } = monthBounds(period);
  const daysInMonthCount = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const [holidaySet, weeklyOffDays, leaveTypes, attendanceMarks, requests] = await Promise.all([
    getHolidaySetForRange(start, end),
    getWeeklyOffDays(),
    getLeaveTypes(),
    attendanceMarksForMonth(userId, period),
    getApprovedLeaveRequestsOverlapping(userId, start, end),
  ]);

  // Tally raw (pre-cap) leave days per type for this month.
  const leaveDayEntries = new Map(); // date -> { leaveType, amount }
  const rawTotals = new Map(); // leaveType -> total days this month

  for (const request of requests) {
    const days = expandLeaveRequestToDays(request, start, end, holidaySet, weeklyOffDays);
    for (const d of days) {
      leaveDayEntries.set(d.date, d);
      rawTotals.set(d.leaveType, round1((rawTotals.get(d.leaveType) || 0) + d.amount));
    }
  }

  // Monthly-cap -> LOP conversion, per leave type. LOP is always fully
  // unpaid; HALF_DAY is never capped.
  const leaveBreakdown = [];
  let paidLeaveDays = 0;
  let lopDays = 0;
  let halfDays = 0;

  for (const lt of leaveTypes) {
    const consumed = rawTotals.get(lt.id) || 0;
    const cap = lt.monthlyCap ?? null;
    const paid = cap != null ? Math.min(consumed, cap) : consumed;
    const excessLop = cap != null ? round1(Math.max(0, consumed - cap)) : 0;
    paidLeaveDays = round1(paidLeaveDays + paid);
    lopDays = round1(lopDays + excessLop);
    leaveBreakdown.push({ id: lt.id, name: lt.name, days: consumed, monthlyCap: cap, excessLop });
  }

  const lopConsumed = rawTotals.get(LOP) || 0;
  lopDays = round1(lopDays + lopConsumed);
  leaveBreakdown.push({ id: LOP, name: "Loss of Pay", days: lopConsumed, monthlyCap: null, excessLop: 0 });

  const halfDayConsumed = rawTotals.get(HALF_DAY) || 0;
  paidLeaveDays = round1(paidLeaveDays + halfDayConsumed);
  halfDays = round1(halfDayConsumed);
  leaveBreakdown.push({ id: HALF_DAY, name: "Half Day", days: halfDayConsumed, monthlyCap: null, excessLop: 0 });

  // Also count half-day trims taken on any *paid* (non-LOP) leave type as
  // "half days" for the summary field, without double counting the days.
  for (const [, entry] of leaveDayEntries) {
    if (entry.amount === 0.5 && entry.leaveType !== HALF_DAY) {
      halfDays = round1(halfDays + 0.5);
    }
  }

  // Day-by-day muster string: Holiday > WeeklyOff > Leave > Present > Absent.
  let holidayDays = 0;
  let weeklyOffCount = 0;
  const dayMarks = [];
  for (const date of eachDate(start, end)) {
    const dayNum = Number(date.slice(-2));
    let mark;
    if (holidaySet.has(date)) {
      mark = "H";
      holidayDays++;
    } else if (weeklyOffDays.includes(weekdayOf(date))) {
      mark = "W";
      weeklyOffCount++;
    } else if (leaveDayEntries.has(date)) {
      const entry = leaveDayEntries.get(date);
      if (entry.leaveType === HALF_DAY) mark = "HD";
      else if (entry.amount === 0.5) mark = `${entry.leaveType}(H)`;
      else mark = entry.leaveType;
    } else if (attendanceMarks.get(date)) {
      mark = "P";
    } else {
      mark = "A";
    }
    dayMarks.push({ day: dayNum, date, mark });
  }

  const workingDays = daysInMonthCount - holidayDays - weeklyOffCount;
  const absentDays = dayMarks.filter((d) => d.mark === "A").length;
  const systemLoginDays = [...attendanceMarks.values()].filter(Boolean).length;

  return {
    daysInMonth: daysInMonthCount,
    workingDays,
    holidayDays,
    weeklyOffDays: weeklyOffCount,
    absentDays,
    halfDays,
    systemLoginDays,
    paidLeaveDays: round1(paidLeaveDays),
    lopDays: round1(lopDays),
    leaveBreakdown,
    dayMarks,
  };
}

export function computeEarningsForPayableDays(structureVersion, payableDays, daysInMonth) {
  const ratio = daysInMonth > 0 ? payableDays / daysInMonth : 0;
  const basic = round2(structureVersion.basic * ratio);
  const hra = round2(structureVersion.hra * ratio);
  const others = round2(structureVersion.others * ratio);
  const pt = payableDays > 0 ? Number(structureVersion.pt || 0) : 0;
  const esi = structureVersion.esiApplicable
    ? round2((basic + hra + others) * (Number(structureVersion.esiPercent) || 0) / 100)
    : 0;
  return { ratio, basic, hra, others, pt, esi };
}

export function computeTotals({ basic, hra, others, incentives, pt, incomeTax, esi, othersDeduction }) {
  const totalEarnings = round2(Number(basic) + Number(hra) + Number(others) + Number(incentives || 0));
  const totalDeductions = round2(
    Number(pt || 0) + Number(incomeTax || 0) + Number(esi || 0) + Number(othersDeduction || 0)
  );
  const netPay = round2(totalEarnings - totalDeductions);
  return { totalEarnings, totalDeductions, netPay };
}

// Full generate/regenerate computation for one employee/period. `existing`
// is the current payslip doc if regenerating a DRAFT (preserves manual
// entries), or null for a brand-new payslip.
export async function computeGeneratedPayslip(userId, profile, period, existing) {
  const structureVersion = await getCurrentSalaryVersion(userId, monthBounds(period).end);
  if (!structureVersion) {
    return { skipped: true, reason: "No salary structure defined as of this period" };
  }

  const muster = await computeMusterAndLeave(userId, period);

  const presentDays = existing ? existing.presentDays : 0;
  const incentives = existing ? existing.incentives ?? 0 : 0;
  const incomeTax = existing ? existing.incomeTax ?? 0 : 0;
  const othersDeduction = existing ? existing.othersDeduction ?? 0 : 0;
  const ptManual = existing?.ptManual || false;
  const esiManual = existing?.esiManual || false;

  const payableDays = Math.min(muster.daysInMonth, round2(Number(presentDays) + muster.paidLeaveDays));
  const earnings = computeEarningsForPayableDays(structureVersion, payableDays, muster.daysInMonth);

  const pt = ptManual ? existing.pt : earnings.pt;
  const esi = esiManual ? existing.esi : earnings.esi;

  const totals = computeTotals({
    basic: earnings.basic,
    hra: earnings.hra,
    others: earnings.others,
    incentives,
    pt,
    incomeTax,
    esi,
    othersDeduction,
  });

  return {
    skipped: false,
    userId,
    period,
    name: profile.name,
    designation: profile.designation || "",
    employeeId: profile.employeeId || "",
    dateOfJoining: profile.dateOfJoining || null,
    dateOfLeaving: profile.dateOfLeaving || null,
    gross: structureVersion.gross,
    daysInMonth: muster.daysInMonth,
    workingDays: muster.workingDays,
    presentDays: Number(presentDays),
    systemLoginDays: muster.systemLoginDays,
    paidLeaveDays: muster.paidLeaveDays,
    payableDays,
    lopDays: muster.lopDays,
    holidayDays: muster.holidayDays,
    weeklyOffDays: muster.weeklyOffDays,
    absentDays: muster.absentDays,
    halfDays: muster.halfDays,
    leaveBreakdown: muster.leaveBreakdown,
    dayMarks: muster.dayMarks,
    basic: earnings.basic,
    hra: earnings.hra,
    others: earnings.others,
    incentives: Number(incentives),
    pt: Number(pt),
    incomeTax: Number(incomeTax),
    esi: Number(esi),
    othersDeduction: Number(othersDeduction),
    ptManual,
    esiManual,
    ...totals,
  };
}

// Edit: recompute payable days/basic/hra/others only if presentDays changed;
// always recompute totals. incentives/pt/incomeTax/esi/othersDeduction are
// applied only when explicitly present in `updates` (undefined = keep as-is).
export async function applyPayslipEdit(existing, updates) {
  let { presentDays, payableDays, basic, hra, others, pt, esi, ptManual, esiManual } = existing;

  if (updates.presentDays !== undefined && Number(updates.presentDays) !== existing.presentDays) {
    presentDays = Number(updates.presentDays);
    const structureVersion = await getCurrentSalaryVersion(existing.userId, monthBounds(existing.period).end);
    payableDays = Math.min(existing.daysInMonth, round2(presentDays + existing.paidLeaveDays));
    const earnings = computeEarningsForPayableDays(structureVersion, payableDays, existing.daysInMonth);
    basic = earnings.basic;
    hra = earnings.hra;
    others = earnings.others;
    if (!ptManual) pt = earnings.pt;
    if (!esiManual) esi = earnings.esi;
  }

  if (updates.pt !== undefined) {
    pt = Number(updates.pt);
    ptManual = true;
  }
  if (updates.esi !== undefined) {
    esi = Number(updates.esi);
    esiManual = true;
  }

  const incentives = updates.incentives !== undefined ? Number(updates.incentives) : existing.incentives;
  const incomeTax = updates.incomeTax !== undefined ? Number(updates.incomeTax) : existing.incomeTax;
  const othersDeduction =
    updates.othersDeduction !== undefined ? Number(updates.othersDeduction) : existing.othersDeduction;

  const totals = computeTotals({ basic, hra, others, incentives, pt, incomeTax, esi, othersDeduction });

  return {
    ...existing,
    presentDays,
    payableDays,
    basic,
    hra,
    others,
    incentives,
    pt,
    incomeTax,
    esi,
    othersDeduction,
    ptManual,
    esiManual,
    ...totals,
  };
}
