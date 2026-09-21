import { db } from "../config/firebase.js";
import { COLLECTIONS, LOP, HALF_DAY, LEAVE_STATUS } from "./constants.js";
import { getLeaveTypes, getLeaveBalancesForYear } from "./leaveBalances.js";
import { financialYearOf, round1 } from "./dateUtils.js";

// Assembles one employee's "Leave Card for the Year <FY>" — header details
// + a running leave log — from the same leave-request and balance data the
// rest of the Leave module already uses, so the card always reconciles
// with the register/balances screens for the same employee and FY.
export async function getLeaveCardData(userId, fy) {
  const [profileSnap, userSnap, leaveTypes, previousBalances] = await Promise.all([
    db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(userId).get(),
    db.collection(COLLECTIONS.USERS).doc(userId).get(),
    getLeaveTypes(),
    getLeaveBalancesForYear(userId, fy - 1),
  ]);
  const profile = profileSnap.exists ? profileSnap.data() : {};
  const name = userSnap.exists ? userSnap.data().name : userId;
  const typeById = new Map(leaveTypes.map((lt) => [lt.id, lt]));

  // "Eligibility as on" = this FY's fresh configured entitlement (not
  // including carry-in); "Previous Year's Accumulation" = what carried in
  // from the FY before, for the leave types that allow carry-forward.
  // getLeaveBalancesForYear's stored `entitlement` bundles both together —
  // this splits them back out for the card's two separate header cells.
  const eligibility = round1(leaveTypes.reduce((s, lt) => s + (lt.paidDaysPerYear || 0), 0));
  const previousAccumulation = round1(
    leaveTypes.filter((lt) => lt.carryForward).reduce((s, lt) => s + (previousBalances[lt.id]?.remaining || 0), 0)
  );

  const snap = await db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).where("userId", "==", userId).get();
  const requests = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => financialYearOf(r.fromDate) === fy)
    .sort((a, b) => (a.fromDate < b.fromDate ? -1 : a.fromDate > b.fromDate ? 1 : 0));

  let runningBalance = round1(eligibility + previousAccumulation);
  const rows = requests.map((r, i) => {
    const typeLabel = r.leaveType === LOP ? "Loss of Pay" : r.leaveType === HALF_DAY ? "Half Day" : (typeById.get(r.leaveType)?.name || r.leaveType);
    // Only an APPROVED, real (non-LOP/HALF_DAY) leave type actually deducts
    // from the balance — mirrors leaveBalances.adjustUsedInTransaction.
    const deducts = r.status === LEAVE_STATUS.APPROVED && r.leaveType !== LOP && r.leaveType !== HALF_DAY;
    if (deducts) runningBalance = round1(runningBalance - r.days);
    return {
      slNo: i + 1,
      reasonsForLeave: `${typeLabel}${r.reason ? ` — ${r.reason}` : ""}`,
      from: r.fromDate,
      to: r.toDate,
      days: r.days,
      balance: deducts ? runningBalance : null,
      remarks: r.status === LEAVE_STATUS.APPROVED ? "" : r.status,
    };
  });

  return {
    userId,
    name,
    employeeId: profile.employeeId || userId,
    department: profile.department || "",
    location: profile.location || "",
    dateOfJoining: profile.dateOfJoining || "",
    dateOfConfirmation: profile.dateOfConfirmation || "",
    fy,
    eligibility,
    previousAccumulation,
    rows,
  };
}

export async function listActiveEmployeeUserIds() {
  const snap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "in", ["employee", "admin"]).get();
  return snap.docs.map((d) => d.id);
}
