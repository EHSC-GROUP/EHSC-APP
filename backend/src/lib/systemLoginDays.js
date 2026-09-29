import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";
import { monthBounds } from "./dateUtils.js";

// Reference-only figure for the payslip edit modal — never fed into any
// payroll calculation, just shown alongside Present Days so an admin can
// sanity-check attendance against how often the employee actually logged in.
export async function getSystemLoginDays(userId, period) {
  const { start, end } = monthBounds(period);
  const snap = await db.collection(COLLECTIONS.LOGIN_DAYS)
    .where("userId", "==", userId)
    .where("date", ">=", start)
    .where("date", "<=", end)
    .get();
  return snap.size;
}
