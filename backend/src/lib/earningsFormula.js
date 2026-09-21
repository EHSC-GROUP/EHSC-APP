import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";
import { round2 } from "./dateUtils.js";

// Basic is a percent of Gross. HRA, Transportation Allowance, Special
// Allowance and Medical Allowance are each a percent of BASIC. Whatever of
// gross is left over (zero with the defaults: 50% basic + 100% of basic
// spread across the four = 100% of gross) lands in `others`, so the
// components always add back up to gross.
export const DEFAULT_FORMULA = Object.freeze({
  basicPercent: 50,
  hraPercent: 40,
  transportPercent: 20,
  specialPercent: 20,
  bonusPercent: 20,
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
  const basic = round2((g * formula.basicPercent) / 100);
  const pctOfBasic = (p) => round2((basic * Number(p)) / 100);
  const hra = pctOfBasic(formula.hraPercent);
  const transport = pctOfBasic(formula.transportPercent);
  const special = pctOfBasic(formula.specialPercent);
  const bonus = pctOfBasic(formula.bonusPercent);
  const others = round2(g - basic - hra - transport - special - bonus);
  return { basic, hra, transport, special, bonus, others };
}

// Every percent must be a non-negative number, and the components must not
// add up to more than 100% of gross:
// basic% + basic% * (hra% + transport% + special% + bonus%) / 100 <= 100.
export function validateFormula(formula) {
  for (const key of FORMULA_KEYS) {
    const v = Number(formula[key]);
    if (!Number.isFinite(v) || v < 0) return `${key} must be a non-negative number`;
  }
  const bp = Number(formula.basicPercent);
  const ofBasic = Number(formula.hraPercent) + Number(formula.transportPercent) + Number(formula.specialPercent) + Number(formula.bonusPercent);
  if (bp + (bp * ofBasic) / 100 > 100 + 1e-9) {
    return "Basic + HRA + Transportation + Special + Medical Allowance exceed 100% of gross";
  }
  return null;
}

export function pickFormulaFields(body) {
  const out = {};
  for (const key of FORMULA_KEYS) out[key] = Number(body[key] ?? DEFAULT_FORMULA[key]);
  return out;
}
