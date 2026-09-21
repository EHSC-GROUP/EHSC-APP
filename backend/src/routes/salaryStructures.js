import { Router } from "express";

import { db } from "../config/firebase.js";
import { COLLECTIONS, STAFF_PROFILE_TYPES } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { getEarningsFormula, computeEarnings, validateFormula } from "../lib/earningsFormula.js";
import { getSalaryStructureDoc, pickCurrentVersion } from "../lib/salaryStructures.js";
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


async function assertEmployeeType(userId) {
  const snap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(userId).get();
  if (!snap.exists) return "Employee profile not found";
  if (!STAFF_PROFILE_TYPES.includes(snap.data().type)) return "Salary structures are not applicable to associate profiles";
  return null;
}

// The snapshot of formula percents stored on each version, so a version
// keeps meaning what it meant when it was created even if the global
// formula is edited later.
function formulaSnapshot(formula) {
  return {
    basicPercentUsed: formula.basicPercent,
    hraPercentUsed: formula.hraPercent,
    transportPercentUsed: formula.transportPercent,
    specialPercentUsed: formula.specialPercent,
    bonusPercentUsed: formula.bonusPercent,
  };
}

// Preview-only: compute the earnings split for a given gross without
// saving, used by the "+ New Version" form's live preview.
router.get("/formula/preview", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const gross = Number(req.query.gross) || 0;
    const formula = await getEarningsFormula();
    res.json(computeEarnings(gross, formula));
  } catch (err) {
    next(err);
  }
});

// Irreversible bulk correction: recompute every earnings component (and
// the snapshotted formula %) for every version of every employee's salary
// structure using the CURRENT global formula. Already-generated payslips
// are untouched — each snapshots its own numbers.
router.post("/reset-all", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const formula = await getEarningsFormula();
    const formulaError = validateFormula(formula);
    if (formulaError) return res.status(400).json({ error: `Global earnings formula is invalid: ${formulaError}` });

    const snap = await db.collection(COLLECTIONS.HR_SALARY_STRUCTURES).get();
    let updated = 0;
    let batch = db.batch();
    let opsInBatch = 0;

    for (const doc of snap.docs) {
      const versions = doc.data().versions || [];
      const newVersions = versions.map((v) => ({
        ...v,
        ...computeEarnings(v.gross, formula),
        ...formulaSnapshot(formula),
      }));
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

    // pt and medicalAllowance are flat deduction amounts entered directly
    // (not percentages).
    const { effectiveFrom, gross, pt, medicalAllowance, components } = req.body;
    if (!effectiveFrom || !(Number(gross) > 0)) {
      return res.status(400).json({ error: "effectiveFrom and a positive gross are required" });
    }

    const formula = await getEarningsFormula();
    const formulaError = validateFormula(formula);
    if (formulaError) return res.status(400).json({ error: `Global earnings formula is invalid: ${formulaError}` });

    let earnings = computeEarnings(gross, formula);
    // The form auto-fills these from the formula but lets the admin adjust
    // them. When supplied, "Others" is whatever remains of gross, so the
    // components always add back up to it.
    if (components) {
      const keys = ["basic", "hra", "transport", "special", "bonus"];
      const supplied = {};
      for (const k of keys) {
        const v = Number(components[k]);
        if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `${k} must be a non-negative number` });
        supplied[k] = Math.round(v * 100) / 100;
      }
      const others = Math.round((Number(gross) - keys.reduce((s, k) => s + supplied[k], 0)) * 100) / 100;
      if (others < -0.005) return res.status(400).json({ error: "Basic + HRA + Transportation + Special + Medical Allowance can't exceed the gross" });
      earnings = { ...supplied, others: Math.max(0, others) };
    }

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
        ...earnings,
        ...formulaSnapshot(formula),
        pt: Number(pt) || 0,
        medicalAllowance: Number(medicalAllowance) || 0,
        addedBy: req.user.userId,
        addedAt: new Date().toISOString(),
      };
      tx.set(ref, { userId, versions: [...versions, newVersion] }, { merge: true });
    });

    res.status(201).json(earnings);
  } catch (err) {
    next(err);
  }
});

export default router;
