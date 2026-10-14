// Deletes the attendance records the correction script wrongly created for the
// associate EHSC-EXT001 on 12-14 Oct 2026. Associates have no attendance.
import { db } from "../src/config/firebase.js";

for (const date of ["2026-10-12", "2026-10-13", "2026-10-14"]) {
  const ref = db.collection("attendance_status").doc(`EHSC-EXT001_${date}`);
  const snap = await ref.get();
  console.log(date, snap.exists ? `deleting ${snap.data().status} (${snap.data().source})` : "nothing there");
  if (snap.exists) await ref.delete();
}
process.exit(0);
