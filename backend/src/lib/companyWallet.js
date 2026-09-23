import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, WALLET_TXN_TYPE } from "./constants.js";
import { round2 } from "./dateUtils.js";

const WALLET_DOC = () => db.collection(COLLECTIONS.HR_SETTINGS).doc("company_wallet");
const TXN_COL = () => db.collection(COLLECTIONS.HR_WALLET_TRANSACTIONS);

export async function getCompanyWalletBalance() {
  const snap = await WALLET_DOC().get();
  return snap.exists ? Number(snap.data().balance || 0) : 0;
}

// Applies a signed delta to the running balance and writes one statement
// line, both inside the caller's own Firestore transaction — so a
// reimbursement/advance/indent approval and its wallet deduction either
// both land or neither does. delta > 0 = credit (top-up, or a reversal
// handing money back), delta < 0 = debit (an approval committing spend).
export async function applyWalletDelta(tx, { delta, type, sourceId, description, userId }) {
  const walletRef = WALLET_DOC();
  const snap = await tx.get(walletRef);
  const before = snap.exists ? Number(snap.data().balance || 0) : 0;
  const after = round2(before + Number(delta));
  tx.set(
    walletRef,
    { balance: after, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: userId },
    { merge: true }
  );

  const txnRef = TXN_COL().doc();
  tx.set(txnRef, {
    type,
    sourceId: sourceId || null,
    amount: round2(Math.abs(delta)),
    direction: delta >= 0 ? "CREDIT" : "DEBIT",
    balanceAfter: after,
    description: description || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: userId,
  });
  return after;
}

// Top-up is its own standalone transaction (not composed into anything
// else) — superadmin adding budget, independent of any voucher.
export async function topUpWallet({ amount, note, userId }) {
  return db.runTransaction((tx) =>
    applyWalletDelta(tx, {
      delta: round2(Number(amount)),
      type: WALLET_TXN_TYPE.TOPUP,
      description: note || null,
      userId,
    })
  );
}

export async function listWalletTransactions(limitCount = 300) {
  const snap = await TXN_COL().orderBy("createdAt", "desc").limit(limitCount).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
