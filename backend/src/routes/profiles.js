import { Router } from "express";
import bcrypt from "bcryptjs";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ROLES, PROFILE_TYPE, STAFF_PROFILE_TYPES, DEPARTMENTS, TEMP_PASSWORD } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { generateAssociateId } from "../lib/userId.js";
import { getAssignedWork } from "../lib/assignedWork.js";
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


const ASSOCIATE_HIDDEN_FIELDS = [
  "employeeId",
  "designation",
  "department",
  "fatherOrHusbandName",
  "gender",
  "dateOfJoining",
  "dateOfLeaving",
  "firstName",
  "lastName",
  "professionalEmail",
  "personalEmail",
];

function deriveStatus(profile) {
  return profile.dateOfLeaving ? "RELIEVED" : "ACTIVE";
}

function sanitizeForType(body) {
  const clean = { ...body };
  if (clean.type === PROFILE_TYPE.ASSOCIATE) {
    for (const f of ASSOCIATE_HIDDEN_FIELDS) delete clean[f];
  }
  return clean;
}

const isStaffType = (type) => STAFF_PROFILE_TYPES.includes(type);

// Staff (employee/admin) profiles are people: first + last name are
// required and `name` (used across logins, payslips, exports) is derived.
function applyStaffNameRules(body, { partial }) {
  const first = (body.firstName || "").trim();
  const last = (body.lastName || "").trim();
  if (!partial && (!first || !last)) return "firstName and lastName are required";
  if (first || last) body.name = `${first} ${last}`.trim();
  if (body.firstName !== undefined) body.firstName = first;
  if (body.lastName !== undefined) body.lastName = last;
  return null;
}

function validateStaffFields(body, { partial }) {
  if (body.department !== undefined || !partial) {
    if (!DEPARTMENTS.includes(body.department)) return `department must be one of: ${DEPARTMENTS.join(", ")}`;
  }
  if (!partial) {
    if (!body.professionalEmail || !body.personalEmail) return "professionalEmail and personalEmail are required";
  }
  return null;
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

router.get("/:userId/assigned-work", authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    const isSelf = req.user.userId === targetId;
    const isAdmin = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(req.user.role);
    if (!isSelf && !isAdmin) return res.status(403).json({ error: "Forbidden" });

    const items = await getAssignedWork(targetId);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const body = sanitizeForType(req.body);
    if (!body.type) return res.status(400).json({ error: "type is required" });
    if (!Object.values(PROFILE_TYPE).includes(body.type)) {
      return res.status(400).json({ error: `type must be one of: ${Object.values(PROFILE_TYPE).join(", ")}` });
    }
    if (isStaffType(body.type)) {
      const nameError = applyStaffNameRules(body, { partial: false }) || validateStaffFields(body, { partial: false });
      if (nameError) return res.status(400).json({ error: nameError });
    } else if (!body.name) {
      return res.status(400).json({ error: "name is required" });
    }

    // Staff (employee/admin) logins are keyed by the Employee ID HR assigns
    // (not a randomly generated one) — it's required up front and becomes
    // the userId outright, so login ID and employee ID can never diverge.
    // Associates have no Employee ID; they get the next EHSC-EXT### code.
    let userId;
    if (isStaffType(body.type)) {
      const employeeId = (body.employeeId || "").trim().toUpperCase();
      if (!employeeId) return res.status(400).json({ error: "employeeId is required for employee and admin profiles" });
      if (!/^[A-Z0-9_-]+$/.test(employeeId)) {
        return res.status(400).json({ error: "employeeId may only contain letters, numbers, hyphens and underscores" });
      }
      const existing = await db.collection(COLLECTIONS.USERS).doc(employeeId).get();
      if (existing.exists) return res.status(400).json({ error: `Employee ID ${employeeId} is already in use` });
      userId = employeeId;
    } else {
      userId = await generateAssociateId();
    }
    const tempPassword = TEMP_PASSWORD;
    const hash = await bcrypt.hash(tempPassword, 10);

    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.USERS).doc(userId), {
      userId,
      name: body.name,
      role: body.type === PROFILE_TYPE.ADMIN ? ROLES.ADMIN : ROLES.EMPLOYEE,
      password: hash,
      mustReset: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const { name, ...profileFields } = body;
    batch.set(db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(userId), {
      ...profileFields,
      userId,
      ...(isStaffType(body.type) ? { employeeId: userId } : {}),
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
    const resolvedType = req.body.type || existingType;
    const body = sanitizeForType({ ...req.body, type: resolvedType });
    delete body.userId;
    if (isStaffType(resolvedType)) {
      // Editing only touches name if a first/last name was actually sent.
      const partialErr = applyStaffNameRules(body, { partial: true }) || validateStaffFields(body, { partial: true });
      if (partialErr) return res.status(400).json({ error: partialErr });
    }
    const { name, ...profileFields } = body;

    // Employee ID always mirrors the login userId — never independently
    // editable, so the two can't drift apart across exports (Leave Card,
    // payslips, Form 22) that key off one or the other. Associates never
    // get one (see ASSOCIATE_HIDDEN_FIELDS).
    await ref.update({
      ...profileFields,
      ...(isStaffType(resolvedType) ? { employeeId: targetId } : {}),
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
