import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, BD_RESULT, APPROACH_MODE, MARKETING_SOURCE_OPTIONS, REFERRAL_TYPE } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { newProjectDoc } from "../lib/companyProfile.js";
import { emptyBranch } from "./companyProfiles.js";

const router = Router();

// Sequential, human-readable enquiry numbers (001, 002, ...), generated in
// a transaction against a single counter doc so concurrent creates never
// collide.
async function nextEnquiryNo() {
  const ref = db.collection(COLLECTIONS.HR_SETTINGS).doc("bd_counter");
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const seq = (snap.exists ? snap.data().seq : 0) + 1;
    tx.set(ref, { seq }, { merge: true });
    return String(seq).padStart(3, "0");
  });
}

// Parent company numbers start at 150 (150, 151, 152, ...) — one per
// genuinely new company, never reused when a second branch or project is
// added under an existing one.
async function nextParentNumber() {
  const ref = db.collection(COLLECTIONS.HR_SETTINGS).doc("company_counter");
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const parentNumber = (snap.exists ? snap.data().seq : 149) + 1;
    tx.set(ref, { seq: parentNumber }, { merge: true });
    return parentNumber;
  });
}

// Project IDs are PRJ + the parent company's 3-digit number + a 3-digit
// sequence (PRJ150001, PRJ150002, ...) — one counter shared by every branch
// of that company, so project numbering never resets per branch. Deliberately
// 3 digits (not 2, like branch numbers) so a project's numeric part is
// always one digit longer than any branch code and can never be mistaken
// for one, even when both happen to be "the first" (01).
async function nextProjectId(companyRef, parentNumber) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(companyRef);
    if (!snap.exists) throw Object.assign(new Error("Company not found"), { status: 404 });
    const projectSeq = (snap.data().projectSeq || 0) + 1;
    tx.update(companyRef, { projectSeq });
    return `PRJ${parentNumber}${String(projectSeq).padStart(3, "0")}`;
  });
}

function validateApproachMode(mode) {
  return Object.values(APPROACH_MODE).includes(mode);
}

router.get("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    let query = db.collection(COLLECTIONS.BD_ENQUIRIES);
    if (req.query.result) query = query.where("result", "==", req.query.result);
    const snap = await query.get();
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (req.query.assignedTo) {
      const target = req.query.assignedTo.toUpperCase();
      list = list.filter((e) => (e.actions || []).some((a) => a.assignedTo === target));
    }
    list.sort((a, b) => (a.enquiryNo < b.enquiryNo ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    res.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    next(err);
  }
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const {
      companyId, branchId, clientName, address, marketingSource,
      referralType, referredByEmployeeId, referredByEmployeeName, referredByExternalName, referredByExternalPhone,
      approachedByName, approachDate, approachMode,
      contactPhone, contactEmail, topic, outcomeOfDiscussion, estimatedValue, remarks,
    } = req.body;

    if (!approachedByName || !approachDate || !approachMode) {
      return res.status(400).json({ error: "approachedByName, approachDate and approachMode are required" });
    }
    if (!validateApproachMode(approachMode)) {
      return res.status(400).json({ error: `approachMode must be one of ${Object.values(APPROACH_MODE).join(", ")}` });
    }
    if (approachMode === APPROACH_MODE.EMAIL && !contactEmail) {
      return res.status(400).json({ error: "contactEmail is required when the mode of approach is Email" });
    }
    if (approachMode === APPROACH_MODE.PHONE && !contactPhone) {
      return res.status(400).json({ error: "contactPhone is required when the mode of approach is Phone" });
    }
    if (marketingSource && !MARKETING_SOURCE_OPTIONS.includes(marketingSource)) {
      return res.status(400).json({ error: `marketingSource must be one of ${MARKETING_SOURCE_OPTIONS.join(", ")}` });
    }
    if (marketingSource === "Referral") {
      if (!referralType || !Object.values(REFERRAL_TYPE).includes(referralType)) {
        return res.status(400).json({ error: "referralType (EMPLOYEE or EXTERNAL) is required when marketingSource is Referral" });
      }
      if (referralType === REFERRAL_TYPE.EMPLOYEE && !referredByEmployeeId) {
        return res.status(400).json({ error: "referredByEmployeeId is required for an employee referral" });
      }
      if (referralType === REFERRAL_TYPE.EXTERNAL && (!referredByExternalName || !referredByExternalPhone)) {
        return res.status(400).json({ error: "referredByExternalName and referredByExternalPhone are required for an external referral" });
      }
    }

    let companyRef;
    let parentNumber;
    let resolvedClientName;
    let branch;

    if (companyId) {
      companyRef = db.collection(COLLECTIONS.COMPANY_PROFILES).doc(companyId);
      const companySnap = await companyRef.get();
      if (!companySnap.exists) return res.status(404).json({ error: "Selected company not found" });
      const company = companySnap.data();
      parentNumber = company.parentNumber;
      resolvedClientName = company.clientName;

      if (branchId) {
        branch = (company.branches || []).find((b) => b.id === branchId);
        if (!branch) return res.status(404).json({ error: "Selected branch not found" });
      } else {
        if (!address) return res.status(400).json({ error: "address is required for a new branch" });
        branch = await db.runTransaction(async (tx) => {
          const snap = await tx.get(companyRef);
          const c = snap.data();
          const branchSeq = (c.branchSeq || 0) + 1;
          const branchNumber = String(branchSeq).padStart(2, "0");
          const companyCode = `${c.parentNumber}${branchNumber}`;
          const newBranch = emptyBranch({ branchNumber, companyCode, address, contactPersonName: approachedByName, contactPhone });
          tx.update(companyRef, { branchSeq, branches: [...(c.branches || []), newBranch] });
          return newBranch;
        });
      }
    } else {
      if (!clientName) return res.status(400).json({ error: "clientName is required for a new company" });
      parentNumber = await nextParentNumber();
      resolvedClientName = clientName;
      companyRef = db.collection(COLLECTIONS.COMPANY_PROFILES).doc(uuid());
      const branchNumber = "01";
      const companyCode = `${parentNumber}${branchNumber}`;
      branch = emptyBranch({ branchNumber, companyCode, address, contactPersonName: approachedByName, contactPhone });
      await companyRef.set({
        parentNumber,
        clientName,
        branchSeq: 1,
        projectSeq: 0,
        branches: [branch],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: req.user.userId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.user.userId,
      });
    }

    const enquiryNo = await nextEnquiryNo();
    const projectId = await nextProjectId(companyRef, parentNumber);
    const id = uuid();

    const doc = {
      enquiryNo,
      companyId: companyRef.id,
      branchId: branch.id,
      companyCode: branch.companyCode,
      projectId,
      clientName: resolvedClientName,
      address: branch.address,
      marketingSource: marketingSource || "",
      referralType: marketingSource === "Referral" ? referralType : null,
      referredByEmployeeId: referralType === REFERRAL_TYPE.EMPLOYEE ? referredByEmployeeId.toUpperCase() : null,
      referredByEmployeeName: referralType === REFERRAL_TYPE.EMPLOYEE ? (referredByEmployeeName || referredByEmployeeId) : null,
      referredByExternalName: referralType === REFERRAL_TYPE.EXTERNAL ? referredByExternalName : null,
      referredByExternalPhone: referralType === REFERRAL_TYPE.EXTERNAL ? referredByExternalPhone : null,
      approachedByName,
      approachDate,
      approachMode,
      contactPhone: contactPhone || "",
      contactEmail: contactEmail || "",
      topic: topic || "",
      outcomeOfDiscussion: outcomeOfDiscussion || "",
      estimatedValue: estimatedValue !== undefined && estimatedValue !== "" ? Number(estimatedValue) : null,
      actions: [],
      result: BD_RESULT.IN_PROGRESS,
      remarks: remarks || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    };

    const projectDoc = newProjectDoc({
      projectId,
      companyId: companyRef.id,
      branchId: branch.id,
      companyCode: branch.companyCode,
      clientName: resolvedClientName,
      sourceEnquiryId: id,
      sourceEnquiryNo: enquiryNo,
      userId: req.user.userId,
    });

    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.BD_ENQUIRIES).doc(id), doc);
    batch.set(db.collection(COLLECTIONS.PROJECTS).doc(uuid()), projectDoc);
    await batch.commit();

    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });

    const {
      clientName, address, marketingSource, approachedByName, approachDate, approachMode,
      contactPhone, contactEmail, topic, outcomeOfDiscussion, estimatedValue, result, remarks,
    } = req.body;

    if (approachMode !== undefined && !validateApproachMode(approachMode)) {
      return res.status(400).json({ error: `approachMode must be one of ${Object.values(APPROACH_MODE).join(", ")}` });
    }
    if (result !== undefined && !Object.values(BD_RESULT).includes(result)) {
      return res.status(400).json({ error: `result must be one of ${Object.values(BD_RESULT).join(", ")}` });
    }
    if (marketingSource !== undefined && marketingSource && !MARKETING_SOURCE_OPTIONS.includes(marketingSource)) {
      return res.status(400).json({ error: `marketingSource must be one of ${MARKETING_SOURCE_OPTIONS.join(", ")}` });
    }

    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId };
    if (clientName !== undefined) updates.clientName = clientName;
    if (address !== undefined) updates.address = address;
    if (marketingSource !== undefined) updates.marketingSource = marketingSource;
    if (approachedByName !== undefined) updates.approachedByName = approachedByName;
    if (approachDate !== undefined) updates.approachDate = approachDate;
    if (approachMode !== undefined) updates.approachMode = approachMode;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (contactEmail !== undefined) updates.contactEmail = contactEmail;
    if (topic !== undefined) updates.topic = topic;
    if (outcomeOfDiscussion !== undefined) updates.outcomeOfDiscussion = outcomeOfDiscussion;
    if (estimatedValue !== undefined) updates.estimatedValue = estimatedValue === "" ? null : Number(estimatedValue);
    if (result !== undefined) updates.result = result;
    if (remarks !== undefined) updates.remarks = remarks;

    await ref.update(updates);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    await db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- action log: the running history of follow-ups on one enquiry -------
router.post("/:id/actions", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { description, assignedTo, assignedToName, dueDate, startDate } = req.body;
    if (!description || !assignedTo || !dueDate) {
      return res.status(400).json({ error: "description, assignedTo and dueDate are required" });
    }

    const ref = db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id);
    const action = {
      id: uuid(),
      description,
      assignedTo: assignedTo.toUpperCase(),
      assignedToName: assignedToName || assignedTo,
      dueDate,
      startDate: startDate || null,
      completed: false,
      completedAt: null,
      addedAt: new Date().toISOString(),
      addedBy: req.user.userId,
    };

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const actions = snap.data().actions || [];
      tx.update(ref, {
        actions: [...actions, action],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.user.userId,
      });
    });

    res.status(201).json(action);
  } catch (err) {
    next(err);
  }
});

router.put("/:id/actions/:actionId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id);
    const { description, assignedTo, assignedToName, dueDate, startDate, completed } = req.body;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const actions = snap.data().actions || [];
      const idx = actions.findIndex((a) => a.id === req.params.actionId);
      if (idx === -1) throw Object.assign(new Error("Action not found"), { status: 404 });

      const existing = actions[idx];
      const updated = { ...existing };
      if (description !== undefined) updated.description = description;
      if (assignedTo !== undefined) updated.assignedTo = assignedTo.toUpperCase();
      if (assignedToName !== undefined) updated.assignedToName = assignedToName;
      if (dueDate !== undefined) updated.dueDate = dueDate;
      if (startDate !== undefined) updated.startDate = startDate;
      if (completed !== undefined) {
        updated.completed = !!completed;
        updated.completedAt = completed ? new Date().toISOString() : null;
      }
      actions[idx] = updated;

      tx.update(ref, { actions, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/actions/:actionId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.BD_ENQUIRIES).doc(req.params.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const actions = (snap.data().actions || []).filter((a) => a.id !== req.params.actionId);
      tx.update(ref, { actions, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
