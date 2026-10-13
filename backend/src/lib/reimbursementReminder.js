import cron from "node-cron";
import { db } from "./../config/firebase.js";
import { COLLECTIONS, REIMBURSEMENT_STATUS } from "./constants.js";
import { notifySuperAdmins } from "./notifications.js";

export function startReimbursementReminderJob() {
  cron.schedule("0 9 * * 5", async () => {
    try {
      const snap = await db.collection(COLLECTIONS.HR_REIMBURSEMENTS)
        .where("status", "==", REIMBURSEMENT_STATUS.PENDING).get();
      if (snap.empty) return;
      await notifySuperAdmins({
        message: `${snap.size} reimbursement request${snap.size === 1 ? "" : "s"} await review.`,
        link: "/admin/reimbursements",
      });
    } catch (err) {
      console.error("Reimbursement Friday reminder failed:", err);
    }
  });
}
