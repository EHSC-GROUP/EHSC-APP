import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";
import { round2 } from "./dateUtils.js";

// Basic, HRA, Special Allowances and Transportation Allowance are each a
// percent of GROSS directly (not of Basic). Whatever of gross is left over
// lands in `others` ("Statutory Bonus-Others" on payslips/exports), so the
// components always add back up to gross. Defaults match EHSC's real slip
// format: 50 / 25 / 12.5 / 2.5, leaving 10% as Statutory Bonus-Others.
export const DEFAULT_FORMULA = Object.freeze({
  basicPercent: 50,
  hraPercent: 25,
  specialPercent: 12.5,
  transportPercent: 2.5,
});

const FORMULA_KEYS = Object.keys(DEFAULT_FORMULA);

export async function getEarningsFormula() {
  const snap = await db.collection(COLLECTIONS.HR_SETTINGS).doc("earnings_formula").get();
  const data = snap.exists ? snap.data() : {};
  const formula = {};
  for (const key of FORMULA_KEYS) formula[key] = Number(data[key] ?? DEFAULT_FORMULA[key]);
  return formula;
}

export function computeEarnings(gross, formula) {
  const g = Number(gross);
  const pctOfGross = (p) => round2((g * Number(p)) / 100);
  const basic = pctOfGross(formula.basicPercent);
  const hra = pctOfGross(formula.hraPercent);
  const special = pctOfGross(formula.specialPercent);
  const transport = pctOfGross(formula.transportPercent);
  const others = round2(g - basic - hra - special - transport);
  return { basic, hra, transport, special, others };
}

// Every percent must be a non-negative number, and they must not add up to
// more than 100% of gross (whatever's left is Statutory Bonus-Others).
export function validateFormula(formula) {
  for (const key of FORMULA_KEYS) {
    const v = Number(formula[key]);
    if (!Number.isFinite(v) || v < 0) return `${key} must be a non-negative number`;
  }
  const sum = FORMULA_KEYS.reduce((s, key) => s + Number(formula[key]), 0);
  if (sum > 100 + 1e-9) {
    return "Basic + HRA + Special Allowances + Transportation Allowance exceed 100% of gross";
  }
  return null;
}

export function pickFormulaFields(body) {
  const out = {};
  for (const key of FORMULA_KEYS) out[key] = Number(body[key] ?? DEFAULT_FORMULA[key]);
  return out;
}
