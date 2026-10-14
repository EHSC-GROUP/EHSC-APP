// One-off: overwrite two days with On Duty, as confirmed by management.
//   Vanitha (EHSC107) 13 Oct 2026 - was an approved WFH
//   Indira  (EHSC102) 14 Oct 2026 - was a geofenced check-in (Present)
// Prints the record it replaces. Run with FIREBASE_PROJECT_ID=ehsc-app.
import { db } from "../src/config/firebase.js";

const TARGETS = [
  { userId: "EHSC107", date: "2026-10-13" },
  { userId: "EHSC102", date: "2026-10-14" },
];

for (const { userId, date } of TARGETS) {
  const ref = db.collection("attendance_status").doc(`${userId}_${date}`);
  const before = await ref.get();
  console.log(`${userId} ${date} was:`, before.exists ? `${before.data().status} (${before.data().source})` : "(none)");
  await ref.set({
    userId, date, status: "OUT_OF_OFFICE", leaveTypeId: null,
    note: "On Duty (confirmed by management)",
    source: "ADMIN", markedAt: new Date().toISOString(), markedBy: "SYSTEM-CORRECTION",
  });
  console.log(`${userId} ${date} now: OUT_OF_OFFICE`);
}
process.exit(0);
