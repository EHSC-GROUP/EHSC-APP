import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ROLES, MATERIAL_INDENT_STATUS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { round2 } from "../lib/dateUtils.js";
import { renderMaterialIndentPdf } from "../lib/materialIndentPdf.js";
import { buildMaterialIndentRegisterWorkbook } from "../lib/materialIndentExcel.js";

const router = Router();

function isAdminRole(role) {
  return [ROLES.ADMIN, ROLES.SUPERADMIN].includes(role);
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "At least one item is required";
  for (const item of items) {
    if (!item.itemMaterial || !(Number(item.qty) > 0) || !(Number(item.rate) >= 0)) {
      return "Each item needs a name, a quantity > 0 and a rate >= 0";
    }
  }
  return null;
}

function withAmounts(items) {
  return items.map((i) => ({
    requiredDate: i.requiredDate || null,
    itemMaterial: i.itemMaterial,
    qty: Number(i.qty),
    rate: Number(i.rate),
    amount: round2(Number(i.qty) * Number(i.rate)),
  }));
}

function computeTotal(items) {
  return round2(items.reduce((s, i) => s + i.amount, 0));
}

router.get("/admin", authenticate, requireAdmin, async (req, res, next) => {
  try {
    let query = db.collection(COLLECTIONS.MATERIAL_INDENTS);
    if (req.query.status) query = query.where("status", "==", req.query.status);
    if (req.query.userId) query = query.where("userId", "==", req.query.userId.toUpperCase());
    const snap = await query.get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.raisedDate < b.raisedDate ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/mine", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.MATERIAL_INDENTS).where("userId", "==", req.user.userId).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.raisedDate < b.raisedDate ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

async function queryList(query) {
  const snap = await query.get();
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.raisedDate < b.raisedDate ? 1 : -1));
  return list;
}

function buildAdminQuery(reqQuery) {
  let query = db.collection(COLLECTIONS.MATERIAL_INDENTS);
  if (reqQuery.status) query = query.where("status", "==", reqQuery.status);
  if (reqQuery.userId) query = query.where("userId", "==", reqQuery.userId.toUpperCase());
  return query;
}

// Bulk exports — ahead of "/:id/pdf" so "/export/pdf" and "/export/excel"
// aren't swallowed by the ":id" param.
router.get("/export/pdf", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const list = await queryList(buildAdminQuery(req.query));
    if (list.length === 0) return res.status(404).json({ error: "No material indents match this filter" });
    const pdfBuffer = await renderMaterialIndentPdf(list);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Material_Indents_${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

router.get("/export/excel", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const list = await queryList(buildAdminQuery(req.query));
    const workbook = await buildMaterialIndentRegisterWorkbook(list);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Material_Indent_Register_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, async (req, res, next) => {
  try {
    const { raisedDate, purpose } = req.body;
    if (!raisedDate || !purpose) return res.status(400).json({ error: "raisedDate and purpose are required" });
    const itemsError = validateItems(req.body.items);
    if (itemsError) return res.status(400).json({ error: itemsError });

    const items = withAmounts(req.body.items);
    const totalAmount = computeTotal(items);
    const docId = uuid();
    const doc = {
      userId: req.user.userId,
      name: req.user.name,
      raisedDate,
      purpose,
      items,
      totalAmount,
      preparedBy: req.user.name,
      verifiedApprovedBy: null,
      status: MATERIAL_INDENT_STATUS.PENDING,
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      appliedBy: req.user.userId,
    };
    await db.collection(COLLECTIONS.MATERIAL_INDENTS).doc(docId).set(doc);
    res.status(201).json({ id: docId, ...doc });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/pdf", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.MATERIAL_INDENTS).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    const record = { id: snap.id, ...snap.data() };
    if (!isAdminRole(req.user.role) && record.userId !== req.user.userId) return res.status(403).json({ error: "Forbidden" });
    const pdfBuffer = await renderMaterialIndentPdf([record]);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Material_Indent_${record.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

router.put("/:id/approve", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.MATERIAL_INDENTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== MATERIAL_INDENT_STATUS.PENDING) {
      return res.status(400).json({ error: "Only PENDING indents can be approved" });
    }
    await ref.update({
      status: MATERIAL_INDENT_STATUS.APPROVED,
      verifiedApprovedBy: req.user.name,
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
    const ref = db.collection(COLLECTIONS.MATERIAL_INDENTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== MATERIAL_INDENT_STATUS.PENDING) {
      return res.status(400).json({ error: "Only PENDING indents can be rejected" });
    }
    await ref.update({
      status: MATERIAL_INDENT_STATUS.REJECTED,
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
    const ref = db.collection(COLLECTIONS.MATERIAL_INDENTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    const record = snap.data();
    const isSelf = record.userId === req.user.userId;
    if (!isSelf && !isAdminRole(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    if (record.status !== MATERIAL_INDENT_STATUS.PENDING) {
      return res.status(400).json({ error: "Only PENDING indents can be cancelled" });
    }
    await ref.update({
      status: MATERIAL_INDENT_STATUS.CANCELLED,
      cancelledBy: req.user.userId,
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
