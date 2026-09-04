import { verifyToken } from "../lib/jwt.js";
import { ADMIN_ROLES } from "../lib/constants.js";

export function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  try {
    const payload = verifyToken(token);
    req.user = payload; // { userId, name, role }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
