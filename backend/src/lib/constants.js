// Single source of truth for role strings — the reference app this is
// rebuilt from had a role-string mismatch bug in one delete route because
// roles were compared against ad-hoc string literals scattered across the
// codebase. Import ROLES everywhere instead of typing role strings.
export const ROLES = Object.freeze({
  EMPLOYEE: "user",
  ADMIN: "admin",
  SUPERADMIN: "superadmin",
});

export const ADMIN_ROLES = Object.freeze([ROLES.ADMIN, ROLES.SUPERADMIN]);

export const COLLECTIONS = Object.freeze({
  USERS: "users",
  HR_EMPLOYEE_PROFILES: "hr_employee_profiles",
  HR_SALARY_STRUCTURES: "hr_salary_structures",
  HR_DOCUMENTS: "hr_documents",
  HR_BILLS: "hr_bills",
  HR_HOLIDAYS: "hr_holidays",
  HR_SETTINGS: "hr_settings",
  HR_LEAVE_TYPES: "hr_leave_types",
  HR_LEAVE_BALANCES: "hr_leave_balances",
  HR_LEAVE_REQUESTS: "hr_leave_requests",
  HR_REIMBURSEMENTS: "hr_reimbursements",
  HR_PAYSLIPS: "hr_payslips",
  ATTENDANCE_LOGS: "attendance_logs",
  ATTENDANCE_STATUS: "attendance_status",
  ATTENDANCE_OOO_REQUESTS: "attendance_ooo_requests",
  BD_ENQUIRIES: "bd_enquiries",
  COMPANY_PROFILES: "company_profiles",
});

// Synthetic, non-configurable leave types. Never stored in HR_LEAVE_TYPES,
// never selectable in the self-service apply form.
export const LOP = "LOP";
export const HALF_DAY = "HALF_DAY";

export const LEAVE_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

export const REIMBURSEMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  PAID: "PAID",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

export const PAYSLIP_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  FINALIZED: "FINALIZED",
  PUBLISHED: "PUBLISHED",
});

export const APPROACH_MODE = Object.freeze({
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  ON_SITE: "ON_SITE",
});

// "Result" is the enquiry's current outcome/stage. IN_PROGRESS is the
// default for a freshly logged enquiry; the other four are exactly the
// terminal outcomes the business asked to track.
export const BD_RESULT = Object.freeze({
  IN_PROGRESS: "IN_PROGRESS",
  PURCHASE_ORDER_RECEIVED: "PURCHASE_ORDER_RECEIVED",
  CONTRACT_ACCEPTED: "CONTRACT_ACCEPTED",
  ENQUIRY_ON_HOLD: "ENQUIRY_ON_HOLD",
  ENQUIRY_DROPPED: "ENQUIRY_DROPPED",
});

export const MEDICAL_CERT_THRESHOLD_DAYS = 3;
export const ATTENDANCE_RETENTION_MONTHS = 3;

// Daily attendance STATUS (present/absent/leave/half-day/out-of-office) —
// an integrity-controlled ledger of who was actually marked present each day:
// an admin sets it directly, or an employee self-check-in sets it, but only
// when validated server-side against the configured office geofence. Never
// a free dropdown a user picks for themself. Kept fully decoupled from
// payroll — Present Days there is manual-entry-only, always (see
// payslipCompute.js) — this module never writes to a payslip.
export const ATTENDANCE_STATUS_VALUES = Object.freeze({
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  LEAVE: "LEAVE",
  HALF_DAY: "HALF_DAY",
  OUT_OF_OFFICE: "OUT_OF_OFFICE",
});

export const ATTENDANCE_SOURCE = Object.freeze({
  ADMIN: "ADMIN",
  SELF_GEOFENCE: "SELF_GEOFENCE",
  BULK: "BULK",
  SELF_OOO_REQUEST: "SELF_OOO_REQUEST",
});

export const GEOFENCE_RADIUS_MIN_METERS = 10;
export const GEOFENCE_RADIUS_MAX_METERS = 5000;

// Out-of-office requests: an employee whose self check-in fails the
// geofence can ask to be marked Out of Office instead of just being
// rejected — but it only ever becomes an actual attendance-status record
// once an admin approves it (mirrors the leave-request PENDING/APPROVED/
// REJECTED flow), preserving the same "never a free self-picked status"
// rule the rest of this module enforces.
export const OOO_REQUEST_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});
