import { v4 as uuid } from "uuid";

import { db } from "../config/firebase.js";
import { COLLECTIONS, PROJECT_TYPES } from "./constants.js";

// Starter/placeholder task list — every project type ships with this same
// generic set until an admin customizes it per type in Settings. Kept
// intentionally generic rather than guessing at real per-type methodology.
// Each task's `stage` (1-4, optional) groups it under one of the 4 invoice
// stages — completing every task tagged with a stage auto-marks that
// invoice stage complete (see routes/projects.js plan-actions PUT). Tasks
// keep real descriptive names; `stage` is just an internal grouping tag,
// never the task's own name.
export const DEFAULT_TEMPLATE_TASKS = Object.freeze([
  { description: "Kickoff meeting with client", dayOffset: 3, stage: 1 },
  { description: "Data collection / site assessment", dayOffset: 7, stage: 1 },
  { description: "Draft deliverable preparation", dayOffset: 14, stage: 2 },
  { description: "Internal quality review", dayOffset: 18, stage: 2 },
  { description: "Client review and feedback", dayOffset: 24, stage: 3 },
  { description: "Revisions based on feedback", dayOffset: 27, stage: 3 },
  { description: "Final submission", dayOffset: 30, stage: 4 },
  { description: "Project closeout", dayOffset: 32, stage: 4 },
]);

function templatesRef() {
  return db.collection(COLLECTIONS.HR_SETTINGS).doc("project_plan_templates");
}

// Returns { [projectType]: [{description, dayOffset}, ...] } for every
// known project type — stored overrides merged over the shared default, so
// a type an admin hasn't touched yet still resolves to something usable.
export async function getProjectPlanTemplates() {
  const snap = await templatesRef().get();
  const stored = snap.exists ? snap.data() : {};
  const out = {};
  for (const type of PROJECT_TYPES) {
    out[type] = Array.isArray(stored[type]) && stored[type].length > 0 ? stored[type] : DEFAULT_TEMPLATE_TASKS;
  }
  return out;
}

export async function getProjectPlanTemplate(projectType) {
  if (!PROJECT_TYPES.includes(projectType)) return null;
  const templates = await getProjectPlanTemplates();
  return templates[projectType];
}

export { templatesRef };

// Turns a template's {description, dayOffset} rows into real plan-action
// objects, dated relative to `baseDateISO` (the date the contract was
// accepted) — same shape POST /:id/plan-actions writes by hand.
export function buildPlanActionsFromTemplate(tasks, { userId, userName, baseDateISO }) {
  const base = new Date(baseDateISO);
  return tasks.map((t) => {
    const due = new Date(base);
    due.setDate(due.getDate() + Number(t.dayOffset || 0));
    return {
      id: uuid(),
      description: t.description,
      stage: [1, 2, 3, 4].includes(Number(t.stage)) ? Number(t.stage) : null,
      assignedTo: userId,
      assignedToName: userName || userId,
      startDate: baseDateISO,
      dueDate: due.toISOString().slice(0, 10),
      completed: false,
      completedAt: null,
      dependsOn: [],
      addedAt: new Date().toISOString(),
      addedBy: userId,
    };
  });
}
