import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, PAYSLIP_STATUS, ADMIN_ROLES } from "../lib/constants.js";
import { authenticate } from "../middleware/auth.js";
import { getAssignedWork } from "../lib/assignedWork.js";

const router = Router();

// Read-only HR details for the logged-in employee. Deliberately excludes
// anything sensitive (bank details, etc.) that might be added to the
// profile schema later — this view should stay a subset of the admin one.
const SENSITIVE_FIELDS = ["bankAccountNumber", "bankIfsc", "bankName"];

router.get("/profile", authenticate, async (req, res, next) => {
  try {
    const [directProfileSnap, userSnap] = await Promise.all([
      db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(req.user.userId).get(),
      db.collection(COLLECTIONS.USERS).doc(req.user.userId).get(),
    ]);
    let profileSnap = directProfileSnap;
    if (!profileSnap.exists) {
      const fallback = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("userId", "==", req.user.userId).limit(1).get();
      if (!fallback.empty) profileSnap = fallback.docs[0];
    }
    if (!profileSnap.exists) {
      // Admin/superadmin accounts can exist without an HR profile (e.g. the seeded
      // superadmin). They don't need reimbursement access to file their own
      // vouchers, so give them a minimal profile instead of an error.
      if (userSnap.exists && ADMIN_ROLES.includes(userSnap.data().role)) {
        return res.json({
          userId: req.user.userId,
          name: userSnap.data().name,
          type: "admin",
          reimbursementAccess: true,
          status: "ACTIVE",
          noHrProfile: true,
        });
      }
      return res.status(404).json({ error: "Profile not found" });
    }

    const profile = { ...profileSnap.data() };
    for (const f of SENSITIVE_FIELDS) delete profile[f];
    // Reimbursements is the one thing an associate can do, so they always have access.
    if (profile.type === "associate") profile.reimbursementAccess = true;

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

// Employees/admins fill these three themselves (prompted by a banner until
// done). Father/spouse name and date of birth are required; anniversary date
// is optional. Only these fields are ever written here.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
router.put("/personal-details", authenticate, async (req, res, next) => {
  try {
    const { fatherOrHusbandName, dateOfBirth, anniversaryDate } = req.body;
    const name = (fatherOrHusbandName || "").trim();
    if (!name) return res.status(400).json({ error: "Father / spouse name is required" });
    if (!ISO_DATE.test(dateOfBirth || "") || Number.isNaN(new Date(`${dateOfBirth}T00:00:00Z`).getTime())) {
      return res.status(400).json({ error: "A valid birth date is required" });
    }
    if (dateOfBirth > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: "Birth date can't be in the future" });
    }
    if (anniversaryDate && (!ISO_DATE.test(anniversaryDate) || Number.isNaN(new Date(`${anniversaryDate}T00:00:00Z`).getTime()))) {
      return res.status(400).json({ error: "Anniversary date is not a valid date" });
    }

    const ref = db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(req.user.userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Profile not found" });
    await ref.update({
      fatherOrHusbandName: name,
      dateOfBirth,
      anniversaryDate: anniversaryDate || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Staff (employees, admins, team leaders) can correct their own personal HR
// details. Anything the company controls stays locked: employee ID, name,
// designation, department, joining/leaving dates, reporting manager,
// professional email, ESI/UAN and bank details.
const SELF_EDITABLE = ["phone", "address", "personalEmail", "gender", "emergencyContactName", "emergencyContactPhone", "fatherOrHusbandName", "dateOfBirth", "anniversaryDate"];
const validDate = (d) => ISO_DATE.test(d || "") && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());

router.put("/profile", authenticate, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(req.user.userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Profile not found" });
    if (snap.data().type === "associate") return res.status(403).json({ error: "Associates can't edit HR details here" });

    const updates = {};
    for (const key of SELF_EDITABLE) {
      if (req.body[key] === undefined) continue;
      updates[key] = typeof req.body[key] === "string" ? req.body[key].trim() : req.body[key];
    }
    if (updates.phone !== undefined && updates.phone !== "" && !/^[+\d][\d\s-]{6,17}$/.test(updates.phone)) {
      return res.status(400).json({ error: "Phone number isn't valid" });
    }
    if (updates.emergencyContactPhone !== undefined && updates.emergencyContactPhone !== "" && !/^[+\d][\d\s-]{6,17}$/.test(updates.emergencyContactPhone)) {
      return res.status(400).json({ error: "Emergency contact phone isn't valid" });
    }
    if (updates.personalEmail !== undefined && updates.personalEmail !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.personalEmail)) {
      return res.status(400).json({ error: "Personal email isn't valid" });
    }
    if (updates.gender !== undefined && updates.gender !== "") {
      const g = String(updates.gender).toLowerCase();
      if (g !== "male" && g !== "female") return res.status(400).json({ error: "Gender must be Male or Female" });
      updates.gender = g === "male" ? "Male" : "Female";
    }
    if (updates.dateOfBirth !== undefined) {
      if (!validDate(updates.dateOfBirth)) return res.status(400).json({ error: "A valid birth date is required" });
      if (updates.dateOfBirth > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "Birth date can't be in the future" });
    }
    if (updates.anniversaryDate !== undefined) {
      if (updates.anniversaryDate === "") updates.anniversaryDate = null;
      else if (!validDate(updates.anniversaryDate)) return res.status(400).json({ error: "Anniversary date is not a valid date" });
    }
    if (updates.fatherOrHusbandName !== undefined && !updates.fatherOrHusbandName) {
      return res.status(400).json({ error: "Father / spouse name can't be empty" });
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });

    await ref.update({ ...updates, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/assigned-work", authenticate, async (req, res, next) => {
  try {
    const items = await getAssignedWork(req.user.userId);
    res.json(items);
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

function toMillis(at) {
  if (!at) return 0;
  if (typeof at.toMillis === "function") return at.toMillis();
  if (at._seconds) return at._seconds * 1000;
  const t = new Date(at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Computed on the fly from recent status changes on the employee's own
// leave/reimbursement/attendance records — no separate notifications
// collection. The attendance slice only surfaces entries someone ELSE
// marked (an admin correcting/setting your status) — self-check-ins don't
// need to notify you of your own action.
router.get("/activity", authenticate, async (req, res, next) => {
  try {
    const [leaveSnap, reimbSnap, attendanceSnap] = await Promise.all([
      db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).where("userId", "==", req.user.userId).get(),
      db.collection(COLLECTIONS.HR_REIMBURSEMENTS).where("userId", "==", req.user.userId).get(),
      db.collection(COLLECTIONS.ATTENDANCE_STATUS).where("userId", "==", req.user.userId).get(),
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
    for (const d of attendanceSnap.docs) {
      const r = d.data();
      if (r.markedBy === req.user.userId) continue;
      events.push({
        type: "attendance",
        id: d.id,
        status: r.status,
        summary: `Your attendance for ${r.date} was marked ${r.status} by ${r.markedBy}`,
        at: r.markedAt,
      });
    }

    events.sort((a, b) => toMillis(b.at) - toMillis(a.at));

    res.json(events.slice(0, 20));
  } catch (err) {
    next(err);
  }
});

export default router;
