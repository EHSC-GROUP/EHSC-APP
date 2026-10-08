import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";

// How the client classifies work: Project Category -> Service -> Project Type.
//   Consultancy: service ESG Consultancy or ISO Consultancy; each has its own types.
//   Audit:       service Audit & Assessment.
//   Training:    no service; goes straight to its project types.
// `value` is what is stored, `label` is what people see, `code` is the short
// form used inside the Project ID.

const t = (value, label, code) => ({ value, label, code });

const ESG_CONSULTANCY_TYPES = [
  t("RESOURCE_CONSERVATION", "Resource Conservation Project", "RCP"),
  t("ECOVADIS", "EcoVadis", "ECOVADIS"),
  t("CBAM", "CBAM", "CBAM"),
  t("BRSR", "BRSR", "BRSR"),
  t("SUSTAINABILITY_REPORT", "Sustainability Report", "SR"),
];

// The ISO standards the company already works with (formerly the ISO sub-types).
const ISO_TYPES = [
  t("ISO9001", "ISO9001", "ISO9001"),
  t("ISO14001", "ISO14001", "ISO14001"),
  t("ISO45001", "ISO45001", "ISO45001"),
  t("ISO50001", "ISO50001", "ISO50001"),
];

const AUDIT_TYPES = [
  t("GHG", "GHG", "GHG"),
  t("ESG", "ESG", "ESG"),
  t("SUPPLY_CHAIN_ASSESSMENT", "Supply Chain Assessment", "SCA"),
];

const TRAINING_TYPES = [
  t("ESG", "ESG", "ESG"),
  t("HIRA", "HIRA", "HIRA"),
  t("AIA", "AIA", "AIA"),
];

const svc = (value, label, code, types) => ({ value, label, code, types });

export const PROJECT_CATEGORIES = Object.freeze([
  {
    value: "CONSULTANCY", label: "Consultancy", code: "CONS",
    services: [
      svc("ESG_CONSULTANCY", "ESG Consultancy", "ESG", ESG_CONSULTANCY_TYPES),
      svc("ISO_CONSULTANCY", "ISO Consultancy", "ISO", ISO_TYPES),
    ],
    types: [],
  },
  {
    value: "TRAINING", label: "Training", code: "TRG",
    services: [],
    types: TRAINING_TYPES,
  },
  {
    value: "AUDIT", label: "Audit", code: "AUD",
    services: [
      svc("AUDIT_ASSESSMENT", "Audit & Assessment", "AA", AUDIT_TYPES),
    ],
    types: [],
  },
]);


// Every distinct project type, once (a type can appear under several
// categories, e.g. ESG). Plan templates are kept per type.
export const ALL_PROJECT_TYPES = (() => {
  const seen = new Map();
  for (const c of PROJECT_CATEGORIES) {
    for (const ty of [...c.types, ...c.services.flatMap((s) => s.types)]) {
      if (!seen.has(ty.value)) seen.set(ty.value, { value: ty.value, label: ty.label, code: ty.code });
    }
  }
  return [...seen.values()];
})();

export const PROJECT_TYPE_VALUES = Object.freeze(ALL_PROJECT_TYPES.map((x) => x.value));

// Returns the matched {category, service, type} or an error string. A category
// with services needs a service; Training must not have one.
export function resolveClassification({ category, service, projectType }) {
  const cat = PROJECT_CATEGORIES.find((c) => c.value === category);
  if (!cat) return { error: `Project category must be one of: ${PROJECT_CATEGORIES.map((c) => c.label).join(", ")}` };

  let svcMatch = null;
  let types = cat.types;
  if (cat.services.length > 0) {
    svcMatch = cat.services.find((s) => s.value === service);
    if (!svcMatch) return { error: `Service is required for ${cat.label} (${cat.services.map((s) => s.label).join(" or ")})` };
    types = svcMatch.types;
  } else if (service) {
    return { error: `${cat.label} has no service — choose the project type directly` };
  }

  const typeMatch = types.find((x) => x.value === projectType);
  if (!typeMatch) return { error: "Choose a project type that belongs to the selected category and service" };
  return { cat, svc: svcMatch, type: typeMatch };
}

// Project IDs read CATEGORY/SERVICE/TYPE/YEAR/NUMBER, e.g. CONS/ESG/ECOVADIS/2026/001
// (Training has no service: TRG/HIRA/2026/001). The number starts at 001 for
// each category + service + type + year and counts up from there.
export async function nextProjectId({ category, service, projectType }) {
  const resolved = resolveClassification({ category, service, projectType });
  if (resolved.error) throw Object.assign(new Error(resolved.error), { status: 400 });

  const year = new Date().getFullYear();
  const parts = [resolved.cat.code, resolved.svc?.code, resolved.type.code, String(year)].filter(Boolean);
  const prefix = parts.join("/");

  const ref = db.collection(COLLECTIONS.HR_SETTINGS).doc(`project_id_${parts.join("_")}`);
  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? snap.data().seq : 0) + 1;
    tx.set(ref, { prefix, seq: next });
    return next;
  });
  return `${prefix}/${String(seq).padStart(3, "0")}`;
}
