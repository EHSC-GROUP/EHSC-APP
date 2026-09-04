import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";

export async function getSalaryStructureDoc(userId) {
  const snap = await db.collection(COLLECTIONS.HR_SALARY_STRUCTURES).doc(userId).get();
  if (!snap.exists) return null;
  return snap.data();
}

// "Current" version = latest effectiveFrom that is <= asOfDate (default today).
export function pickCurrentVersion(versions, asOfDate) {
  if (!versions || !versions.length) return null;
  const cutoff = asOfDate || new Date().toISOString().slice(0, 10);
  const eligible = versions
    .filter((v) => v.effectiveFrom <= cutoff)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return eligible[0] || null;
}

export async function getCurrentSalaryVersion(userId, asOfDate) {
  const doc = await getSalaryStructureDoc(userId);
  if (!doc) return null;
  return pickCurrentVersion(doc.versions, asOfDate);
}
