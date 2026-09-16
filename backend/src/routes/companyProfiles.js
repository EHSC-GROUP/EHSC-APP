import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

// A "company" here is the parent business entity (e.g. "Meridian
// Industries") — parentNumber is a 3-digit sequence starting at 150
// (150, 151, 152, ...), assigned once per genuinely new company. Every
// physical location is a branch nested in `branches`, each with its own
// 2-digit branchNumber (01, 02, ...) scoped to that parent, combining into
// a 5-digit companyCode (parentNumber + branchNumber, e.g. "15001",
// "15002" for a second branch of the same company, "15101" for the next
// company's first branch). `projectSeq` is a single counter shared by every
// branch of this company — project numbering doesn't reset per branch (see
// routes/businessDevelopment.js and routes/projects.js).
export function emptyBranch({ branchNumber, companyCode, address, contactPersonName, contactPhone }) {
  return {
    id: uuid(),
    branchNumber,
    companyCode,
    address: address || "",
    contactPersonName: contactPersonName || "",
    contactPhone: contactPhone || "",
    createdAt: new Date().toISOString(),
  };
}

router.get("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.COMPANY_PROFILES).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.clientName || "").localeCompare(b.clientName || ""));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.COMPANY_PROFILES).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    res.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    next(err);
  }
});

// Standalone creation — for a client with no Business Development history.
// Enquiry-linked companies are normally created automatically alongside
// their first enquiry (see routes/businessDevelopment.js). Always creates
// the company's first branch (01) at the same time — a company never
// exists with zero branches.
router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { clientName, address, contactPersonName, contactPhone } = req.body;
    if (!clientName) return res.status(400).json({ error: "clientName is required" });

    const { parentNumber } = await db.runTransaction(async (tx) => {
      const ref = db.collection(COLLECTIONS.HR_SETTINGS).doc("company_counter");
      const snap = await tx.get(ref);
      const num = (snap.exists ? snap.data().seq : 149) + 1;
      tx.set(ref, { seq: num }, { merge: true });
      return { parentNumber: num };
    });

    const branchNumber = "01";
    const companyCode = `${parentNumber}${branchNumber}`;
    const id = uuid();
    const doc = {
      parentNumber,
      clientName,
      branchSeq: 1,
      projectSeq: 0,
      branches: [emptyBranch({ branchNumber, companyCode, address, contactPersonName, contactPhone })],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    };
    await db.collection(COLLECTIONS.COMPANY_PROFILES).doc(id).set(doc);
    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.COMPANY_PROFILES).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });

    const { clientName } = req.body;
    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId };
    if (clientName !== undefined) updates.clientName = clientName;

    await ref.update(updates);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    await db.collection(COLLECTIONS.COMPANY_PROFILES).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Branches — physical locations under one parent company -------------
router.post("/:id/branches", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { address, contactPersonName, contactPhone } = req.body;
    const ref = db.collection(COLLECTIONS.COMPANY_PROFILES).doc(req.params.id);

    const branch = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const company = snap.data();
      const branchSeq = (company.branchSeq || 0) + 1;
      const branchNumber = String(branchSeq).padStart(2, "0");
      const companyCode = `${company.parentNumber}${branchNumber}`;
      const newBranch = emptyBranch({ branchNumber, companyCode, address, contactPersonName, contactPhone });
      tx.update(ref, {
        branchSeq,
        branches: [...(company.branches || []), newBranch],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.user.userId,
      });
      return newBranch;
    });

    res.status(201).json(branch);
  } catch (err) {
    next(err);
  }
});

router.put("/:id/branches/:branchId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { address, contactPersonName, contactPhone } = req.body;
    const ref = db.collection(COLLECTIONS.COMPANY_PROFILES).doc(req.params.id);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const company = snap.data();
      const branches = company.branches || [];
      const idx = branches.findIndex((b) => b.id === req.params.branchId);
      if (idx === -1) throw Object.assign(new Error("Branch not found"), { status: 404 });

      const updated = { ...branches[idx] };
      if (address !== undefined) updated.address = address;
      if (contactPersonName !== undefined) updated.contactPersonName = contactPersonName;
      if (contactPhone !== undefined) updated.contactPhone = contactPhone;
      branches[idx] = updated;

      tx.update(ref, { branches, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/branches/:branchId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.COMPANY_PROFILES).doc(req.params.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const company = snap.data();
      const branches = company.branches || [];
      if (branches.length <= 1) {
        throw Object.assign(new Error("A company must keep at least one branch"), { status: 400 });
      }
      tx.update(ref, {
        branches: branches.filter((b) => b.id !== req.params.branchId),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.user.userId,
      });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
