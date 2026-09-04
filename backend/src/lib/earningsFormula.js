import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";
import { round2 } from "./dateUtils.js";

const DEFAULT_FORMULA = { basicPercent: 50, hraPercent: 20 };

export async function getEarningsFormula() {
  const snap = await db
    .collection(COLLECTIONS.HR_SETTINGS)
    .doc("earnings_formula")
    .get();
  if (!snap.exists) return { ...DEFAULT_FORMULA };
  const data = snap.data();
  return {
    basicPercent: Number(data.basicPercent ?? DEFAULT_FORMULA.basicPercent),
    hraPercent: Number(data.hraPercent ?? DEFAULT_FORMULA.hraPercent),
  };
}

// HRA is a percent of Basic, not of Gross (a percent of a percent).
// basic = gross * basicPercent/100
// hra   = basic * hraPercent/100
// others = gross - basic - hra
export function computeEarnings(gross, basicPercent, hraPercent) {
  const basic = round2((Number(gross) * Number(basicPercent)) / 100);
  const hra = round2((basic * Number(hraPercent)) / 100);
  const others = round2(Number(gross) - basic - hra);
  return { basic, hra, others };
}

// Reject formulas where Basic + (Basic% of Basic via HRA%) would exceed 100%
// of gross, i.e. basicPercent + (basicPercent * hraPercent / 100) > 100.
export function validateFormula(basicPercent, hraPercent) {
  const bp = Number(basicPercent);
  const hp = Number(hraPercent);
  if (!Number.isFinite(bp) || !Number.isFinite(hp) || bp < 0 || hp < 0) {
    return "basicPercent and hraPercent must be non-negative numbers";
  }
  if (bp + (bp * hp) / 100 > 100) {
    return "basicPercent + (basicPercent * hraPercent / 100) exceeds 100%";
  }
  return null;
}
