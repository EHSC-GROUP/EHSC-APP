// Marks Present for 1 Oct and 10 Oct 2026 for every active employee, admin and team leader
// who has no record that day (they show as LOP on the Form 22 now). Anyone who
// already has a record for the day is left as is. Nothing else is touched.
// Dry run by default; add --apply to write.
import { db } from "../src/config/firebase.js";

const APPLY = process.argv.includes("--apply");
const DATES = ["2026-10-01", "2026-10-10"];
const profiles = await db.collection("hr_employee_profiles").get();
const users = await db.collection("users").get();
const disabled = new Set(users.docs.filter((d) => d.data().disabled).map((d) => d.id));
const staff = profiles.docs.filter((d) => ["employee", "admin", "team_leader"].includes(d.data().type)).map((d) => d.id).filter((u) => !disabled.has(u));

for (const DATE of DATES) {
  for (const userId of staff) {
    const ref = db.collection("attendance_status").doc(`${userId}_${DATE}`);
    const snap = await ref.get();
    if (snap.exists) { console.log(`KEEP   ${DATE} ${userId} already ${snap.data().status}`); continue; }
    console.log(`${APPLY ? "SET   " : "WOULD "} ${DATE} ${userId} -> PRESENT`);
    if (APPLY) await ref.set({ userId, date: DATE, status: "PRESENT", leaveTypeId: null, note: "", source: "ADMIN", markedAt: new Date().toISOString(), markedBy: "SYSTEM-CORRECTION" });
  }
}
process.exit(0);
