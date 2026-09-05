import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

router.get("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    let query = db.collection(COLLECTIONS.COMPANY_PROFILES);
    if (req.query.sourceEnquiryId) query = query.where("sourceEnquiryId", "==", req.query.sourceEnquiryId);
    const snap = await query.get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.clientName || "").localeCompare(b.clientName || ""));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.COMPANY_PROFILES).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    res.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const {
      clientName, address, contactPersonName, contactPhone,
      poNumber, poValue, deliveryDueDate, termsAndConditions,
      sourceEnquiryId, sourceEnquiryNo,
    } = req.body;

    if (!clientName || !poNumber) {
      return res.status(400).json({ error: "clientName and poNumber are required" });
    }

    const id = uuid();
    const doc = {
      clientName,
      address: address || "",
      contactPersonName: contactPersonName || "",
      contactPhone: contactPhone || "",
      poNumber,
      poValue: poValue !== undefined && poValue !== "" ? Number(poValue) : null,
      deliveryDueDate: deliveryDueDate || null,
      termsAndConditions: termsAndConditions || "",
      sourceEnquiryId: sourceEnquiryId || null,
      sourceEnquiryNo: sourceEnquiryNo || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    };
    await db.collection(COLLECTIONS.COMPANY_PROFILES).doc(id).set(doc);
    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.COMPANY_PROFILES).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });

    const {
      clientName, address, contactPersonName, contactPhone,
      poNumber, poValue, deliveryDueDate, termsAndConditions,
    } = req.body;

    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId };
    if (clientName !== undefined) updates.clientName = clientName;
    if (address !== undefined) updates.address = address;
    if (contactPersonName !== undefined) updates.contactPersonName = contactPersonName;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (poNumber !== undefined) updates.poNumber = poNumber;
    if (poValue !== undefined) updates.poValue = poValue === "" ? null : Number(poValue);
    if (deliveryDueDate !== undefined) updates.deliveryDueDate = deliveryDueDate || null;
    if (termsAndConditions !== undefined) updates.termsAndConditions = termsAndConditions;

    await ref.update(updates);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    await db.collection(COLLECTIONS.COMPANY_PROFILES).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
