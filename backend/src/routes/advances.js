import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ROLES, ADVANCE_STATUS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { round2 } from "../lib/dateUtils.js";
import { getWalletBalance } from "../lib/advanceWallet.js";
import {
  loadDepartmentMap, loadDepartmentAdmins, visibleDepartmentFor, filterByDepartment,
  canDeptApprove, canFinalApprove, canAdminCancel, awaitingNote, moneyActions,
} from "../lib/approvals.js";
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

const isAdminRole = (role) => [ROLES.ADMIN, ROLES.SUPERADMIN].includes(role);
const col = () => db.collection(COLLECTIONS.HR_ADVANCES);

async function decorate(list, user) {
  const [deptMap, deptAdmins] = await Promise.all([loadDepartmentMap(), loadDepartmentAdmins()]);
  return Promise.all(
    list.map(async (a) => {
      const department = deptMap.get(a.userId) || null;
      return {
        ...a,
        department,
        awaiting: awaitingNote(a.status, department, deptAdmins),
        actions: isAdminRole(user.role) ? await moneyActions(user, a) : undefined,
      };
    })
  );
}

router.post("/", authenticate, async (req, res, next) => {
  try {
    if (req.user.role === ROLES.EMPLOYEE) {
      const profileSnap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(req.user.userId).get();
      if (!profileSnap.exists || !profileSnap.data().reimbursementAccess) {
        return res.status(403).json({ error: "Reimbursement access has not been granted to you" });
      }
    }
    const amount = round2(Number(req.body.amount));
    const { purpose } = req.body;
    if (!(amount > 0)) return res.status(400).json({ error: "amount must be greater than 0" });
    if (!purpose || !String(purpose).trim()) return res.status(400).json({ error: "purpose is required" });

    const id = uuid();
    const doc = {
      userId: req.user.userId,
      name: req.user.name,
      amount,
      remainingBalance: 0, // credited only on final approval
      purpose: String(purpose).trim(),
      status: ADVANCE_STATUS.PENDING,
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      appliedBy: req.user.userId,
    };
    await col().doc(id).set(doc);
    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

router.get("/mine", authenticate, async (req, res, next) => {
  try {
    const snap = await col().where("userId", "==", req.user.userId).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => ((a.appliedAt?._seconds || 0) < (b.appliedAt?._seconds || 0) ? 1 : -1));
    const [decorated, balance] = await Promise.all([decorate(list, { ...req.user, role: ROLES.EMPLOYEE }), getWalletBalance(req.user.userId)]);
    res.json({ balance, advances: decorated });
  } catch (err) {
    next(err);
  }
});

router.get("/wallet/:userId", authenticate, async (req, res, next) => {
  try {
    const target = req.params.userId.toUpperCase();
    if (target !== req.user.userId && !isAdminRole(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    res.json({ userId: target, balance: await getWalletBalance(target) });
  } catch (err) {
    next(err);
  }
});

router.get("/admin", authenticate, requireAdmin, async (req, res, next) => {
  try {
    let query = col();
    if (req.query.status) query = query.where("status", "==", req.query.status);
    const snap = await query.get();
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const [visibleDept, deptMap] = await Promise.all([visibleDepartmentFor(req.user), loadDepartmentMap()]);
    list = filterByDepartment(list, visibleDept, deptMap);
    list.sort((a, b) => ((a.appliedAt?._seconds || 0) < (b.appliedAt?._seconds || 0) ? 1 : -1));
    res.json(await decorate(list, req.user));
  } catch (err) {
    next(err);
  }
});

async function loadOr404(id, res) {
  const ref = col().doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return { ref, data: snap.data() };
}

router.put("/:id/dept-approve", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const found = await loadOr404(req.params.id, res);
    if (!found) return;
    if (found.data.status !== ADVANCE_STATUS.PENDING) return res.status(400).json({ error: "Only PENDING advances await department approval" });
    if (!(await canDeptApprove(req.user, found.data))) {
      return res.status(403).json({ error: "Only an admin of this employee's department can give the first approval" });
    }
    await found.ref.update({
      status: ADVANCE_STATUS.DEPT_APPROVED,
      deptApprovedBy: req.user.userId,
      deptApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
      deptComment: req.body.comment || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Final approval releases the money: the whole amount becomes the
// employee's advance wallet balance.
router.put("/:id/final-approve", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const found = await loadOr404(req.params.id, res);
    if (!found) return;
    if (found.data.status !== ADVANCE_STATUS.DEPT_APPROVED) return res.status(400).json({ error: "Only department-approved advances can be finally approved" });
    if (!canFinalApprove(req.user, found.data)) {
      return res.status(403).json({ error: "Only the superadmin (and not on their own request) can give final approval" });
    }
    await found.ref.update({
      status: ADVANCE_STATUS.APPROVED,
      remainingBalance: found.data.amount,
      finalApprovedBy: req.user.userId,
      finalApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
      finalApprovedMs: Date.now(),
      comment: req.body.comment || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/reject", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const found = await loadOr404(req.params.id, res);
    if (!found) return;
    const { status } = found.data;
    const allowed =
      (status === ADVANCE_STATUS.PENDING && (await canDeptApprove(req.user, found.data))) ||
      (status === ADVANCE_STATUS.DEPT_APPROVED && canFinalApprove(req.user, found.data));
    if (!allowed) return res.status(403).json({ error: "You can't reject this advance at its current stage" });
    await found.ref.update({
      status: ADVANCE_STATUS.REJECTED,
      decidedBy: req.user.userId,
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      comment: req.body.comment || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/cancel", authenticate, async (req, res, next) => {
  try {
    const found = await loadOr404(req.params.id, res);
    if (!found) return;
    const isSelf = found.data.userId === req.user.userId;
    if (!isSelf && !(isAdminRole(req.user.role) && (await canAdminCancel(req.user, found.data)))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (![ADVANCE_STATUS.PENDING, ADVANCE_STATUS.DEPT_APPROVED].includes(found.data.status)) {
      return res.status(400).json({ error: "Only advances that are not yet finally approved can be cancelled" });
    }
    await found.ref.update({
      status: ADVANCE_STATUS.CANCELLED,
      cancelledBy: req.user.userId,
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
