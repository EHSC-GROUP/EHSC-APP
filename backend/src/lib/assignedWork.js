import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";

// Aggregates everything assigned to one employee across the two places
// action items live: a Project's Project Plan (phase3b.actions) and a BD
// Enquiry's follow-up log (actions). Both collections are small (one doc
// per project/enquiry), so a full scan + in-memory filter mirrors the
// existing `?assignedTo=` filter on GET /business-development rather than
// requiring a Firestore composite/array index.
export async function getAssignedWork(userId) {
  const target = userId.toUpperCase();

  const [projectsSnap, enquiriesSnap] = await Promise.all([
    db.collection(COLLECTIONS.PROJECTS).get(),
    db.collection(COLLECTIONS.BD_ENQUIRIES).get(),
  ]);

  const items = [];

  for (const doc of projectsSnap.docs) {
    const project = doc.data();
    for (const action of project.phase3b?.actions || []) {
      if (action.assignedTo !== target) continue;
      items.push({
        ...action,
        source: "project",
        sourceId: doc.id,
        sourceLabel: project.projectId,
        clientName: project.clientName,
        companyCode: project.companyCode,
      });
    }
  }

  for (const doc of enquiriesSnap.docs) {
    const enquiry = doc.data();
    for (const action of enquiry.actions || []) {
      if (action.assignedTo !== target) continue;
      items.push({
        ...action,
        source: "enquiry",
        sourceId: doc.id,
        sourceLabel: enquiry.enquiryNo,
        clientName: enquiry.clientName,
        companyCode: null,
      });
    }
  }

  items.sort((a, b) => {
    if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
    return (a.dueDate || "").localeCompare(b.dueDate || "");
  });

  return items;
}
