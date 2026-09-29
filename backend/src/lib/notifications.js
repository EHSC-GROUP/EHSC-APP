import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ROLES } from "./constants.js";

// One notification doc per recipient (not one shared doc with a recipients
// array) — keeps unread-count and mark-as-read queries a plain per-user
// where() instead of an array-membership scan. Superadmin-only, not every
// admin — raising an invoice is a superadmin-level call in this app.
export async function notifySuperadmins({ message, link }) {
  const usersSnap = await db.collection(COLLECTIONS.USERS).where("role", "==", ROLES.SUPERADMIN).get();
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
