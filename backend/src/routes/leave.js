import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import {
  COLLECTIONS,
  ROLES,
  LOP,
  HALF_DAY,
  LEAVE_STATUS,
  MEDICAL_CERT_THRESHOLD_DAYS,
} from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { uploadBuffer, streamFile, safeFileName } from "../lib/storage.js";
import { financialYearOf } from "../lib/dateUtils.js";
import { workingDaysForRange } from "../lib/calendar.js";
import {
  getLeaveTypes,
  getLeaveBalancesForYear,
  adjustUsedInTransaction,
  setEntitlementOverride,
} from "../lib/leaveBalances.js";

const router = Router();

function isAdminRole(role) {
  return [ROLES.ADMIN, ROLES.SUPERADMIN].includes(role);
}

// ---- working-day preview (used by both the admin entry form and the
// self-service apply modal) --------------------------------------------
router.get("/working-days-preview", authenticate, async (req, res, next) => {
  try {
    const { from, to, halfDay } = req.query;
    if (!from || !to || from > to) {
      return res.status(400).json({ error: "from and to (YYYY-MM-DD, from <= to) are required" });
    }
    const fullDays = await workingDaysForRange(from, to);
    const isHalfDay = halfDay === "true";
    const days = isHalfDay ? Math.max(0, fullDays - 0.5) : fullDays;
    res.json({ fullDays, days, medicalCertRequired: fullDays > MEDICAL_CERT_THRESHOLD_DAYS });
  } catch (err) {
    next(err);
  }
});

// ---- leave register (admin) --------------------------------------------
router.get("/requests", authenticate, requireAdmin, async (req, res, next) => {
  try {
    let query = db.collection(COLLECTIONS.HR_LEAVE_REQUESTS);
    if (req.query.userId) query = query.where("userId", "==", req.query.userId.toUpperCase());
    if (req.query.status) query = query.where("status", "==", req.query.status);
    const snap = await query.get();
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (req.query.fy) {
      const fy = Number(req.query.fy);
      list = list.filter((r) => financialYearOf(r.fromDate) === fy);
    }
    list.sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/requests/mine", authenticate, async (req, res, next) => {
  try {
    const snap = await db
      .collection(COLLECTIONS.HR_LEAVE_REQUESTS)
      .where("userId", "==", req.user.userId)
      .get();
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (req.query.fy) {
      const fy = Number(req.query.fy);
      list = list.filter((r) => financialYearOf(r.fromDate) === fy);
    }
    list.sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

async function saveMedicalCert(file) {
  if (!file) return { medicalCertFileId: null, medicalCertLink: null };
  const id = uuid();
  const path = `medical-certs/${id}-${safeFileName(file.originalname)}`;
  await uploadBuffer(path, file.buffer, file.mimetype);
  return { medicalCertFileId: path, medicalCertLink: `/api/leave/requests/${id}/medical-cert` };
}

// ---- create: admin recording on anyone's behalf -------------------------
router.post("/requests", authenticate, requireAdmin, upload.single("medicalCert"), async (req, res, next) => {
  try {
    const { userId, leaveType, fromDate, toDate, halfDay, reason } = req.body;
    if (!userId || !leaveType || !fromDate || !toDate) {
      return res.status(400).json({ error: "userId, leaveType, fromDate and toDate are required" });
    }
    const effectiveToDate = leaveType === HALF_DAY ? fromDate : toDate;
    if (fromDate > effectiveToDate) return res.status(400).json({ error: "fromDate must be <= toDate" });

    let days;
    const isHalfDay = leaveType === HALF_DAY ? true : halfDay === "true" || halfDay === true;
    if (leaveType === HALF_DAY) {
      days = 0.5;
    } else {
      const fullDays = await workingDaysForRange(fromDate, effectiveToDate);
      days = isHalfDay ? Math.max(0, fullDays - 0.5) : fullDays;
    }

    const medicalCert = await saveMedicalCert(req.file);
    const id = uuid();
    const doc = {
      userId: userId.toUpperCase(),
      name: req.body.name || null,
      leaveType,
      fromDate,
      toDate: effectiveToDate,
      halfDay: isHalfDay,
      days,
      reason: reason || "",
      ...medicalCert,
      status: LEAVE_STATUS.PENDING,
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      appliedBy: req.user.userId,
    };
    await db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).doc(id).set(doc);
    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

// ---- create: self-service apply -----------------------------------------
router.post("/requests/self", authenticate, upload.single("medicalCert"), async (req, res, next) => {
  try {
    const { leaveType, fromDate, toDate, halfDay, reason } = req.body;
    if (!leaveType || !fromDate || !toDate) {
      return res.status(400).json({ error: "leaveType, fromDate and toDate are required" });
    }
    if (leaveType === LOP || leaveType === HALF_DAY) {
      return res.status(400).json({ error: "This leave type is administrative-only" });
    }
    if (fromDate > toDate) return res.status(400).json({ error: "fromDate must be <= toDate" });

    const leaveTypes = await getLeaveTypes();
    if (!leaveTypes.some((lt) => lt.id === leaveType)) {
      return res.status(400).json({ error: "Unknown leave type" });
    }

    const fullDays = await workingDaysForRange(fromDate, toDate);
    const isHalfDay = halfDay === "true" || halfDay === true;

    if (fullDays > MEDICAL_CERT_THRESHOLD_DAYS) {
      if (isHalfDay) {
        return res.status(400).json({ error: "Half-day trim is not available for requests longer than 3 working days" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "A medical certificate is required for leave longer than 3 working days" });
      }
    }

    const requestedDays = req.body.days !== undefined ? Number(req.body.days) : (isHalfDay ? fullDays - 0.5 : fullDays);
    const validDays = isHalfDay ? fullDays - 0.5 : fullDays;
    if (Math.abs(requestedDays - validDays) > 1e-9) {
      return res.status(400).json({ error: `days must equal ${fullDays} or ${fullDays - 0.5} (a half-day trim on the last day)` });
    }

    const medicalCert = await saveMedicalCert(req.file);
    const id = uuid();
    const doc = {
      userId: req.user.userId,
      name: req.user.name,
      leaveType,
      fromDate,
      toDate,
      halfDay: isHalfDay,
      days: Math.max(0, validDays),
      reason: reason || "",
      ...medicalCert,
      status: LEAVE_STATUS.PENDING,
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      appliedBy: req.user.userId,
    };
    await db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).doc(id).set(doc);
    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

router.get("/requests/:id/medical-cert", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).doc(req.params.id).get();
    if (!snap.exists || !snap.data().medicalCertFileId) return res.status(404).json({ error: "Not found" });
    const request = snap.data();
    const isSelf = request.userId === req.user.userId;
    if (!isSelf && !isAdminRole(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    await streamFile(res, request.medicalCertFileId);
  } catch (err) {
    next(err);
  }
});

// ---- approve (transaction: PENDING -> APPROVED, deduct balance) --------
router.put("/requests/:id/approve", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).doc(req.params.id);
    const leaveTypes = await getLeaveTypes();

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const request = snap.data();
      if (request.status !== LEAVE_STATUS.PENDING) {
        throw Object.assign(new Error("Only PENDING requests can be approved"), { status: 400 });
      }

      const balanceYear = financialYearOf(request.fromDate);
      if (request.leaveType !== LOP && request.leaveType !== HALF_DAY) {
        const lt = leaveTypes.find((l) => l.id === request.leaveType);
        if (lt) await adjustUsedInTransaction(tx, request.userId, balanceYear, lt, request.days);
      }

      tx.update(ref, {
        status: LEAVE_STATUS.APPROVED,
        balanceYear,
        decidedBy: req.user.userId,
        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        comment: req.body.comment || null,
      });
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put("/requests/:id/reject", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== LEAVE_STATUS.PENDING) {
      return res.status(400).json({ error: "Only PENDING requests can be rejected" });
    }
    await ref.update({
      status: LEAVE_STATUS.REJECTED,
      decidedBy: req.user.userId,
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      comment: req.body.comment || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- cancel: admin (any) or the employee themself (own), from PENDING or
// APPROVED. Reverses the balance deduction using the FY it was posted
// against (stamped at approval time), floored at 0.
router.put("/requests/:id/cancel", authenticate, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).doc(req.params.id);
    const leaveTypes = await getLeaveTypes();

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const request = snap.data();

      const isSelf = request.userId === req.user.userId;
      if (!isSelf && !isAdminRole(req.user.role)) {
        throw Object.assign(new Error("Forbidden"), { status: 403 });
      }
      if (![LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED].includes(request.status)) {
        throw Object.assign(new Error("Only PENDING or APPROVED requests can be cancelled"), { status: 400 });
      }

      if (request.status === LEAVE_STATUS.APPROVED && request.leaveType !== LOP && request.leaveType !== HALF_DAY) {
        const lt = leaveTypes.find((l) => l.id === request.leaveType);
        if (lt) await adjustUsedInTransaction(tx, request.userId, request.balanceYear, lt, -request.days);
      }

      tx.update(ref, {
        status: LEAVE_STATUS.CANCELLED,
        cancelledBy: req.user.userId,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- balances -------------------------------------------------------------
router.get("/balances/:userId", authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    const isSelf = req.user.userId === targetId;
    if (!isSelf && !isAdminRole(req.user.role)) return res.status(403).json({ error: "Forbidden" });

    const fy = req.query.fy ? Number(req.query.fy) : financialYearOf(new Date().toISOString().slice(0, 10));
    const balances = await getLeaveBalancesForYear(targetId, fy);
    res.json({ userId: targetId, year: fy, balances });
  } catch (err) {
    next(err);
  }
});

router.put("/balances/:userId/:leaveTypeId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { fy, entitlement } = req.body;
    if (fy === undefined || entitlement === undefined) {
      return res.status(400).json({ error: "fy and entitlement are required" });
    }
    await setEntitlementOverride(req.params.userId.toUpperCase(), Number(fy), req.params.leaveTypeId, Number(entitlement));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
