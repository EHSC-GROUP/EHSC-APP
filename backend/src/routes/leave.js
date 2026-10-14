import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import {
  COLLECTIONS,
  ROLES,
  LOP,
  HALF_DAY,
  LEAVE_STATUS,
  STAFF_PROFILE_TYPES,
  ATTENDANCE_STATUS_VALUES,
} from "../lib/constants.js";
import { authenticate, requireAdmin, requireApprover, requireSuperAdmin } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { uploadBuffer, streamFile, safeFileName } from "../lib/storage.js";
import { financialYearOf, eachDate, round1, weekdayOf } from "../lib/dateUtils.js";
import { workingDaysForRange, getHolidaySetForRange, getWeeklyOffDays } from "../lib/calendar.js";
import {
  getLeaveTypes,
  getLeaveBalancesForYear,
  adjustUsedInTransaction,
  setEntitlementOverride,
} from "../lib/leaveBalances.js";
import { canDeptApprove, canTeamLeadApprove, getDepartmentOf, loadDepartmentMap, visibleDepartmentFor, filterByDepartment } from "../lib/approvals.js";
import { getLeaveCardData, listActiveEmployeeUserIds } from "../lib/leaveCard.js";
import { renderLeaveCardPdf } from "../lib/leaveCardPdf.js";
import { buildLeaveCardWorkbook } from "../lib/leaveCardExcel.js";
import { isValidId } from "../lib/validateId.js";

const router = Router();
// userId route params must look like a real ID before they're used to build
// a Firestore document path (see lib/validateId.js). 'ALL' is the one
// special literal (documents.js's company-wide bucket) and passes through
// since it's plain letters.
router.param("userId", (req, res, next, value) => {
  const v = (value || "").toUpperCase();
  if (!isValidId(v)) return res.status(400).json({ error: "userId is invalid" });
  req.params.userId = v;
  next();
});


function isAdminRole(role) {
  return [ROLES.ADMIN, ROLES.SUPERADMIN].includes(role);
}

// Leave is single-step: either the employee's department admin or their
// team lead (if one is assigned) can approve/reject it — whichever gets
// there first, no ordering between the two.
async function canApproveLeave(user, request) {
  return (await canDeptApprove(user, request)) || (await canTeamLeadApprove(user, request));
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
    res.json({ fullDays, days, medicalCertRequired: false });
  } catch (err) {
    next(err);
  }
});

// ---- leave register (admin) --------------------------------------------
router.get("/requests", authenticate, requireApprover, async (req, res, next) => {
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
    // Department admins only see their own department's leave; the
    // superadmin sees everything (but only a matching department admin can
    // approve — see canDeptApprove).
    const [visibleDept, deptMap] = await Promise.all([visibleDepartmentFor(req.user), loadDepartmentMap()]);
    list = filterByDepartment(list, visibleDept, deptMap);
    list = await Promise.all(
      list.map(async (r) => ({
        ...r,
        department: deptMap.get(r.userId) || null,
        actions: { canApprove: r.status === LEAVE_STATUS.PENDING && (await canApproveLeave(req.user, r)) },
      }))
    );
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

// ---- Comp Off -----------------------------------------------------------
// Work on a company holiday or weekly off to give back a leave day already
// taken. The employee picks the day they worked (it must have a Present, On
// Duty, Travel, WFH or Half Day record on a holiday / weekly off) and the
// approved leave it makes up for. When the approver confirms, those days are
// credited back to that leave type's balance, so they are not deducted.
const COMP_COL = () => db.collection(COLLECTIONS.HR_COMP_OFF_REQUESTS);
const WORKED_WEIGHT = {
  [ATTENDANCE_STATUS_VALUES.PRESENT]: 1,
  [ATTENDANCE_STATUS_VALUES.OUT_OF_OFFICE]: 1,
  [ATTENDANCE_STATUS_VALUES.TRAVEL]: 1,
  [ATTENDANCE_STATUS_VALUES.WFH]: 1,
  [ATTENDANCE_STATUS_VALUES.HALF_DAY]: 0.5,
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const OPEN_COMP = [LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED];

async function offDaySet(dates) {
  if (!dates.length) return new Set();
  const sorted = [...dates].sort();
  const [holidays, weeklyOff] = await Promise.all([getHolidaySetForRange(sorted[0], sorted[sorted.length - 1]), getWeeklyOffDays()]);
  return new Set(dates.filter((d) => holidays.has(d) || weeklyOff.includes(weekdayOf(d))));
}

// What this employee can claim right now: worked holiday/off days not yet used,
// and approved leaves that still have days to give back.
async function compOffOptionsFor(userId) {
  const [attSnap, compSnap, leaveSnap] = await Promise.all([
    db.collection(COLLECTIONS.ATTENDANCE_STATUS).where("userId", "==", userId).get(),
    COMP_COL().where("userId", "==", userId).get(),
    db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).where("userId", "==", userId).get(),
  ]);
  const comps = compSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => OPEN_COMP.includes(c.status));
  const usedDates = new Set(comps.map((c) => c.workedDate));
  const worked = attSnap.docs.map((d) => d.data()).filter((r) => r.date <= todayISO() && WORKED_WEIGHT[r.status] && !usedDates.has(r.date));
  const off = await offDaySet(worked.map((r) => r.date));
  const workedDays = worked.filter((r) => off.has(r.date)).sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((r) => ({ date: r.date, status: r.status, credit: WORKED_WEIGHT[r.status] }));

  const pendingByLeave = new Map();
  for (const c of comps.filter((x) => x.status === LEAVE_STATUS.PENDING)) {
    pendingByLeave.set(c.leaveRequestId, round1((pendingByLeave.get(c.leaveRequestId) || 0) + c.credit));
  }
  const leaves = leaveSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.status === LEAVE_STATUS.APPROVED && r.leaveType !== LOP && r.leaveType !== HALF_DAY)
    .map((r) => ({ id: r.id, leaveType: r.leaveType, fromDate: r.fromDate, toDate: r.toDate, days: r.days, available: round1(r.days - (r.compOffCredit || 0) - (pendingByLeave.get(r.id) || 0)) }))
    .filter((r) => r.available > 0)
    .sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1));
  return { workedDays, leaves };
}

router.get("/comp-off/options", authenticate, async (req, res, next) => {
  try {
    res.json(await compOffOptionsFor(req.user.userId));
  } catch (err) {
    next(err);
  }
});

router.post("/comp-off", authenticate, async (req, res, next) => {
  try {
    const { workedDate, leaveRequestId } = req.body;
    if (!workedDate || !leaveRequestId) return res.status(400).json({ error: "Choose the day you worked and the leave it makes up for" });
    const { workedDays, leaves } = await compOffOptionsFor(req.user.userId);
    const day = workedDays.find((d) => d.date === workedDate);
    if (!day) return res.status(400).json({ error: "That day is not available. It must be a holiday or weekly off with your attendance marked, and not already used for a Comp Off." });
    const leave = leaves.find((l) => l.id === leaveRequestId);
    if (!leave) return res.status(400).json({ error: "That leave is not available. It must be your approved leave with days still to give back." });
    const credit = Math.min(day.credit, leave.available);
    const doc = {
      userId: req.user.userId,
      name: req.user.name,
      workedDate,
      leaveRequestId,
      leaveType: leave.leaveType,
      leaveFrom: leave.fromDate,
      leaveTo: leave.toDate,
      credit,
      status: LEAVE_STATUS.PENDING,
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = COMP_COL().doc();
    await ref.set(doc);
    res.status(201).json({ id: ref.id, ...doc });
  } catch (err) {
    next(err);
  }
});

router.get("/comp-off/mine", authenticate, async (req, res, next) => {
  try {
    const snap = await COMP_COL().where("userId", "==", req.user.userId).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.workedDate < b.workedDate ? 1 : -1)));
  } catch (err) {
    next(err);
  }
});

router.get("/comp-off", authenticate, requireApprover, async (req, res, next) => {
  try {
    const snap = await COMP_COL().get();
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const [visibleDept, deptMap] = await Promise.all([visibleDepartmentFor(req.user), loadDepartmentMap()]);
    list = filterByDepartment(list, visibleDept, deptMap);
    list = await Promise.all(list.map(async (c) => ({
      ...c,
      department: deptMap.get(c.userId) || null,
      actions: { canApprove: c.status === LEAVE_STATUS.PENDING && (await canApproveLeave(req.user, c)) },
    })));
    list.sort((a, b) => (a.workedDate < b.workedDate ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.put("/comp-off/:id/approve", authenticate, requireApprover, async (req, res, next) => {
  try {
    const ref = COMP_COL().doc(req.params.id);
    const leaveTypes = await getLeaveTypes();
    const pre = await ref.get();
    if (!pre.exists) return res.status(404).json({ error: "Not found" });
    if (!(await canApproveLeave(req.user, pre.data()))) {
      return res.status(403).json({ error: "Only an admin or team lead of this employee's department can approve this" });
    }
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const comp = snap.data();
      if (comp.status !== LEAVE_STATUS.PENDING) throw Object.assign(new Error("Only PENDING requests can be approved"), { status: 400 });
      const leaveRef = db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).doc(comp.leaveRequestId);
      const leaveSnap = await tx.get(leaveRef);
      const leave = leaveSnap.exists ? leaveSnap.data() : null;
      if (!leave || leave.status !== LEAVE_STATUS.APPROVED) {
        throw Object.assign(new Error("The leave this Comp Off is for is no longer approved"), { status: 400 });
      }
      const room = round1(leave.days - (leave.compOffCredit || 0));
      const credit = Math.min(comp.credit, room);
      if (credit <= 0) throw Object.assign(new Error("That leave has no days left to give back"), { status: 400 });

      const lt = leaveTypes.find((l) => l.id === leave.leaveType);
      if (lt) await adjustUsedInTransaction(tx, leave.userId, leave.balanceYear, lt, -credit);
      tx.update(leaveRef, {
        compOffCredit: round1((leave.compOffCredit || 0) + credit),
        // Days that had gone past the balance (Loss of Pay) are made up first.
        lopExcessDays: Math.max(0, round1((leave.lopExcessDays || 0) - credit)),
      });
      tx.update(ref, {
        status: LEAVE_STATUS.APPROVED,
        credit,
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

router.put("/comp-off/:id/reject", authenticate, requireApprover, async (req, res, next) => {
  try {
    const ref = COMP_COL().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== LEAVE_STATUS.PENDING) return res.status(400).json({ error: "Only PENDING requests can be rejected" });
    if (!(await canApproveLeave(req.user, snap.data()))) {
      return res.status(403).json({ error: "Only an admin or team lead of this employee's department can reject this" });
    }
    await ref.update({ status: LEAVE_STATUS.REJECTED, decidedBy: req.user.userId, decidedAt: admin.firestore.FieldValue.serverTimestamp(), comment: req.body.comment || null });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// The employee can withdraw a request that is still waiting.
router.put("/comp-off/:id/cancel", authenticate, async (req, res, next) => {
  try {
    const ref = COMP_COL().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().userId !== req.user.userId) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== LEAVE_STATUS.PENDING) return res.status(400).json({ error: "Only a PENDING request can be cancelled" });
    await ref.update({ status: LEAVE_STATUS.CANCELLED });
    res.json({ ok: true });
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

    // A department admin can only record leave for their own department.
    if (req.user.role === ROLES.ADMIN) {
      const [adminDept, targetDept] = await Promise.all([getDepartmentOf(req.user.userId), getDepartmentOf(userId.toUpperCase())]);
      if (!adminDept || adminDept !== targetDept) {
        return res.status(403).json({ error: "You can only record leave for employees in your own department" });
      }
    }

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
router.put("/requests/:id/approve", authenticate, requireApprover, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).doc(req.params.id);
    const leaveTypes = await getLeaveTypes();

    const pre = await ref.get();
    if (!pre.exists) return res.status(404).json({ error: "Not found" });
    if (!(await canApproveLeave(req.user, pre.data()))) {
      return res.status(403).json({ error: "Only an admin or team lead of this employee's department can approve their leave" });
    }

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const request = snap.data();
      if (request.status !== LEAVE_STATUS.PENDING) {
        throw Object.assign(new Error("Only PENDING requests can be approved"), { status: 400 });
      }

      const balanceYear = financialYearOf(request.fromDate);
      // Leave is paid while balance remains; whatever goes past the balance
      // is stamped here so payroll treats those days as Loss of Pay.
      let lopExcessDays = 0;
      if (request.leaveType !== LOP && request.leaveType !== HALF_DAY) {
        const lt = leaveTypes.find((l) => l.id === request.leaveType);
        if (lt) lopExcessDays = await adjustUsedInTransaction(tx, request.userId, balanceYear, lt, request.days);
      }

      tx.update(ref, {
        status: LEAVE_STATUS.APPROVED,
        balanceYear,
        lopExcessDays,
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

router.put("/requests/:id/reject", authenticate, requireApprover, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_LEAVE_REQUESTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== LEAVE_STATUS.PENDING) {
      return res.status(400).json({ error: "Only PENDING requests can be rejected" });
    }
    if (!(await canApproveLeave(req.user, snap.data()))) {
      return res.status(403).json({ error: "Only an admin or team lead of this employee's department can reject their leave" });
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
      // A department admin can only cancel their own department's leave;
      // the superadmin can cancel any.
      if (!isSelf && req.user.role === ROLES.ADMIN) {
        const [adminDept, targetDept] = await Promise.all([getDepartmentOf(req.user.userId), getDepartmentOf(request.userId)]);
        if (!adminDept || adminDept !== targetDept) {
          throw Object.assign(new Error("Only an admin of this employee's department can cancel their leave"), { status: 403 });
        }
      }
      if (![LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED].includes(request.status)) {
        throw Object.assign(new Error("Only PENDING or APPROVED requests can be cancelled"), { status: 400 });
      }

      if (request.status === LEAVE_STATUS.APPROVED && request.leaveType !== LOP && request.leaveType !== HALF_DAY) {
        const lt = leaveTypes.find((l) => l.id === request.leaveType);
        // Days already given back through an approved Comp Off are not credited twice.
        if (lt) await adjustUsedInTransaction(tx, request.userId, request.balanceYear, lt, -Math.max(0, round1(request.days - (request.compOffCredit || 0))));
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

// ---- Leave Card export (PDF/Excel) ----------------------------------------
// Registered ahead of "/card/:userId/..." so "/card/export/..." isn't
// swallowed by the ":userId" param.
router.get("/card/export/pdf", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fy = req.query.fy ? Number(req.query.fy) : financialYearOf(new Date().toISOString().slice(0, 10));
    const userIds = await listActiveEmployeeUserIds();
    const cards = await Promise.all(userIds.map((id) => getLeaveCardData(id, fy)));
    const pdfBuffer = await renderLeaveCardPdf(cards);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Leave_Cards_FY${fy}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

router.get("/card/export/excel", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fy = req.query.fy ? Number(req.query.fy) : financialYearOf(new Date().toISOString().slice(0, 10));
    const userIds = await listActiveEmployeeUserIds();
    const cards = await Promise.all(userIds.map((id) => getLeaveCardData(id, fy)));
    const workbook = await buildLeaveCardWorkbook(cards);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Leave_Cards_FY${fy}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

router.get("/card/:userId/pdf", authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    if (targetId !== req.user.userId && !isAdminRole(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    const fy = req.query.fy ? Number(req.query.fy) : financialYearOf(new Date().toISOString().slice(0, 10));
    const card = await getLeaveCardData(targetId, fy);
    const pdfBuffer = await renderLeaveCardPdf([card]);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Leave_Card_${targetId}_FY${fy}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

router.get("/card/:userId/excel", authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    if (targetId !== req.user.userId && !isAdminRole(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    const fy = req.query.fy ? Number(req.query.fy) : financialYearOf(new Date().toISOString().slice(0, 10));
    const card = await getLeaveCardData(targetId, fy);
    const workbook = await buildLeaveCardWorkbook([card]);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Leave_Card_${targetId}_FY${fy}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// ---- balances -------------------------------------------------------------
// Whole-roster view for the admin Balances tab — one request instead of a
// separate round trip per employee. Leave types are fetched once and reused
// for every employee's computation instead of being re-queried per row.
router.get("/balances", authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const fy = req.query.fy ? Number(req.query.fy) : financialYearOf(new Date().toISOString().slice(0, 10));
    const [profilesSnap, usersSnap, leaveTypes] = await Promise.all([
      db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "in", STAFF_PROFILE_TYPES).get(),
      db.collection(COLLECTIONS.USERS).get(),
      getLeaveTypes(),
    ]);
    const usersById = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));
    const roster = profilesSnap.docs
      .map((d) => ({ userId: d.id, name: usersById.get(d.id)?.name, department: d.data().department || null, disabled: !!usersById.get(d.id)?.disabled }))
      .filter((p) => !p.disabled)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    const balancesByUser = await Promise.all(roster.map((p) => getLeaveBalancesForYear(p.userId, fy)));
    const employees = roster.map((p, i) => ({ userId: p.userId, name: p.name, department: p.department, balances: balancesByUser[i] }));
    res.json({ year: fy, leaveTypes: leaveTypes.map((lt) => ({ id: lt.id, name: lt.name })), employees });
  } catch (err) {
    next(err);
  }
});

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

router.put("/balances/:userId/:leaveTypeId", authenticate, requireSuperAdmin, async (req, res, next) => {
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
