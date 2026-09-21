import { Router } from "express";
import bcrypt from "bcryptjs";

import { db } from "../config/firebase.js";
import { COLLECTIONS, TEMP_PASSWORD } from "../lib/constants.js";
import { signToken } from "../lib/jwt.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { isValidId } from "../lib/validateId.js";

const router = Router();
// userId route params must look like a real ID before they're used to build
// a Firestore document path (see lib/validateId.js). 'ALL' is the one
// special literal (documents.js's company-wide bucket) and passes through
// since it's plain letters.
router.param("userId", (req, res, next, value) => {
  const v = (value || "").toUpperCase();
  if (!isValidId(v)) return res.status(400).json({ error: "userId is invalid" });
  req.params.userId = v;
  next();
});


router.post("/login", async (req, res, next) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) {
      return res.status(400).json({ error: "userId and password are required" });
    }
    const snap = await db.collection(COLLECTIONS.USERS).doc(String(userId).toUpperCase()).get();
    if (!snap.exists) return res.status(401).json({ error: "Invalid credentials" });

    const user = snap.data();
    if (user.disabled) return res.status(403).json({ error: "This account has been archived" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken({ userId: snap.id, name: user.name, role: user.role });
    res.json({
      token,
      user: { userId: snap.id, name: user.name, role: user.role, mustReset: !!user.mustReset },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/change-password", authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "currentPassword and a newPassword of at least 8 characters are required" });
    }
    const ref = db.collection(COLLECTIONS.USERS).doc(req.user.userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });

    if (newPassword === TEMP_PASSWORD) {
      return res.status(400).json({ error: "Choose a different password — the temporary one can't be reused" });
    }

    const match = await bcrypt.compare(currentPassword, snap.data().password);
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });

    const hash = await bcrypt.hash(newPassword, 10);
    await ref.update({ password: hash, mustReset: false });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.USERS).doc(req.user.userId).get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });
    const user = snap.data();
    res.json({ userId: snap.id, name: user.name, role: user.role, mustReset: !!user.mustReset });
  } catch (err) {
    next(err);
  }
});

// Admin-initiated reset: sets the standard temporary password and forces the
// user to change it on next login.
router.post("/admin/reset-password/:userId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.USERS).doc(req.params.userId.toUpperCase());
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });

    const tempPassword = TEMP_PASSWORD;
    const hash = await bcrypt.hash(tempPassword, 10);
    await ref.update({ password: hash, mustReset: true });
    res.json({ tempPassword });
  } catch (err) {
    next(err);
  }
});

export default router;
