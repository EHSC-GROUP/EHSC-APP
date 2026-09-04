import cron from "node-cron";
import { db } from "../config/firebase.js";
import { COLLECTIONS, ATTENDANCE_RETENTION_MONTHS } from "./constants.js";

function cutoffDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - ATTENDANCE_RETENTION_MONTHS);
  return d.toISOString().slice(0, 10);
}

export async function pruneOldAttendanceLogs() {
  const cutoff = cutoffDate();
  const snap = await db.collection(COLLECTIONS.ATTENDANCE_LOGS).where("date", "<", cutoff).get();
  if (snap.empty) return 0;

  let batch = db.batch();
  let ops = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  return snap.size;
}

// Runs once a day at 03:00 server time, pruning logs older than the
// retention window (default 3 months). Attendance is reference-only data
// (systemLoginDays / muster P-A marks), never a payroll source of truth.
export function startAttendancePruneJob() {
  cron.schedule("0 3 * * *", () => {
    pruneOldAttendanceLogs().catch((err) => console.error("Attendance prune job failed:", err));
  });
}
