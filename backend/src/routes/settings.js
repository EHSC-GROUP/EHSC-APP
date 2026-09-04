import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { getWeeklyOffDays } from "../lib/calendar.js";
import { getEarningsFormula, validateFormula } from "../lib/earningsFormula.js";

const router = Router();

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
    const { basicPercent, hraPercent } = req.body;
    const error = validateFormula(basicPercent, hraPercent);
    if (error) return res.status(400).json({ error });

    await db.collection(COLLECTIONS.HR_SETTINGS).doc("earnings_formula").set({
      basicPercent: Number(basicPercent),
      hraPercent: Number(hraPercent),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
