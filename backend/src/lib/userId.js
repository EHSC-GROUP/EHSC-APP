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
