import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { getWeeklyOffDays, getRecurringWeekdayRules } from "../lib/calendar.js";
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

// Predefined "Nth weekday of every month" rules — e.g. "every 3rd Saturday
// is a holiday" (type HOLIDAY, folded into the regular holiday set) or
// "every 1st Saturday is WFH" (type WFH, counted as present automatically
// in payslip generation only). See lib/calendar.js for how these resolve.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NTH_WORDS = ["1st", "2nd", "3rd", "4th", "5th"];

router.get("/weekday-rules", authenticate, async (req, res, next) => {
  try {
    res.json({ rules: await getRecurringWeekdayRules() });
  } catch (err) {
    next(err);
  }
});

router.put("/weekday-rules", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rules } = req.body;
    if (!Array.isArray(rules)) return res.status(400).json({ error: "rules must be an array" });
    for (const r of rules) {
      if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) {
        return res.status(400).json({ error: "weekday must be an integer 0-6 (0 = Sunday)" });
      }
      if (!Number.isInteger(r.nth) || r.nth < 1 || r.nth > 5) {
        return res.status(400).json({ error: "nth must be an integer 1-5" });
      }
      if (!["HOLIDAY", "WFH"].includes(r.type)) {
        return res.status(400).json({ error: "type must be HOLIDAY or WFH" });
      }
    }
    const normalized = rules.map((r) => ({
      weekday: r.weekday,
      nth: r.nth,
      type: r.type,
      name: r.name || `${NTH_WORDS[r.nth - 1]} ${WEEKDAYS[r.weekday]}`,
    }));
    await db.collection(COLLECTIONS.HR_SETTINGS).doc("recurring_weekday_rules").set({
      rules: normalized,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    });
    res.json({ ok: true, rules: normalized });
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
