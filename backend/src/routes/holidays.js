import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { getHolidaysForYear } from "../lib/calendar.js";

const router = Router();

router.get("/:year", authenticate, async (req, res, next) => {
  try {
    const holidays = await getHolidaysForYear(req.params.year);
    res.json({ year: Number(req.params.year), holidays });
  } catch (err) {
    next(err);
  }
});

// Preview-only: holidays from `sourceYear`, each date shifted to `year`.
// Nothing is saved until the admin edits/confirms and PUTs /:year.
router.get("/:year/copy-from/:sourceYear", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const targetYear = Number(req.params.year);
    const source = await getHolidaysForYear(req.params.sourceYear);
    const shifted = source.map((h) => ({
      date: h.date.replace(/^\d{4}/, String(targetYear)),
      name: h.name,
    }));
    res.json({ year: targetYear, holidays: shifted });
  } catch (err) {
    next(err);
  }
});

// Full replace, not incremental.
router.put("/:year", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const { holidays } = req.body;
    if (!Array.isArray(holidays)) return res.status(400).json({ error: "holidays must be an array" });
    for (const h of holidays) {
      if (!h.date || !/^\d{4}-\d{2}-\d{2}$/.test(h.date) || !h.name) {
        return res.status(400).json({ error: "Each holiday needs a date (YYYY-MM-DD) and a name" });
      }
    }
    await db.collection(COLLECTIONS.HR_HOLIDAYS).doc(String(year)).set({
      year,
      holidays,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
