import { Router } from "express";

import { db } from "../config/firebase.js";
import { COLLECTIONS, PAYSLIP_STATUS } from "../lib/constants.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// Read-only HR details for the logged-in employee. Deliberately excludes
// anything sensitive (bank details, etc.) that might be added to the
// profile schema later — this view should stay a subset of the admin one.
const SENSITIVE_FIELDS = ["bankAccountNumber", "bankIfsc", "bankName"];

router.get("/profile", authenticate, async (req, res, next) => {
  try {
    const [profileSnap, userSnap] = await Promise.all([
      db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(req.user.userId).get(),
      db.collection(COLLECTIONS.USERS).doc(req.user.userId).get(),
    ]);
    if (!profileSnap.exists) return res.status(404).json({ error: "Profile not found" });

    const profile = { ...profileSnap.data() };
    for (const f of SENSITIVE_FIELDS) delete profile[f];

    res.json({
      ...profile,
      userId: req.user.userId,
      name: userSnap.data()?.name,
      status: profile.dateOfLeaving ? "RELIEVED" : "ACTIVE",
    });
  } catch (err) {
    next(err);
  }
});

router.get("/payslips", authenticate, async (req, res, next) => {
  try {
    const snap = await db
      .collection(COLLECTIONS.HR_PAYSLIPS)
      .where("userId", "==", req.user.userId)
      .where("status", "==", PAYSLIP_STATUS.PUBLISHED)
      .get();
    const list = snap.docs.map((d) => d.data()).sort((a, b) => (a.period < b.period ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/badges", authenticate, async (req, res, next) => {
  try {
    const [leaveSnap, reimbSnap] = await Promise.all([
      db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).where("userId", "==", req.user.userId).where("status", "==", "PENDING").get(),
      db.collection(COLLECTIONS.HR_REIMBURSEMENTS).where("userId", "==", req.user.userId).where("status", "==", "PENDING").get(),
    ]);
    res.json({ pendingLeave: leaveSnap.size, pendingReimbursements: reimbSnap.size });
  } catch (err) {
    next(err);
  }
});

// Computed on the fly from recent status changes on the employee's own
// leave/reimbursement records — no separate notifications collection.
router.get("/activity", authenticate, async (req, res, next) => {
  try {
    const [leaveSnap, reimbSnap] = await Promise.all([
      db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).where("userId", "==", req.user.userId).get(),
      db.collection(COLLECTIONS.HR_REIMBURSEMENTS).where("userId", "==", req.user.userId).get(),
    ]);

    const events = [];
    for (const d of leaveSnap.docs) {
      const r = d.data();
      const at = r.decidedAt || r.cancelledAt || r.appliedAt;
      events.push({
        type: "leave",
        id: d.id,
        status: r.status,
        summary: `Leave (${r.leaveType}) ${r.fromDate} to ${r.toDate} — ${r.status}`,
        at,
      });
    }
    for (const d of reimbSnap.docs) {
      const r = d.data();
      const at = r.paidAt || r.decidedAt || r.cancelledAt || r.appliedAt;
      events.push({
        type: "reimbursement",
        id: d.id,
        status: r.status,
        summary: `Reimbursement of ${r.totalAmount} — ${r.status}`,
        at,
      });
    }

    events.sort((a, b) => {
      const av = a.at?.toMillis ? a.at.toMillis() : 0;
      const bv = b.at?.toMillis ? b.at.toMillis() : 0;
      return bv - av;
    });

    res.json(events.slice(0, 20));
  } catch (err) {
    next(err);
  }
});

export default router;
