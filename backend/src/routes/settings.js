import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { getWeeklyOffDays } from "../lib/calendar.js";
import { getEarningsFormula, validateFormula, pickFormulaFields } from "../lib/earningsFormula.js";
import { getFeatureFlags, FLAGS_DOC } from "../lib/featureFlags.js";
import { FEATURE_FLAG_DEFAULTS } from "../lib/constants.js";

const router = Router();

// Readable by any authenticated user (the reimbursement form needs to know
// whether to show the project picker), writable by admins only.
router.get("/feature-flags", authenticate, async (req, res, next) => {
  try {
    res.json(await getFeatureFlags());
  } catch (err) {
    next(err);
  }
});

router.put("/feature-flags", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const updates = {};
    for (const key of Object.keys(FEATURE_FLAG_DEFAULTS)) {
      if (req.body[key] !== undefined) updates[key] = !!req.body[key];
    }
    await FLAGS_DOC().set(
      { ...updates, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId },
      { merge: true }
    );
    res.json(await getFeatureFlags());
  } catch (err) {
    next(err);
  }
});

router.get("/weekly-off", authenticate, async (req, res, next) => {
  try {
    res.json({ days: await getWeeklyOffDays() });
  } catch (err) {
    next(err);
  }
});

router.put("/weekly-off", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { days } = req.body;
    if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return res.status(400).json({ error: "days must be an array of integers 0-6" });
    }
    await db.collection(COLLECTIONS.HR_SETTINGS).doc("weekly_off").set({
      days,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/earnings-formula", authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await getEarningsFormula());
  } catch (err) {
    next(err);
  }
});

router.put("/earnings-formula", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const formula = pickFormulaFields(req.body);
    const error = validateFormula(formula);
    if (error) return res.status(400).json({ error });

    await db.collection(COLLECTIONS.HR_SETTINGS).doc("earnings_formula").set({
      ...formula,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
