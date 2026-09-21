import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { getRecurringHolidays, getHolidaysForYear } from "../lib/calendar.js";

const router = Router();

// The single recurring holiday list (month/day/name) — applies every year.
router.get("/", authenticate, async (req, res, next) => {
  try {
    const holidays = await getRecurringHolidays();
    holidays.sort((a, b) => a.month - b.month || a.day - b.day);
    res.json({ holidays });
  } catch (err) {
    next(err);
  }
});

// Full replace of the recurring list: add, edit a date, or delete a holiday
// and the change carries into every year.
router.put("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { holidays } = req.body;
    if (!Array.isArray(holidays)) return res.status(400).json({ error: "holidays must be an array" });

    const clean = [];
    for (const h of holidays) {
      const month = Number(h.month);
      const day = Number(h.day);
      const name = String(h.name || "").trim();
      // 2000 is a leap year, so Feb 29 is accepted.
      const probe = new Date(Date.UTC(2000, month - 1, day));
      const validDate = Number.isInteger(month) && Number.isInteger(day) && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
      if (!validDate || !name) {
        return res.status(400).json({ error: "Each holiday needs a valid month, day and a name" });
      }
      clean.push({ month, day, name });
    }
    clean.sort((a, b) => a.month - b.month || a.day - b.day);

    await db.collection(COLLECTIONS.HR_SETTINGS).doc("recurring_holidays").set({
      holidays: clean,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    });
    res.json({ ok: true, holidays: clean });
  } catch (err) {
    next(err);
  }
});

// The list resolved to real dates for one year (read-only convenience).
router.get("/:year", authenticate, async (req, res, next) => {
  try {
    res.json({ year: Number(req.params.year), holidays: await getHolidaysForYear(req.params.year) });
  } catch (err) {
    next(err);
  }
});

export default router;
