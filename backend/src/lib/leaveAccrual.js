import cron from "node-cron";
import { db } from "../config/firebase.js";
import { COLLECTIONS, STAFF_PROFILE_TYPES } from "./constants.js";
import { financialYearOf } from "./dateUtils.js";
import { getLeaveTypes, accrueEntitlementInTransaction, balanceDocId } from "./leaveBalances.js";

const ACCRUAL_MARKER_DOC = "leave_accrual";

// "2026-04" -> next month "2026-05"
function nextMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function prevMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
const monthsBetween = (fromYm, toYm) => {
  const out = [];
  for (let m = fromYm; m <= toYm; m = nextMonth(m)) out.push(m);
  return out;
};

// Adds each leave type's accrualPerMonth to every active staff member's
// entitlement for the current financial year. Every employee + leave type
// remembers the last month it was credited for (accruedThrough on their balance
// document), so a month is never credited twice and a month missed because the
// server was not running is caught up on the next run. A new joiner is credited
// from the month they joined, not from April.
export async function runMonthlyLeaveAccrual() {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7); // YYYY-MM
  const fyStartYear = financialYearOf(today);
  const fyFirstMonth = `${fyStartYear}-04`;

  const markerRef = db.collection(COLLECTIONS.HR_SETTINGS).doc(ACCRUAL_MARKER_DOC);
  const markerSnap = await markerRef.get();
  // Balances created before per-employee tracking existed were credited up to
  // the month recorded here, so they are treated as caught up to it.
  const legacyThrough = markerSnap.exists ? markerSnap.data().lastRunMonth || null : null;

  const leaveTypes = (await getLeaveTypes()).filter((lt) => Number(lt.accrualPerMonth) > 0);
  if (leaveTypes.length === 0) {
    await markerRef.set({ lastRunMonth: thisMonth }, { merge: true });
    return { skipped: true, reason: "No leave types have an accrualPerMonth configured" };
  }

  const [profilesSnap, usersSnap] = await Promise.all([
    db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "in", STAFF_PROFILE_TYPES).get(),
    db.collection(COLLECTIONS.USERS).get(),
  ]);
  const disabled = new Set(usersSnap.docs.filter((u) => u.data().disabled).map((u) => u.id));
  const active = profilesSnap.docs.filter((d) => !disabled.has(d.id)).map((d) => ({ userId: d.id, joined: d.data().dateOfJoining || null }));

  let credited = 0;
  for (const { userId, joined } of active) {
    const joinMonth = typeof joined === "string" && /^\d{4}-\d{2}/.test(joined) ? joined.slice(0, 7) : null;
    const firstMonth = joinMonth && joinMonth > fyFirstMonth ? joinMonth : fyFirstMonth;
    for (const lt of leaveTypes) {
      await db.runTransaction(async (tx) => {
        const ref = db.collection(COLLECTIONS.HR_LEAVE_BALANCES).doc(balanceDocId(userId, fyStartYear));
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        const hasEntry = data?.balances?.[lt.id]?.entitlement !== undefined;
        let through = data?.accruedThrough?.[lt.id];
        if (!through) through = hasEntry ? legacyThrough || prevMonth(firstMonth) : prevMonth(firstMonth);
        const from = nextMonth(through) > firstMonth ? nextMonth(through) : firstMonth;
        const months = from <= thisMonth ? monthsBetween(from, thisMonth).length : 0;
        if (months === 0) {
          // Nothing due. Record how far this balance is credited, once, so later
          // months are measured from here and not from the shared marker.
          if (hasEntry && !data?.accruedThrough?.[lt.id]) tx.set(ref, { accruedThrough: { [lt.id]: through } }, { merge: true });
          return;
        }
        await accrueEntitlementInTransaction(tx, userId, fyStartYear, lt, Number(lt.accrualPerMonth) * months, thisMonth, snap);
        credited += months;
      });
    }
  }

  await markerRef.set({ lastRunMonth: thisMonth, lastRunAt: today, employeeCount: active.length }, { merge: true });
  return { skipped: false, month: thisMonth, employees: active.length, leaveTypes: leaveTypes.map((lt) => lt.id), monthsCredited: credited };
}

// Checked daily (not scheduled for exactly the 1st) and also once on every
// server startup — see server.js. Cloud Run scales to zero when idle, so a
// fixed "0 2 1 * *" cron pattern can be silently skipped for days if nothing
// wakes the instance right then. The per-employee accruedThrough record makes
// every trigger safe to call redundantly, and a month that was missed is
// credited the next time this runs.
export function startLeaveAccrualJob() {
  cron.schedule("30 2 * * *", () => {
    runMonthlyLeaveAccrual().catch((err) => console.error("Leave accrual job failed:", err));
  });
}
