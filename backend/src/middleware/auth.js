  import { verifyToken } from "../lib/jwt.js";
  import { db } from "../config/firebase.js";
  import { ADMIN_ROLES, ROLES, COLLECTIONS, PROFILE_TYPE } from "../lib/constants.js";

  // The role inside a login token is only a snapshot from sign-in. So that a
  // role change (or archiving someone) takes effect straight away rather than
  // at the token's expiry, every request re-reads the user's current role —
  // cached for a few seconds so it isn't a database read per request.
  const STATE_TTL_MS = 15 * 1000;
  const stateCache = new Map(); // userId -> { at, state }

  export function invalidateUserState(userId) {
    stateCache.delete(userId);
  }

  async function loadUserState(userId) {
    const hit = stateCache.get(userId);
    if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit.state;
    const userSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    let state = null;
    if (userSnap.exists && !userSnap.data().disabled) {
      const role = userSnap.data().role;
      let profileType = null;
      if (role === ROLES.EMPLOYEE) {
        const profileSnap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(userId).get();
        profileType = profileSnap.exists ? profileSnap.data().type : null;
      }
      state = { role, name: userSnap.data().name, isAssociate: profileType === PROFILE_TYPE.ASSOCIATE };
    }
    stateCache.set(userId, { at: Date.now(), state });
    return state;
  }

  // Associates (external parties) can only use Reimbursements for now: the
  // routes that page needs, and nothing else.
  const ASSOCIATE_ALLOWED_PREFIXES = [
    "/api/auth", "/api/reimbursements", "/api/advances", "/api/me",
    "/api/settings", "/api/projects", "/api/notifications",
  ];

  export async function authenticate(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    try {
      const state = await loadUserState(payload.userId);
      if (!state) return res.status(401).json({ error: "This account is no longer active" });
      if (state.isAssociate && !ASSOCIATE_ALLOWED_PREFIXES.some((p) => req.baseUrl === p || req.baseUrl.startsWith(`${p}/`))) {
        return res.status(403).json({ error: "Associates can only use Reimbursements" });
      }
      req.user = { ...payload, role: state.role }; // { userId, name, role } — role is the current one
      next();
    } catch (err) {
      next(err);
    }
  }

  export function requireAdmin(req, res, next) {
    if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  }

  export function requireSuperAdmin(req, res, next) {
    if (!req.user || req.user.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({ error: "Super admin access required" });
    }
    next();
  }

  // Admin/superadmin, plus a Team Lead — for the handful of leave and
  // reimbursement routes a Team Lead needs to reach. The fine-grained check
  // (which department, which stage) still happens inside the route via
  // canDeptApprove/canTeamLeadApprove — this only gets them past the door.
  export function requireApprover(req, res, next) {
    if (!req.user || ![...ADMIN_ROLES, ROLES.TEAM_LEAD].includes(req.user.role)) {
      return res.status(403).json({ error: "Approver access required" });
    }
    next();
  }
