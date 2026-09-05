import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, BD_RESULT, APPROACH_MODE } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

// Sequential, human-readable enquiry numbers (ENQ-0001, ENQ-0002, ...),
// generated in a transaction against a single counter doc so concurrent
// creates never collide.
async function nextEnquiryNo() {
  const ref = db.collection(COLLECTIONS.HR_SETTINGS).doc("bd_counter");
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const seq = (snap.exists ? snap.data().seq : 0) + 1;
    tx.set(ref, { seq }, { merge: true });
    return `ENQ-${String(seq).padStart(4, "0")}`;
  });
}

function validateApproachMode(mode) {
  return Object.values(APPROACH_MODE).includes(mode);
}

router.get("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    let query = db.collection(COLLECTIONS.BD_ENQUIRIES);
    if (req.query.result) query = query.where("result", "==", req.query.result);
    const snap = await query.get();
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (req.query.assignedTo) {
      const target = req.query.assignedTo.toUpperCase();
      list = list.filter((e) => (e.actions || []).some((a) => a.assignedTo === target));
    }
    list.sort((a, b) => (a.enquiryNo < b.enquiryNo ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    res.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const {
      clientName, address, marketingSource, approachedByName, approachDate, approachMode,
      contactPhone, contactEmail, topic, outcomeOfDiscussion, estimatedValue, remarks,
    } = req.body;

    if (!clientName || !approachedByName || !approachDate || !approachMode) {
      return res.status(400).json({ error: "clientName, approachedByName, approachDate and approachMode are required" });
    }
    if (!validateApproachMode(approachMode)) {
      return res.status(400).json({ error: `approachMode must be one of ${Object.values(APPROACH_MODE).join(", ")}` });
    }

    const enquiryNo = await nextEnquiryNo();
    const id = uuid();
    const doc = {
      enquiryNo,
      clientName,
      address: address || "",
      marketingSource: marketingSource || "",
      approachedByName,
      approachDate,
      approachMode,
      contactPhone: contactPhone || "",
      contactEmail: contactEmail || "",
      topic: topic || "",
      outcomeOfDiscussion: outcomeOfDiscussion || "",
      estimatedValue: estimatedValue !== undefined && estimatedValue !== "" ? Number(estimatedValue) : null,
      actions: [],
      result: BD_RESULT.IN_PROGRESS,
      remarks: remarks || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    };
    await db.collection(COLLECTIONS.BD_ENQUIRIES).doc(id).set(doc);
    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });

    const {
      clientName, address, marketingSource, approachedByName, approachDate, approachMode,
      contactPhone, contactEmail, topic, outcomeOfDiscussion, estimatedValue, result, remarks,
    } = req.body;

    if (approachMode !== undefined && !validateApproachMode(approachMode)) {
      return res.status(400).json({ error: `approachMode must be one of ${Object.values(APPROACH_MODE).join(", ")}` });
    }
    if (result !== undefined && !Object.values(BD_RESULT).includes(result)) {
      return res.status(400).json({ error: `result must be one of ${Object.values(BD_RESULT).join(", ")}` });
    }

    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId };
    if (clientName !== undefined) updates.clientName = clientName;
    if (address !== undefined) updates.address = address;
    if (marketingSource !== undefined) updates.marketingSource = marketingSource;
    if (approachedByName !== undefined) updates.approachedByName = approachedByName;
    if (approachDate !== undefined) updates.approachDate = approachDate;
    if (approachMode !== undefined) updates.approachMode = approachMode;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (contactEmail !== undefined) updates.contactEmail = contactEmail;
    if (topic !== undefined) updates.topic = topic;
    if (outcomeOfDiscussion !== undefined) updates.outcomeOfDiscussion = outcomeOfDiscussion;
    if (estimatedValue !== undefined) updates.estimatedValue = estimatedValue === "" ? null : Number(estimatedValue);
    if (result !== undefined) updates.result = result;
    if (remarks !== undefined) updates.remarks = remarks;

    await ref.update(updates);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    await db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- action log: the running history of follow-ups on one enquiry -------
router.post("/:id/actions", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { description, assignedTo, assignedToName, dueDate, startDate } = req.body;
    if (!description || !assignedTo || !dueDate) {
      return res.status(400).json({ error: "description, assignedTo and dueDate are required" });
    }

    const ref = db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id);
    const action = {
      id: uuid(),
      description,
      assignedTo: assignedTo.toUpperCase(),
      assignedToName: assignedToName || assignedTo,
      dueDate,
      startDate: startDate || null,
      completed: false,
      completedAt: null,
      addedAt: new Date().toISOString(),
      addedBy: req.user.userId,
    };

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const actions = snap.data().actions || [];
      tx.update(ref, {
        actions: [...actions, action],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.user.userId,
      });
    });

    res.status(201).json(action);
  } catch (err) {
    next(err);
  }
});

router.put("/:id/actions/:actionId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id);
    const { description, assignedTo, assignedToName, dueDate, startDate, completed } = req.body;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const actions = snap.data().actions || [];
      const idx = actions.findIndex((a) => a.id === req.params.actionId);
      if (idx === -1) throw Object.assign(new Error("Action not found"), { status: 404 });

      const existing = actions[idx];
      const updated = { ...existing };
      if (description !== undefined) updated.description = description;
      if (assignedTo !== undefined) updated.assignedTo = assignedTo.toUpperCase();
      if (assignedToName !== undefined) updated.assignedToName = assignedToName;
      if (dueDate !== undefined) updated.dueDate = dueDate;
      if (startDate !== undefined) updated.startDate = startDate;
      if (completed !== undefined) {
        updated.completed = !!completed;
        updated.completedAt = completed ? new Date().toISOString() : null;
      }
      actions[idx] = updated;

      tx.update(ref, { actions, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/actions/:actionId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const actions = (snap.data().actions || []).filter((a) => a.id !== req.params.actionId);
      tx.update(ref, { actions, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
