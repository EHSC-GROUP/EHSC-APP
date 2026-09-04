import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, LOP, HALF_DAY } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

const RESERVED_IDS = new Set([LOP, HALF_DAY]);

function slugify(name) {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

router.get("/", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.HR_LEAVE_TYPES).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, paidDaysPerYear, carryForward, monthlyCap, id } = req.body;
    if (!name || paidDaysPerYear === undefined) {
      return res.status(400).json({ error: "name and paidDaysPerYear are required" });
    }
    const leaveTypeId = id ? slugify(id) : slugify(name);
    if (!leaveTypeId) return res.status(400).json({ error: "Could not derive a valid id from name" });
    if (RESERVED_IDS.has(leaveTypeId)) {
      return res.status(400).json({ error: `${leaveTypeId} is a reserved, administrative-only leave type` });
    }

    const ref = db.collection(COLLECTIONS.HR_LEAVE_TYPES).doc(leaveTypeId);
    const existing = await ref.get();
    if (existing.exists) return res.status(400).json({ error: `Leave type ${leaveTypeId} already exists` });

    const doc = {
      name,
      paidDaysPerYear: Number(paidDaysPerYear),
      carryForward: !!carryForward,
      monthlyCap: monthlyCap === null || monthlyCap === undefined || monthlyCap === "" ? null : Number(monthlyCap),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    };
    await ref.set(doc);
    res.status(201).json({ id: leaveTypeId, ...doc });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (RESERVED_IDS.has(req.params.id)) {
      return res.status(400).json({ error: "Reserved leave types cannot be edited" });
    }
    const ref = db.collection(COLLECTIONS.HR_LEAVE_TYPES).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });

    const { name, paidDaysPerYear, carryForward, monthlyCap } = req.body;
    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId };
    if (name !== undefined) updates.name = name;
    if (paidDaysPerYear !== undefined) updates.paidDaysPerYear = Number(paidDaysPerYear);
    if (carryForward !== undefined) updates.carryForward = !!carryForward;
    if (monthlyCap !== undefined) updates.monthlyCap = monthlyCap === null || monthlyCap === "" ? null : Number(monthlyCap);

    await ref.update(updates);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (RESERVED_IDS.has(req.params.id)) {
      return res.status(400).json({ error: "Reserved leave types cannot be deleted" });
    }
    await db.collection(COLLECTIONS.HR_LEAVE_TYPES).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
