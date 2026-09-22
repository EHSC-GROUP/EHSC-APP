import { db } from "../config/firebase.js";
import { COLLECTIONS, ROLES, PROFILE_TYPE, REIMBURSEMENT_STATUS } from "./constants.js";

// ---- Department-based approval routing --------------------------------
// Each admin profile belongs to exactly one department and only acts on
// requests from employees of that same department. The superadmin is
// global but only performs the FINAL step of a money approval — they do
// not stand in for a missing department admin (a request whose department
// has no admin simply waits until one is assigned).

export async function loadDepartmentMap() {
  const snap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).get();
  const byUser = new Map();
  for (const d of snap.docs) byUser.set(d.id, d.data().department || null);
  return byUser;
}

export async function getDepartmentOf(userId) {
  const snap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(userId).get();
  return snap.exists ? snap.data().department || null : null;
}

// dept -> [admin userIds] (admin-type profiles whose login isn't archived).
export async function loadDepartmentAdmins() {
  const [profiles, users] = await Promise.all([
    db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "==", PROFILE_TYPE.ADMIN).get(),
    db.collection(COLLECTIONS.USERS).get(),
  ]);
  const disabled = new Set(users.docs.filter((u) => u.data().disabled).map((u) => u.id));
  const map = new Map();
  for (const p of profiles.docs) {
    const dept = p.data().department;
    if (!dept || disabled.has(p.id)) continue;
    if (!map.has(dept)) map.set(dept, []);
    map.get(dept).push(p.id);
  }
  return map;
}

const isAdminRole = (role) => role === ROLES.ADMIN || role === ROLES.SUPERADMIN;

// Step 1 (and single-step leave): the approver must be an admin whose own
// profile department matches the requester's department, and must not be
// approving their own request.
export async function canDeptApprove(user, request) {
  if (!isAdminRole(user.role)) return false;
  if (user.userId === request.userId) return false;
  const [approverDept, requesterDept] = await Promise.all([getDepartmentOf(user.userId), getDepartmentOf(request.userId)]);
  return !!approverDept && approverDept === requesterDept;
}

// dept -> [team-lead userIds] (team_leader-type profiles whose login isn't
// archived) — mirrors loadDepartmentAdmins. A department with no entry here
// has no team lead, so reimbursements for it skip straight to the normal
// two-step (dept admin, then superadmin) flow.
export async function loadDepartmentTeamLeads() {
  const [profiles, users] = await Promise.all([
    db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "==", PROFILE_TYPE.TEAM_LEADER).get(),
    db.collection(COLLECTIONS.USERS).get(),
  ]);
  const disabled = new Set(users.docs.filter((u) => u.data().disabled).map((u) => u.id));
  const map = new Map();
  for (const p of profiles.docs) {
    const dept = p.data().department;
    if (!dept || disabled.has(p.id)) continue;
    if (!map.has(dept)) map.set(dept, []);
    map.get(dept).push(p.id);
  }
  return map;
}

// Team Leader's own approval step: leave (single-step, alongside
// canDeptApprove) and the first stage of reimbursements for a department
// that has a team lead assigned.
export async function canTeamLeadApprove(user, request) {
  if (user.role !== ROLES.TEAM_LEAD) return false;
  if (user.userId === request.userId) return false;
  const [approverDept, requesterDept] = await Promise.all([getDepartmentOf(user.userId), getDepartmentOf(request.userId)]);
  return !!approverDept && approverDept === requesterDept;
}

// Step 2: superadmin only, and never on their own request.
export function canFinalApprove(user, request) {
  return user.role === ROLES.SUPERADMIN && user.userId !== request.userId;
}

// For list endpoints: null = see everything (superadmin), otherwise the
// department whose requests this admin may see ("" = admin has no
// department, so they see nothing).
export async function visibleDepartmentFor(user) {
  if (user.role === ROLES.SUPERADMIN) return null;
  return (await getDepartmentOf(user.userId)) || "";
}

export function filterByDepartment(list, visibleDepartment, departmentMap) {
  if (visibleDepartment === null) return list;
  return list.filter((r) => departmentMap.get(r.userId) === visibleDepartment);
}

// Superadmin may cancel anything still pre-final; a department admin only
// their own department's.
export async function canAdminCancel(user, request) {
  if (user.role === ROLES.SUPERADMIN) return true;
  if (user.role !== ROLES.ADMIN) return false;
  const [a, r] = await Promise.all([getDepartmentOf(user.userId), getDepartmentOf(request.userId)]);
  return !!a && a === r;
}

// Human-readable "who is this waiting on" for the two-step money flow —
// makes a request stuck for want of a department admin visible, not silent.
// departmentTeamLeads is optional — pass it (reimbursements only) to surface
// the extra team-lead stage where a department has one assigned.
export function awaitingNote(status, department, departmentAdmins, departmentTeamLeads) {
  if (status === "PENDING") {
    if (!department) return "Employee has no department set";
    if (departmentTeamLeads?.has(department)) return `Awaiting ${department} team leader`;
    return departmentAdmins.has(department) ? `Awaiting ${department} department admin` : `No admin assigned to ${department} yet`;
  }
  if (status === REIMBURSEMENT_STATUS.TL_APPROVED) return `Awaiting ${department} department admin`;
  if (status === "DEPT_APPROVED") return "Awaiting superadmin final approval";
  return null;
}

// Per-row permissions for the current user on a two-step money request
// (reimbursement or advance — advances never have a team-lead stage). What
// buttons the UI should offer.
export async function moneyActions(user, request) {
  const deptOk = request.status === "PENDING" ? await canDeptApprove(user, request) : false;
  const finalOk = request.status === "DEPT_APPROVED" ? canFinalApprove(user, request) : false;
  const cancellable = request.status === "PENDING" || request.status === "DEPT_APPROVED";
  return {
    canDeptApprove: deptOk,
    canFinalApprove: finalOk,
    canReject: deptOk || finalOk,
    canCancel: cancellable && (await canAdminCancel(user, request)),
  };
}

// Same as moneyActions, but reimbursement-specific: departments with a team
// lead assigned get a PENDING -> TL_APPROVED stage in front of the normal
// two-step flow; departments without one behave exactly like moneyActions.
export async function reimbursementActions(user, request, departmentTeamLeads) {
  const deptHasTL = departmentTeamLeads.has(request.department);
  let tlOk = false;
  let deptOk = false;
  let finalOk = false;
  if (request.status === REIMBURSEMENT_STATUS.PENDING) {
    if (deptHasTL) tlOk = await canTeamLeadApprove(user, request);
    else deptOk = await canDeptApprove(user, request);
  } else if (request.status === REIMBURSEMENT_STATUS.TL_APPROVED) {
    deptOk = await canDeptApprove(user, request);
  } else if (request.status === REIMBURSEMENT_STATUS.DEPT_APPROVED) {
    finalOk = canFinalApprove(user, request);
  }
  const cancellable = [REIMBURSEMENT_STATUS.PENDING, REIMBURSEMENT_STATUS.TL_APPROVED, REIMBURSEMENT_STATUS.DEPT_APPROVED].includes(request.status);
  return {
    canTeamLeadApprove: tlOk,
    canDeptApprove: deptOk,
    canFinalApprove: finalOk,
    canReject: tlOk || deptOk || finalOk,
    canCancel: cancellable && (await canAdminCancel(user, request)),
  };
}
