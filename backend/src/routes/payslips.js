import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ROLES, PAYSLIP_STATUS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { computeGeneratedPayslip, applyPayslipEdit } from "../lib/payslipCompute.js";
import { renderPayslipPdf, renderConsolidatedPayslipPdf } from "../lib/payslipPdf.js";
import { buildPayrollRegisterWorkbook } from "../lib/payrollExcel.js";
import { uploadBuffer, streamFile } from "../lib/storage.js";

const router = Router();

function payslipDocId(userId, period) {
  return `${userId}_${period}`;
}

function pdfStoragePath(userId, period) {
  return `payslips/${userId}/${period}.pdf`;
}

// hr_employee_profiles never stores `name` (it lives on the `users` doc) —
// join it in here since computeGeneratedPayslip/payslip PDFs need it.
async function attachNames(profiles) {
  if (!profiles.length) return profiles;
  const userRefs = profiles.map((p) => db.collection(COLLECTIONS.USERS).doc(p.userId));
  const userSnaps = await db.getAll(...userRefs);
  return profiles.map((p, i) => ({ ...p, name: userSnaps[i].data()?.name || p.userId }));
}

async function getActiveEmployeeProfiles(userIds) {
  let profiles;
  if (userIds && userIds.length) {
    const refs = userIds.map((id) => db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(id.toUpperCase()));
    const snaps = await db.getAll(...refs);
    profiles = snaps.filter((s) => s.exists).map((s) => ({ userId: s.id, ...s.data() }));
  } else {
    const snap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "==", "employee").get();
    profiles = snap.docs.map((d) => ({ userId: d.id, ...d.data() }));
  }
  return attachNames(profiles);
}

// ---- list by period (admin) ---------------------------------------------
router.get("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const period = req.query.period;
    if (!period) return res.status(400).json({ error: "period (YYYY-MM) is required" });

    const [profiles, payslipsSnap] = await Promise.all([
      db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "==", "employee").get(),
      db.collection(COLLECTIONS.HR_PAYSLIPS).where("period", "==", period).get(),
    ]);
    const payslipsByUser = new Map(payslipsSnap.docs.map((d) => [d.data().userId, { id: d.id, ...d.data() }]));

    const list = profiles.docs.map((d) => {
      const existing = payslipsByUser.get(d.id);
      if (existing) return existing;
      return {
        userId: d.id,
        period,
        name: null,
        status: "NOT_GENERATED",
      };
    });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// ---- generate (bulk or by userIds) ---------------------------------------
router.post("/generate", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { period, userIds } = req.body;
    if (!period) return res.status(400).json({ error: "period (YYYY-MM) is required" });

    const profiles = await getActiveEmployeeProfiles(userIds);
    const generated = [];
    const skipped = [];

    for (const profile of profiles) {
      const docId = payslipDocId(profile.userId, period);
      const ref = db.collection(COLLECTIONS.HR_PAYSLIPS).doc(docId);
      const existingSnap = await ref.get();
      const existing = existingSnap.exists ? existingSnap.data() : null;

      if (existing && [PAYSLIP_STATUS.FINALIZED, PAYSLIP_STATUS.PUBLISHED].includes(existing.status)) {
        skipped.push({ userId: profile.userId, reason: `Already ${existing.status.toLowerCase()}` });
        continue;
      }

      const result = await computeGeneratedPayslip(profile.userId, profile, period, existing);
      if (result.skipped) {
        skipped.push({ userId: profile.userId, reason: result.reason });
        continue;
      }

      const payload = {
        ...result,
        status: PAYSLIP_STATUS.DRAFT,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        generatedBy: req.user.userId,
      };
      delete payload.skipped;
      await ref.set(payload, { merge: false });
      generated.push(profile.userId);
    }

    res.json({ generated, skipped });
  } catch (err) {
    next(err);
  }
});

// ---- edit (DRAFT only) ----------------------------------------------------
router.put("/:userId/:period", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.userId.toUpperCase();
    const { period } = req.params;
    const ref = db.collection(COLLECTIONS.HR_PAYSLIPS).doc(payslipDocId(userId, period));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Payslip not found. Generate it first." });
    const existing = { userId, period, ...snap.data() };
    if (existing.status !== PAYSLIP_STATUS.DRAFT) {
      return res.status(400).json({ error: "Only DRAFT payslips can be edited. Un-finalize it first." });
    }

    const updated = await applyPayslipEdit(existing, req.body);
    await ref.update({
      ...updated,
      editedAt: admin.firestore.FieldValue.serverTimestamp(),
      editedBy: req.user.userId,
    });
    res.json({ ok: true, payslip: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/:userId/:period/finalize", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.userId.toUpperCase();
    const { period } = req.params;
    const ref = db.collection(COLLECTIONS.HR_PAYSLIPS).doc(payslipDocId(userId, period));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Payslip not found" });
    if (snap.data().status !== PAYSLIP_STATUS.DRAFT) {
      return res.status(400).json({ error: "Only DRAFT payslips can be finalized" });
    }

    const payslip = { userId, period, ...snap.data() };
    const pdfBuffer = await renderPayslipPdf(payslip);
    const path = pdfStoragePath(userId, period);
    await uploadBuffer(path, pdfBuffer, "application/pdf");

    await ref.update({
      status: PAYSLIP_STATUS.FINALIZED,
      pdfUrl: `/api/payslips/${userId}/${period}/pdf`,
      finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
      finalizedBy: req.user.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Reverts FINALIZED -> DRAFT so numbers can be edited again. An explicit
// step (not silent re-editing of finalized numbers, which the reference
// app allowed and which this rebuild treats as a bug).
router.post("/:userId/:period/unfinalize", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.userId.toUpperCase();
    const { period } = req.params;
    const ref = db.collection(COLLECTIONS.HR_PAYSLIPS).doc(payslipDocId(userId, period));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Payslip not found" });
    if (snap.data().status !== PAYSLIP_STATUS.FINALIZED) {
      return res.status(400).json({ error: "Only FINALIZED payslips can be un-finalized" });
    }
    await ref.update({
      status: PAYSLIP_STATUS.DRAFT,
      pdfUrl: admin.firestore.FieldValue.delete(),
      finalizedAt: admin.firestore.FieldValue.delete(),
      finalizedBy: admin.firestore.FieldValue.delete(),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/:userId/:period/publish", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.userId.toUpperCase();
    const { period } = req.params;
    const ref = db.collection(COLLECTIONS.HR_PAYSLIPS).doc(payslipDocId(userId, period));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Payslip not found" });
    if (snap.data().status !== PAYSLIP_STATUS.FINALIZED) {
      return res.status(400).json({ error: "Only FINALIZED payslips can be published" });
    }
    await ref.update({
      status: PAYSLIP_STATUS.PUBLISHED,
      publishedAt: admin.firestore.FieldValue.serverTimestamp(),
      publishedBy: req.user.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/:userId/:period/unpublish", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.userId.toUpperCase();
    const { period } = req.params;
    const ref = db.collection(COLLECTIONS.HR_PAYSLIPS).doc(payslipDocId(userId, period));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Payslip not found" });
    if (snap.data().status !== PAYSLIP_STATUS.PUBLISHED) {
      return res.status(400).json({ error: "Only PUBLISHED payslips can be unpublished" });
    }
    await ref.update({
      status: PAYSLIP_STATUS.FINALIZED,
      publishedAt: admin.firestore.FieldValue.delete(),
      publishedBy: admin.firestore.FieldValue.delete(),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:userId/:period", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.userId.toUpperCase();
    const { period } = req.params;
    await db.collection(COLLECTIONS.HR_PAYSLIPS).doc(payslipDocId(userId, period)).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/:userId/:period/pdf", authenticate, async (req, res, next) => {
  try {
    const userId = req.params.userId.toUpperCase();
    const { period } = req.params;
    const isAdmin = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(req.user.role);
    const isSelf = req.user.userId === userId;
    if (!isAdmin && !isSelf) return res.status(403).json({ error: "Forbidden" });

    const snap = await db.collection(COLLECTIONS.HR_PAYSLIPS).doc(payslipDocId(userId, period)).get();
    if (!snap.exists) return res.status(404).json({ error: "Payslip not found" });
    const payslip = snap.data();
    if (isSelf && !isAdmin && payslip.status !== PAYSLIP_STATUS.PUBLISHED) {
      return res.status(403).json({ error: "This payslip has not been published yet" });
    }
    if (!payslip.pdfUrl) return res.status(404).json({ error: "PDF not generated yet" });

    await streamFile(res, pdfStoragePath(userId, period), { filename: `Payslip_${userId}_${period}.pdf` });
  } catch (err) {
    next(err);
  }
});

// ---- Excel payroll register export ---------------------------------------
router.get("/excel/export", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const period = req.query.period;
    if (!period) return res.status(400).json({ error: "period (YYYY-MM) is required" });

    const snap = await db.collection(COLLECTIONS.HR_PAYSLIPS).where("period", "==", period).get();
    const rows = snap.docs.map((d) => d.data());
    const workbook = await buildPayrollRegisterWorkbook(period, rows);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Payroll_Register_${period}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// ---- consolidated multi-month PDF for one employee -----------------------
router.get("/:userId/consolidated", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.userId.toUpperCase();
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: "from and to (YYYY-MM) are required" });

    const snap = await db
      .collection(COLLECTIONS.HR_PAYSLIPS)
      .where("userId", "==", userId)
      .where("period", ">=", from)
      .where("period", "<=", to)
      .get();
    const payslips = snap.docs.map((d) => d.data()).sort((a, b) => (a.period < b.period ? -1 : 1));
    if (!payslips.length) return res.status(404).json({ error: "No payslips found in this range" });

    const pdfBuffer = await renderConsolidatedPayslipPdf(payslips);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Payslips_${userId}_${from}_to_${to}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

export default router;
