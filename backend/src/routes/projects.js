import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ADMIN_ROLES } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { emptyPhase2, emptyPhase3, emptyPhase3b, emptyPhase4 } from "../lib/companyProfile.js";

const router = Router();

router.get("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    let query = db.collection(COLLECTIONS.PROJECTS);
    if (req.query.companyId) query = query.where("companyId", "==", req.query.companyId);
    if (req.query.sourceEnquiryId) query = query.where("sourceEnquiryId", "==", req.query.sourceEnquiryId);
    const snap = await query.get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.projectId || "").localeCompare(b.projectId || ""));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.PROJECTS).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    res.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    next(err);
  }
});

// Add a new project directly under an existing company/branch, outside the
// New Enquiry flow (e.g. a repeat engagement with no fresh enquiry to log).
// Shares the same per-company (all-branches) projectSeq counter as the
// enquiry-created path, so IDs never collide either way.
router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { companyId, branchId } = req.body;
    if (!companyId) return res.status(400).json({ error: "companyId is required" });
    if (!branchId) return res.status(400).json({ error: "branchId is required" });

    const companyRef = db.collection(COLLECTIONS.COMPANY_PROFILES).doc(companyId);
    const id = uuid();
    const projectRef = db.collection(COLLECTIONS.PROJECTS).doc(id);

    const doc = await db.runTransaction(async (tx) => {
      const companySnap = await tx.get(companyRef);
      if (!companySnap.exists) throw Object.assign(new Error("Company not found"), { status: 404 });
      const company = companySnap.data();
      const branch = (company.branches || []).find((b) => b.id === branchId);
      if (!branch) throw Object.assign(new Error("Branch not found"), { status: 404 });
      const projectSeq = (company.projectSeq || 0) + 1;
      const projectId = `PRJ${company.parentNumber}${String(projectSeq).padStart(3, "0")}`;

      const newDoc = {
        projectId,
        companyId,
        branchId,
        companyCode: branch.companyCode,
        clientName: company.clientName,
        poNumber: "",
        poValue: null,
        deliveryDueDate: null,
        termsAndConditions: "",
        sourceEnquiryId: null,
        sourceEnquiryNo: null,
        phase2: emptyPhase2(),
        phase3: emptyPhase3(),
        phase3b: emptyPhase3b(),
        phase4: emptyPhase4(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: req.user.userId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.user.userId,
      };
      tx.update(companyRef, { projectSeq });
      tx.set(projectRef, newDoc);
      return newDoc;
    });

    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

const PHASE2_FIELDS = [
  "proposalNo", "proposalDate", "modeOfSubmission", "submittedTo", "submittedBy",
  "nextFollowUpDueOn", "nextFollowUpDate", "respondedInFavour",
  "finalProposalAfterNegotiation", "workOrderDate", "workOrderNumber",
];
const PHASE3_FIELDS = ["workOrderDate", "workOrderNumber", "workOrderDescription", "deliveryConditions", "paymentTerms"];
const PHASE4_FIELDS = [
  "deliveryReportSubmitted", "deliveryReportDate", "deliveryReportNotes",
  "invoiceNumber", "invoiceDate", "invoiceAmount", "paymentReceived", "paymentReceivedDate",
];

router.put("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    const existing = snap.data();

    const { poNumber, poValue, deliveryDueDate, termsAndConditions, phase2, phase3, phase4 } = req.body;

    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId };
    if (poNumber !== undefined) updates.poNumber = poNumber;
    if (poValue !== undefined) updates.poValue = poValue === "" ? null : Number(poValue);
    if (deliveryDueDate !== undefined) updates.deliveryDueDate = deliveryDueDate || null;
    if (termsAndConditions !== undefined) updates.termsAndConditions = termsAndConditions;

    // Partial merge into the nested phase objects — conversations are
    // managed by their own sub-resource endpoints below, never overwritten
    // here even if the caller's phase2 payload omits them.
    if (phase2 !== undefined) {
      const merged = { ...(existing.phase2 || emptyPhase2()) };
      for (const f of PHASE2_FIELDS) if (phase2[f] !== undefined) merged[f] = phase2[f];
      updates.phase2 = merged;
    }
    if (phase3 !== undefined) {
      const merged = { ...(existing.phase3 || emptyPhase3()) };
      for (const f of PHASE3_FIELDS) if (phase3[f] !== undefined) merged[f] = phase3[f];
      updates.phase3 = merged;
    }
    if (phase4 !== undefined) {
      const merged = { ...(existing.phase4 || emptyPhase4()) };
      for (const f of PHASE4_FIELDS) if (phase4[f] !== undefined) merged[f] = phase4[f];
      updates.phase4 = merged;
    }

    await ref.update(updates);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    await db.collection(COLLECTIONS.PROJECTS).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Conversation Stage: our own outgoing conversation log ----------------
router.post("/:id/conversations", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { date, description } = req.body;
    if (!description) return res.status(400).json({ error: "description is required" });

    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);
    const entry = { id: uuid(), date: date || null, description, addedAt: new Date().toISOString(), addedBy: req.user.userId };

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const phase2 = snap.data().phase2 || emptyPhase2();
      const conversations = [...(phase2.conversations || []), entry];
      tx.update(ref, { phase2: { ...phase2, conversations }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });

    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/conversations/:convId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const phase2 = snap.data().phase2 || emptyPhase2();
      const conversations = (phase2.conversations || []).filter((c) => c.id !== req.params.convId);
      tx.update(ref, { phase2: { ...phase2, conversations }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Client replies received during the Conversation Stage ----------------
router.post("/:id/client-replies", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { date, reply } = req.body;
    if (!reply) return res.status(400).json({ error: "reply is required" });

    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);
    const entry = { id: uuid(), date: date || null, reply, addedAt: new Date().toISOString(), addedBy: req.user.userId };

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const phase2 = snap.data().phase2 || emptyPhase2();
      const clientReplies = [...(phase2.clientReplies || []), entry];
      tx.update(ref, { phase2: { ...phase2, clientReplies }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });

    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/client-replies/:replyId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const phase2 = snap.data().phase2 || emptyPhase2();
      const clientReplies = (phase2.clientReplies || []).filter((c) => c.id !== req.params.replyId);
      tx.update(ref, { phase2: { ...phase2, clientReplies }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Phase III(b) project plan: a numbered action list --------------------
router.post("/:id/plan-actions", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { description, assignedTo, assignedToName, startDate, dueDate } = req.body;
    if (!description || !assignedTo || !dueDate) {
      return res.status(400).json({ error: "description, assignedTo and dueDate are required" });
    }

    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);
    const action = {
      id: uuid(),
      description,
      assignedTo: assignedTo.toUpperCase(),
      assignedToName: assignedToName || assignedTo,
      startDate: startDate || null,
      dueDate,
      completed: false,
      completedAt: null,
      dependsOn: [],
      addedAt: new Date().toISOString(),
      addedBy: req.user.userId,
    };

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const phase3b = snap.data().phase3b || emptyPhase3b();
      const actions = [...(phase3b.actions || []), action];
      tx.update(ref, { phase3b: { ...phase3b, actions }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });

    res.status(201).json(action);
  } catch (err) {
    next(err);
  }
});

// True if `startId` can reach itself by following `dependsOn` edges in
// `actions` (with `overrides` layered on top for the node being saved,
// since that node's new dependsOn isn't committed to the array yet).
function dependencyCycleExists(actions, startId, overrides) {
  const dependsOnById = new Map(actions.map((a) => [a.id, a.id in overrides ? overrides[a.id] : (a.dependsOn || [])]));
  const visited = new Set();
  function canReach(id, target) {
    if (id === target) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return (dependsOnById.get(id) || []).some((depId) => canReach(depId, target));
  }
  return (dependsOnById.get(startId) || []).some((depId) => canReach(depId, startId));
}

// Admins can edit every field; an assignee who isn't an admin may only flip
// their own action's `completed` flag (checking off their own work) — every
// other field stays admin-only.
router.put("/:id/plan-actions/:actionId", authenticate, async (req, res, next) => {
  try {
    const isAdmin = ADMIN_ROLES.includes(req.user.role);
    const { description, assignedTo, assignedToName, startDate, dueDate, completed, dependsOn } = req.body;
    if (!isAdmin) {
      const onlyCompleted = Object.keys(req.body).every((k) => k === "completed");
      if (!onlyCompleted) return res.status(403).json({ error: "Admin access required" });
    }
    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const phase3b = snap.data().phase3b || emptyPhase3b();
      const actions = phase3b.actions || [];
      const idx = actions.findIndex((a) => a.id === req.params.actionId);
      if (idx === -1) throw Object.assign(new Error("Action not found"), { status: 404 });
      if (!isAdmin && actions[idx].assignedTo !== req.user.userId) {
        throw Object.assign(new Error("You can only update your own assigned actions"), { status: 403 });
      }

      const updated = { ...actions[idx] };
      if (description !== undefined) updated.description = description;
      if (assignedTo !== undefined) updated.assignedTo = assignedTo.toUpperCase();
      if (assignedToName !== undefined) updated.assignedToName = assignedToName;
      if (startDate !== undefined) updated.startDate = startDate;
      if (dueDate !== undefined) updated.dueDate = dueDate;
      if (completed !== undefined) {
        updated.completed = !!completed;
        updated.completedAt = completed ? new Date().toISOString() : null;
      }
      if (dependsOn !== undefined) {
        const validIds = new Set(actions.map((a) => a.id));
        const deduped = [...new Set(dependsOn)].filter((depId) => depId !== req.params.actionId);
        const unknown = deduped.filter((depId) => !validIds.has(depId));
        if (unknown.length) throw Object.assign(new Error("dependsOn references an action that doesn't exist"), { status: 400 });
        if (dependencyCycleExists(actions, req.params.actionId, { [req.params.actionId]: deduped })) {
          throw Object.assign(new Error("That would create a circular dependency"), { status: 400 });
        }
        updated.dependsOn = deduped;
      }
      actions[idx] = updated;

      tx.update(ref, { phase3b: { ...phase3b, actions }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/plan-actions/:actionId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const phase3b = snap.data().phase3b || emptyPhase3b();
      const actions = (phase3b.actions || [])
        .filter((a) => a.id !== req.params.actionId)
        .map((a) => (a.dependsOn?.includes(req.params.actionId) ? { ...a, dependsOn: a.dependsOn.filter((d) => d !== req.params.actionId) } : a));
      tx.update(ref, { phase3b: { ...phase3b, actions }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
