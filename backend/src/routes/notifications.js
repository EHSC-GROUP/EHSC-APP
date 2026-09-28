import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// Self-service only — every route here is scoped to req.user.userId, never
// admin-gated, since a notification is meaningless to anyone but its owner.
router.get("/", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.NOTIFICATIONS).where("userId", "==", req.user.userId).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    res.json(list.slice(0, 50));
  } catch (err) {
    next(err);
  }
});

router.get("/unread-count", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.NOTIFICATIONS)
      .where("userId", "==", req.user.userId)
      .where("read", "==", false)
      .get();
    res.json({ count: snap.size });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/read", authenticate, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.NOTIFICATIONS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().userId !== req.user.userId) return res.status(403).json({ error: "Forbidden" });
    await ref.update({ read: true });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put("/read-all", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.NOTIFICATIONS)
      .where("userId", "==", req.user.userId)
      .where("read", "==", false)
      .get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
    await batch.commit();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
