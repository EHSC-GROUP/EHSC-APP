import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ADMIN_ROLES } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { emptyPhase2, emptyPhase3, emptyPhase3b, emptyPhase4, emptyInvoiceStages } from "../lib/companyProfile.js";
import { buildGanttWorkbook } from "../lib/ganttExcel.js";
import { notifyAdmins } from "../lib/notifications.js";
import { INVOICE_STAGE_NUMBERS, isValidStage } from "../lib/constants.js";
import { getProjectPlanTemplate, buildPlanActionsFromTemplate } from "../lib/projectPlanTemplate.js";
import { resolveClassification, nextProjectId } from "../lib/projectClassification.js";
import { getDropdownLists, listValueError, startingValues } from "../lib/dropdownLists.js";

const router = Router();

// A minimal, non-admin-gated project list for pickers (e.g. the
// reimbursement form's project-linkage field, once that feature is
// enabled) — id/projectId/clientName only, none of the financial/contract
// detail the full admin listing carries.
router.get("/picklist", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.PROJECTS).get();
    const list = snap.docs.map((d) => ({ id: d.id, projectId: d.data().projectId, clientName: d.data().clientName }));
    list.sort((a, b) => (a.projectId || "").localeCompare(b.projectId || ""));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// Excel download of the Project Tracker's Gantt chart — same rows,
// grouping and status coloring as the on-screen chart (frontend
// flattenActions/statusOf in ProjectTracker.jsx), so the export matches
// what's visible when the button is clicked. Optional ?clientName= mirrors
// the page's company filter.
router.get("/gantt-export", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.PROJECTS).get();
    const rows = [];
    for (const doc of snap.docs) {
      const project = doc.data();
      if (req.query.clientName && project.clientName !== req.query.clientName) continue;
      for (const action of project.phase3b?.actions || []) {
        rows.push({ ...action, clientName: project.clientName });
      }
    }

    const workbook = await buildGanttWorkbook(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Project_Tracker_Gantt_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

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
    const { companyId, branchId, projectCategory, service, projectType, region } = req.body;
    if (!companyId) return res.status(400).json({ error: "companyId is required" });
    if (!branchId) return res.status(400).json({ error: "branchId is required" });
    const classification = resolveClassification({ category: projectCategory, service, projectType });
    if (classification.error) return res.status(400).json({ error: classification.error });
    const lists = await getDropdownLists();
    const regionError = listValueError(lists, "region", region);
    if (regionError) return res.status(400).json({ error: regionError });
    const starting = startingValues(lists);
    const projectId = await nextProjectId({ category: projectCategory, service, projectType });

    const companyRef = db.collection(COLLECTIONS.COMPANY_PROFILES).doc(companyId);
    const id = uuid();
    const projectRef = db.collection(COLLECTIONS.PROJECTS).doc(id);

    const doc = await db.runTransaction(async (tx) => {
      const companySnap = await tx.get(companyRef);
      if (!companySnap.exists) throw Object.assign(new Error("Company not found"), { status: 404 });
      const company = companySnap.data();
      const branch = (company.branches || []).find((b) => b.id === branchId);
      if (!branch) throw Object.assign(new Error("Branch not found"), { status: 404 });
      const newDoc = {
        projectId,
        companyId,
        branchId,
        companyCode: branch.companyCode,
        clientName: company.clientName,
        projectCategory,
        service: service || null,
        projectType,
        region: region || "",
        teamLeadId: "",
        teamLeadName: "",
        teamMembers: [],
        status: starting.status,
        priority: starting.priority,
        risk: starting.risk,
        startDate: null,
        paymentStatus: starting.paymentStatus,
        invoicedAmount: null,
        receivedAmount: null,
        poNumber: "",
        poValue: null,
        deliveryDueDate: null,
        termsAndConditions: "",
        contractValue: null,
        ...emptyInvoiceStages(),
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

    const {
      poNumber, poValue, deliveryDueDate, termsAndConditions, contractValue,
      teamLeadId, teamLeadName, teamMembers, status, priority, risk, startDate,
      paymentStatus, invoicedAmount, receivedAmount,
      phase2, phase3, phase4,
    } = req.body;
    const lists = await getDropdownLists();
    for (const [key, value] of [["projectStatus", status], ["priority", priority], ["risk", risk], ["paymentStatus", paymentStatus]]) {
      const err = listValueError(lists, key, value);
      if (err) return res.status(400).json({ error: err });
    }

    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId };
    if (poNumber !== undefined) updates.poNumber = poNumber;
    if (poValue !== undefined) updates.poValue = poValue === "" ? null : Number(poValue);
    if (deliveryDueDate !== undefined) updates.deliveryDueDate = deliveryDueDate || null;
    if (termsAndConditions !== undefined) updates.termsAndConditions = termsAndConditions;
    if (contractValue !== undefined) updates.contractValue = contractValue === "" ? null : Number(contractValue);
    // Up to five invoice stages, each with a billing-trigger name and a percentage.
    for (const n of INVOICE_STAGE_NUMBERS) {
      const nameKey = `invoiceStage${n}Name`;
      if (req.body[nameKey] !== undefined) updates[nameKey] = String(req.body[nameKey] || "").trim().slice(0, 120);
      const key = `invoiceStage${n}Percent`;
      const val = req.body[key];
      if (val === undefined) continue;
      const num = val === "" || val === null ? null : Number(val);
      if (num !== null && (Number.isNaN(num) || num < 0 || num > 100)) {
        return res.status(400).json({ error: `Stage ${n} percentage must be a number between 0 and 100` });
      }
      updates[key] = num;
    }
    const percentTotal = INVOICE_STAGE_NUMBERS.reduce((sum, n) => {
      const v = updates[`invoiceStage${n}Percent`] !== undefined ? updates[`invoiceStage${n}Percent`] : existing[`invoiceStage${n}Percent`];
      return sum + (Number(v) || 0);
    }, 0);
    if (percentTotal > 100.0001) {
      return res.status(400).json({ error: `The invoice stage percentages add up to ${Math.round(percentTotal * 100) / 100}%, which is more than 100%` });
    }

    // Who runs the project and who works on it, plus its status, priority and risk.
    if (teamLeadId !== undefined) {
      updates.teamLeadId = teamLeadId ? String(teamLeadId).toUpperCase() : "";
      updates.teamLeadName = teamLeadId ? String(teamLeadName || teamLeadId) : "";
    }
    if (teamMembers !== undefined) {
      if (!Array.isArray(teamMembers) || teamMembers.length > 50) {
        return res.status(400).json({ error: "teamMembers must be a list of up to 50 people" });
      }
      const seen = new Set();
      updates.teamMembers = teamMembers
        .map((m) => ({ userId: String(m.userId || "").toUpperCase(), name: String(m.name || m.userId || "") }))
        .filter((m) => m.userId && !seen.has(m.userId) && seen.add(m.userId));
    }
    if (status !== undefined && status) updates.status = status;
    if (priority !== undefined && priority) updates.priority = priority;
    if (risk !== undefined && risk) updates.risk = risk;
    if (startDate !== undefined) updates.startDate = startDate || null;
    if (paymentStatus !== undefined && paymentStatus) updates.paymentStatus = paymentStatus;
    for (const [key, val] of [["invoicedAmount", invoicedAmount], ["receivedAmount", receivedAmount]]) {
      if (val === undefined) continue;
      const num = val === "" || val === null ? null : Number(val);
      if (num !== null && (Number.isNaN(num) || num < 0)) return res.status(400).json({ error: `${key} must be a number, 0 or more` });
      updates[key] = num;
    }

    // Partial merge into the nested phase objects — conversations are
    // managed by their own sub-resource endpoints below, never overwritten
    // here even if the caller's phase2 payload omits them.
    if (phase2 !== undefined) {
      const merged = { ...(existing.phase2 || emptyPhase2()) };
      for (const f of PHASE2_FIELDS) if (phase2[f] !== undefined) merged[f] = phase2[f];
      updates.phase2 = merged;

      // The contract just got confirmed (Responded in favour flipped on) —
      // auto-populate the Project Plan from that project type's template,
      // but only into a still-empty plan, so this never overwrites a plan
      // someone already built by hand.
      const justAccepted = merged.respondedInFavour && !existing.phase2?.respondedInFavour;
      const planIsEmpty = (existing.phase3b?.actions || []).length === 0;
      if (justAccepted && planIsEmpty && existing.projectType) {
        const tasks = await getProjectPlanTemplate(existing.projectType);
        if (tasks && tasks.length > 0) {
          const actions = buildPlanActionsFromTemplate(tasks, {
            userId: req.user.userId,
            userName: req.user.name,
            baseDateISO: new Date().toISOString().slice(0, 10),
          });
          updates.phase3b = { ...(existing.phase3b || emptyPhase3b()), actions };
        }
      }
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

// Shared by both the manual mark-complete endpoint below and the
// auto-detection in plan-actions PUT (a stage is complete once every Project
// Plan task tagged with it is done) — same message either way. References
// the stage number so the superadmin knows which invoice to raise, never
// the (real, descriptive) task names themselves.
function stageNotificationMessage(project, stage) {
  const percent = project[`invoiceStage${stage}Percent`];
  const amount = percent != null && project.contractValue != null
    ? Math.round((Number(project.contractValue) * Number(percent) / 100) * 100) / 100
    : null;
  const stageName = project[`invoiceStage${stage}Name`];
  return `Stage ${stage}${stageName ? ` (${stageName})` : ""} complete for ${project.clientName} (${project.projectId})${percent != null ? ` — ${percent}%` : ""}${amount != null ? ` (₹${amount})` : ""}. Raise the invoice.`;
}

// Marking an invoice stage complete manually — a fallback/override for a
// stage with no tasks tagged to it (or to force it early). It's its own
// endpoint rather than folded into the general PUT /:id since it's the
// action that fires a notification, so it needs to be a controlled,
// explicit transition rather than something that falls out of an arbitrary
// field edit.
router.put("/:id/invoice-stages/:stage", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const stage = Number(req.params.stage);
    if (!isValidStage(stage)) return res.status(400).json({ error: "stage must be 1 to 5" });
    const completed = !!req.body.completed;
    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);

    let shouldNotify = false;
    let project;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      project = snap.data();
      const wasCompleted = !!project[`invoiceStage${stage}Completed`];
      shouldNotify = completed && !wasCompleted;
      tx.update(ref, {
        [`invoiceStage${stage}Completed`]: completed,
        [`invoiceStage${stage}CompletedAt`]: completed ? new Date().toISOString() : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: req.user.userId,
      });
    });

    if (shouldNotify) {
      await notifyAdmins({
        message: stageNotificationMessage(project, stage),
        link: `/admin/company-profiles?companyId=${project.companyId}`,
      });
    }

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

// Checks the plan-action fields that come from the editable lists, plus % complete.
function actionFieldsError(lists, body) {
  for (const [key, value] of [["projectStatus", body.status], ["priority", body.priority], ["risk", body.risk]]) {
    const err = listValueError(lists, key, value);
    if (err) return err;
  }
  if (body.percentComplete !== undefined && body.percentComplete !== "" && body.percentComplete !== null) {
    const n = Number(body.percentComplete);
    if (!Number.isFinite(n) || n < 0 || n > 100) return "% complete must be a number from 0 to 100";
  }
  return null;
}

// ---- Phase III(b) project plan: a numbered action list --------------------
router.post("/:id/plan-actions", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { description, assignedTo, assignedToName, startDate, dueDate, stage } = req.body;
    if (!description || !assignedTo || !dueDate) {
      return res.status(400).json({ error: "description, assignedTo and dueDate are required" });
    }
    if (stage !== undefined && stage !== null && stage !== "" && !isValidStage(stage)) {
      return res.status(400).json({ error: "stage must be 1 to 5 or left blank" });
    }
    const lists = await getDropdownLists();
    const fieldsError = actionFieldsError(lists, req.body);
    if (fieldsError) return res.status(400).json({ error: fieldsError });
    const starting = startingValues(lists);

    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);
    const action = {
      id: uuid(),
      description,
      stage: stage !== undefined && stage !== null && stage !== "" ? Number(stage) : null,
      assignedTo: assignedTo.toUpperCase(),
      assignedToName: assignedToName || assignedTo,
      startDate: startDate || null,
      dueDate,
      completed: false,
      completedAt: null,
      priority: req.body.priority || starting.priority,
      risk: req.body.risk || starting.risk,
      status: req.body.status || starting.status,
      percentComplete: req.body.percentComplete !== undefined && req.body.percentComplete !== "" ? Number(req.body.percentComplete) : 0,
      deliverable: String(req.body.deliverable || "").slice(0, 300),
      escalationRequired: !!req.body.escalationRequired,
      remarks: String(req.body.remarks || "").slice(0, 1000),
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

// Bulk-appends several already-dated actions at once - used by the Project
// Plan's "Import Template" flow, where the admin has reviewed/adjusted every
// row's days and dates in the browser before importing.
router.post("/:id/plan-actions/import", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { tasks } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: "tasks must be a non-empty array" });
    for (const t of tasks) {
      if (!t.description || !t.dueDate) return res.status(400).json({ error: "every task needs a description and dueDate" });
      if (t.stage !== undefined && t.stage !== null && t.stage !== "" && !isValidStage(t.stage)) {
        return res.status(400).json({ error: "stage must be 1 to 5 or left blank" });
      }
    }
    const lists = await getDropdownLists();
    const starting = startingValues(lists);
    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);
    const actions = tasks.map((t) => ({
      id: uuid(),
      description: t.description,
      stage: t.stage !== undefined && t.stage !== null && t.stage !== "" ? Number(t.stage) : null,
      assignedTo: req.user.userId,
      assignedToName: req.user.name || req.user.userId,
      startDate: t.startDate || null,
      dueDate: t.dueDate,
      completed: false,
      completedAt: null,
      priority: starting.priority,
      risk: starting.risk,
      status: starting.status,
      percentComplete: 0,
      deliverable: String(t.deliverable || "").slice(0, 300),
      escalationRequired: false,
      remarks: "",
      dependsOn: [],
      addedAt: new Date().toISOString(),
      addedBy: req.user.userId,
    }));
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const phase3b = snap.data().phase3b || emptyPhase3b();
      tx.update(ref, { phase3b: { ...phase3b, actions: [...(phase3b.actions || []), ...actions] }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId });
    });
    res.status(201).json({ ok: true, added: actions.length });
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
    const { description, assignedTo, assignedToName, startDate, dueDate, completed, dependsOn, stage } = req.body;
    const { priority, risk, status, percentComplete, deliverable, escalationRequired, remarks } = req.body;
    if (!isAdmin) {
      // An assignee can report on their own progress, nothing else.
      const ownFields = ["completed", "status", "percentComplete", "remarks"];
      const onlyOwn = Object.keys(req.body).every((k) => ownFields.includes(k));
      if (!onlyOwn) return res.status(403).json({ error: "Admin access required" });
    }
    if (stage !== undefined && stage !== null && stage !== "" && !isValidStage(stage)) {
      return res.status(400).json({ error: "stage must be 1 to 5 or left blank" });
    }
    const lists = await getDropdownLists();
    const fieldsError = actionFieldsError(lists, req.body);
    if (fieldsError) return res.status(400).json({ error: fieldsError });
    const ref = db.collection(COLLECTIONS.PROJECTS).doc(req.params.id);

    let stagesJustCompleted = [];
    let projectForNotify = null;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const project = snap.data();
      const phase3b = project.phase3b || emptyPhase3b();
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
      if (stage !== undefined) updated.stage = stage !== null && stage !== "" ? Number(stage) : null;
      if (priority !== undefined && priority) updated.priority = priority;
      if (risk !== undefined && risk) updated.risk = risk;
      if (deliverable !== undefined) updated.deliverable = String(deliverable || "").slice(0, 300);
      if (escalationRequired !== undefined) updated.escalationRequired = !!escalationRequired;
      if (remarks !== undefined) updated.remarks = String(remarks || "").slice(0, 1000);
      if (percentComplete !== undefined && percentComplete !== "") updated.percentComplete = Number(percentComplete);
      if (status !== undefined && status) updated.status = status;

      // "Completed" status, the done tick and 100% all say the same thing, so
      // keep them in step whichever one the caller changed.
      const wasCompleted = !!actions[idx].completed;
      let nowCompleted = wasCompleted;
      if (completed !== undefined) nowCompleted = !!completed;
      else if (status !== undefined && status) nowCompleted = status === "Completed";
      else if (updated.percentComplete >= 100 && percentComplete !== undefined && percentComplete !== "") nowCompleted = true;
      if (nowCompleted && !wasCompleted) {
        updated.completed = true;
        updated.completedAt = new Date().toISOString();
        updated.status = "Completed";
        updated.percentComplete = 100;
      } else if (!nowCompleted && wasCompleted) {
        updated.completed = false;
        updated.completedAt = null;
        if (updated.status === "Completed") updated.status = "Ongoing";
        if (updated.percentComplete >= 100) updated.percentComplete = 90;
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

      const docUpdates = { phase3b: { ...phase3b, actions }, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user.userId };

      // Auto-detect: check every stage on any change to this action (its
      // completion, or which stage it's tagged to) — if every action
      // tagged with a stage is now done, that stage counts as complete.
      // Tasks keep their real names throughout; the stage number is only
      // ever an internal tag, never the task's own name.
      for (const n of INVOICE_STAGE_NUMBERS) {
        if (project[`invoiceStage${n}Completed`]) continue;
        const stageActions = actions.filter((a) => a.stage === n);
        const allDone = stageActions.length > 0 && stageActions.every((a) => a.completed);
        if (allDone) {
          docUpdates[`invoiceStage${n}Completed`] = true;
          docUpdates[`invoiceStage${n}CompletedAt`] = new Date().toISOString();
          stagesJustCompleted.push(n);
        }
      }
      if (stagesJustCompleted.length > 0) projectForNotify = project;

      tx.update(ref, docUpdates);
    });

    for (const stageNum of stagesJustCompleted) {
      await notifyAdmins({
        message: stageNotificationMessage(projectForNotify, stageNum),
        link: `/admin/company-profiles?companyId=${projectForNotify.companyId}`,
      });
    }

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
