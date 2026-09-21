import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ROLES, REIMBURSEMENT_STATUS, REIMBURSEMENT_TYPE } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { uploadBuffer, streamFile, safeFileName } from "../lib/storage.js";
import { numberToWords } from "../lib/numberToWords.js";
import { round2 } from "../lib/dateUtils.js";
import { getFeatureFlags } from "../lib/featureFlags.js";
import { renderReimbursementPdf } from "../lib/reimbursementPdf.js";
import { buildReimbursementRegisterWorkbook } from "../lib/reimbursementExcel.js";
import { planWalletOffset, restoreWalletOffsets } from "../lib/advanceWallet.js";
import {
  loadDepartmentMap, loadDepartmentAdmins, visibleDepartmentFor, filterByDepartment,
  canDeptApprove, canFinalApprove, canAdminCancel, awaitingNote, moneyActions,
} from "../lib/approvals.js";

const router = Router();
const isAdminRole = (role) => [ROLES.ADMIN, ROLES.SUPERADMIN].includes(role);
const col = () => db.collection(COLLECTIONS.HR_REIMBURSEMENTS);

// Reimbursement Claim Form (RCF) shape: a single claim can carry any mix of
// A. Travelling (outstation), B. Conveyance (local) and C. Other expenses —
// mirrors the physical EHSC RCF, which is one form covering all three.
function parseMaybeJSON(v) {
  if (v === undefined || v === null || v === "") return [];
  return typeof v === "string" ? JSON.parse(v) : v;
}

function validItem(item, requiredFields) {
  return requiredFields.every((f) => item[f] !== undefined && item[f] !== null && String(item[f]).trim() !== "");
}

function validateSections(travelItems, conveyanceItems, otherItems) {
  if (travelItems.length === 0 && conveyanceItems.length === 0 && otherItems.length === 0) {
    return "At least one expense item (Travelling, Conveyance or Other) is required";
  }
  for (const it of travelItems) {
    if (!validItem(it, ["fromDate", "fromPlace", "toDate", "toPlace"]) || !(Number(it.fare) > 0)) {
      return "Each Travelling Expense item needs From/To dates & places and a fare > 0";
    }
  }
  for (const it of conveyanceItems) {
    if (!validItem(it, ["date", "from", "to"]) || !(Number(it.fare) > 0)) {
      return "Each Conveyance Expense item needs a date, from, to and a fare > 0";
    }
  }
  for (const it of otherItems) {
    if (!validItem(it, ["date", "details"]) || !(Number(it.amount) > 0)) {
      return "Each Other Expense item needs a date, details and an amount > 0";
    }
  }
  return null;
}

function computeTotal(travelItems, conveyanceItems, otherItems) {
  const sum = (arr, field) => arr.reduce((s, i) => s + Number(i[field] || 0), 0);
  return round2(sum(travelItems, "fare") + sum(conveyanceItems, "fare") + sum(otherItems, "amount"));
}

// A voucher can be split across several projects (free-text project IDs for
// now — a dropdown replaces the text box once Project Management goes
// live). One project: it simply gets the whole voucher total. Two or more:
// each needs an explicit amount and the amounts must add up to the total.
function normalizeProjects(rawProjects, totalAmount) {
  const projects = (rawProjects || [])
    .map((p) => ({ projectId: String(p.projectId || "").trim(), amountSpent: p.amountSpent }))
    .filter((p) => p.projectId);
  if (new Set(projects.map((p) => p.projectId.toUpperCase())).size !== projects.length) {
    return { error: "The same project is listed more than once" };
  }
  if (projects.length === 0) return { projects: [] };
  if (projects.length === 1) return { projects: [{ projectId: projects[0].projectId, amountSpent: totalAmount }] };

  let sum = 0;
  const out = [];
  for (const p of projects) {
    const amt = round2(Number(p.amountSpent));
    if (!(amt > 0)) return { error: `Enter the amount spent on project ${p.projectId}` };
    sum += amt;
    out.push({ projectId: p.projectId, amountSpent: amt });
  }
  if (Math.abs(round2(sum) - totalAmount) > 0.01) {
    return { error: `Project amounts add up to ${round2(sum)} but the voucher total is ${totalAmount}` };
  }
  return { projects: out };
}

// Adds per-row "what can the caller do / who is it waiting on" info.
async function decorate(list, user) {
  const [deptMap, deptAdmins] = await Promise.all([loadDepartmentMap(), loadDepartmentAdmins()]);
  return Promise.all(
    list.map(async (r) => {
      const department = deptMap.get(r.userId) || null;
      const base = { ...r, department, awaiting: awaitingNote(r.status, department, deptAdmins) };
      if (!isAdminRole(user.role)) return base;
      const actions = await moneyActions(user, r);
      // Payment is the superadmin's, and only for what the advance wallet
      // did not already cover.
      actions.canMarkPaid = user.role === ROLES.SUPERADMIN && r.status === REIMBURSEMENT_STATUS.APPROVED && Number(r.payableAmount ?? r.totalAmount) > 0;
      return { ...base, actions };
    })
  );
}

function buildAdminQuery(reqQuery) {
  let query = col();
  if (reqQuery.status) query = query.where("status", "==", reqQuery.status);
  if (reqQuery.userId) query = query.where("userId", "==", reqQuery.userId.toUpperCase());
  if (reqQuery.projectId) query = query.where("projectId", "==", reqQuery.projectId);
  if (reqQuery.type) query = query.where("type", "==", reqQuery.type);
  return query;
}

// Admin-facing list, scoped to the caller's department (superadmin: all).
async function queryScopedList(reqQuery, user) {
  const snap = await buildAdminQuery(reqQuery).get();
  let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const [visibleDept, deptMap] = await Promise.all([visibleDepartmentFor(user), loadDepartmentMap()]);
  list = filterByDepartment(list, visibleDept, deptMap);
  list.sort((a, b) => (a.voucherDate < b.voucherDate ? 1 : -1));
  return list;
}

router.get("/admin", authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await decorate(await queryScopedList(req.query, req.user), req.user));
  } catch (err) {
    next(err);
  }
});

router.get("/mine", authenticate, async (req, res, next) => {
  try {
    const snap = await col().where("userId", "==", req.user.userId).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.voucherDate < b.voucherDate ? 1 : -1));
    res.json(await decorate(list, { ...req.user, role: ROLES.EMPLOYEE }));
  } catch (err) {
    next(err);
  }
});

// Bulk exports — placed ahead of "/:id/pdf" so "/export/pdf" and
// "/export/excel" aren't swallowed by the ":id" param.
router.get("/export/pdf", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const list = await queryScopedList(req.query, req.user);
    if (list.length === 0) return res.status(404).json({ error: "No reimbursements match this filter" });
    const pdfBuffer = await renderReimbursementPdf(list);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Reimbursement_Claims_${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

router.get("/export/excel", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const list = await queryScopedList(req.query, req.user);
    const workbook = await buildReimbursementRegisterWorkbook(list);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Reimbursement_Register_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// Access management: full-set replace of who (non-admin employees) may
// submit their own reimbursements.
router.get("/access", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("reimbursementAccess", "==", true).get();
    res.json(snap.docs.map((d) => d.id));
  } catch (err) {
    next(err);
  }
});

router.put("/access", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: "userIds must be an array" });
    const granted = new Set(userIds.map((id) => id.toUpperCase()));

    const snap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).get();
    let batch = db.batch();
    let ops = 0;
    for (const doc of snap.docs) {
      const shouldHave = granted.has(doc.id);
      if (!!doc.data().reimbursementAccess !== shouldHave) {
        batch.update(doc.ref, { reimbursementAccess: shouldHave });
        ops++;
        if (ops >= 450) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
    }
    if (ops > 0) await batch.commit();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Submit — always for the caller themself. Non-admin employees need
// reimbursementAccess and at least one bill copy; admins/superadmins
// submitting their own expense vouchers need neither. Up to 10 bills.
router.post("/", authenticate, upload.fields([{ name: "bills", maxCount: 10 }, { name: "bill", maxCount: 1 }]), async (req, res, next) => {
  try {
    const isEmployee = req.user.role === ROLES.EMPLOYEE;
    const files = [...(req.files?.bills || []), ...(req.files?.bill || [])];

    if (isEmployee) {
      const profileSnap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(req.user.userId).get();
      if (!profileSnap.exists || !profileSnap.data().reimbursementAccess) {
        return res.status(403).json({ error: "Reimbursement access has not been granted to you" });
      }
      if (files.length === 0) {
        return res.status(400).json({ error: "At least one bill copy is required" });
      }
    }

    const { voucherDate, paidTo, projectId, journeyPurpose, journeyStation } = req.body;
    const type = req.body.type || REIMBURSEMENT_TYPE.GENERAL;
    const travelItems = parseMaybeJSON(req.body.travelItems);
    const conveyanceItems = parseMaybeJSON(req.body.conveyanceItems);
    const otherItems = parseMaybeJSON(req.body.otherItems);
    if (!voucherDate || !paidTo) return res.status(400).json({ error: "voucherDate and paidTo are required" });
    if (!Object.values(REIMBURSEMENT_TYPE).includes(type)) {
      return res.status(400).json({ error: `type must be one of ${Object.values(REIMBURSEMENT_TYPE).join(", ")}` });
    }
    const itemsError = validateSections(travelItems, conveyanceItems, otherItems);
    if (itemsError) return res.status(400).json({ error: itemsError });

    const totalAmount = computeTotal(travelItems, conveyanceItems, otherItems);
    const projectResult = normalizeProjects(parseMaybeJSON(req.body.projects), totalAmount);
    if (projectResult.error) return res.status(400).json({ error: projectResult.error });

    // The legacy single project *link* (used by project costing roll-ups)
    // only ever takes hold once the feature flag is on — a projectId in the
    // request is silently dropped while it's off.
    const flags = await getFeatureFlags();
    const resolvedProjectId = flags.projectCosting && projectId ? projectId : null;

    const profileSnap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(req.user.userId).get();
    const designation = profileSnap.exists ? profileSnap.data().designation || null : null;
    const department = profileSnap.exists ? profileSnap.data().department || null : null;

    const docId = uuid();
    const bills = [];
    for (const [i, file] of files.entries()) {
      const fileId = `reimbursement-bills/${docId}-${i}-${safeFileName(file.originalname)}`;
      await uploadBuffer(fileId, file.buffer, file.mimetype);
      bills.push({ fileId, name: file.originalname, link: `/api/reimbursements/${docId}/bills/${i}` });
    }

    const doc = {
      userId: req.user.userId,
      name: req.user.name,
      designation,
      department,
      voucherDate,
      paidTo,
      type,
      projectId: resolvedProjectId,
      projects: projectResult.projects,
      journeyPurpose: journeyPurpose || null,
      journeyStation: journeyStation || null,
      travelItems,
      conveyanceItems,
      otherItems,
      // The advance wallet fills these in on final approval; until then the
      // whole voucher is what would be payable.
      advanceTaken: 0,
      advanceOffsets: [],
      totalAmount,
      balance: totalAmount,
      payableAmount: totalAmount,
      amountInWords: numberToWords(totalAmount),
      bills,
      billFileId: bills[0]?.fileId || null,
      billLink: bills[0]?.link || null,
      status: REIMBURSEMENT_STATUS.PENDING,
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      appliedBy: req.user.userId,
    };
    await col().doc(docId).set(doc);
    res.status(201).json({ id: docId, ...doc });
  } catch (err) {
    next(err);
  }
});

async function canViewRecord(user, record) {
  return isAdminRole(user.role) || record.userId === user.userId;
}

router.get("/:id/bills/:index", authenticate, async (req, res, next) => {
  try {
    const snap = await col().doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    const record = snap.data();
    if (!(await canViewRecord(req.user, record))) return res.status(403).json({ error: "Forbidden" });
    const bill = (record.bills || [])[Number(req.params.index)];
    if (!bill) return res.status(404).json({ error: "Not found" });
    await streamFile(res, bill.fileId);
  } catch (err) {
    next(err);
  }
});

// Legacy single-bill route (claims filed before multi-bill upload).
router.get("/:id/bill", authenticate, async (req, res, next) => {
  try {
    const snap = await col().doc(req.params.id).get();
    if (!snap.exists || !snap.data().billFileId) return res.status(404).json({ error: "Not found" });
    const record = snap.data();
    if (!(await canViewRecord(req.user, record))) return res.status(403).json({ error: "Forbidden" });
    await streamFile(res, record.billFileId);
  } catch (err) {
    next(err);
  }
});

router.get("/:id/pdf", authenticate, async (req, res, next) => {
  try {
    const snap = await col().doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    const record = { id: snap.id, ...snap.data() };
    if (!(await canViewRecord(req.user, record))) return res.status(403).json({ error: "Forbidden" });
    const pdfBuffer = await renderReimbursementPdf([record]);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Reimbursement_Claim_${record.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

async function loadOr404(id, res) {
  const ref = col().doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return { ref, data: snap.data() };
}

// Step 1 of 2 — the employee's own department admin.
router.put("/:id/dept-approve", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const found = await loadOr404(req.params.id, res);
    if (!found) return;
    if (found.data.status !== REIMBURSEMENT_STATUS.PENDING) {
      return res.status(400).json({ error: "Only PENDING vouchers await department approval" });
    }
    if (!(await canDeptApprove(req.user, found.data))) {
      return res.status(403).json({ error: "Only an admin of this employee's department can give the first approval" });
    }
    await found.ref.update({
      status: REIMBURSEMENT_STATUS.DEPT_APPROVED,
      deptApprovedBy: req.user.userId,
      deptApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
      deptComment: req.body.comment || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Step 2 of 2 — superadmin. This is where the employee's advance wallet is
// drawn down: the voucher first eats into any unspent advance, and only the
// remainder (if any) stays payable. Fully covered => SETTLED, no payout.
router.put("/:id/final-approve", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const found = await loadOr404(req.params.id, res);
    if (!found) return;
    if (!canFinalApprove(req.user, found.data)) {
      return res.status(403).json({ error: "Only the superadmin (and not on their own voucher) can give final approval" });
    }

    let outcome;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(found.ref);
      const voucher = snap.data();
      if (voucher.status !== REIMBURSEMENT_STATUS.DEPT_APPROVED) {
        throw Object.assign(new Error("Only department-approved vouchers can be finally approved"), { status: 400 });
      }
      const wallet = await planWalletOffset(tx, voucher.userId, voucher.totalAmount);
      const payable = round2(voucher.totalAmount - wallet.total);
      const settled = payable <= 0;
      wallet.apply();
      tx.update(found.ref, {
        status: settled ? REIMBURSEMENT_STATUS.SETTLED : REIMBURSEMENT_STATUS.APPROVED,
        advanceTaken: wallet.total,
        advanceOffsets: wallet.offsets,
        balance: payable,
        payableAmount: payable,
        finalApprovedBy: req.user.userId,
        finalApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
        comment: req.body.comment || null,
      });
      outcome = { advanceApplied: wallet.total, payableAmount: payable, settled };
    });
    res.json({ ok: true, ...outcome });
  } catch (err) {
    next(err);
  }
});

// Reject: department admin at the first stage, superadmin at the second.
router.put("/:id/reject", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const found = await loadOr404(req.params.id, res);
    if (!found) return;
    const { status } = found.data;
    const allowed =
      (status === REIMBURSEMENT_STATUS.PENDING && (await canDeptApprove(req.user, found.data))) ||
      (status === REIMBURSEMENT_STATUS.DEPT_APPROVED && canFinalApprove(req.user, found.data));
    if (!allowed) return res.status(403).json({ error: "You can't reject this voucher at its current stage" });
    await found.ref.update({
      status: REIMBURSEMENT_STATUS.REJECTED,
      decidedBy: req.user.userId,
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      comment: req.body.comment || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Only for the part the advance wallet didn't cover. While an employee still
// holds unspent advance, vouchers are absorbed by the wallet at final
// approval, so there is nothing to pay — payableAmount stays 0 and this is
// refused.
router.put("/:id/mark-paid", authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== ROLES.SUPERADMIN) return res.status(403).json({ error: "Only the superadmin can mark a voucher paid" });
    const { paymentRef, paymentDate } = req.body;
    if (!paymentRef || !paymentDate) return res.status(400).json({ error: "paymentRef and paymentDate are required" });

    const found = await loadOr404(req.params.id, res);
    if (!found) return;
    if (found.data.status !== REIMBURSEMENT_STATUS.APPROVED) {
      return res.status(400).json({ error: "Only finally APPROVED vouchers can be marked paid" });
    }
    const payable = Number(found.data.payableAmount ?? found.data.totalAmount);
    if (!(payable > 0)) {
      return res.status(400).json({ error: "Nothing to pay — this voucher was covered by the employee's advance" });
    }
    await found.ref.update({
      status: REIMBURSEMENT_STATUS.PAID,
      paidAmount: payable,
      paymentRef,
      paymentDate,
      paidBy: req.user.userId,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, paidAmount: payable });
  } catch (err) {
    next(err);
  }
});

// Cancel while still awaiting approval, or after final approval as long as
// nothing was paid — a cancelled voucher hands its advance offset back to
// the wallet. Admin-side only (employees don't cancel vouchers).
router.put("/:id/cancel", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const found = await loadOr404(req.params.id, res);
    if (!found) return;
    if (!(await canAdminCancel(req.user, found.data))) {
      return res.status(403).json({ error: "Only an admin of this employee's department (or the superadmin) can cancel this voucher" });
    }
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(found.ref);
      const voucher = snap.data();
      if (![REIMBURSEMENT_STATUS.PENDING, REIMBURSEMENT_STATUS.DEPT_APPROVED, REIMBURSEMENT_STATUS.APPROVED].includes(voucher.status)) {
        throw Object.assign(new Error("Only vouchers not yet paid or settled can be cancelled"), { status: 400 });
      }
      const offsets = voucher.advanceOffsets || [];
      const applyRestore = offsets.length ? await restoreWalletOffsets(tx, offsets) : null;
      if (applyRestore) applyRestore();
      tx.update(found.ref, {
        status: REIMBURSEMENT_STATUS.CANCELLED,
        cancelledBy: req.user.userId,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
