// One-off correction after the "Mark all present" button was pressed by mistake.
//
// For 12, 13 and 14 Oct 2026 it sets On Duty for the people management named and
// Present (in office) for everyone else, replacing only records that are BULK or
// missing. Records that came from a real source (an approved request, a geofenced
// check-in, an admin edit) are never touched. It also removes BULK
// records dated after the 14th (marked in advance) so those days stay blank for
// employees to mark themselves. BULK records on 1-11 Oct are kept.
//
// Dry run by default (prints what it would do). Add --apply to write.
//   node scripts/fix-bulk-attendance.mjs
//   node scripts/fix-bulk-attendance.mjs --apply
// Against production set FIREBASE_PROJECT_ID=ehsc-app and use gcloud application-default login.
import { db } from "../src/config/firebase.js";

const APPLY = process.argv.includes("--apply");
const COL = "attendance_status";
const id = (u, d) => `${u}_${d}`;

const OD = {
  "2026-10-12": ["EHSC102", "EHSC118"],
  "2026-10-13": ["EHSC102", "EHSC118", "EHSC117", "EHSC107"],
  "2026-10-14": ["EHSC102", "EHSC118", "EHSC107"],
};

const profiles = await db.collection("hr_employee_profiles").get();
const users = await db.collection("users").get();
const disabled = new Set(users.docs.filter((d) => d.data().disabled).map((d) => d.id));
const staff = profiles.docs.filter((d) => ["employee", "admin", "team_leader"].includes(d.data().type)).map((d) => d.id).filter((u) => !disabled.has(u));

let changes = 0;
for (const [date, odList] of Object.entries(OD)) {
  for (const userId of staff) {
    const ref = db.collection(COL).doc(id(userId, date));
    const snap = await ref.get();
    const cur = snap.exists ? snap.data() : null;
    const wantOd = odList.includes(userId);
    if (cur && cur.source !== "BULK") {
      if (wantOd && cur.status !== "OUT_OF_OFFICE") console.log(`CHECK  ${date} ${userId} has a real ${cur.status} (${cur.source}) but management said On Duty - left as is`);
      continue;
    }
    const status = wantOd ? "OUT_OF_OFFICE" : "PRESENT";
    console.log(`${APPLY ? "SET   " : "WOULD "} ${date} ${userId} ${cur ? cur.status + "/BULK" : "(none)"} -> ${status}`);
    changes++;
    if (APPLY) {
      await ref.set({
        userId, date, status, leaveTypeId: null,
        note: wantOd ? "On Duty (confirmed by management)" : "Present in office (confirmed by management)",
        source: "ADMIN", markedAt: new Date().toISOString(), markedBy: "SYSTEM-CORRECTION",
      });
    }
  }
}

// Bulk records AFTER the 14th were marked in advance: remove them so those days
// are blank and employees mark attendance themselves as usual. Bulk records up to
// the 14th are kept as the attendance for 1-14 Oct.
const LAST = "2026-10-14";
const bulk = await db.collection(COL).where("source", "==", "BULK").get();
const future = bulk.docs.filter((d) => d.data().date > LAST);
console.log(`
${changes} record(s) ${APPLY ? "written" : "would be written"} for 12-14 Oct.`);
console.log(`${future.length} bulk record(s) dated after ${LAST} ${APPLY ? "removed" : "would be removed"}.`);
for (const d of future) {
  if (APPLY) await d.ref.delete();
}
const kept = bulk.docs.filter((d) => d.data().date <= LAST && !OD[d.data().date]).length;
console.log(`${kept} bulk record(s) on 1-11 Oct kept as the attendance for those days.`);
process.exit(0);
