import "dotenv/config";
import bcrypt from "bcryptjs";
import { db, admin } from "../src/config/firebase.js";
import { COLLECTIONS, ROLES } from "../src/lib/constants.js";

async function seed() {
  const userId = process.env.SEED_SUPERADMIN_ID || "SUPERADMIN";
  const password = process.env.SEED_SUPERADMIN_PASSWORD || "ChangeMe123!";

  const existing = await db.collection(COLLECTIONS.USERS).doc(userId).get();
  if (existing.exists) {
    console.log(`User ${userId} already exists — skipping user creation.`);
  } else {
    const hash = await bcrypt.hash(password, 10);
    await db.collection(COLLECTIONS.USERS).doc(userId).set({
      userId,
      name: "Super Admin",
      role: ROLES.SUPERADMIN,
      password: hash,
      mustReset: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Created superadmin user: ${userId} / ${password} (must change password on first login)`);
  }

  await db.collection(COLLECTIONS.HR_SETTINGS).doc("weekly_off").set(
    { days: [0], updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: "seed" },
    { merge: true }
  );
  await db.collection(COLLECTIONS.HR_SETTINGS).doc("earnings_formula").set(
    { basicPercent: 50, hraPercent: 20, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: "seed" },
    { merge: true }
  );

  console.log("Default settings (weekly off = Sunday, earnings formula = 50%/20%) ensured.");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
