import { admin } from "../config/firebase.js";
import { INVOICE_STAGE_COUNT } from "./constants.js";

// Empty defaults for the extended workflow phases every Project carries:
// Phase II (turning the enquiry into a work order), Phase III (executing
// that work order), Phase III(b) (the project plan action list) and
// Phase IV (delivery/invoice). Shared so every creation path (auto-created
// alongside a new enquiry, or a second project added under an existing
// company) starts from the same shape.
export function emptyPhase2() {
  return {
    proposalNo: "",
    proposalDate: null,
    modeOfSubmission: "",
    submittedTo: "",
    submittedBy: "",
    nextFollowUpDueOn: null,
    nextFollowUpDate: null,
    conversations: [],
    clientReplies: [],
    respondedInFavour: false,
    finalProposalAfterNegotiation: "",
    workOrderDate: null,
    workOrderNumber: "",
  };
}

export function emptyPhase3() {
  return {
    workOrderDate: null,
    workOrderNumber: "",
    workOrderDescription: "",
    deliveryConditions: "",
    paymentTerms: "",
  };
}

// Phase III(b) — Project Plan: just a numbered action list (who's doing
// what, by when) for executing the work order. Same shape as the Business
// Development action log, managed by its own add/edit/delete endpoints —
// `actions` is never touched by the general PUT /:id update.
export function emptyPhase3b() {
  return { actions: [] };
}

// Phase IV — Project Completion: the template only names two checkpoints
// (Delivery Report, Invoice) with no sub-fields of its own, so these are a
// reasonable elaboration of what each actually needs to track.
export function emptyPhase4() {
  return {
    deliveryReportSubmitted: false,
    deliveryReportDate: null,
    deliveryReportNotes: "",
    invoiceNumber: "",
    invoiceDate: null,
    invoiceAmount: null,
    paymentReceived: false,
    paymentReceivedDate: null,
  };
}

// Contract value + invoice-stage defaults, shared by both project-creation
// paths (see below) so a project is never missing these fields regardless
// of how it was created.
export function emptyInvoiceStages() {
  const out = {};
  for (let n = 1; n <= INVOICE_STAGE_COUNT; n++) {
    out[`invoiceStage${n}Name`] = "";
    out[`invoiceStage${n}Percent`] = null;
    out[`invoiceStage${n}Completed`] = false;
    out[`invoiceStage${n}CompletedAt`] = null;
  }
  return out;
}

// A Project created alongside (or added under an existing company for) an
// enquiry: `clientName` is denormalized from the company at creation time
// (so the Project Tracker and lists don't need an extra join per row) —
// a one-time copy, not a live sync. `projectType`/`projectSubType` are the
// same one-time copy from the enquiry, when it came from one.
export function newProjectDoc({ projectId, companyId, branchId, companyCode, clientName, sourceEnquiryId, sourceEnquiryNo, userId, projectCategory, service, projectType, region, starting = {} }) {
  return {
    projectId,
    companyId,
    branchId,
    companyCode,
    clientName,
    projectCategory: projectCategory || null,
    service: service || null,
    projectType: projectType || null,
    region: region || "",
    // Who runs it and who works on it (picked from the people list)
    teamLeadId: "",
    teamLeadName: "",
    teamMembers: [],
    status: starting.status || "Not Started",
    priority: starting.priority || "Medium",
    risk: starting.risk || "Low",
    startDate: null,
    paymentStatus: starting.paymentStatus || "Not Invoiced",
    invoicedAmount: null,
    receivedAmount: null,
    poNumber: "",
    poValue: null,
    deliveryDueDate: null,
    termsAndConditions: "",
    contractValue: null,
    ...emptyInvoiceStages(),
    sourceEnquiryId,
    sourceEnquiryNo,
    phase2: emptyPhase2(),
    phase3: emptyPhase3(),
    phase3b: emptyPhase3b(),
    phase4: emptyPhase4(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: userId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: userId,
  };
}
