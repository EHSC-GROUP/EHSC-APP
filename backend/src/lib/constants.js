// Single source of truth for role strings — the reference app this is
// rebuilt from had a role-string mismatch bug in one delete route because
// roles were compared against ad-hoc string literals scattered across the
// codebase. Import ROLES everywhere instead of typing role strings.
export const ROLES = Object.freeze({
  EMPLOYEE: "user",
  ADMIN: "admin",
  SUPERADMIN: "superadmin",
  // A narrow approval-only tier: same self-service access as an employee,
  // plus leave/reimbursement approval for their own department only (see
  // lib/approvals.js's canTeamLeadApprove). Not an ADMIN_ROLES member —
  // deliberately can't touch Settings, other profiles, payslips, etc.
  TEAM_LEAD: "team_lead",
});

export const ADMIN_ROLES = Object.freeze([ROLES.ADMIN, ROLES.SUPERADMIN]);

// Every new login and every admin password reset starts with this password;
// the user is forced to replace it on first sign-in (and can't pick it again).
export const TEMP_PASSWORD = "Welcome@123";

// Profile types: "employee", "admin" and "team_leader" are staff (same HR
// fields); admin additionally gets the admin login role and approves for
// its department, team_leader gets the team_lead login role and approves
// leave/reimbursements for its department (see ROLES.TEAM_LEAD above);
// "associate" is an external party/vendor (formerly "external").
export const PROFILE_TYPE = Object.freeze({
  EMPLOYEE: "employee",
  ADMIN: "admin",
  TEAM_LEADER: "team_leader",
  ASSOCIATE: "associate",
});
export const STAFF_PROFILE_TYPES = Object.freeze([PROFILE_TYPE.EMPLOYEE, PROFILE_TYPE.ADMIN, PROFILE_TYPE.TEAM_LEADER]);

// Fixed department list — leave and money approvals route by department.
export const DEPARTMENTS = Object.freeze(["BD", "HR", "Operations", "Finance", "Business Management"]);

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
  ATTENDANCE_TRAVEL_REQUESTS: "attendance_travel_requests",
  BD_ENQUIRIES: "bd_enquiries",
  COMPANY_PROFILES: "company_profiles",
  PROJECTS: "projects",
  MATERIAL_INDENTS: "material_indents",
  HR_ADVANCES: "hr_advances",
});

// Reimbursement claim types (client requirement: Travel and Accommodation
// tracked separately from each other and from a plain expense claim, plus a
// distinct Advance type for money disbursed before the expense happens).
// GENERAL covers every claim filed before this field existed.
export const REIMBURSEMENT_TYPE = Object.freeze({
  GENERAL: "GENERAL",
  TRAVEL: "TRAVEL",
  ACCOMMODATION: "ACCOMMODATION",
});
// Cash advances are their own module now (COLLECTIONS.HR_ADVANCES). Claims
// filed earlier with type ADVANCE still exist and just keep that label.
export const LEGACY_REIMBURSEMENT_TYPES = Object.freeze(["ADVANCE"]);

// Fixed set shown in the New Enquiry marketing-source dropdown.
export const MARKETING_SOURCE_OPTIONS = Object.freeze([
  "Email Campaign",
  "Referral",
  "Website",
  "Exhibition",
]);

// Who referred the enquiry, when marketingSource is "Referral" — either one
// of our own employees, or a named external person (with contact number)
// who isn't in the system.
export const REFERRAL_TYPE = Object.freeze({
  EMPLOYEE: "EMPLOYEE",
  EXTERNAL: "EXTERNAL",
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

// Money approvals are two-step: the employee's department admin first
// (PENDING -> DEPT_APPROVED), then the superadmin gives final approval
// (DEPT_APPROVED -> APPROVED). SETTLED = fully covered by the employee's
// advance wallet, so nothing is left to pay out.
// Departments with an assigned Team Leader get an extra step in front:
// PENDING -> TL_APPROVED -> DEPT_APPROVED -> APPROVED. Departments with no
// team leader skip straight to the normal two-step flow.
export const REIMBURSEMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  TL_APPROVED: "TL_APPROVED",
  DEPT_APPROVED: "DEPT_APPROVED",
  APPROVED: "APPROVED",
  SETTLED: "SETTLED",
  PAID: "PAID",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

// Material Indent Form (MIF): an employee requests materials/items for a
// job; admin verifies & approves before procurement. Mirrors the
// reimbursement/leave PENDING -> APPROVED|REJECTED (+ CANCELLED) shape.
export const MATERIAL_INDENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

// Advance requests use the same two-step approval; APPROVED credits the
// employee's advance wallet (remainingBalance = amount).
export const ADVANCE_STATUS = Object.freeze({
  PENDING: "PENDING",
  DEPT_APPROVED: "DEPT_APPROVED",
  APPROVED: "APPROVED",
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
// a free dropdown a user picks for themself. Payroll reads these records to
// fill a payslip's Present Days (see attendanceQuery.js / payslipCompute.js);
// this module never writes to a payslip itself.
export const ATTENDANCE_STATUS_VALUES = Object.freeze({
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  LEAVE: "LEAVE",
  HALF_DAY: "HALF_DAY",
  OUT_OF_OFFICE: "OUT_OF_OFFICE",
  TRAVEL: "TRAVEL",
});

export const ATTENDANCE_SOURCE = Object.freeze({
  ADMIN: "ADMIN",
  SELF_GEOFENCE: "SELF_GEOFENCE",
  BULK: "BULK",
  SELF_OOO_REQUEST: "SELF_OOO_REQUEST",
  SELF_TRAVEL_REQUEST: "SELF_TRAVEL_REQUEST",
});

export const GEOFENCE_RADIUS_MIN_METERS = 10;
export const GEOFENCE_RADIUS_MAX_METERS = 5000;

// Out-of-office requests: an employee whose self check-in fails the
// geofence can ask to be marked Out of Office instead of just being
// rejected — but it only ever becomes an actual attendance-status record
// once an admin approves it (mirrors the leave-request PENDING/APPROVED/
// REJECTED flow), preserving the same "never a free self-picked status"
// rule the rest of this module enforces. Travel requests (a separate
// collection, ATTENDANCE_TRAVEL_REQUESTS) reuse this same status enum —
// same admin-approval shape, different trigger (proactively planned work
// travel, not a failed geofence check).
export const OOO_REQUEST_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

// Toggleable, admin-controlled features that ship disabled until a
// dependency is ready (e.g. project-wise reimbursement costing needs the
// Project Management module finalized and live first). Stored in
// hr_settings/feature_flags — see lib/featureFlags.js.
export const FEATURE_FLAG_DEFAULTS = Object.freeze({
  projectCosting: false,
  // The whole PM suite (Business Development, Company Profiles, Project
  // Tracker) — off for the EHSC HR/Payroll go-live; flip on in Settings
  // when SARN wants it back.
  projectManagement: false,
});
