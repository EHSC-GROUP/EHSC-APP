import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";

// Proposal references read "EHSC - 2075" (the last one in the current template
// is 2074), counting up by one for every proposal.
const FIRST_AFTER = 2074;

export async function nextProposalNumber() {
  const ref = db.collection(COLLECTIONS.HR_SETTINGS).doc("proposal_counter");
  const n = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? snap.data().last : FIRST_AFTER) + 1;
    tx.set(ref, { last: next });
    return next;
  });
  return `EHSC - ${n}`;
}

export const SUBMISSION_MODES = Object.freeze(["In Person", "Email", "WhatsApp"]);
