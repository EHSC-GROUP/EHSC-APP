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

export const MEDICAL_CERT_THRESHOLD_DAYS = 3;
export const EXPECTED_MINUTES_PER_DAY = 480; // 8h
export const MAX_PING_CREDIT_MINUTES = 2;
export const ATTENDANCE_RETENTION_MONTHS = 3;
