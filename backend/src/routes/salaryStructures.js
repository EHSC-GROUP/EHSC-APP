import { Router } from "express";

import { db } from "../config/firebase.js";
import { COLLECTIONS } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { getEarningsFormula, computeEarnings, validateFormula } from "../lib/earningsFormula.js";
import { getSalaryStructureDoc, pickCurrentVersion } from "../lib/salaryStructures.js";

const router = Router();

async function assertEmployeeType(userId) {
  const snap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(userId).get();
  if (!snap.exists) return "Employee profile not found";
  if (snap.data().type !== "employee") return "Salary structures are not applicable to external/vendor profiles";
  return null;
}

// Preview-only: compute basic/hra/others for a given gross without saving,
// used by the "+ New Version" form's live preview.
router.get("/formula/preview", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const gross = Number(req.query.gross) || 0;
    const formula = await getEarningsFormula();
    res.json(computeEarnings(gross, formula.basicPercent, formula.hraPercent));
  } catch (err) {
    next(err);
  }
});

// Irreversible bulk correction: recompute basic/hra/others (and the
// snapshotted formula %) for every version of every employee's salary
// structure using the CURRENT global formula. Already-generated payslips
// are untouched — each snapshots its own numbers.
router.post("/reset-all", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const formula = await getEarningsFormula();
    const formulaError = validateFormula(formula.basicPercent, formula.hraPercent);
    if (formulaError) return res.status(400).json({ error: `Global earnings formula is invalid: ${formulaError}` });

    const snap = await db.collection(COLLECTIONS.HR_SALARY_STRUCTURES).get();
    let updated = 0;
    let batch = db.batch();
    let opsInBatch = 0;

    for (const doc of snap.docs) {
      const versions = doc.data().versions || [];
      const newVersions = versions.map((v) => {
        const { basic, hra, others } = computeEarnings(v.gross, formula.basicPercent, formula.hraPercent);
        return { ...v, basic, hra, others, basicPercentUsed: formula.basicPercent, hraPercentUsed: formula.hraPercent };
      });
      batch.update(doc.ref, { versions: newVersions });
      updated++;
      opsInBatch++;
      if (opsInBatch >= 450) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    }
    if (opsInBatch > 0) await batch.commit();

    res.json({ ok: true, employeesUpdated: updated });
  } catch (err) {
    next(err);
  }
});

router.get("/:userId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const doc = await getSalaryStructureDoc(req.params.userId.toUpperCase());
    const versions = doc?.versions || [];
    res.json({
      versions: [...versions].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1)),
      current: pickCurrentVersion(versions),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:userId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.userId.toUpperCase();
    const typeError = await assertEmployeeType(userId);
    if (typeError) return res.status(400).json({ error: typeError });

    const { effectiveFrom, gross, pt, esiApplicable, esiPercent, pfApplicable, pfPercent } = req.body;
    if (!effectiveFrom || !(Number(gross) > 0)) {
      return res.status(400).json({ error: "effectiveFrom and a positive gross are required" });
    }

    const formula = await getEarningsFormula();
    const formulaError = validateFormula(formula.basicPercent, formula.hraPercent);
    if (formulaError) return res.status(400).json({ error: `Global earnings formula is invalid: ${formulaError}` });

    const { basic, hra, others } = computeEarnings(gross, formula.basicPercent, formula.hraPercent);

    const ref = db.collection(COLLECTIONS.HR_SALARY_STRUCTURES).doc(userId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const versions = snap.exists ? snap.data().versions || [] : [];
      if (versions.some((v) => v.effectiveFrom === effectiveFrom)) {
        throw Object.assign(new Error(`A version already exists effective ${effectiveFrom}`), { status: 400 });
      }
      const newVersion = {
        effectiveFrom,
        gross: Number(gross),
        basic,
        hra,
        others,
        basicPercentUsed: formula.basicPercent,
        hraPercentUsed: formula.hraPercent,
        pt: Number(pt) || 0,
        esiApplicable: !!esiApplicable,
        esiPercent: Number(esiPercent) || 0,
        pfApplicable: !!pfApplicable,
        pfPercent: Number(pfPercent) || 0,
        addedBy: req.user.userId,
        addedAt: new Date().toISOString(),
      };
      tx.set(ref, { userId, versions: [...versions, newVersion] }, { merge: true });
    });

    res.status(201).json({ basic, hra, others });
  } catch (err) {
    next(err);
  }
});

export default router;
