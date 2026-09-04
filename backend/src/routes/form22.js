import { Router } from "express";

import { db } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { computeGeneratedPayslip } from "../lib/payslipCompute.js";
import { renderForm22Pdf } from "../lib/form22Pdf.js";

const router = Router();

// Direct download, no on-screen preview. Reuses payslip data where it
// already exists (so the export reconciles exactly with what was
// generated/finalized); falls back to a fresh on-the-fly computation
// otherwise, using the identical computeGeneratedPayslip logic.
router.get("/export", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { period } = req.query;
    const userIds = req.query.userIds ? req.query.userIds.split(",").map((s) => s.trim().toUpperCase()) : null;
    if (!period) return res.status(400).json({ error: "period (YYYY-MM) is required" });

    const profilesSnap = userIds
      ? await db.getAll(...userIds.map((id) => db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(id)))
      : (await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "==", "employee").get()).docs;

    const rawProfiles = profilesSnap.filter((s) => s.exists).map((s) => ({ userId: s.id, ...s.data() }));
    const userRefs = rawProfiles.map((p) => db.collection(COLLECTIONS.USERS).doc(p.userId));
    const userSnaps = userRefs.length ? await db.getAll(...userRefs) : [];
    const profiles = rawProfiles.map((p, i) => ({ ...p, name: userSnaps[i]?.data()?.name || p.userId }));

    const payslipRefs = profiles.map((p) =>
      db.collection(COLLECTIONS.HR_PAYSLIPS).doc(`${p.userId}_${period}`)
    );
    const payslipSnaps = payslipRefs.length ? await db.getAll(...payslipRefs) : [];

    const rows = [];
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const existingSnap = payslipSnaps[i];
      if (existingSnap?.exists) {
        rows.push(existingSnap.data());
        continue;
      }
      const computed = await computeGeneratedPayslip(profile.userId, profile, period, null);
      if (!computed.skipped) rows.push(computed);
    }

    if (!rows.length) return res.status(404).json({ error: "No employee data available for this period" });

    const pdfBuffer = await renderForm22Pdf(period, rows);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Form22_${period}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

export default router;
