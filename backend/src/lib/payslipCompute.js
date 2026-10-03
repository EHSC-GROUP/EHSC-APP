import { db } from "../config/firebase.js";
import { COLLECTIONS, LOP, HALF_DAY, ATTENDANCE_STATUS_VALUES } from "./constants.js";
import {
  eachDate,
  monthBounds,
  weekdayOf,
  round1,
  round2,
} from "./dateUtils.js";
import { getHolidaySetForRange, getWeeklyOffDays, getWfhDateSetForRange } from "./calendar.js";
import { getLeaveTypes } from "./leaveBalances.js";
import { attendanceWeightsForMonth, attendanceStatusForMonth } from "./attendanceQuery.js";
import { getCurrentSalaryVersion } from "./salaryStructures.js";
import { getSystemLoginDays } from "./systemLoginDays.js";

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
  const todayISO = new Date().toISOString().slice(0, 10);

  const [holidaySet, weeklyOffDays, leaveTypes, attendanceWeights, attendanceStatuses, requests, wfhSet] = await Promise.all([
    getHolidaySetForRange(start, end),
    getWeeklyOffDays(),
    getLeaveTypes(),
    attendanceWeightsForMonth(userId, period),
    attendanceStatusForMonth(userId, period),
    getApprovedLeaveRequestsOverlapping(userId, start, end),
    getWfhDateSetForRange(start, end),
  ]);

  // A predefined WFH day (e.g. "1st Saturday") counts as present
  // automatically — unless this employee already has an explicit
  // attendance record for that exact date (any status), which always wins
  // over the automatic default.
  let wfhAutoDates = new Set();
  if (wfhSet.size > 0) {
    const wfhDates = [...wfhSet];
    const wfhSnaps = await db.getAll(...wfhDates.map((d) => db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(`${userId}_${d}`)));
    wfhAutoDates = new Set(wfhDates.filter((d, i) => !wfhSnaps[i].exists));
  }

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

  // Day-by-day muster mark, one flat string per calendar day (day N = index
  // N-1), priority order: Holiday > WeeklyOff > Leave > "not yet due" (a
  // future date never counts as absent) > actual attendance (Present /
  // Half Day / Out of Office|Travel, or an automatic WFH-rule day folded
  // into Present) > Absent. Out of Office/Travel keep their own "OOO"
  // calendar tag, but count as full Present days in every payroll
  // calculation (systemPresentDays below is driven by attendance weights,
  // not by this mark string, so that's unaffected either way).
  let holidayDays = 0;
  let weeklyOffCount = 0;
  let wfhAutoCount = 0;
  let outOfOfficeCount = 0;
  const dayMarks = [];
  for (const date of eachDate(start, end)) {
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
    } else if (date > todayISO) {
      mark = "-";
    } else {
      const status = attendanceStatuses.get(date);
      if (status === ATTENDANCE_STATUS_VALUES.HALF_DAY) mark = "P(H)";
      else if (status === ATTENDANCE_STATUS_VALUES.PRESENT) mark = "P";
      else if ([ATTENDANCE_STATUS_VALUES.OUT_OF_OFFICE, ATTENDANCE_STATUS_VALUES.TRAVEL].includes(status)) {
        mark = "OOO";
        outOfOfficeCount++;
      } else if (wfhAutoDates.has(date)) {
        // A predefined WFH day (e.g. "1st Saturday") — shown as its own
        // tag so it's visible which days were auto-credited by the
        // recurring weekday rule rather than an actual attendance record;
        // still counts fully toward systemPresentDays below either way.
        mark = "WFH";
        wfhAutoCount++;
      } else {
        mark = "A";
      }
    }
    dayMarks.push(mark);
  }

  const workingDays = daysInMonthCount - holidayDays - weeklyOffCount;
  const absentDays = dayMarks.filter((m) => m === "A").length;
  // Days present per the attendance records: Present / Out of Office / Travel
  // count as a full day, Half Day as half, plus any automatic WFH-rule days.
  const systemPresentDays = round1([...attendanceWeights.values()].reduce((sum, w) => sum + w, 0) + wfhAutoCount);
  // Every plain Absent day is unpaid, same as leave taken past its monthly
  // cap — folded into the same LOP total.
  lopDays = round1(lopDays + absentDays);

  return {
    daysInMonth: daysInMonthCount,
    workingDays,
    holidayDays,
    weeklyOffDays: weeklyOffCount,
    absentDays,
    halfDays,
    outOfOfficeDays: outOfOfficeCount,
    systemPresentDays,
    paidLeaveDays: round1(paidLeaveDays),
    lopDays: round1(lopDays),
    leaveBreakdown,
    dayMarks,
  };
}

// Paid days: days present (incl. Out of Office, Travel, WFH and half days),
// paid leave, plus holidays and weekly-offs. Absent days and LOP leave are
// unpaid. Capped at the calendar day count.
export function computePayableDays({ presentDays, paidLeaveDays, holidayDays, weeklyOffDays, daysInMonth }) {
  return Math.min(
    Number(daysInMonth),
    round2(Number(presentDays || 0) + Number(paidLeaveDays || 0) + Number(holidayDays || 0) + Number(weeklyOffDays || 0))
  );
}

export function computeEarningsForPayableDays(structureVersion, payableDays, daysInMonth) {
  const ratio = daysInMonth > 0 ? payableDays / daysInMonth : 0;
  // Formula-driven components pro-rate with payable days. Versions created
  // before Transportation/Special existed simply have none of those
  // (their `others` still carries the remainder of gross).
  const prorate = (amount) => round2(Number(amount || 0) * ratio);
  const basic = prorate(structureVersion.basic);
  const hra = prorate(structureVersion.hra);
  const transportAllowance = prorate(structureVersion.transport);
  const specialAllowance = prorate(structureVersion.special);
  // "Statutory Bonus-Others" — the remainder of gross after Basic/HRA/
  // Transport/Special (folds what used to be a separate bonus line into
  // this one).
  const others = prorate(structureVersion.others);
  // Flat amounts (not pro-rated): only zeroed when there are no payable days.
  const flat = (amount) => (payableDays > 0 ? Number(amount || 0) : 0);
  const pt = flat(structureVersion.pt);
  const medicalAllowance = flat(structureVersion.medicalAllowance);
  const tds = flat(structureVersion.tds);
  // ESI is a percentage of (prorated) Basic+HRA+Others, only when the
  // employee is ESI-applicable — naturally zero once those three are zero
  // (payableDays 0), no separate flat-zero guard needed.
  const esiApplicable = !!structureVersion.esiApplicable;
  const esiPercent = Number(structureVersion.esiPercent || 0);
  const esi = esiApplicable ? round2((basic + hra + others) * esiPercent / 100) : 0;
  return { ratio, basic, hra, transportAllowance, specialAllowance, others, pt, medicalAllowance, tds, esiApplicable, esiPercent, esi };
}

export function computeTotals(p) {
  const totalEarnings = round2(
    Number(p.basic) + Number(p.hra) + Number(p.transportAllowance || 0) + Number(p.specialAllowance || 0) +
    Number(p.others) + Number(p.incentives || 0)
  );
  const totalDeductions = round2(
    Number(p.pt || 0) + Number(p.incomeTax || 0) + Number(p.esi || 0) + Number(p.othersDeduction || 0)
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

  const [muster, systemLoginDays] = await Promise.all([
    computeMusterAndLeave(userId, period),
    getSystemLoginDays(userId, period),
  ]);

  // Present Days comes from the attendance records. If an admin overrode it by
  // hand (or, for payslips made before this flag existed, entered a value), that
  // manual figure is kept when regenerating.
  const presentDaysManual = existing
    ? existing.presentDaysManual ?? Number(existing.presentDays) > 0
    : false;
  const presentDays = presentDaysManual ? existing.presentDays : muster.systemPresentDays;
  const incentives = existing ? existing.incentives ?? 0 : 0;
  const othersDeduction = existing ? existing.othersDeduction ?? 0 : 0;
  const ptManual = existing?.ptManual || false;
  const esiManual = existing?.esiManual || false;
  const incomeTaxManual = existing?.incomeTaxManual || false;

  const payableDays = computePayableDays({ presentDays, paidLeaveDays: muster.paidLeaveDays, holidayDays: muster.holidayDays, weeklyOffDays: muster.weeklyOffDays, daysInMonth: muster.daysInMonth });
  const earnings = computeEarningsForPayableDays(structureVersion, payableDays, muster.daysInMonth);

  const pt = ptManual ? existing.pt : earnings.pt;
  const esi = esiManual ? existing.esi : earnings.esi;
  // TDS defaults from the salary structure (like PT/ESI); a manually-edited
  // figure on this payslip survives regeneration.
  const incomeTax = incomeTaxManual ? existing.incomeTax : earnings.tds;

  const totals = computeTotals({ ...earnings, incentives, pt, esi, incomeTax, othersDeduction });

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
    presentDaysManual,
    attendancePresentDays: muster.systemPresentDays,
    systemPresentDays: muster.systemPresentDays,
    systemLoginDays,
    paidLeaveDays: muster.paidLeaveDays,
    payableDays,
    lopDays: muster.lopDays,
    holidayDays: muster.holidayDays,
    weeklyOffDays: muster.weeklyOffDays,
    absentDays: muster.absentDays,
    halfDays: muster.halfDays,
    outOfOfficeDays: muster.outOfOfficeDays,
    leaveBreakdown: muster.leaveBreakdown,
    dayMarks: muster.dayMarks,
    basic: earnings.basic,
    hra: earnings.hra,
    transportAllowance: earnings.transportAllowance,
    specialAllowance: earnings.specialAllowance,
    others: earnings.others,
    incentives: Number(incentives),
    pt: Number(pt),
    esiApplicable: earnings.esiApplicable,
    esiPercent: earnings.esiPercent,
    esi: Number(esi),
    incomeTax: Number(incomeTax),
    othersDeduction: Number(othersDeduction),
    ptManual,
    esiManual,
    incomeTaxManual,
    ...totals,
  };
}

// Edit: recompute payable days and the earnings components only if
// presentDays changed; always recompute totals. incentives/pt/
// esi/incomeTax/othersDeduction are applied only when explicitly present in
// `updates` (undefined = keep as-is).
export async function applyPayslipEdit(existing, updates) {
  let { presentDaysManual, presentDays, payableDays, basic, hra, transportAllowance, specialAllowance, others, pt, esi, incomeTax, ptManual, esiManual, incomeTaxManual } = existing;

  // Payslips made before the flag existed count as manual if a value was entered.
  presentDaysManual = presentDaysManual ?? Number(existing.presentDays) > 0;

  // An admin either types a different figure (manual override) or asks to go
  // back to the attendance-based one.
  let newPresentDays = null;
  if (updates.useAttendance) {
    newPresentDays = Number(existing.systemPresentDays || 0);
    presentDaysManual = false;
  } else if (updates.presentDays !== undefined && Number(updates.presentDays) !== existing.presentDays) {
    newPresentDays = Number(updates.presentDays);
    presentDaysManual = true;
  }
  if (newPresentDays !== null && newPresentDays !== existing.presentDays) {
    presentDays = newPresentDays;
    const structureVersion = await getCurrentSalaryVersion(existing.userId, monthBounds(existing.period).end);
    payableDays = computePayableDays({
      presentDays,
      paidLeaveDays: existing.paidLeaveDays,
      holidayDays: existing.holidayDays,
      weeklyOffDays: existing.weeklyOffDays,
      daysInMonth: existing.daysInMonth,
    });
    const earnings = computeEarningsForPayableDays(structureVersion, payableDays, existing.daysInMonth);
    basic = earnings.basic;
    hra = earnings.hra;
    transportAllowance = earnings.transportAllowance;
    specialAllowance = earnings.specialAllowance;
    others = earnings.others;
    if (!ptManual) pt = earnings.pt;
    if (!esiManual) esi = earnings.esi;
    if (!incomeTaxManual) incomeTax = earnings.tds;
  }

  if (updates.pt !== undefined) {
    pt = Number(updates.pt);
    ptManual = true;
  }
  if (updates.esi !== undefined) {
    esi = Number(updates.esi);
    esiManual = true;
  }
  if (updates.incomeTax !== undefined) {
    incomeTax = Number(updates.incomeTax);
    incomeTaxManual = true;
  }

  const incentives = updates.incentives !== undefined ? Number(updates.incentives) : existing.incentives;
  const othersDeduction =
    updates.othersDeduction !== undefined ? Number(updates.othersDeduction) : existing.othersDeduction;

  const totals = computeTotals({
    basic, hra, transportAllowance, specialAllowance, others,
    incentives, pt, esi, incomeTax, othersDeduction,
  });

  return {
    ...existing,
    presentDays,
    presentDaysManual: presentDaysManual ?? false,
    payableDays,
    basic,
    hra,
    transportAllowance,
    specialAllowance,
    others,
    incentives,
    pt,
    esi,
    incomeTax,
    othersDeduction,
    ptManual,
    esiManual,
    incomeTaxManual,
    ...totals,
  };
}
