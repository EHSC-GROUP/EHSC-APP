import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import { db } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { signToken } from "../lib/jwt.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

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

// Admin-initiated reset: generates a temporary password, forces the user
// to change it on next login. Returned once — not stored in plaintext.
router.post("/admin/reset-password/:userId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.USERS).doc(req.params.userId.toUpperCase());
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });

    const tempPassword = crypto.randomBytes(6).toString("base64url");
    const hash = await bcrypt.hash(tempPassword, 10);
    await ref.update({ password: hash, mustReset: true });
    res.json({ tempPassword });
  } catch (err) {
    next(err);
  }
});

export default router;
