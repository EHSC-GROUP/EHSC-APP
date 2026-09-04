import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";
import { round1 } from "./dateUtils.js";

export function balanceDocId(userId, fyStartYear) {
  return `${userId}_${fyStartYear}`;
}

export async function getLeaveTypes() {
  const snap = await db.collection(COLLECTIONS.HR_LEAVE_TYPES).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Carry-forward, implemented for real (not just a stored flag): the first
// time a given leave type is touched in a new FY, if it has carryForward:
// true, its opening entitlement = configured paidDaysPerYear + whatever was
// left remaining for that same type at the end of the immediately preceding
// FY. That carry-in is snapshotted into the entitlement at that moment
// (same pattern as salary-structure formula snapshotting) — it does not
// keep re-deriving itself from a growing chain of prior years.
async function getCarryInForType(userId, fyStartYear, leaveType, getter) {
  if (!leaveType.carryForward) return 0;
  const prevRef = db.collection(COLLECTIONS.HR_LEAVE_BALANCES).doc(balanceDocId(userId, fyStartYear - 1));
  const prevSnap = await getter(prevRef);
  if (!prevSnap.exists) return 0;
  const prevEntry = (prevSnap.data().balances || {})[leaveType.id];
  if (!prevEntry) return 0;
  return Math.max(0, round1(prevEntry.remaining || 0));
}

// Balance docs are not pre-created for every employee. A stored entry only
// exists once something actually changed it (an approval, a cancellation
// reversal, or a manual entitlement edit); everything else falls back to
// the leave type's configured default (+ carry-in, if applicable) here.
export async function getLeaveBalancesForYear(userId, fyStartYear) {
  const leaveTypes = await getLeaveTypes();
  const snap = await db
    .collection(COLLECTIONS.HR_LEAVE_BALANCES)
    .doc(balanceDocId(userId, fyStartYear))
    .get();
  const stored = snap.exists ? snap.data().balances || {} : {};
  const directGet = (ref) => ref.get();

  const view = {};
  for (const lt of leaveTypes) {
    const storedEntry = stored[lt.id];
    let entitlement;
    if (storedEntry?.entitlement !== undefined) {
      entitlement = round1(storedEntry.entitlement);
    } else {
      const carryIn = await getCarryInForType(userId, fyStartYear, lt, directGet);
      entitlement = round1((lt.paidDaysPerYear ?? 0) + carryIn);
    }
    const used = round1(storedEntry?.used || 0);
    view[lt.id] = { entitlement, used, remaining: round1(entitlement - used) };
  }
  return view;
}

// Applies a delta to `used` for one leave type, within an existing Firestore
// transaction. Floors at 0. leaveTypeId must be a real (non-synthetic)
// configured type — callers should skip LOP/HALF_DAY entirely.
export async function adjustUsedInTransaction(tx, userId, fyStartYear, leaveType, deltaDays) {
  const ref = db.collection(COLLECTIONS.HR_LEAVE_BALANCES).doc(balanceDocId(userId, fyStartYear));
  const snap = await tx.get(ref);
  const data = snap.exists ? snap.data() : { userId, year: fyStartYear, balances: {} };
  const balances = data.balances || {};
  const existing = balances[leaveType.id];

  let entitlement;
  if (existing?.entitlement !== undefined) {
    entitlement = existing.entitlement;
  } else {
    const carryIn = await getCarryInForType(userId, fyStartYear, leaveType, (r) => tx.get(r));
    entitlement = round1((leaveType.paidDaysPerYear ?? 0) + carryIn);
  }

  const used = Math.max(0, round1((existing?.used || 0) + deltaDays));
  balances[leaveType.id] = { entitlement, used, remaining: round1(entitlement - used) };

  tx.set(
    ref,
    { userId, year: fyStartYear, balances, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

export async function setEntitlementOverride(userId, fyStartYear, leaveTypeId, entitlement) {
  const ref = db.collection(COLLECTIONS.HR_LEAVE_BALANCES).doc(balanceDocId(userId, fyStartYear));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : { userId, year: fyStartYear, balances: {} };
    const balances = data.balances || {};
    const existing = balances[leaveTypeId] || { used: 0 };
    const used = round1(existing.used || 0);
    balances[leaveTypeId] = { entitlement: round1(entitlement), used, remaining: round1(entitlement - used) };
    tx.set(
      ref,
      { userId, year: fyStartYear, balances, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  });
}
