import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireAdmin, requireSuperAdmin } from "../middleware/auth.js";
import { getWeeklyOffDays, getRecurringWeekdayRules } from "../lib/calendar.js";
import { getEarningsFormula, validateFormula, pickFormulaFields } from "../lib/earningsFormula.js";
import { getFeatureFlags, FLAGS_DOC } from "../lib/featureFlags.js";
import { FEATURE_FLAG_DEFAULTS } from "../lib/constants.js";
import { PROJECT_CATEGORIES, ALL_PROJECT_TYPES, REGION_OPTIONS, PROJECT_TYPE_VALUES as PROJECT_TYPES } from "../lib/projectClassification.js";
import { getProjectPlanTemplates, templatesRef } from "../lib/projectPlanTemplate.js";

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

router.put("/feature-flags", authenticate, requireSuperAdmin, async (req, res, next) => {
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

router.put("/weekly-off", authenticate, requireSuperAdmin, async (req, res, next) => {
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

router.put("/weekday-rules", authenticate, requireSuperAdmin, async (req, res, next) => {
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

router.get("/earnings-formula", authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    res.json(await getEarningsFormula());
  } catch (err) {
    next(err);
  }
});

router.put("/earnings-formula", authenticate, requireSuperAdmin, async (req, res, next) => {
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

// Per-project-type Project Plan starter tasks — applied automatically to a
// project's (empty) Project Plan the moment its enquiry's contract gets
// accepted (see routes/projects.js PUT /:id). Readable by any authenticated
// user (same reasoning as feature-flags: a non-admin assignee viewing a
// Project Plan doesn't need admin rights just to see what generated it).
// The Project Category -> Service -> Project Type tree and the region list,
// for the enquiry / new project forms and the template pickers.
router.get("/project-classification", authenticate, (req, res) => {
  res.json({ categories: PROJECT_CATEGORIES, allTypes: ALL_PROJECT_TYPES, regions: REGION_OPTIONS });
});

router.get("/project-plan-templates", authenticate, async (req, res, next) => {
  try {
    res.json(await getProjectPlanTemplates());
  } catch (err) {
    next(err);
  }
});

router.put("/project-plan-templates", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const updates = {};
    for (const type of PROJECT_TYPES) {
      const tasks = req.body[type];
      if (tasks === undefined) continue;
      if (!Array.isArray(tasks)) return res.status(400).json({ error: `${type} must be an array of tasks` });
      for (const t of tasks) {
        if (!t.description || typeof t.description !== "string") {
          return res.status(400).json({ error: `${type}: every task needs a description` });
        }
        if (!Number.isFinite(Number(t.dayOffset)) || Number(t.dayOffset) < 0) {
          return res.status(400).json({ error: `${type}: dayOffset must be a number >= 0` });
        }
        if (t.stage !== undefined && t.stage !== null && t.stage !== "" && ![1, 2, 3, 4].includes(Number(t.stage))) {
          return res.status(400).json({ error: `${type}: stage must be 1, 2, 3, 4 or left blank` });
        }
      }
      updates[type] = tasks.map((t) => ({
        description: t.description,
        dayOffset: Number(t.dayOffset),
        stage: t.stage !== undefined && t.stage !== null && t.stage !== "" ? Number(t.stage) : null,
      }));
    }
    await templatesRef().set(
      { ...updates, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId },
      { merge: true }
    );
    res.json(await getProjectPlanTemplates());
  } catch (err) {
    next(err);
  }
});

export default router;
