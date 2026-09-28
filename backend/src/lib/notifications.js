import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ADMIN_ROLES } from "./constants.js";

// One notification doc per recipient (not one shared doc with a recipients
// array) — keeps unread-count and mark-as-read queries a plain per-user
// where() instead of an array-membership scan.
export async function notifyAdmins({ message, link }) {
  const usersSnap = await db.collection(COLLECTIONS.USERS).where("role", "in", ADMIN_ROLES).get();
  const batch = db.batch();
  for (const doc of usersSnap.docs) {
    if (doc.data().disabled) continue;
    const ref = db.collection(COLLECTIONS.NOTIFICATIONS).doc();
    batch.set(ref, {
      userId: doc.id,
      message,
      link: link || null,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}
