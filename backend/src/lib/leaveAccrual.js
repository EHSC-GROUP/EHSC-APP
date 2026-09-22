import cron from "node-cron";
import { db } from "../config/firebase.js";
import { COLLECTIONS, STAFF_PROFILE_TYPES } from "./constants.js";
import { financialYearOf } from "./dateUtils.js";
import { getLeaveTypes, accrueEntitlementInTransaction } from "./leaveBalances.js";

const ACCRUAL_MARKER_DOC = "leave_accrual";

// Runs once for the current calendar month (idempotent — a marker doc
// records the last month processed, so a second trigger in the same month,
// e.g. from a server restart, is a no-op). Adds each leave type's
// accrualPerMonth to every active staff member's entitlement for the
// leave type's current financial year.
export async function runMonthlyLeaveAccrual() {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7); // YYYY-MM

  const markerRef = db.collection(COLLECTIONS.HR_SETTINGS).doc(ACCRUAL_MARKER_DOC);
  const markerSnap = await markerRef.get();
  if (markerSnap.exists && markerSnap.data().lastRunMonth === thisMonth) {
    return { skipped: true, reason: `Already ran for ${thisMonth}` };
  }

  const leaveTypes = (await getLeaveTypes()).filter((lt) => Number(lt.accrualPerMonth) > 0);
  if (leaveTypes.length === 0) {
    await markerRef.set({ lastRunMonth: thisMonth }, { merge: true });
    return { skipped: true, reason: "No leave types have an accrualPerMonth configured" };
  }

  const fyStartYear = financialYearOf(today);
  const [profilesSnap, usersSnap] = await Promise.all([
    db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "in", STAFF_PROFILE_TYPES).get(),
    db.collection(COLLECTIONS.USERS).get(),
  ]);
  const disabled = new Set(usersSnap.docs.filter((u) => u.data().disabled).map((u) => u.id));
  const activeUserIds = profilesSnap.docs.map((d) => d.id).filter((id) => !disabled.has(id));

  let accrued = 0;
  for (const userId of activeUserIds) {
    for (const lt of leaveTypes) {
      await db.runTransaction((tx) => accrueEntitlementInTransaction(tx, userId, fyStartYear, lt, Number(lt.accrualPerMonth)));
      accrued++;
    }
  }

  await markerRef.set({ lastRunMonth: thisMonth, lastRunAt: today, employeeCount: activeUserIds.length }, { merge: true });
  return { skipped: false, month: thisMonth, employees: activeUserIds.length, leaveTypes: leaveTypes.map((lt) => lt.id), accrued };
}

// Checked daily (not scheduled for exactly the 1st) and also once on every
// server startup — see server.js. Cloud Run scales to zero when idle, so a
// fixed "0 2 1 * *" cron pattern can be silently skipped for days if nothing
// wakes the instance right then; the marker doc makes both triggers safe to
// call redundantly, and between "daily while warm" and "on every cold
// start", the first request of a new month reliably catches it either way.
export function startLeaveAccrualJob() {
  cron.schedule("30 2 * * *", () => {
    runMonthlyLeaveAccrual().catch((err) => console.error("Leave accrual job failed:", err));
  });
}
