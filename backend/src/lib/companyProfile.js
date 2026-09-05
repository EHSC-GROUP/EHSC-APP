import { admin } from "../config/firebase.js";

// Empty defaults for the two extended workflow phases every Company
// Profile carries: Phase II (turning the enquiry into a work order) and
// Phase III (executing that work order). Shared so every creation path
// (auto-created alongside a new enquiry, backfilled for an older one, or
// created standalone) starts from the same shape.
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

// A Company Profile created alongside (or backfilled for) an enquiry:
// basic company/contact info is a one-time copy from the enquiry at
// creation time, not a live sync — editing one afterward doesn't touch
// the other.
export function linkedCompanyProfileDoc(enquiry, sourceEnquiryId, sourceEnquiryNo, userId) {
  return {
    clientName: enquiry.clientName,
    address: enquiry.address || "",
    contactPersonName: enquiry.approachedByName || "",
    contactPhone: enquiry.contactPhone || "",
    poNumber: "",
    poValue: null,
    deliveryDueDate: null,
    termsAndConditions: "",
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
