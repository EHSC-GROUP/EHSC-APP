import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ROLES, REIMBURSEMENT_STATUS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { uploadBuffer, streamFile, safeFileName } from "../lib/storage.js";
import { numberToWords } from "../lib/numberToWords.js";
import { round2 } from "../lib/dateUtils.js";

const router = Router();

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "At least one item is required";
  for (const item of items) {
    if (!item.date || !item.description || !(Number(item.amount) > 0)) {
      return "Each item needs a date, description and amount > 0";
    }
  }
  return null;
}

function computeTotal(items) {
  return round2(items.reduce((sum, i) => sum + Number(i.amount), 0));
}

router.get("/admin", authenticate, requireAdmin, async (req, res, next) => {
  try {
    let query = db.collection(COLLECTIONS.HR_REIMBURSEMENTS);
    if (req.query.status) query = query.where("status", "==", req.query.status);
    if (req.query.userId) query = query.where("userId", "==", req.query.userId.toUpperCase());
    const snap = await query.get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.voucherDate < b.voucherDate ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/mine", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.HR_REIMBURSEMENTS).where("userId", "==", req.user.userId).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.voucherDate < b.voucherDate ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// Access management: full-set replace of who (non-admin employees) may
// submit their own reimbursements.
router.get("/access", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("reimbursementAccess", "==", true).get();
    res.json(snap.docs.map((d) => d.id));
  } catch (err) {
    next(err);
  }
});

router.put("/access", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: "userIds must be an array" });
    const granted = new Set(userIds.map((id) => id.toUpperCase()));

    const snap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).get();
    let batch = db.batch();
    let ops = 0;
    for (const doc of snap.docs) {
      const shouldHave = granted.has(doc.id);
      if (!!doc.data().reimbursementAccess !== shouldHave) {
        batch.update(doc.ref, { reimbursementAccess: shouldHave });
        ops++;
        if (ops >= 450) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
    }
    if (ops > 0) await batch.commit();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Submit — always for the caller themself. Non-admin employees need
// reimbursementAccess and a bill copy; admins/superadmins submitting their
// own expense vouchers need neither.
router.post("/", authenticate, upload.single("bill"), async (req, res, next) => {
  try {
    const isEmployee = req.user.role === ROLES.EMPLOYEE;

    if (isEmployee) {
      const profileSnap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(req.user.userId).get();
      if (!profileSnap.exists || !profileSnap.data().reimbursementAccess) {
        return res.status(403).json({ error: "Reimbursement access has not been granted to you" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "A bill copy is required" });
      }
    }

    const { voucherDate, paidTo } = req.body;
    const items = typeof req.body.items === "string" ? JSON.parse(req.body.items) : req.body.items;
    if (!voucherDate || !paidTo) return res.status(400).json({ error: "voucherDate and paidTo are required" });
    const itemsError = validateItems(items);
    if (itemsError) return res.status(400).json({ error: itemsError });

    const totalAmount = computeTotal(items);

    const docId = uuid();
    let billFileId = null;
    let billLink = null;
    if (req.file) {
      billFileId = `reimbursement-bills/${docId}-${safeFileName(req.file.originalname)}`;
      await uploadBuffer(billFileId, req.file.buffer, req.file.mimetype);
      billLink = `/api/reimbursements/${docId}/bill`;
    }

    const doc = {
      userId: req.user.userId,
      name: req.user.name,
      voucherDate,
      paidTo,
      items,
      totalAmount,
      amountInWords: numberToWords(totalAmount),
      billFileId,
      billLink,
      status: REIMBURSEMENT_STATUS.PENDING,
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      appliedBy: req.user.userId,
    };
    await db.collection(COLLECTIONS.HR_REIMBURSEMENTS).doc(docId).set(doc);
    res.status(201).json({ id: docId, ...doc });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/bill", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.HR_REIMBURSEMENTS).doc(req.params.id).get();
    if (!snap.exists || !snap.data().billFileId) return res.status(404).json({ error: "Not found" });
    const record = snap.data();
    const isAdmin = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(req.user.role);
    if (!isAdmin && record.userId !== req.user.userId) return res.status(403).json({ error: "Forbidden" });
    await streamFile(res, record.billFileId);
  } catch (err) {
    next(err);
  }
});

router.put("/:id/approve", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_REIMBURSEMENTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== REIMBURSEMENT_STATUS.PENDING) {
      return res.status(400).json({ error: "Only PENDING vouchers can be approved" });
    }
    await ref.update({
      status: REIMBURSEMENT_STATUS.APPROVED,
      decidedBy: req.user.userId,
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      comment: req.body.comment || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/reject", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_REIMBURSEMENTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== REIMBURSEMENT_STATUS.PENDING) {
      return res.status(400).json({ error: "Only PENDING vouchers can be rejected" });
    }
    await ref.update({
      status: REIMBURSEMENT_STATUS.REJECTED,
      decidedBy: req.user.userId,
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      comment: req.body.comment || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/mark-paid", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { paymentRef, paymentDate } = req.body;
    if (!paymentRef || !paymentDate) return res.status(400).json({ error: "paymentRef and paymentDate are required" });

    const ref = db.collection(COLLECTIONS.HR_REIMBURSEMENTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== REIMBURSEMENT_STATUS.APPROVED) {
      return res.status(400).json({ error: "Only APPROVED vouchers can be marked paid" });
    }
    await ref.update({
      status: REIMBURSEMENT_STATUS.PAID,
      paymentRef,
      paymentDate,
      paidBy: req.user.userId,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Admin-only (not exposed to employee self-service, per role matrix).
router.put("/:id/cancel", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_REIMBURSEMENTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (![REIMBURSEMENT_STATUS.PENDING, REIMBURSEMENT_STATUS.APPROVED].includes(snap.data().status)) {
      return res.status(400).json({ error: "Only PENDING or APPROVED vouchers can be cancelled (paid vouchers cannot)" });
    }
    await ref.update({
      status: REIMBURSEMENT_STATUS.CANCELLED,
      cancelledBy: req.user.userId,
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
