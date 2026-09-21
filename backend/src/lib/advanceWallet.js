import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ADVANCE_STATUS } from "./constants.js";
import { round2 } from "./dateUtils.js";

// An employee's advance wallet = the unspent part of every APPROVED advance
// they hold. Reimbursement vouchers draw it down (oldest advance first) when
// they receive final approval; only what's left over after the wallet hits
// zero is ever paid out.

export async function getWalletBalance(userId) {
  const snap = await db
    .collection(COLLECTIONS.HR_ADVANCES)
    .where("userId", "==", userId)
    .where("status", "==", ADVANCE_STATUS.APPROVED)
    .get();
  return round2(snap.docs.reduce((s, d) => s + Number(d.data().remainingBalance || 0), 0));
}

// Must be called inside a Firestore transaction BEFORE any tx writes (all
// reads first). Returns { offsets, total, apply } — call apply() after the
// caller's own reads to write the balance reductions.
export async function planWalletOffset(tx, userId, needAmount) {
  const snap = await tx.get(
    db.collection(COLLECTIONS.HR_ADVANCES).where("userId", "==", userId).where("status", "==", ADVANCE_STATUS.APPROVED)
  );
  const advances = snap.docs
    .map((d) => ({ ref: d.ref, id: d.id, remaining: Number(d.data().remainingBalance || 0), at: d.data().finalApprovedMs || 0 }))
    .filter((a) => a.remaining > 0)
    .sort((a, b) => a.at - b.at);

  let need = round2(needAmount);
  const offsets = [];
  for (const a of advances) {
    if (need <= 0) break;
    const take = round2(Math.min(a.remaining, need));
    offsets.push({ advanceId: a.id, amount: take, ref: a.ref, newRemaining: round2(a.remaining - take) });
    need = round2(need - take);
  }
  const total = round2(offsets.reduce((s, o) => s + o.amount, 0));
  return {
    offsets: offsets.map(({ advanceId, amount }) => ({ advanceId, amount })),
    total,
    apply() {
      for (const o of offsets) {
        tx.update(o.ref, { remainingBalance: o.newRemaining, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    },
  };
}

// Puts previously offset amounts back (a cancelled/undone reimbursement).
// Reads first, then writes — call before other tx writes.
export async function restoreWalletOffsets(tx, offsets) {
  const refs = offsets.map((o) => db.collection(COLLECTIONS.HR_ADVANCES).doc(o.advanceId));
  const snaps = await Promise.all(refs.map((r) => tx.get(r)));
  return () => {
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      tx.update(refs[i], {
        remainingBalance: round2(Number(snap.data().remainingBalance || 0) + offsets[i].amount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  };
}
