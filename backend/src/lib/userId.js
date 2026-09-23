import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";

// userId = prefix (from name, letters only) + 4 random digits, uppercased.
// e.g. name "Sarn Kumar" -> "SARN4821". Retries on collision.
export async function generateUserId(name) {
  const lettersOnly = (name || "").replace(/[^a-zA-Z]/g, "");
  const prefix = (lettersOnly.slice(0, 4) || "EMP").toUpperCase();

  for (let attempt = 0; attempt < 20; attempt++) {
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    const candidate = `${prefix}${digits}`;
    const existing = await db.collection(COLLECTIONS.USERS).doc(candidate).get();
    if (!existing.exists) return candidate;
  }
  throw new Error("Could not generate a unique userId after 20 attempts");
}

const ASSOCIATE_PREFIX = "EHSC-EXT";
const ASSOCIATE_ID_PATTERN = /^EHSC-EXT(\d+)$/;

// Associates get sequential IDs: EHSC-EXT001, EHSC-EXT002, ... A counter
// document hands out the next number inside a transaction so two associates
// created at the same moment can't get the same ID. If the counter doesn't
// exist yet it is seeded from the highest ID already in use.
export async function generateAssociateId() {
  const counterRef = db.collection(COLLECTIONS.HR_SETTINGS).doc("associate_id_counter");
  return db.runTransaction(async (tx) => {
    const [counterSnap, usersSnap] = await Promise.all([
      tx.get(counterRef),
      tx.get(db.collection(COLLECTIONS.USERS).where("userId", ">=", ASSOCIATE_PREFIX).where("userId", "<", `${ASSOCIATE_PREFIX}~`)),
    ]);
    const highestInUse = usersSnap.docs.reduce((max, d) => {
      const m = ASSOCIATE_ID_PATTERN.exec(d.id);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    let next = Math.max(counterSnap.exists ? counterSnap.data().last : 0, highestInUse) + 1;
    // Belt and braces: never hand out a code that already belongs to someone,
    // even if the counter or the scan above were somehow wrong.
    for (let attempt = 0; attempt < 100; attempt++, next++) {
      const id = `${ASSOCIATE_PREFIX}${String(next).padStart(3, "0")}`;
      const taken = await tx.get(db.collection(COLLECTIONS.USERS).doc(id));
      if (!taken.exists) {
        tx.set(counterRef, { last: next });
        return id;
      }
    }
    throw new Error("Could not find a free associate code");
  });
}

const EMPLOYEE_PREFIX = "EHSC";
// Deliberately requires 3+ digits so this never matches an associate code
// (EHSC-EXT001 has no digit right after "EHSC" — the "-" fails this pattern).
const EMPLOYEE_ID_PATTERN = /^EHSC(\d{3,})$/;

// Staff (employee/admin/team lead) get sequential IDs too: EHSC123,
// EHSC124, ... Same belt-and-braces transactional pattern as
// generateAssociateId — seeded from the highest ID already in use if the
// counter doesn't exist yet (so it picks up right after whatever the last
// manually-entered ID was, e.g. EHSC122 in use -> next is EHSC123).
export async function generateEmployeeId() {
  const counterRef = db.collection(COLLECTIONS.HR_SETTINGS).doc("employee_id_counter");
  return db.runTransaction(async (tx) => {
    const [counterSnap, usersSnap] = await Promise.all([
      tx.get(counterRef),
      tx.get(db.collection(COLLECTIONS.USERS).where("userId", ">=", EMPLOYEE_PREFIX).where("userId", "<", `${EMPLOYEE_PREFIX}~`)),
    ]);
    const highestInUse = usersSnap.docs.reduce((max, d) => {
      const m = EMPLOYEE_ID_PATTERN.exec(d.id);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    let next = Math.max(counterSnap.exists ? counterSnap.data().last : 0, highestInUse) + 1;
    for (let attempt = 0; attempt < 100; attempt++, next++) {
      const id = `${EMPLOYEE_PREFIX}${String(next).padStart(3, "0")}`;
      const taken = await tx.get(db.collection(COLLECTIONS.USERS).doc(id));
      if (!taken.exists) {
        tx.set(counterRef, { last: next });
        return id;
      }
    }
    throw new Error("Could not find a free employee code");
  });
}
