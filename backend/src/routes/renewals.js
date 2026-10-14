import { Router } from "express";
import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireSuperAdmin } from "../middleware/auth.js";
import { mailConfigured } from "../lib/mailer.js";
import { RENEWAL_FREQUENCIES, FREQUENCY_LABELS, ensureRenewalDefaults, advanceDueDate, statusOf, daysUntil, runRenewalReminders, alertRecipient } from "../lib/renewals.js";

const router = Router();
const col = () => db.collection(COLLECTIONS.HR_RENEWALS);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d) => typeof d === "string" && ISO.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());

// The Renewals monitor belongs to the superadmin only.
router.use(authenticate, requireSuperAdmin);

function readBody(body, { partial }) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) return { error: "Item name is required" };
    out.name = name.slice(0, 120);
  }
  if (!partial || body.frequency !== undefined) {
    if (!Object.keys(RENEWAL_FREQUENCIES).includes(body.frequency)) return { error: `Frequency must be one of: ${Object.values(FREQUENCY_LABELS).join(", ")}` };
    out.frequency = body.frequency;
  }
  if (!partial || body.nextDueDate !== undefined) {
    if (!validDay(body.nextDueDate)) return { error: "Next due date is required" };
    out.nextDueDate = body.nextDueDate;
  }
  if (body.activatedOn !== undefined) {
    if (body.activatedOn && !validDay(body.activatedOn)) return { error: "Activated date is not a valid date" };
    out.activatedOn = body.activatedOn || null;
  }
  if (body.remindDaysBefore !== undefined) {
    const n = Number(body.remindDaysBefore);
    if (!Number.isInteger(n) || n < 0 || n > 90) return { error: "Remind days must be a whole number from 0 to 90" };
    out.remindDaysBefore = n;
  }
  if (body.notes !== undefined) out.notes = String(body.notes || "").slice(0, 500);
  if (body.active !== undefined) out.active = !!body.active;
  return { out };
}

const view = (d) => ({ id: d.id, ...d.data(), status: statusOf(d.data()), daysLeft: daysUntil(d.data().nextDueDate) });

router.get("/", async (req, res, next) => {
  try {
    await ensureRenewalDefaults();
    const snap = await col().get();
    const items = snap.docs.map(view).sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
    res.json({ items, emailConfigured: mailConfigured(), recipient: alertRecipient(), frequencies: FREQUENCY_LABELS });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const { out, error } = readBody(req.body, { partial: false });
    if (error) return res.status(400).json({ error });
    const ref = col().doc();
    await ref.set({ remindDaysBefore: 7, active: true, notes: "", activatedOn: null, ...out, createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: req.user.userId });
    res.status(201).json({ id: ref.id });
  } catch (err) { next(err); }
});

// What needs attention right now: due tomorrow, due today, or overdue.
// Feeds the alerts sections (Renewals page and the superadmin Home).
router.get("/alerts", async (req, res, next) => {
  try {
    const snap = await col().get();
    const items = snap.docs.map(view).filter((i) => i.active !== false && i.status !== "OK").sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
    res.json({ items, frequencies: FREQUENCY_LABELS });
  } catch (err) { next(err); }
});

// "Send reminders now": same as the daily run, but for everything that is
// currently due or overdue, even if it was already reminded. Registered before
// "/:id" routes so it is not swallowed by them.
router.post("/run-reminders", async (req, res, next) => {
  try {
    res.json(await runRenewalReminders({ force: true }));
  } catch (err) { next(err); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { out, error } = readBody(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    const ref = col().doc(req.params.id);
    if (!(await ref.get()).exists) return res.status(404).json({ error: "Not found" });
    // Changing the date or frequency starts the reminders afresh.
    const reset = out.nextDueDate !== undefined || out.frequency !== undefined ? { lastReminder: null } : {};
    await ref.update({ ...out, ...reset, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Paid / renewed: moves the due date forward by one period.
router.post("/:id/renewed", async (req, res, next) => {
  try {
    const ref = col().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    const nextDueDate = advanceDueDate(snap.data());
    await ref.update({ nextDueDate, lastRenewedOn: new Date().toISOString().slice(0, 10), lastReminder: null, updatedBy: req.user.userId });
    res.json({ ok: true, nextDueDate });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await col().doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
