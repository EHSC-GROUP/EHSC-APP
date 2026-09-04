import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ROLES } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { generateUserId } from "../lib/userId.js";

const router = Router();

const EXTERNAL_HIDDEN_FIELDS = [
  "employeeId",
  "designation",
  "department",
  "fatherOrHusbandName",
  "gender",
  "dateOfJoining",
  "dateOfLeaving",
];

function deriveStatus(profile) {
  return profile.dateOfLeaving ? "RELIEVED" : "ACTIVE";
}

function sanitizeForType(body) {
  const clean = { ...body };
  if (clean.type === "external") {
    for (const f of EXTERNAL_HIDDEN_FIELDS) delete clean[f];
  }
  return clean;
}

router.get("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    const [profilesSnap, usersSnap] = await Promise.all([
      db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).get(),
      db.collection(COLLECTIONS.USERS).get(),
    ]);
    const usersById = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));

    const list = profilesSnap.docs
      .map((d) => {
        const profile = d.data();
        const user = usersById.get(d.id) || {};
        return {
          ...profile,
          userId: d.id,
          name: user.name,
          role: user.role,
          disabled: !!user.disabled,
          status: deriveStatus(profile),
        };
      })
      .filter((p) => includeArchived || !p.disabled);

    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/:userId", authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    const isSelf = req.user.userId === targetId;
    const isAdmin = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(req.user.role);
    if (!isSelf && !isAdmin) return res.status(403).json({ error: "Forbidden" });

    const [profileSnap, userSnap] = await Promise.all([
      db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(targetId).get(),
      db.collection(COLLECTIONS.USERS).doc(targetId).get(),
    ]);
    if (!profileSnap.exists || !userSnap.exists) return res.status(404).json({ error: "Not found" });

    const profile = profileSnap.data();
    const user = userSnap.data();
    res.json({
      ...profile,
      userId: targetId,
      name: user.name,
      role: user.role,
      status: deriveStatus(profile),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const body = sanitizeForType(req.body);
    if (!body.name || !body.type) {
      return res.status(400).json({ error: "name and type are required" });
    }
    if (!["employee", "external"].includes(body.type)) {
      return res.status(400).json({ error: "type must be 'employee' or 'external'" });
    }

    const userId = await generateUserId(body.name);
    const tempPassword = crypto.randomBytes(6).toString("base64url");
    const hash = await bcrypt.hash(tempPassword, 10);

    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.USERS).doc(userId), {
      userId,
      name: body.name,
      role: ROLES.EMPLOYEE,
      password: hash,
      mustReset: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const { name, ...profileFields } = body;
    batch.set(db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(userId), {
      ...profileFields,
      userId,
      reimbursementAccess: !!body.reimbursementAccess,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    });

    await batch.commit();
    res.status(201).json({ userId, tempPassword });
  } catch (err) {
    next(err);
  }
});

router.put("/:userId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    const ref = db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(targetId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });

    const existingType = snap.data().type;
    const body = sanitizeForType({ ...req.body, type: req.body.type || existingType });
    delete body.userId;
    const { name, ...profileFields } = body;

    await ref.update({
      ...profileFields,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    });

    if (name) {
      await db.collection(COLLECTIONS.USERS).doc(targetId).update({ name });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Soft-delete/archive: disables login and keeps all HR/payroll/leave
// history intact for audit and statutory-record purposes. Hidden from the
// default directory listing (?includeArchived=true to see it).
router.delete("/:userId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    if (targetId === req.user.userId) {
      return res.status(400).json({ error: "You cannot archive your own account" });
    }
    const userRef = db.collection(COLLECTIONS.USERS).doc(targetId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ error: "Not found" });
    if (userSnap.data().role === ROLES.SUPERADMIN) {
      return res.status(403).json({ error: "Super admin accounts cannot be archived" });
    }

    await userRef.update({ disabled: true, disabledAt: admin.firestore.FieldValue.serverTimestamp(), disabledBy: req.user.userId });
    res.json({ ok: true, archived: true });
  } catch (err) {
    next(err);
  }
});

router.post("/:userId/restore", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    await db.collection(COLLECTIONS.USERS).doc(targetId).update({ disabled: false });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
